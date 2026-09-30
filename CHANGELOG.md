# Changelog

## 1.0.0

- 初始版本：把 OpenCode Zen 免费模型接入 WorkBuddy。
- `scripts/bridge.mjs`：隔离 opencode 运行时 + 固定端口 OpenAI 兼容端点（含 SSE 流式），自动探测 DSH 插件与 opencode 二进制。
- `scripts/sync-workbuddy-models.mjs`：把免费模型写入 `~/.workbuddy/models.json`（先备份）。
- `scripts/verify.mjs`：校验桥接与 models.json 一致性。
- `scripts/install-launchd.sh`：生成开机自启 plist。
- `scripts/validate-skill.mjs` + `.github/workflows/validate.yml`：仓库自检与 CI。
- `scripts/package-skill.sh`：按 WorkBuddy 发布要求打包（stage 干净副本 + 官方校验 + zip）。
- 已实测：门禁绕过成功，非流式与流式均正常；官方 `quick_validate.py` 校验通过。
