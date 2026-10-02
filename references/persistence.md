# 持久化（开机自启）指南

本技能**不包含任何自动安装持久化的脚本**。以下步骤在用户明确要求「持久化 / 开机自启」时，
由 agent 按本文档**逐步执行**，每一步的输出都应展示给用户确认。

> **先分清两层保护**（详见文末「自愈与持久化的分工」）：
> - **桥接内自愈**：上游 opencode 崩溃 → 自动重启上游，**已默认开启，无需配置**；
> - **开机自启**：桥接进程本身被杀 / 重启机器后自动拉起，需按下面步骤配置。
>
> 只想「连不上就自动修」的话，跑 `node scripts/doctor.mjs` 就够了，不必配持久化。

平台对应方案：

| 平台 | 方案 | 章节 |
| --- | --- | --- |
| macOS | launchd（LaunchAgents） | 方案 A |
| Windows | 任务计划程序 / 启动文件夹 | 方案 C |
| 任意 | 手动前台 / nohup 常驻 | 方案 B |

## 方案 A：macOS launchd（推荐，崩溃自动重启）

### A1. 定位 node 与 bridge.mjs 的绝对路径

```bash
command -v node
# bridge.mjs 位于本技能安装目录下：
ls ~/.workbuddy/skills/opencode-free-models-workbuddy/scripts/bridge.mjs
```

### A2. 写入 plist（由 agent 用 Write 工具生成，路径变量按上一步结果替换）

目标路径：`~/Library/LaunchAgents/com.workbuddy.opencode-bridge.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.workbuddy.opencode-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/path/to/node</string>
    <string>/path/to/bridge.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>~/.workbuddy/opencode-bridge/launchd.out.log</string>
  <key>StandardErrorPath</key><string>~/.workbuddy/opencode-bridge/launchd.err.log</string>
</dict>
</plist>
```

> 注意：plist 内不支持 `~`，写路径时替换为展开后的绝对 home 路径。

### A3. 加载（需用户手动执行或明确同意）

```bash
launchctl load ~/Library/LaunchAgents/com.workbuddy.opencode-bridge.plist
```

若手动起的桥接还占着 3199 端口，先停掉再 load，否则端口冲突。

> **注意：加载必须在用户自己的「终端.app」里执行。**
> WorkBuddy 的沙箱会话无法向 launchd 域注册服务——`launchctl load` 与
> `launchctl bootstrap` 都会返回 `5: Input/output error`。这不是配置错误，
> 换到普通终端即可成功。若仍失败，用现代语法：
> `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.workbuddy.opencode-bridge.plist`

### A4. 验证

```bash
node scripts/doctor.mjs
```

### A5. 卸载（完全移除持久化）

```bash
launchctl unload ~/Library/LaunchAgents/com.workbuddy.opencode-bridge.plist
rm ~/Library/LaunchAgents/com.workbuddy.opencode-bridge.plist
```

## 方案 B：手动前台 / 常驻（任意平台，无常驻项）

前台运行（关掉终端即停止）：

```bash
# macOS / Linux
sh scripts/run-bridge.sh

# Windows
scripts\run-bridge.cmd
```

后台常驻（不占终端窗口）：

```bash
# macOS / Linux
nohup node scripts/bridge.mjs > ~/.workbuddy/opencode-bridge/bridge.stdout.log 2>&1 &

# Windows (PowerShell)
Start-Process -WindowStyle Hidden node -ArgumentList "scripts\bridge.mjs"
```

更省事的替代：直接跑 `node scripts/doctor.mjs`——它检测到桥接没跑就会用
「脱离进程」的方式拉起来（POSIX 独立会话 / Windows 独立进程组），父进程退出后依然存活。

## 方案 C：Windows 开机自启

### C1. 任务计划程序（推荐，等价于 launchd 的 KeepAlive）

用管理员或普通用户 PowerShell 执行（`ONLOGON` = 登录即启动）：

