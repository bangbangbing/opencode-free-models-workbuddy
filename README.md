<div align="center">

# opencode-free-models-workbuddy

**把 [OpenCode Zen](https://opencode.ai) 的免费模型接入 [WorkBuddy](https://www.workbuddy.cn)
（也适用于任何支持自定义 OpenAI 兼容端点的客户端）。**

通过一个本地、隔离的 OpenCode 运行时和固定端口的 OpenAI 兼容端点完成桥接。

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](package.json)
[![validate](https://github.com/OWNER/REPO/actions/workflows/validate.yml/badge.svg?branch=main)](../../actions/workflows/validate.yml)
<!-- 发布后把上面的 OWNER/REPO 换成你的 GitHub 用户名/仓库名 -->

</div>

---

## 为什么需要它

OpenCode Zen 的免费档有服务端门禁，直连会被拒绝：

```
FreeTierError: OpenCode's free tier can only be used from within OpenCode
```

改 `User-Agent` 无效（判据不是 UA），必须由**真实的 opencode 进程**发起。本工具因此：

1. 启动一个**隔离的** `opencode serve`（独立 XDG 根 + 随机密码 + `permission:{'*':'ask'}`）——
   门禁放行，但本地不执行任何动作；
2. 在 `127.0.0.1:<port>` 暴露 **OpenAI 兼容** `/v1/chat/completions`（含 SSE 流式）；
3. 把读到的**计费为 0** 的模型写进 WorkBuddy 的 `models.json`（`vendor: "Custom"`）。

```
WorkBuddy ──HTTP──▶ 127.0.0.1:3199 (bridge.mjs) ──HTTP──▶ isolated opencode serve ──▶ OpenCode Zen
```

## 安装

### 作为 WorkBuddy 技能

```bash
git clone https://github.com/OWNER/REPO.git \
  ~/.workbuddy/skills/opencode-free-models-workbuddy
```

之后用自然语言触发即可，例如「把 opencode 免费模型接到 workbuddy」「同步免费模型」「验证桥接」。

### 作为独立工具

```bash
git clone https://github.com/OWNER/REPO.git && cd REPO
```

## 前置条件

| 依赖 | 说明 |
| --- | --- |
| **Node** | `^22.19 \|\| >=24` |
| **opencode 二进制** | 本机已有，或允许联网下载（约 57 MB，sha512 校验） |
| **`dsh-opencode-xdbridge` 核心模块** | 复用其 bridge 逻辑（MIT）。解析顺序见下 |

`dsh-opencode-xdbridge` 解析顺序：

1. 环境变量 `OPENCODE_BRIDGE_PLUGIN_LIB`
2. `$DSH_HOME/profiles/*/node_modules/dsh-opencode-xdbridge/lib`（已装 DSH 插件时直接用）
3. 都没有时先安装：

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

## 仓库结构

```
.
├── SKILL.md                  # WorkBuddy 技能定义（frontmatter + 工作流）
├── README.md  PUBLISHING.md  LICENSE  NOTICE  CONTRIBUTING.md  SECURITY.md  CHANGELOG.md
├── package.json              # 元数据 + npm scripts
├── scripts/
│   ├── bridge.mjs            # 隔离运行时 + OpenAI 兼容端点（便携，自动探测）
│   ├── sync-workbuddy-models.mjs
│   ├── verify.mjs
│   ├── validate-skill.mjs    # 本仓库自检 + 市场导入规则（CI 也跑）
│   ├── package-skill.sh      # 打出完整包 + 市场精简包
│   ├── run-bridge.sh
│   └── install-launchd.sh
├── references/troubleshooting.md
├── assets/
│   ├── icon.png              # 512×512 技能图标（上架时单独上传）
│   └── com.workbuddy.opencode-bridge.plist.template
└── .github/                  # CI + issue/PR 模板
```

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

## 开机自启（macOS）

```bash
bash scripts/install-launchd.sh
launchctl load ~/Library/LaunchAgents/com.workbuddy.opencode-bridge.plist
```

## 打包与发布（WorkBuddy 技能市场）

WorkBuddy 的发布要求：一个 **ZIP**，内部顶层是**一个以技能名命名的文件夹**，其中包含 `SKILL.md`
（可选 `scripts/`、`references/`、`assets/`）。官方校验规则（`quick_validate.py`）：`SKILL.md` 必须有
YAML frontmatter，`name` 为 hyphen-case，`description` 不含尖括号 `<` `>`。

```bash
bash scripts/package-skill.sh
# → dist/opencode-free-models-workbuddy.zip             完整包（GitHub Release / 直接分享）
# → dist/opencode-free-models-workbuddy.marketplace.zip 精简包（上架 SkillHub 用这个）
```

脚本会：① 只 stage 技能内容（排除 `.git`/`.github`/`dist` 等）；② 若存在官方
`skill-creator/scripts/quick_validate.py` 则先跑官方校验；③ 用 `zip` 产出两个 zip。

**为什么要两个 zip**：WorkBuddy 市场导入管线有白名单，**只保留** `SKILL.md`、`references/`、
`scripts/`，其余（`README.md`、`LICENSE`、`NOTICE`、`CHANGELOG.md`、`assets/`）会作为
`non_standard_files` 被删除。精简包先自行剔除，免得审核端看到"文件被过滤"的噪音。

> 等价官方方式：`python3 <WorkBuddy>/…/skill-creator/scripts/package_skill.py <skill-dir> dist`
> （注意它会连 `.git` 一起打包，建议先 stage 干净副本，本仓库的脚本已处理这一点。）

**发布**：三个渠道的完整步骤、可直接复制的提交表单字段、以及对齐平台 B 系列检查项的自查表，
见 **[PUBLISHING.md](./PUBLISHING.md)**。

```bash
node scripts/validate-skill.mjs   # 本地自查：frontmatter / 必需文件 / 语法 / 市场导入规则
```

## 开发

```bash
npm run validate             # 校验 SKILL.md frontmatter + 脚本语法
bash scripts/package-skill.sh   # 打包成技能市场可用的 zip
```

## 故障排查

见 [`references/troubleshooting.md`](references/troubleshooting.md)。

## 许可与致谢

MIT，详见 [`LICENSE`](LICENSE)。桥接逻辑**复用** [dsh-opencode-xdbridge](https://github.com/XDTrees/dsh-opencode-xdbridge)
（MIT，作者 XDTrees）的核心模块，**未修改其源码**，详见 [`NOTICE`](NOTICE)。

免费模型由 OpenCode Zen 提供，清单与额度随上游变化。本项目与 OpenCode / WorkBuddy 官方无隶属关系。
