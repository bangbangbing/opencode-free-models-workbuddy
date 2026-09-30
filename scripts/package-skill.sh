#!/bin/bash
#
# Package this skill for WorkBuddy's skill marketplace.
#
# WorkBuddy's publishing requirement: a ZIP whose top level is one folder named
# after the skill, containing SKILL.md (plus optional scripts/references/assets).
# The official validator requires: SKILL.md with YAML frontmatter that has a
# hyphen-case `name` and a `description` with no angle brackets.
#
# This script stages a clean copy (excluding VCS/dev artifacts), runs the official
# validator when available, then produces dist/<skill-name>.zip.
#
# Usage: bash scripts/package-skill.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="$(basename "$ROOT")"
DIST="$ROOT/dist"
STAGE_ROOT="$DIST/.stage"
STAGE="$STAGE_ROOT/$NAME"

# The frontmatter name must match the folder name (marketplace convention).
SKILL_NAME="$(sed -n 's/^name:[[:space:]]*//p' "$ROOT/SKILL.md" | head -1 | tr -d '\r"'"'"' ')"
if [ -n "$SKILL_NAME" ] && [ "$SKILL_NAME" != "$NAME" ]; then
  echo "⚠️  SKILL.md name ($SKILL_NAME) 与目录名 ($NAME) 不一致；zip 将以目录名命名" >&2
fi

echo "📦 打包技能：$NAME"
rm -rf "$STAGE_ROOT"
mkdir -p "$STAGE"

# Ship only skill content; exclude .git / .github / dist / dev metadata.
for item in SKILL.md README.md LICENSE NOTICE CHANGELOG.md scripts references assets; do
  [ -e "$ROOT/$item" ] && cp -R "$ROOT/$item" "$STAGE/"
done
find "$STAGE" -name '.DS_Store' -delete 2>/dev/null || true

# Run the official WorkBuddy validator when the app bundle is present.
CREATOR_SCRIPTS="/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/skill-creator/scripts"
if [ -f "$CREATOR_SCRIPTS/quick_validate.py" ] && command -v python3 >/dev/null 2>&1; then
  echo "🔍 官方校验 (quick_validate.py)："
  python3 "$CREATOR_SCRIPTS/quick_validate.py" "$STAGE" || { echo "❌ 校验未通过，已中止" >&2; rm -rf "$STAGE_ROOT"; exit 1; }
else
  echo "ℹ️  未找到官方 quick_validate.py，跳过（仍生成 zip）"
fi

OUT="$DIST/$NAME.zip"
rm -f "$OUT"
if command -v zip >/dev/null 2>&1; then
  ( cd "$STAGE_ROOT" && zip -qr "$OUT" "$NAME" )
else
  ( cd "$STAGE_ROOT" && python3 -m zipfile -c "$OUT" "$NAME" )
fi
rm -rf "$STAGE_ROOT"

echo ""
echo "✅ 已打包：$OUT"
echo "--- zip 内容 ---"
unzip -l "$OUT"
echo ""
echo "上传该 zip 即完成 WorkBuddy 技能发布；对应 GitHub Release 也用它作为附件。"