```powershell
$node   = (Get-Command node).Source
$script = "$env:USERPROFILE\.workbuddy\skills\opencode-free-models-workbuddy\scripts\bridge.mjs"

$action  = New-ScheduledTaskAction -Execute $node -Argument "`"$script`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
# 崩溃自动重启：失败后每 1 分钟重试，最多 999 次
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName "WorkBuddyOpenCodeBridge" `
  -Action $action -Trigger $trigger -Settings $settings -Force
```

立即启动 / 停止 / 卸载：

```powershell
Start-ScheduledTask   -TaskName "WorkBuddyOpenCodeBridge"
Stop-ScheduledTask    -TaskName "WorkBuddyOpenCodeBridge"
Unregister-ScheduledTask -TaskName "WorkBuddyOpenCodeBridge" -Confirm:$false
```

> 若希望只在用户登录后可见地运行，可在 `New-ScheduledTaskPrincipal` 中指定
> `-LogonType Interactive`。

### C2. 启动文件夹（最简单，无重启能力）

1. `Win + R` → 输入 `shell:startup` → 回车，打开启动文件夹
2. 放入一个快捷方式，目标填写：
   `node.exe "<完整路径>\scripts\bridge.mjs"`
   起始位置填技能目录

缺点：进程崩溃后不会自动重启（此时靠桥接内部的自愈兜底上游，但桥接自身挂了就没了）。
要真正的崩溃重启，用 C1。

### C3. 卸载

删除任务（C1）或删除启动文件夹里的快捷方式（C2）即可，不残留其他项。

## 自愈与持久化的分工

两层保护互相独立，**建议都启用**：

| 层 | 负责 | 配置 |
| --- | --- | --- |
| 桥接内（默认开启） | 上游 `opencode serve` 崩溃 → 自动重启上游（最多 5 次，间隔 2 秒，稳定 60 秒重置预算） | `OPENCODE_BRIDGE_MAX_RESTARTS` |
| `doctor.mjs`（按需/可定时） | 桥接没跑 → 拉起；上游卡死 → 重启；models.json 漂移 → 重新同步 | `node scripts/doctor.mjs` |
| 开机自启（opt-in） | 机器重启 / 桥接进程被杀 → 系统级拉起 | 方案 A（macOS）/ 方案 C（Windows） |

只有第一层时，桥接进程自己被杀掉就没人管了；只有第三层时，上游每次崩溃都要靠整
进程重启来恢复（更慢）。三层齐备才是稳态。

### 让 doctor 定期巡检

若不想配开机自启，可让 doctor 定期跑（发现异常才动手）：

- macOS：`crontab -e` 加一行 `*/10 * * * * /path/to/node /path/to/scripts/doctor.mjs >> ~/.workbuddy/opencode-bridge/doctor.log 2>&1`
- Windows：任务计划程序新建任务，触发器设为「每 10 分钟重复」，操作填
  `node.exe "<路径>\scripts\doctor.mjs"`
- WorkBuddy 自动化：可用 `automation_update` 建一个每小时的巡检任务调用该脚本

## 安全说明

- 持久化是**显式 opt-in**：本技能默认不安装任何开机自启，仅按用户要求执行上述文档步骤。
- 生成物只有一个 plist（macOS）或一个计划任务（Windows），均在用户级作用域，无需管理员提权。
- macOS 用 `launchctl unload` + 删 plist；Windows 用 `Unregister-ScheduledTask`，即可完全回滚。
- `doctor.mjs` 只启动属于自己的桥接进程；端口被别的程序占用时**只报告不结束**对方进程。


## 安全说明

- 持久化是**显式 opt-in**：本技能默认不安装任何开机自启，仅按用户要求执行上述文档步骤。
- 生成物只有一个 plist 文件（LaunchAgents 属 macOS 标准用户级启动项位置，无需 root）。
- `launchctl unload` + 删除 plist 即可完全回滚。
