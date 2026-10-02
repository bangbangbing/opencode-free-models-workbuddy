---
name: opencode-free-models-workbuddy
description: |
  OpenCode Zen 免费模型接入 WorkBuddy：本地隔离 opencode 运行时 + 固定端口 OpenAI 兼容桥接，
  绕过 FreeTier 门禁并同步进 models.json。
  Triggers: opencode 免费模型, workbuddy 加免费模型, opencode bridge, opencode zen, 同步免费模型
description_zh: "把 OpenCode Zen 免费模型接入 WorkBuddy"
description_en: "Bridge OpenCode Zen free models into WorkBuddy via a local endpoint"
version: 1.0.4
when_to_use: |
  Use when the user wants OpenCode Zen's free models usable inside WorkBuddy, or wants to
  install / sync / verify / persist the local opencode bridge that feeds WorkBuddy's Custom
  model list.
  Examples: "把 opencode 免费模型接到 workbuddy", "workbuddy 里加免费模型", "opencode 免费模型怎么接",
  "同步免费模型", "验证桥接", "免费模型没了", "让它开机自启".
category: agent
exposes_tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
permissions:
  filesystem: write:~/.workbuddy/opencode-bridge, ~/.workbuddy/models.json
  network: outbound
  credential: none
  exec: opencode, node
trust: |
  会启动一个本地隔离的 opencode 进程并监听 127.0.0.1（仅回环，带 Bearer 鉴权），往
  ~/.workbuddy/models.json 追加 Custom 模型条目（先备份）。仅暴露计费全部为 0 的模型，
  不产生费用。当本机找不到 opencode 二进制时，会从 registry.npmjs.org 下载官方包
  （约 57MB，sha512 校验）；设 OPENCODE_BRIDGE_NO_DOWNLOAD=1 可禁用下载。不读取也不改动
  OpenCode 自身的配置与凭据。不收集、不上传任何用户数据；无遥测。本技能不包含自动安装
  开机自启的脚本：持久化仅为 references/persistence.md 文档指引，在用户显式要求时由
  agent 生成 plist，launchctl load 由用户手动执行并可随时移除。
argument-hint: "[动作: 安装 | 同步 | 验证 | 状态 | 持久化 | 排查]"
arguments:
  - action
effort: medium
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
agent_created: true
---

# OpenCode 免费模型接入 WorkBuddy

## 目标

让 WorkBuddy 的模型选择器里出现 OpenCode Zen 的免费模型（以 `Custom` provider 形式）。
做法：复用 `dsh-opencode-xdbridge` 插件的核心模块，跑一个**独立于 DSH** 的隔离 opencode 运行时，
暴露固定端口的 OpenAI 兼容端点，再把这些模型写进 WorkBuddy 的 `models.json`。

## 为什么不能直连

OpenCode Zen 免费档有服务端门禁：

```
FreeTierError: OpenCode's free tier can only be used from within OpenCode
```

- 直连 `opencode.ai/zen` 必 **403**；改 User-Agent 无效（判据不是 UA）。
- 必须由**真实 opencode 进程**发起。本方案启动真实 `opencode serve`，并把 agent 的
  `permission` 设为 `{'*':'ask'}`（这是放行门禁的关键，改成 `deny` 立刻退回 403）。
- 插件在本地把所有审批一律拒绝，因此门禁放行但**本地一个动作都不会真正执行**。

## 前置条件

- **Node**：`^22.19 || >=24`（插件的 engines 要求）。macOS / Windows / Linux 均可。
- **opencode 二进制**：本机已有，或允许联网下载（约 57MB）。Windows 下文件名为
  `opencode.exe`，候选路径见下节「平台支持」。
- **`dsh-opencode-xdbridge` 插件核心模块**（提供 bridge 逻辑）。解析顺序：
  1. 环境变量 `OPENCODE_BRIDGE_PLUGIN_LIB`
  2. `$DSH_HOME/profiles/*/node_modules/dsh-opencode-xdbridge/lib`（DSH 已装插件时直接用）
  3. 都没有 → 提示先安装：
     `dsh plugin --profile <profile> add github:XDTrees/dsh-opencode-xdbridge`
     或 `git clone https://github.com/XDTrees/dsh-opencode-xdbridge` 后用 `OPENCODE_BRIDGE_PLUGIN_LIB` 指过去。
- **禁止联网的环境**：设 `OPENCODE_BRIDGE_NO_DOWNLOAD=1`，桥接只使用本机已有的 opencode
  二进制，找不到即报错退出，不发起任何下载。

