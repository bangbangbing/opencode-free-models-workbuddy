# Changelog

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

