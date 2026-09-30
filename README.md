# opencode-free-models-workbuddy

把 [OpenCode Zen](https://opencode.ai) 的**免费模型**接入 **WorkBuddy**（也适用于任何支持
自定义 OpenAI 兼容端点的客户端）。

> Bridge OpenCode Zen's free models into WorkBuddy through a local, isolated
> OpenCode runtime and a fixed-port OpenAI-compatible endpoint.

## 原理

OpenCode Zen 的免费档有服务端门禁，直连会被拒：

```
FreeTierError: OpenCode's free tier can only be used from within OpenCode
```

改 User-Agent 无效，必须由**真实的 opencode 进程**发起。本工具因此：

1. 启动一个**隔离的** `opencode serve`（独立 XDG 根 + 随机密码 + `permission:{'*':'ask'}`），
   门禁放行，但本地不执行任何动作；
2. 在 `127.0.0.1:<port>` 暴露 **OpenAI 兼容** `/v1/chat/completions`（含 SSE 流式）；
3. 把读到的**计费为 0** 的模型写进 WorkBuddy 的 `models.json`（`vendor: "Custom"`）。

```
WorkBuddy ──HTTP──> 127.0.0.1:3199 (bridge.mjs) ──HTTP──> isolated opencode serve ──> OpenCode Zen
```

## 前置条件

- **Node** `^22.19 || >=24`
- **opencode 二进制**：本机已有，或允许联网下载（约 57MB）
- **`dsh-opencode-xdbridge` 插件核心模块**（复用其 bridge 逻辑，MIT）。解析顺序：
  1. `OPENCODE_BRIDGE_PLUGIN_LIB`
  2. `$DSH_HOME/profiles/*/node_modules/dsh-opencode-xdbridge/lib`
  3. 缺失时先安装：
     ```bash
     dsh plugin --profile <profile> add github:XDTrees/dsh-opencode-xdbridge
     # 或者
     git clone https://github.com/XDTrees/dsh-opencode-xdbridge
     export OPENCODE_BRIDGE_PLUGIN_LIB="$PWD/dsh-opencode-xdbridge/lib"
     ```

## 快速开始

```bash
# 1) 起桥接（后台）
node scripts/bridge.mjs &

# 2) 等就绪
until [ -f ~/.workbuddy/opencode-bridge/endpoint.json ]; do sleep 2; done
curl -s -H "Authorization: Bearer 5b3a9c2e1b6d4f8a0c5e2b9d1a4f6c8e7f3a9c2e1b6d4f8a0c5e2b9d1a4f6c8e" \
  http://127.0.0.1:3199/health        # {"ok":true,"models":8}

# 3) 写入 WorkBuddy（自动备份 models.json）
node scripts/sync-workbuddy-models.mjs

# 4) 重启 WorkBuddy，模型选择器出现 OpenCode · <模型名>

# 5) 验证
node scripts/verify.mjs
```

## 作为 WorkBuddy 技能使用

把本仓库放进 WorkBuddy 用户技能目录即可被识别（技能库）：

```bash
git clone <this-repo> ~/.workbuddy/skills/opencode-free-models-workbuddy
```

之后用自然语言触发，例如「把 opencode 免费模型接到 workbuddy」「同步免费模型」「验证桥接」。
（`SKILL.md` 已带 `agent_created: true` 与触发词。）

## 配置（环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DSH_HOME` | `~/.dsh` | DSH home，用于解析插件与既有 opencode |
| `OPENCODE_BRIDGE_HOME` | `~/.workbuddy/opencode-bridge` | 桥接状态目录（endpoint.json / 日志 / 运行时数据） |
| `OPENCODE_BRIDGE_PLUGIN_LIB` | 自动探测 | 指向 `dsh-opencode-xdbridge/lib` |
| `OPENCODE_BRIDGE_BINARY` | 自动探测 | 指向 opencode 可执行文件 |
| `OPENCODE_BRIDGE_PORT` | `3199` | 回环端口 |
| `OPENCODE_BRIDGE_TOKEN` | 内置固定值 | WorkBuddy 需发送的 `Authorization: Bearer <token>` |

## 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | `{ok, models}` |
| GET | `/v1/models` | OpenAI 格式模型列表 |
| POST | `/admin/refresh` | 重读上游免费模型清单 |
| POST | `/v1/chat/completions` | 聊天补全（支持 `stream:true`） |

## 开机自启

```bash
bash scripts/install-launchd.sh
launchctl load ~/Library/LaunchAgents/com.workbuddy.opencode-bridge.plist
```

## 故障排查

见 [`references/troubleshooting.md`](references/troubleshooting.md)。

## 许可与致谢

MIT。桥接逻辑复用 [dsh-opencode-xdbridge](https://github.com/XDTrees/dsh-opencode-xdbridge)
（MIT，作者 XDTrees）的核心模块，未修改其源码；详见 [`NOTICE`](NOTICE)。

免费模型由 OpenCode Zen 提供，清单与额度随上游变化。本项目与 OpenCode / WorkBuddy 官方无隶属关系。
