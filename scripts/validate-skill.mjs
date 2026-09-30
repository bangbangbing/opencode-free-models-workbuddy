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
for (const f of ['scripts/bridge.mjs', 'scripts/sync-workbuddy-models.mjs', 'scripts/verify.mjs', 'scripts/run-bridge.sh', 'scripts/install-launchd.sh']) {
  exists(f) ? ok(f) : bad(`缺少 ${f}`)
}

console.log('node --check')
for (const f of ['scripts/bridge.mjs', 'scripts/sync-workbuddy-models.mjs', 'scripts/verify.mjs', 'scripts/validate-skill.mjs']) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' })
    ok(f)
  } catch (e) {
    bad(`${f}: ${(e.stderr?.toString() || e.message).split('\n')[0]}`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} 项检查未通过`)
  process.exit(1)
}
console.log('\n全部检查通过')
