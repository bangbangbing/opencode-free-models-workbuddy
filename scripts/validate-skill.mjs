/**
 * Validate this skill/repo. Runs locally (`npm run validate`) and in CI.
 * No external dependencies.
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const ok = (m) => console.log(`  \u2713 ${m}`)
const bad = (m) => { failed += 1; console.error(`  \u2717 ${m}`) }
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const exists = (p) => fs.existsSync(path.join(root, p))

console.log('SKILL.md frontmatter')
const skill = read('SKILL.md')
const fmMatch = /^---\n([\s\S]*?)\n---/.exec(skill)
if (!fmMatch) {
  bad('缺少 frontmatter')
} else {
  const fm = fmMatch[1]
  fm.includes('name:') ? ok('name') : bad('缺少 name')
  fm.includes('description:') ? ok('description') : bad('缺少 description')
  fm.includes('agent_created: true') ? ok('agent_created: true') : bad('缺少 agent_created: true')
  fm.includes('Triggers:') ? ok('description 含 Triggers') : bad('description 缺少 Triggers')
}

console.log('必需文件')
for (const f of ['SKILL.md', 'README.md', 'LICENSE', 'NOTICE', 'CHANGELOG.md']) {
  exists(f) ? ok(f) : bad(`缺少 ${f}`)
}
for (const f of [
  'scripts/bridge.mjs', 'scripts/sync-workbuddy-models.mjs', 'scripts/verify.mjs',
  'scripts/doctor.mjs', 'scripts/run-bridge.sh', 'scripts/run-bridge.cmd',
  'references/persistence.md', 'references/troubleshooting.md',
]) {
  exists(f) ? ok(f) : bad(`缺少 ${f}`)
}

console.log('node --check')
for (const f of ['scripts/bridge.mjs', 'scripts/sync-workbuddy-models.mjs', 'scripts/verify.mjs', 'scripts/doctor.mjs', 'scripts/validate-skill.mjs']) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' })
    ok(f)
  } catch (e) {
    bad(`${f}: ${(e.stderr?.toString() || e.message).split('\n')[0]}`)
  }
}

console.log('跨平台检查')
{
  // No POSIX-only assumptions in the Node entry points: /bin/sh, bash, etc.
  const posixOnly = ['/bin/sh', '/bin/bash', 'chmod +x ']
  for (const f of ['scripts/bridge.mjs', 'scripts/doctor.mjs', 'scripts/sync-workbuddy-models.mjs', 'scripts/verify.mjs']) {
    const src = read(f)
    const hit = posixOnly.find((needle) => src.includes(needle))
    hit ? bad(`${f} 含 POSIX 专有片段：${hit}`) : ok(`${f} 无 POSIX 专有依赖`)
  }
  exists('scripts/run-bridge.cmd') ? ok('存在 Windows 启动脚本 run-bridge.cmd') : bad('缺少 run-bridge.cmd')
}

console.log('GitHub 发布就绪')
{
  // No unfilled placeholders may ship: they are the #1 reason a "ready to
  // publish" repo still doesn't work when someone clones it.
  const readme = read('README.md')
  const placeholder = /OWNER\/REPO|your-username|github\.com\/<you>/.exec(readme)
  placeholder ? bad(`README.md 仍含占位符：${placeholder[0]}`) : ok('README.md 无占位符')

  // README badges/links should point at the real repo.
  const repoSlug = /github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\.git/.exec(`${readme}\n${read('package.json')}`)
  if (repoSlug) {
    readme.includes(repoSlug[1]) ? ok(`README 指向 ${repoSlug[1]}`) : bad(`README 未指向 ${repoSlug[1]}`)
  } else {
    bad('package.json 缺少 repository 字段')
  }

  // Release automation must exist, otherwise "publish" is a manual chore.
  exists('.github/workflows/release.yml') ? ok('存在 release.yml') : bad('缺少 .github/workflows/release.yml')
  exists('.github/workflows/validate.yml') ? ok('存在 validate.yml') : bad('缺少 .github/workflows/validate.yml')

  // Every workflow referenced by a badge must actually exist.
  const wfRefs = [...readme.matchAll(/actions\/workflows\/([A-Za-z0-9._-]+\.ya?ml)/g)].map((m) => m[1])
  const missingWf = [...new Set(wfRefs)].filter((f) => !exists(`.github/workflows/${f}`))
  missingWf.length === 0
    ? ok(`README 徽章引用的工作流均存在 (${[...new Set(wfRefs)].length} 个)`)
    : bad(`README 徽章引用了不存在的 workflow: ${missingWf.join(', ')}`)
}


// Mirrors the checks the platform's review pipeline runs. Catching these locally
// is cheaper than being rejected 1-3 business days later.
console.log('市场导入规则')
{
  const fm = fmMatch ? fmMatch[1] : ''
  const dirName = path.basename(root)

  const grab = (key) => {
    // [ \t]* (not \s*) so the capture starts on the key's own line. The `s` flag
    // lets a `|` block scalar span lines; `(?![\s\S])` = absolute end of string
    // (plain `$` would match a line end under the `m` flag and truncate to empty).
    const m = new RegExp(`^${key}:[ \\t]*(.*?)(?=\\n[a-zA-Z_-]+:|(?![\\s\\S]))`, 'ms').exec(fm)
    return m ? m[1].trim().replace(/^\|/, '') : ''
  }

  // B06: name must equal the folder name
  const name = grab('name').replace(/^["']|["']$/g, '')
  name === dirName ? ok(`B06 name 与目录名一致 (${dirName})`) : bad(`B06 name='${name}' 与目录名 '${dirName}' 不一致`)

  // B03: description 50-200 chars (block scalar joined onto one line)
  const desc = grab('description').replace(/^\|/, '').split('\n').map((s) => s.trim()).filter(Boolean).join(' ')
  desc.length >= 50 && desc.length <= 200
    ? ok(`B03 description 长度 ${desc.length}`)
    : bad(`B03 description 长度 ${desc.length}，应落在 50-200`)

  // B04: description_zh <= 50 chars
  const zh = grab('description_zh').replace(/^["']|["']$/g, '')
  zh && [...zh].length <= 50 ? ok(`B04 description_zh ${[...zh].length} 字`) : bad(`B04 description_zh 缺失或超过 50 字`)

  // B05: description_en <= 120 chars, ideally 60-80
  const en = grab('description_en').replace(/^["']|["']$/g, '')
  if (!en) bad('B05 缺少 description_en')
  else if (en.length > 120) bad(`B05 description_en ${en.length} 字符，上限 120`)
  else if (en.length < 60) ok(`B05 description_en ${en.length} 字符（建议 60-80，当前偏短）`)
  else ok(`B05 description_en ${en.length} 字符`)

  // B10: body must have substance
  const body = skill.replace(/^---\n[\s\S]*?\n---/, '')
  body.trim().length >= 500 ? ok(`B10 body ${body.trim().length} 字符`) : bad('B10 body 内容过少')

  // B15 / B16: references must be referenced both ways
  const refDir = path.join(root, 'references')
  if (fs.existsSync(refDir)) {
    const files = fs.readdirSync(refDir).filter((f) => f.endsWith('.md'))
    const broken = files.filter((f) => !body.includes(`references/${f}`))
    broken.length === 0 ? ok(`B15/B16 references 双向引用有效 (${files.length} 个)`) : bad(`B15/B16 未被正文引用: ${broken.join(', ')}`)
  } else {
    ok('B15/B16 无 references/ 目录，跳过')
  }

  // B18: no ClawHub leftovers
  /clawhub/i.test(skill) ? bad('B18 发现 ClawHub 残留') : ok('B18 无 ClawHub 残留')

  // S05: quick-start example / code block in the body
  body.includes('```') ? ok('S05 body 含代码块') : bad('S05 body 缺少快速开始示例或代码块')
}

if (failed > 0) {
  console.error(`\n${failed} 项检查未通过`)
  process.exit(1)
}
console.log('\n全部检查通过')

