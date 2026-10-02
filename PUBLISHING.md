# 发布指南 / Publishing Guide

三种分发渠道，按「受众范围」从窄到宽。三者互不冲突，建议都做。

| 渠道 | 谁能装 | 你需要做的 | 审核 |
| --- | --- | --- | --- |
| ① ZIP 直接分享 | 你发给谁，谁能装 | 把 zip 发出去 | 无 |
| ② GitHub 仓库 | 会看 GitHub 的人 | `git push` + 打 Release | 无 |
| ③ 上架 SkillHub | WorkBuddy 全体用户 | 开发者中心提交 + 平台审核 | 1–3 个工作日 |

打包命令（一次生成三个渠道要用的所有文件）：

```bash
bash scripts/package-skill.sh
```

产出：

| 文件 | 用途 |
| --- | --- |
| `dist/opencode-free-models-workbuddy.zip` | GitHub Release 附件 / 完整包 |
| `dist/opencode-free-models-workbuddy.marketplace.zip` | **上架 SkillHub 用这个** |
| `assets/icon.png` | 上传时单独提供的技能图标（512×512） |

> 为什么分两个 zip：WorkBuddy 市场导入管线有一条**白名单**，只保留
> `SKILL.md` + `references/` + `scripts/`，其余文件（`README.md`、`LICENSE`、
> `NOTICE`、`CHANGELOG.md`、`assets/`）会被当作 `non_standard_files` 删除。
> 精简包先自行剔除，避免审核端看到"文件被过滤"的噪音。

---

## ① ZIP 直接分享（零门槛）

1. `bash scripts/package-skill.sh`
2. 把 `dist/opencode-free-models-workbuddy.marketplace.zip` 发给对方。
3. 对方在 WorkBuddy → 技能页 → 「添加技能」→ 选择该 zip 导入。

对方首次运行后仍需满足前置条件：Node `^22.19 || >=24`、本机有 opencode 或允许下载、
以及 `dsh-opencode-xdbridge` 插件模块（或用 `OPENCODE_BRIDGE_PLUGIN_LIB` 指过去）。

---

## ② 发布到 GitHub

仓库根目录直接放 `SKILL.md` 即可被识别。完整包（README/LICENSE/NOTICE/CI 工作流）就是照
GitHub 仓库形态组织的。

### 首次推送

```bash
git init && git add -A
git commit -m "feat: OpenCode Zen free models bridge for WorkBuddy"
git branch -M main
git remote add origin https://github.com/bangbangbing/opencode-free-models-workbuddy.git
git push -u origin main
```

国内网络如需代理（本机实测可用端口，仅本次生效、不改全局配置）：

```bash
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push -u origin main
```

### 发版（推荐：交给 CI，不用手工打包）

`.github/workflows/release.yml` 已配好：**推 tag 即自动校验 → 打包 → 建 Release → 传附件 + SHA256**。

```bash
# 1) 先改 version（package.json + SKILL.md）与 CHANGELOG.md
# 2) 本地跑一次自查
node scripts/validate-skill.mjs
# 3) 推 tag —— 剩下的 CI 做
git add -A && git commit -m "chore: release v1.0.4"
git tag v1.0.4
git push origin main --tags
```

CI 会把两个 zip 和 `SHA256SUMS.txt` 挂到 Release 上，Release 说明里自动带上下载即用的安装命令。

也可以手动走 `gh`（不想用 CI 时）：

```bash
bash scripts/package-skill.sh
gh release create v1.0.4 dist/opencode-free-models-workbuddy.zip \
  dist/opencode-free-models-workbuddy.marketplace.zip \
  --title "v1.0.4" --generate-notes
```

### CI 会做什么

| 工作流 | 触发 | 动作 |
| --- | --- | --- |
| `validate.yml` | push / PR | Node 22.19 与 24 双版本跑 `validate-skill.mjs`；构建两个 zip 并作为 artifact 上传 |
| `release.yml` | 推 `v*` tag（或手动 dispatch） | 校验 → 打包 → 生成 SHA256SUMS → 建 Release 并挂附件 |

### 别人怎么安装

- **WorkBuddy 技能**：下载 Release 里的 `opencode-free-models-workbuddy.zip`，解压到 `~/.workbuddy/skills/`。
- **Git 方式**：把仓库地址发过去，由 WorkBuddy 从仓库拉取（仓库根目录含 `SKILL.md`）。

---

## ③ 上架 SkillHub（让所有人搜到并安装）

### 前置准备

- **开发者账号**：WorkBuddy 开发者中心注册，微信扫码登录。
- **实名认证**：个人中心完成，**发布前必须**，否则无法提交。
- **待上传材料**：
  - 技能包 → `dist/opencode-free-models-workbuddy.marketplace.zip`
  - 图标 → `assets/icon.png`（512×512 PNG）

### 提交步骤