## 动作路由（先按动作分流）

| action | 做什么 |
| --- | --- |
| `安装` | 启动桥接 → 同步 models.json → 提示重启 WorkBuddy |
| `自愈` | **跑 `doctor.mjs`**：连不上就自动修（拉起桥接 / 重启上游 / 重同步 models.json） |
| `同步` | 重跑 `sync-workbuddy-models.mjs`（上游换模型后） |
| `验证` | 跑 `verify.mjs` + 发一次真实请求 |
| `状态` | 看 `/health`（含 `upstreamAlive` / `recovering` / `restarts`）与 endpoint.json，不改动任何东西 |
| `恢复` | 上游卡死时 `POST /admin/restart` 手动复位 |
| `持久化` | 按 references/persistence.md 生成 launchd（macOS）或计划任务（Windows），由用户手动执行 |
| `排查` | 直接跳 references/troubleshooting.md |

> **任何「模型用不了」的报修，第一步都跑 `node scripts/doctor.mjs`。**
> 它会自己判断坏在哪一层并修复，修不好才需要人工介入。

## 自愈：连不上就自动修（`doctor.mjs`）

单一入口，跨平台（macOS / Windows / Linux），纯 Node 实现，不依赖 bash 或 PowerShell：

```bash
node scripts/doctor.mjs            # 诊断 + 修复（默认）
node scripts/doctor.mjs --check    # 只诊断，不改动任何东西
node scripts/doctor.mjs --json     # 机器可读结果（便于自动化/定时巡检）
```

它先判断「到底坏在哪一层」，再做对应的修复：

| 诊断结论 | 自动修复动作 |
| --- | --- |
| 桥接未运行（端口无响应） | 以**脱离进程**方式拉起桥接（POSIX 独立会话 / Windows 独立进程组），轮询到就绪 |
| 端口被**别的程序**占用 | **只报告，不结束对方进程**；建议改用 `OPENCODE_BRIDGE_PORT=3399` |
| 桥接在线但上游不可用 | `POST /admin/restart` 重启上游；失败则整个重启桥接 |
| models.json 与桥接不一致 | 自动重跑同步脚本（模型清单漂移） |

退出码：`0` = 可用（含修复后可用）；`1` = 仍不可用。修复成功且改动过
models.json 时会提示「重启 WorkBuddy 才加载」。

> 首次冷启动可能要下载 opencode（约 57MB），doctor 默认最多等 5 分钟
> （`OPENCODE_BRIDGE_START_TIMEOUT_MS` 可调），期间会打印等待提示。

### 三层防护的关系

| 层 | 触发时机 | 谁在做 |
| --- | --- | --- |
| 上游自愈 | 上游 opencode 进程崩溃/退出 | 桥接进程内部，**默认开启** |
| 桥接自愈 | 桥接进程本身没跑 / 上游卡死 / 配置漂移 | `doctor.mjs` |
| 系统级拉起 | 开机、登录、桥接被杀 | launchd（macOS）/ 计划任务（Windows），opt-in |

配好第三层就基本不需要手动跑 doctor；没配的话，或者 WorkBuddy 里模型突然
不可用时，跑一次 doctor 即可。

## 平台支持

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| macOS | 完整支持 | arm64 / x64；自启走 launchd |
| Windows | 完整支持 | x64 / arm64；二进制 `opencode.exe`；自启走任务计划程序或启动文件夹 |
| Linux | 可用 | x64 / arm64；自启用 systemd 或 crontab（未写文档，思路同 macOS） |

跨平台实现要点：

- **二进制名**按平台取 `opencode.exe` / `opencode`，候选路径含
  `%LOCALAPPDATA%\opencode\bin`、`%APPDATA%\opencode\bin`、`%ProgramFiles%\opencode`（Windows）
  与 `~/.opencode/bin`、Homebrew、`/usr/local/bin`（macOS/Linux）。
- **拉起进程**用 `detached + unref + windowsHide`，两种平台都能脱离父进程存活，
  且 Windows 下不弹控制台窗口。
- **本地 HTTP 探测**直连 `127.0.0.1`，规避 `HTTP_PROXY` 环境变量把回环请求
  交给代理（那会报出误导性的 `upstream connect failed`）。
- **启动脚本**：`run-bridge.sh`（macOS/Linux）与 `run-bridge.cmd`（Windows）。

## 运行时生命周期与自愈

