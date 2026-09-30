# 故障排查

## 现象 → 原因 → 处理

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `未找到 dsh-opencode-xdbridge 插件的核心模块` | 没装插件，且未设 `OPENCODE_BRIDGE_PLUGIN_LIB` | `dsh plugin --profile <p> add github:XDTrees/dsh-opencode-xdbridge`，或 clone 后用 env 指过去 |
| `需要 Node ^22.19 || >=24` | node 太旧 | 升级 node（或用 WorkBuddy 受管 node） |
| 请求返回 401 `需要本地桥接 API key` | 没带对 token | `Authorization: Bearer <models.json 里的 apiKey>` |
| 请求返回 403 `仅允许本机回环访问` | Host/Origin 不是回环 | 只从 127.0.0.1 访问，别从浏览器页面调 |
| 请求返回 403 `FreeTierError` | 权限策略被改坏（`deny` / `tools:false`） | 不要改 `permission`；本工具固定用 `{'*':'ask'}` |
| 直连 `opencode.ai/zen` 被拒 | 免费档门禁 | 不要直连，必须经真实 opencode 进程 |
| `/health` 不响应 / 端口拒绝 | 桥接没起或崩了 | 看 `~/.workbuddy/opencode-bridge/runtime-data/opencode.log`；重启 bridge |
| `EADDRINUSE` 3199 | 端口被占（已有桥接在跑） | 复用现有实例，或改 `OPENCODE_BRIDGE_PORT` |
| 桥接起不来，日志说下载失败 | 首次需要下载 opencode（约 57MB） | 检查网络/代理；或设 `OPENCODE_BRIDGE_BINARY` 指向已有二进制 |
| WorkBuddy 里看不到模型 | models.json 改了但没重启 | **重启 WorkBuddy**；确认 `scheduled` 后 models.json 有 `opencode/…` 条目 |
| 个别模型请求失败 | 免费额度限流 / 地区限制 | 正常；换一个模型，稍后重试 |
| 重启桥接后端点变了 | 端口固定，一般不变；若改了端口则 models.json 要重同步 | 重跑 `sync-workbuddy-models.mjs` |

## 快速自检

```bash
# 桥接存活
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:3199/health

# 列模型
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:3199/v1/models

# 真实请求（证明门禁已绕过）
curl -s -X POST http://127.0.0.1:3199/v1/chat/completions \
  -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
  -d '{"model":"opencode/big-pickle","messages":[{"role":"user","content":"1+1=?"}],"stream":false}'

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
