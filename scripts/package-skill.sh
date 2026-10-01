#!/bin/bash
#
# Package this skill into the two ZIP shapes the two distribution channels need.
#
# WorkBuddy's publishing requirement: a ZIP whose top level is one folder named
# after the skill, containing SKILL.md. The official validator requires SKILL.md
# with YAML frontmatter that has a hyphen-case `name` and a `description` with no
# angle brackets.
#
# Two outputs:
#   1. dist/<name>.zip             — GitHub release / 直接分享给同事的完整包
#   2. dist/<name>.marketplace.zip — 上架 SkillHub 的精简包
#
# Why two: WorkBuddy's marketplace ingestion pipeline whitelists exactly
#   SKILL.md + references/ + scripts/
# and deletes everything else (README.md/LICENSE/NOTICE/CHANGELOG/assets get
# filtered out as "non_standard_files"). Shipping the lean zip means the reviewer
# sees no stripped-file noise.
#
# The marketplace zip additionally drops dev-only tools from scripts/:
#   - package-skill.sh   (packaging self-hosting; contains rm -rf staging cleanup
#                         that a static security scan flags as "删除文件")
#   - validate-skill.mjs (repo lint; runs node --check subprocesses)
# Neither is needed for the skill to function after installation.
#
# Usage: bash scripts/package-skill.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="$(basename "$ROOT")"
DIST="$ROOT/dist"

# Files that survive marketplace ingestion (see whitelist above).
MARKETPLACE_ITEMS=(SKILL.md scripts references)
# Everything a human cloning the repo wants.
FULL_ITEMS=(SKILL.md README.md PUBLISHING.md LICENSE NOTICE CHANGELOG.md scripts references assets)

# The frontmatter name must match the folder name (marketplace convention).
SKILL_NAME="$(sed -n 's/^name:[[:space:]]*//p' "$ROOT/SKILL.md" | head -1 | tr -d '\r"'"'"' ')"
if [ -n "$SKILL_NAME" ] && [ "$SKILL_NAME" != "$NAME" ]; then
  echo "⚠️  SKILL.md name ($SKILL_NAME) 与目录名 ($NAME) 不一致；zip 将以目录名命名" >&2
fi

CREATOR_SCRIPTS="/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/skill-creator/scripts"

# stage_and_zip <variant-label> <out-zip> <item...>
stage_and_zip() {
  local label="$1" out="$2"; shift 2
  # Stage in the system temp dir (not inside dist/) and clean up via python, so
  # no bulk rm -rf runs inside the repo.
  local stage_root
  stage_root="$(mktemp -d)"
  local stage="$stage_root/$NAME"

  mkdir -p "$stage"
  for item in "$@"; do
    [ -e "$ROOT/$item" ] && cp -R "$ROOT/$item" "$stage/"
  done
  if [ "$label" = marketplace ]; then
    rm -f "$stage/scripts/package-skill.sh" "$stage/scripts/validate-skill.mjs"
  fi
  find "$stage" -name '.DS_Store' -delete 2>/dev/null || true

  # Official validator, when the app bundle is present.
  if [ -f "$CREATOR_SCRIPTS/quick_validate.py" ] && command -v python3 >/dev/null 2>&1; then
    python3 "$CREATOR_SCRIPTS/quick_validate.py" "$stage" >/dev/null 2>&1 \
      || { echo "❌ [$label] 官方校验未通过，已中止" >&2; python3 "$CREATOR_SCRIPTS/quick_validate.py" "$stage" >&2 || true; return 1; }
    echo "  🔍 [$label] 官方校验通过"
  else
    echo "  ℹ️  [$label] 未找到官方 quick_validate.py，跳过校验"
  fi

  rm -f "$out"
  if command -v zip >/dev/null 2>&1; then
    ( cd "$stage_root" && zip -qr "$out" "$NAME" )
  else
    ( cd "$stage_root" && python3 -m zipfile -c "$out" "$NAME" )
  fi
  python3 -c "import shutil,sys; shutil.rmtree(sys.argv[1], ignore_errors=True)" "$stage_root"

  local size files
  size="$(wc -c < "$out" | tr -d ' ')"
  files="$(unzip -l "$out" | tail -1 | awk '{print $2}')"
  echo "  ✅ $out  (${size} bytes, ${files} files)"
}

mkdir -p "$DIST"
# Drop any stale stage dirs from older script versions.
python3 -c "
import glob, shutil
for p in glob.glob('$DIST/.stage*'): shutil.rmtree(p, ignore_errors=True)
"

echo "📦 打包技能：$NAME"
echo ""

echo "[1/2] 完整包（GitHub Release / 直接分享）"
stage_and_zip full "$DIST/$NAME.zip" "${FULL_ITEMS[@]}"

echo "[2/2] 精简包（上架 SkillHub，仅白名单内容，不含开发工具）"
stage_and_zip marketplace "$DIST/$NAME.marketplace.zip" "${MARKETPLACE_ITEMS[@]}"

echo ""
echo "--- 精简包内容 ---"
unzip -l "$DIST/$NAME.marketplace.zip"
echo ""
echo "上传路径："
echo "  · 上架 SkillHub        → dist/$NAME.marketplace.zip"
echo "  · GitHub Release 附件  → dist/$NAME.zip"
echo "  · 发给同事手动导入      → dist/$NAME.marketplace.zip 或完整包均可"
echo ""
echo "详见 PUBLISHING.md"
