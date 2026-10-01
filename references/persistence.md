# 持久化（开机自启）指南

本技能**不包含任何自动安装持久化的脚本**。以下步骤在用户明确要求「持久化 / 开机自启」时，
由 agent 按本文档**逐步执行**，每一步的输出都应展示给用户确认。

## 方案 A：launchd（推荐，崩溃自动重启）

### 1. 定位 node 与 bridge.mjs 的绝对路径

```bash
command -v node
# bridge.mjs 位于本技能安装目录下：
ls ~/.workbuddy/skills/opencode-free-models-workbuddy/scripts/bridge.mjs
```

### 2. 写入 plist（由 agent 用 Write 工具生成，路径变量按上一步结果替换）

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

### 3. 加载（需用户手动执行或明确同意）

```bash
launchctl load ~/Library/LaunchAgents/com.workbuddy.opencode-bridge.plist
```

若手动起的桥接还占着 3199 端口，先停掉再 load，否则端口冲突。

### 4. 验证

```bash
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:3199/health
# 期望 {"ok":true,"models":N}
```

### 5. 卸载（完全移除持久化）

```bash
launchctl unload ~/Library/LaunchAgents/com.workbuddy.opencode-bridge.plist
rm ~/Library/LaunchAgents/com.workbuddy.opencode-bridge.plist
```

## 方案 B：手动前台运行（无常驻、无持久化）

```bash
bash <skill>/scripts/run-bridge.sh
```

关掉终端即停止，不写任何启动项。适合临时使用。

## 安全说明

- 持久化是**显式 opt-in**：本技能默认不安装任何开机自启，仅按用户要求执行上述文档步骤。
- 生成物只有一个 plist 文件（LaunchAgents 属 macOS 标准用户级启动项位置，无需 root）。
- `launchctl unload` + 删除 plist 即可完全回滚。
