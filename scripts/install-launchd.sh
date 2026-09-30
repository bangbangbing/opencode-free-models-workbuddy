#!/bin/bash
# Install a launchd agent so the bridge starts at login and restarts on crash.
# Generates the plist from the current environment (no hardcoded paths).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node)"
LABEL="com.workbuddy.opencode-bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/bridge.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.workbuddy/opencode-bridge/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/.workbuddy/opencode-bridge/launchd.err.log</string>
</dict>
</plist>
EOF

echo "已写入 $PLIST"
echo "加载：launchctl load \"$PLIST\"     （若端口已被占用，先停掉现有桥接进程）"
echo "卸载：launchctl unload \"$PLIST\""
