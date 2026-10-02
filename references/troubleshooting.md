# 故障排查

## 第一步永远是自愈

```bash
node scripts/doctor.mjs
```

会自动判断坏在哪一层并修复（拉起桥接 / 重启上游 / 重同步 models.json），
修不好才需要看下面的对照表。加 `--check` 只诊断不改动，加 `--json` 出机器可读结果。

若 doctor 报「端口被其他程序占用」，它**不会**结束对方进程——改用
`OPENCODE_BRIDGE_PORT=3399 node scripts/doctor.mjs` 换个端口即可。

## 现象 → 原因 → 处理

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| **模型突然全部不可用，日志见 `ECONNREFUSED 127.0.0.1:<随机端口>`** | **上游 `opencode serve` 子进程静默死亡**（崩溃/OOM/被杀），而桥接进程还活着 | v1.0.3 起桥接会**自动恢复**（见下节）；旧版需手动重启桥接 |
| `/health` 返回 `ok:false` + `upstreamAlive:false` | 上游已死，正在自动恢复中 | 等 2–5 秒后重试；若长期不恢复看下节 |
| `/health` 返回 `recovering:true` | 正在自动重启上游，属正常瞬间状态 | 稍后重试请求即可 |
| `restarts` 持续增大且不回到 0 | 上游反复崩溃（crash loop） | 看日志定位；检查内存压力；`OPENCODE_BRIDGE_MAX_RESTARTS` 控制恢复预算 |
| 自动恢复达到上限后不再重试 | 恢复预算用尽（默认 5 次） | `curl -X POST /admin/restart` 手动复位；或设 `OPENCODE_BRIDGE_EXIT_ON_FAILURE=1` 让 launchd 重新拉起 |
| `未找到 dsh-opencode-xdbridge 插件的核心模块` | 没装插件，且未设 `OPENCODE_BRIDGE_PLUGIN_LIB` | `dsh plugin --profile <p> add github:XDTrees/dsh-opencode-xdbridge`，或 clone 后用 env 指过去 |
| `需要 Node ^22.19 || >=24` | node 太旧 | 升级 node（或用 WorkBuddy 受管 node） |
| 请求返回 401 `需要本地桥接 API key` | 没带对 token | `Authorization: Bearer <models.json 里的 apiKey>` |
| 请求返回 403 `仅允许本机回环访问` | Host/Origin 不是回环 | 只从 127.0.0.1 访问，别从浏览器页面调 |
| 请求返回 403 `FreeTierError` | 权限策略被改坏（`deny` / `tools:false`） | 不要改 `permission`；本工具固定用 `{'*':'ask'}` |
| 直连 `opencode.ai/zen` 被拒 | 免费档门禁 | 不要直连，必须经真实 opencode 进程 |
| `/health` 不响应 / 端口拒绝 | 桥接进程本身没起或崩了 | 看 `~/.workbuddy/opencode-bridge/runtime-data/opencode.log`；重启桥接 |
| `EADDRINUSE` 3199 | 端口被占（已有桥接在跑） | 复用现有实例，或改 `OPENCODE_BRIDGE_PORT` |
| 桥接起不来，日志说下载失败 | 首次需要下载 opencode（约 57MB） | 检查网络/代理；或设 `OPENCODE_BRIDGE_BINARY` 指向已有二进制；或 `OPENCODE_BRIDGE_NO_DOWNLOAD=1` 强制只用本机 |
| WorkBuddy 里看不到模型 | models.json 改了但没重启 | **重启 WorkBuddy**；确认 models.json 有 `opencode/…` 条目 |
| WorkBuddy 请求本地桥接报 `upstream connect failed` | **WorkBuddy 走了系统代理**，没绕过回环地址 | 桥接监听 127.0.0.1，必须绕过代理。用 `--noproxy '*'` 验证；注意 `HTTP_PROXY` 指向本机某端口时更易踩 |
| 个别模型请求失败 | 免费额度限流 / 地区限制 | 正常；换一个模型，稍后重试 |
| 重启桥接后端点变了 | 端口固定，一般不变；若改了端口则 models.json 要重同步 | 重跑 `sync-workbuddy-models.mjs` |

## 上游崩溃与自动恢复（v1.0.3）

上游 `opencode serve` 是一个独立子进程，可能崩溃、被 OOM 杀掉或静默退出。
**旧版桥接不感知**：进程本身还在监听 3199，但所有转发请求都打向已死的端口，
表现为「模型突然全部不可用」。这与插件文档描述的是同一个坑：

> *"Without this the plugin would keep advertising a dead endpoint forever:
> the runtime has no health check and startBackend only notices spawn failures."*

v1.0.3 的对策（对齐 `dsh-opencode-xdbridge` 插件的做法）：

1. **传 `onExit` 回调** → 上游一退出立刻感知（不再傻等）；
2. **运行时用 getter 取，不缓存引用** → 重启后请求自动走新实例；
3. **两处触发恢复**：子进程 exit 事件 + 请求遇到 `ECONNREFUSED`（覆盖"死了但 exit 还没被处理"的窗口）；
4. **有界恢复**：默认最多 5 次，2 秒间隔；上游若稳定存活 60 秒则预算重置，
   避免长期运行中被历史崩溃耗尽；
5. **每次重启后重写 `endpoint.json`**，模型清单保持准确。

### 验证自愈

```bash
# 1) 记录当前上游 pid
pgrep -fl "opencode-bridge.*opencode serve"

# 2) 杀掉上游，模拟崩溃
pkill -f "opencode-bridge/runtime-data.*opencode serve"

# 3) 立刻看状态（应出现 recovering:true / upstreamAlive:false）
curl -s --noproxy '*' -H "Authorization: Bearer <token>" http://127.0.0.1:3199/health

# 4) 等约 20 秒再看（应恢复 ok:true，且 restarts 计数 +1）
curl -s --noproxy '*' -H "Authorization: Bearer <token>" http://127.0.0.1:3199/health
```

### 手动恢复

```bash
curl -s -X POST --noproxy '*' -H "Authorization: Bearer <token>" http://127.0.0.1:3199/admin/restart
```

## 快速自检

```bash
# 桥接存活（注意 --noproxy，避免被系统代理吞掉）
curl -s --noproxy '*' -H "Authorization: Bearer <token>" http://127.0.0.1:3199/health
# → {"ok":true,"bridge":true,"models":N,"upstreamAlive":true,"recovering":false,"restarts":0}

# 列模型
curl -s --noproxy '*' -H "Authorization: Bearer <token>" http://127.0.0.1:3199/v1/models

# 真实请求（证明门禁已绕过）
curl -s --noproxy '*' -X POST http://127.0.0.1:3199/v1/chat/completions \
  -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
  -d '{"model":"opencode/big-pickle","messages":[{"role":"user","content":"1+1=?"}],"stream":false}'

# 上游进程是否在
pgrep -fl "opencode-bridge.*opencode serve"

# 配置一致性
node scripts/verify.mjs
```

## 关键路径

| 用途 | 路径 |
| --- | --- |
| 桥接状态 / 端点 | `~/.workbuddy/opencode-bridge/endpoint.json` |
| opencode 运行时日志 | `~/.workbuddy/opencode-bridge/runtime-data/opencode.log` |
| WorkBuddy 模型清单 | `~/.workbuddy/models.json`（备份 `models.json.bak.*`） |
| 插件核心模块 | `$DSH_HOME/profiles/*/node_modules/dsh-opencode-xdbridge/lib` |