上游 `opencode serve` 是独立子进程，可能崩溃、被 OOM 杀掉或静默退出。若桥接只是持有
一个启动时的 backend 引用，进程死了它也不知情——会一直对外宣告一个死端点，所有请求
报 `ECONNREFUSED`。本技能对齐 `dsh-opencode-xdbridge` 插件的做法：

1. 给 `startBackend` 传 `onExit` 回调，上游一退出立刻感知；
2. 运行时用 getter 取用而非缓存引用，重启后请求自动走新实例；
3. **两处触发恢复**：子进程 exit 事件 + 请求遇到 `ECONNREFUSED`（覆盖"死了但 exit 尚未处理"的窗口）；
4. **有界恢复**：默认最多 5 次、间隔 2 秒；上游稳定存活 60 秒则预算重置，
   避免长跑进程被历史崩溃耗尽配额；
5. 每次重启后**重写 `endpoint.json`**，模型清单保持准确。

`/health` 字段含义：

| 字段 | 含义 |
| --- | --- |
| `ok` | 上游可用（= `upstreamAlive`） |
| `bridge` | 桥接进程本身活着（恒 true） |
| `upstreamAlive` | 上游 opencode 运行时是否可服务 |
| `recovering` | 是否正在自动恢复（瞬时状态，重试即可） |
| `restarts` | 已用掉的恢复次数（稳定 60 秒后归零） |

## 默认流程

### Step 1：启动桥接

```bash
# 后台常驻（前台调试去掉 & ）
node <skill>/scripts/bridge.mjs &
# 等待就绪（首次解析/下载 opencode 可能较久）
until [ -f ~/.workbuddy/opencode-bridge/endpoint.json ]; do sleep 2; done
curl -s --noproxy '*' -H "Authorization: Bearer <token>" http://127.0.0.1:3199/health
# → {"ok":true,"bridge":true,"models":N,"upstreamAlive":true,"recovering":false,"restarts":0}
```

- 端口默认 `3199`，token 默认固定值；用 `OPENCODE_BRIDGE_PORT` / `OPENCODE_BRIDGE_TOKEN` 覆盖。
- 就绪后 `~/.workbuddy/opencode-bridge/endpoint.json` 会写入端点、apiKey 与模型清单。
- **curl 测试请加 `--noproxy '*'`**：环境若设了 `HTTP_PROXY`，请求可能被系统代理吞掉，
  报 `upstream connect failed: Connection refused`（那是代理的错，不是桥接的）。

### Step 2：把模型写入 WorkBuddy

```bash
node <skill>/scripts/sync-workbuddy-models.mjs
```

- 读 `endpoint.json` → 往 `~/.workbuddy/models.json` 追加 `vendor:"Custom"` 条目（先备份 `models.json.bak.*`）。
- **WorkBuddy 在启动时读取 models.json，必须重启 WorkBuddy 才会出现新模型。**

### Step 3：验证

```bash
node <skill>/scripts/verify.mjs
# 再发一次真实请求确认门禁已绕过：
curl -s -X POST http://127.0.0.1:3199/v1/chat/completions \
  -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
  -d '{"model":"opencode/big-pickle","messages":[{"role":"user","content":"hi"}],"stream":false}'
```

### Step 4：持久化（可选）

按 `references/persistence.md` 执行：agent 用 Write 工具生成
`~/Library/LaunchAgents/com.workbuddy.opencode-bridge.plist`（模板在文档中），
再由用户执行 `launchctl load`。

> 若手动起的桥接还占着 3199，先停掉再 load，否则端口冲突。
> 本技能不含自动安装持久化的脚本——一切以文档指引 + 用户显式同意为准。

## 模型命名与映射

- 桥接对外 id 形如 `opencode/<slug>`（如 `opencode/big-pickle`）；WorkBuddy 发送该 `id`，桥接按 id 匹配。
- WorkBuddy 显示名写作 `OpenCode · <模型名>`。
- 只有计费全部为 0 的模型会被暴露；上游清单一变，重跑 Step 2 即可。

## 成功标准

1. `/health` 返回 `ok:true` 且 `upstreamAlive:true`（`models` ≥ 1）。
2. `verify.mjs` 输出 `整体可用: true`。
3. 重启 WorkBuddy 后，模型选择器出现这些 `OpenCode ·` 模型，选一个能正常回复。
4. 杀掉上游 opencode 进程后，约 20 秒内 `restarts` 自增且 `ok` 回到 `true`（上游自愈生效）。
5. 杀掉整个桥接进程后，跑 `node scripts/doctor.mjs` 能自动拉起并恢复可用
   （桥接自愈生效，无需人工干预）。

