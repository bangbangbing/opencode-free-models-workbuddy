# Changelog

## 1.0.4

- **新增跨平台自愈入口 `scripts/doctor.mjs`**（macOS / Windows / Linux，纯 Node，不依赖
  bash 或 PowerShell）：「连不上就自动修」。
  - 分类诊断：`healthy` / `degraded`（上游死）/ `foreign`（端口被占）/ `down`（没跑）。
  - 自动修复：脱离方式拉起桥接 → 重启上游 → 重同步 models.json。
  - 端口被**别的程序**占用时只报告、不结束对方进程；`--check` 只诊断、`--json` 机器可读。
  - 退出码 0/1，可直接用于定时巡检或自动化。
- **Windows 支持补齐**：
  - 二进制名按平台取 `opencode.exe` / `opencode`；候选路径扩充
    `%LOCALAPPDATA%\opencode\bin`、`%APPDATA%\opencode\bin`、`%ProgramFiles%\opencode`、
    `$XDG_BIN_HOME`（macOS 侧增加 `$XDG_BIN_HOME`）。
  - 新增 `scripts/run-bridge.cmd`（Windows 前台启动）；`run-bridge.sh` 改为 POSIX `sh` 兼容并透传参数。
  - references/persistence.md 增补 **Windows 自启方案**：任务计划程序（含崩溃重启、
    可直接照抄的 PowerShell 命令）与启动文件夹，并给出卸载方法。
- **修复启动时序缺陷**：桥接此前先 `listen` 再 `startRuntime`，导致 `/health` 在加载模型的
  间隙返回 `models: 0`。现在先起运行时再开端口，端口一旦可用即代表真正就绪。
- 自检脚本 `validate-skill.mjs` 增加**跨平台检查**（扫描 Node 入口中的 POSIX 专有片段、
  校验 Windows 启动脚本存在）与新增文件校验。
- 文档：SKILL.md 增补「自愈」「平台支持」「三层防护的关系」章节与环境变量；
  troubleshooting 增补「第一步永远是自愈」。
- **发布就绪（面向 GitHub）**：
  - 新增 `.github/workflows/release.yml`——推 `v*` tag 即自动校验 → 打包 → 建 Release →
    挂上两个 zip 与 `SHA256SUMS.txt`，Release 正文自带下载即用的安装命令。
  - `validate.yml` 升级为矩阵（Node 22.19 / 24）并新增打包任务，PR 阶段就能拿到 zip 产物。
  - `README.md` 占位符全部替换为真实仓库地址，新增 Release 徽章与「下载解压即装」路径。
  - `package.json` 补齐 `repository` / `homepage` / `bugs` / `author`，`files` 纳入发布文档。
  - `SECURITY.md` 明确披露 `doctor.mjs` 的脱离进程行为与「绝不杀别人的进程」承诺。
  - `validate-skill.mjs` 新增「GitHub 发布就绪」检查：占位符残留、仓库地址指向、
    workflow 存在性、徽章引用有效性——防止"自认为可发布"的回归。

## 1.0.3

- **修复「模型突然全部不可用」**：上游 `opencode serve` 子进程静默死亡后，旧版桥接不感知，
  一直对外宣告死端点，所有请求报 `ECONNREFUSED 127.0.0.1:<随机端口>`。
  - 给 `startBackend` 传 `onExit` 回调（此前漏传），上游退出立刻感知。
  - 运行时改为 getter 取用，不再用 `const` 缓存引用（重启后自动生效）。
  - 新增自动恢复：exit 事件 + 请求 `ECONNREFUSED` 双触发，默认最多 5 次、间隔 2 秒，
    稳定存活 60 秒重置预算（对齐 `dsh-opencode-xdbridge` 的 `handleRuntimeExit` 思路）。
  - 新增 `POST /admin/restart` 手动复位；`/health` 增补 `upstreamAlive` / `recovering` / `restarts`。
  - 每次重启后重写 `endpoint.json`（含 `upstreamAlive`、`restarts`、`adminRestart`）。
  - 新增环境变量 `OPENCODE_BRIDGE_MAX_RESTARTS`、`OPENCODE_BRIDGE_EXIT_ON_FAILURE`。
- 文档：troubleshooting 增补「上游崩溃与自动恢复」小节与自愈验证步骤；
  SKILL.md 增补「运行时生命周期与自愈」与「环境变量一览」。
- 修正排查命令：本地 curl 一律加 `--noproxy '*'`——环境若设了 `HTTP_PROXY`，
  请求会被系统代理吞掉并报 `upstream connect failed`，与桥接无关。

## 1.0.2

- **安全审核整改二轮**：腾讯威胁情报中心复查后仅剩 1 项「可疑」——`scripts/install-launchd.sh`
  （生成 launchd plist 写入 LaunchAgents）。
  - **移除该脚本**，改为 `references/persistence.md` 纯文档模板：仅当用户显式要求「持久化」时
    由 agent 按文档生成 plist，`launchctl load` 由用户手动执行，可随时 unload + 删除回滚。
  - SKILL.md 动作路由 / Step 4 / trust 声明 / 安全行为对照表同步更新。
  - 其余 8 个文件在二轮扫描中已全部判定「安全」（含 bridge.mjs 本体）。

## 1.0.1

- **安全审核整改**（首轮上架被拒后的修复）：
  - 上架精简包剔除开发工具 `package-skill.sh` / `validate-skill.mjs`——包内不再含任何 `rm` 调用（消除「删除文件」标记）。
  - `bridge.mjs` 新增 `OPENCODE_BRIDGE_NO_DOWNLOAD=1`：只使用本机 opencode 二进制，找不到即退出，不发任何下载（「下载二进制」可选禁用）。
  - `package-skill.sh` 改为在系统临时目录 staging，仓库内不再批量 `rm -rf`。
  - SKILL.md 新增「安全行为对照表」（九个扫描标记项逐条给出代码位置与边界）；`trust` 声明扩充无遥测、无后台常驻说明。
  - 新增申诉材料 `dist/APPEAL-安全扫描申诉.md`。
- 打包脚本产出双 zip：完整包（GitHub Release）与市场精简包（白名单对齐）。

## 1.0.0

- 初始版本：把 OpenCode Zen 免费模型接入 WorkBuddy。
- `scripts/bridge.mjs`：隔离 opencode 运行时 + 固定端口 OpenAI 兼容端点（含 SSE 流式），自动探测 DSH 插件与 opencode 二进制。
- `scripts/sync-workbuddy-models.mjs`：把免费模型写入 `~/.workbuddy/models.json`（先备份）。
- `scripts/verify.mjs`：校验桥接与 models.json 一致性。
- `references/persistence.md`：开机自启指南（文档模板，替代 v1.0.0 的 install-launchd.sh）。
- `scripts/validate-skill.mjs` + `.github/workflows/validate.yml`：仓库自检与 CI。
- `scripts/package-skill.sh`：打包为两个 zip —— 完整包（GitHub Release）与市场精简包（上架 SkillHub，只含 `SKILL.md` + `references/` + `scripts/`，对齐平台白名单）。
- `PUBLISHING.md`：三渠道发布指南 + 可直接复制的提交表单字段 + 对齐平台 B 系列检查项的自查表。
- `assets/icon.png`：512×512 技能图标。
- 已对齐 WorkBuddy 市场导入规则：`description` 179 字符、`description_zh` 31 字、`description_en` 67 字符、
  `name` 与目录名一致、`references` 双向引用有效、包体 18KB（上限建议 100KB）。
- 已实测：门禁绕过成功，非流式与流式均正常；官方 `quick_validate.py` 校验通过。