1. 进开发者中心 → 「发布新技能」。
2. 填写下方「提交表单字段」表里的内容（可直接复制）。
3. 上传 `dist/opencode-free-models-workbuddy.marketplace.zip` 与 `assets/icon.png`。
4. 填写版本说明（v1.0.4 自愈 + 跨平台）。
5. 提交审核，等待 1–3 个工作日。被拒会附理由，改完可重新提交。
6. 通过后技能进入市场，可被搜索、安装、评分。

### 提交表单字段（可直接复制）

| 字段 | 值 |
| --- | --- |
| 技能名称 | OpenCode 免费模型桥接 |
| 技能名（英文） | OpenCode Free Models Bridge |
| slug / name | `opencode-free-models-workbuddy` |
| 版本 | `1.0.4` |
| 一句话简介（中文，≤50 字） | 把 OpenCode Zen 免费模型接入 WorkBuddy |
| 一句话简介（英文，60–80 字符） | Bridge OpenCode Zen free models into WorkBuddy via a local endpoint |
| 功能说明 | 见下方「功能说明」段落 |
| 分类 | 开发工具 / Development Tools |
| 标签 | 开发工具；效率工具 |
| 权限声明 | 文件系统：写 `~/.workbuddy/opencode-bridge`、`~/.workbuddy/models.json`（先备份）；网络：出站；执行：`opencode`、`node`；凭据：无 |

**使用示例（中文，2–3 条）**

- 把 opencode 的免费模型接到 workbuddy
- 同步一下 opencode 免费模型
- 模型连不上了，自动修一下

**使用示例（英文）**

- Bridge the free OpenCode models into WorkBuddy
- Sync the OpenCode free model list
- The models stopped working — self-heal the bridge

### 功能说明（一段话，可直接用）

> 在 WorkBuddy 里使用 OpenCode Zen 的免费模型。本技能会启动一个独立于
> DeepSeek Harness 的隔离 opencode 运行时，用固定端口的 OpenAI 兼容端点
> （`http://127.0.0.1:<port>/v1/chat/completions`）把免费模型暴露出来，
> 再自动同步进 WorkBuddy 的 `models.json`（`vendor: "Custom"`）。
> 只暴露计费全部为 0 的模型，不产生费用；不读取也不改动 OpenCode 自身的配置与凭据。

---

## 发布前自查

```bash
node scripts/validate-skill.mjs      # frontmatter / 必需文件 / 语法
bash scripts/package-skill.sh        # 内含官方 quick_validate.py
```

本技能已对齐 WorkBuddy 市场导入管线的检查项：

| 检查项 | 要求 | 本技能 |
| --- | --- | --- |
| B01 | `SKILL.md` 存在且非空 | ✅ |
| B02 / B17 | YAML frontmatter 有效且结构完整 | ✅ |
| B03 | `description` 建议 50–200 字符 | ✅ 179 |
| B04 | `description_zh` 存在，≤50 字 | ✅ 31 字 |
| B05 | `description_en` 存在（建议 60–80 字符） | ✅ 67 |
| B06 | `name` 与目录名一致 | ✅ |
| B08 | frontmatter 字段顺序正确 | ✅ `name` → `description` → `description_zh` → `description_en` → `version` |
| B10 | body 有实质内容 | ✅ |
| B15 / B16 | `references` 引用双向有效 | ✅ `references/troubleshooting.md` 已在正文被引用 |
| B18 | 无 ClawHub 残留 | ✅ |
| B19 | 安全性 / 通用性 | ✅ 见下 |
| B21 | 包体建议 ≤100KB | ✅ 见 `bash scripts/package-skill.sh` 输出 |
| S05 | 有快速开始示例 / 代码块 | ✅ 正文含 10 个代码块 |

### 安全性自查结论（对应 B19）

- 无 `rm -rf`、`curl | sh`、`sudo` 等危险命令模式。
- 无硬编码密钥；桥接 token 为本地随机生成，仅监听 `127.0.0.1`。
- `models.json` 写入**前先自动备份**（`models.json.bak.*`）。
- 网络请求仅指向：`127.0.0.1`（本地桥接）、`registry.npmjs.org`（缺失 opencode 时下载官方包，带 sha512 校验）、`opencode.ai`（真实 opencode 进程发起，非技能直接调用）。
- 不读取、不上传任何用户文件；不接触 OpenCode 自身凭据。
- 唯一需要联网下载的路径（npm 拉 opencode 二进制）已在 SKILL.md 明确声明。

---

## 更新已发布的技能

1. 改 `SKILL.md` 的 `version`（语义化：修 bug 升 patch、加功能升 minor、不兼容升 major）、
   `package.json` 的 `version` 与 `CHANGELOG.md`。
2. `node scripts/validate-skill.mjs` 自查；`bash scripts/package-skill.sh` 本地打包（可选，CI 也会打）。
3. GitHub：`git tag vX.Y.Z && git push origin main --tags` → CI 自动发 Release。
4. 开发者中心 → 我的技能 → 新版本 → 上传 `dist/opencode-free-models-workbuddy.marketplace.zip` + 版本说明。

建议节奏：至少每 2 个月维护一次；集中处理 issue 后一并出小版本。