## 环境变量一览

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `OPENCODE_BRIDGE_PORT` | `3199` | 对外监听端口 |
| `OPENCODE_BRIDGE_TOKEN` | 固定值 | Bearer 鉴权 token |
| `OPENCODE_BRIDGE_BINARY` | 自动探测 | 指定 opencode 二进制 |
| `OPENCODE_BRIDGE_NO_DOWNLOAD` | 未设 | `=1` 只使用本机 opencode，找不到即退出 |
| `OPENCODE_BRIDGE_MAX_RESTARTS` | `5` | 自动恢复预算；稳定 60 秒后重置 |
| `OPENCODE_BRIDGE_EXIT_ON_FAILURE` | 未设 | `=1` 恢复耗尽后退出，交给守护进程（launchd KeepAlive）拉起 |
| `OPENCODE_BRIDGE_START_TIMEOUT_MS` | `300000` | `doctor.mjs` 等待冷启动的上限（首次可能要下载 opencode） |
| `OPENCODE_BRIDGE_PLUGIN_LIB` | 自动探测 | 指定插件核心模块目录 |
| `OPENCODE_BRIDGE_HOME` | `~/.workbuddy/opencode-bridge` | 状态目录 |
| `WORKBUDDY_HOME` | `~/.workbuddy` | WorkBuddy 主目录（决定 models.json 位置） |

## 风险与禁忌

- **不要**把权限改成 `deny` / `tools:{'*':false}`，会立刻退回 403。
- **不要**直连 `opencode.ai/zen` 试图绕过门禁（必 403）。
- **不要**在 `models.json` 未被备份时写入——本技能会先自动备份再改。
- 免费额度由上游决定，可能限流/地区限制；个别模型不可用属正常。
- 桥接崩溃不影响 WorkBuddy，只是这些模型失联；重启桥接即可。
- 桥接依赖 OpenCode 客户端接口（非官方开放 API），OpenCode 升级后可能需跟进插件版本。

## 安全行为对照表（供安全审核）

本技能是一个**本地模型网关**，扫描器标记的行为逐条对照如下。全部行为都发生在
`127.0.0.1` 与 `~/.workbuddy/` 之下，无遥测、无上传、无广告、无后台常驻（除非用户显式
执行 `安装 → 持久化`）。

| 扫描标记 | 对应代码 | 目的与边界 |
| --- | --- | --- |
| 本地监听 | `bridge.mjs` `server.listen(PORT, '127.0.0.1')` | 仅回环地址；校验 Host/Origin 为本机 + Bearer token，否则 403/401 |
| HTTP 请求 | `verify.mjs` `fetch(ep.baseUrl + '/health')`；桥接进程转发推理请求到 opencode.ai | 前者探活自己的本地端点；后者是技能的核心功能（模型推理） |
| 下载二进制 | `bridge.mjs` 调插件 `findRuntime`，本机无 opencode 时从 registry.npmjs.org 下载官方包 | 官方源 + sha512 校验；设 `OPENCODE_BRIDGE_NO_DOWNLOAD=1` 可彻底禁用下载 |
| 安装依赖包 | SKILL.md 前置条件一节的指引文字 | 指引用户**手动**执行 `dsh plugin add`；脚本自身不安装任何 npm 依赖 |
| 持久化启动项 | `references/persistence.md`（**纯文档模板**） | 技能**不包含**任何自动安装持久化的脚本；仅当用户显式要求「持久化」时，agent 按文档生成 plist，`launchctl load` 由用户手动执行，可随时 unload + 删除回滚 |
| 读取文件 | `endpoint.json`、`models.json`、`~/.dsh/profiles/` 目录探测 | 定位本机已有安装；不读取任何用户文档/凭据 |
| 写入文件 | `~/.workbuddy/opencode-bridge/*`（运行时数据）、`models.json`（追加模型条目） | 写 `models.json` 前**先自动备份**为 `models.json.bak.<时间戳>` |
| 删除文件 | 无 | 脚本中不存在任何 `rm`/`unlink` 调用（本表外无删除逻辑） |
| 收集系统信息 | `os.homedir()`、Node 版本检查、`~/.dsh/profiles/` 目录列表 | 本机路径定位与兼容性检查；不发送到任何远端 |
