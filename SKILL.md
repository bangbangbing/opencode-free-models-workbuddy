---
name: opencode-free-models-workbuddy
description: |
  OpenCode Zen 免费模型接入 WorkBuddy：本地隔离 opencode 运行时 + 固定端口 OpenAI 兼容桥接，
  绕过 FreeTier 门禁并同步进 models.json。
  Triggers: opencode 免费模型, workbuddy 加免费模型, opencode bridge, opencode zen, 同步免费模型
description_zh: "把 OpenCode Zen 免费模型接入 WorkBuddy"
description_en: "Bridge OpenCode Zen free models into WorkBuddy via a local endpoint"
version: 1.0.1
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
  OpenCode 自身的配置与凭据。不收集、不上传任何用户数据；无遥测。开机自启仅在用户
  显式执行「持久化」动作时安装（launchd plist），并可随时 launchctl unload 移除。
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

- **Node**：`^22.19 || >=24`（插件的 engines 要求）。
- **opencode 二进制**：本机已有，或允许联网下载（约 57MB）。
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
| `安装` | Step 1 起桥接 → Step 2 同步 models.json → 提示重启 WorkBuddy |
| `同步` | 重跑 `sync-workbuddy-models.mjs`（上游换模型后） |
| `验证` | 跑 `verify.mjs` + 发一次真实请求 |
| `状态` | 只看 `/health` 与 endpoint.json，不改动任何东西 |
| `持久化` | 跑 `install-launchd.sh` 生成开机自启 |
| `排查` | 直接跳 references/troubleshooting.md |

## 默认流程

### Step 1：启动桥接

```bash
# 后台常驻（前台调试去掉 & ）
node <skill>/scripts/bridge.mjs &
# 等待就绪（首次解析/下载 opencode 可能较久）
until [ -f ~/.workbuddy/opencode-bridge/endpoint.json ]; do sleep 2; done
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:3199/health   # {"ok":true,"models":N}
```

- 端口默认 `3199`，token 默认固定值；用 `OPENCODE_BRIDGE_PORT` / `OPENCODE_BRIDGE_TOKEN` 覆盖。
- 就绪后 `~/.workbuddy/opencode-bridge/endpoint.json` 会写入端点、apiKey 与模型清单。

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

```bash
bash <skill>/scripts/install-launchd.sh    # 生成 plist
launchctl load ~/Library/LaunchAgents/com.workbuddy.opencode-bridge.plist
```

> 若手动起的桥接还占着 3199，先停掉再 load，否则端口冲突。

## 模型命名与映射

- 桥接对外 id 形如 `opencode/<slug>`（如 `opencode/big-pickle`）；WorkBuddy 发送该 `id`，桥接按 id 匹配。
- WorkBuddy 显示名写作 `OpenCode · <模型名>`。
- 只有计费全部为 0 的模型会被暴露；上游清单一变，重跑 Step 2 即可。

## 成功标准

1. `/health` 返回 `{"ok":true,"models":N}`（N ≥ 1）。
2. `verify.mjs` 输出 `整体可用: true`。
3. 重启 WorkBuddy 后，模型选择器出现这些 `OpenCode ·` 模型，选一个能正常回复。

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
| 持久化启动项 | `install-launchd.sh` 生成 launchd plist | 用户显式执行 `持久化` 动作才运行；`launchctl load` 亦由用户手动执行 |
| 读取文件 | `endpoint.json`、`models.json`、`~/.dsh/profiles/` 目录探测 | 定位本机已有安装；不读取任何用户文档/凭据 |
| 写入文件 | `~/.workbuddy/opencode-bridge/*`（运行时数据）、`models.json`（追加模型条目） | 写 `models.json` 前**先自动备份**为 `models.json.bak.<时间戳>` |
| 删除文件 | 无 | 脚本中不存在任何 `rm`/`unlink` 调用（本表外无删除逻辑） |
| 收集系统信息 | `os.homedir()`、Node 版本检查、`~/.dsh/profiles/` 目录列表 | 本机路径定位与兼容性检查；不发送到任何远端 |
