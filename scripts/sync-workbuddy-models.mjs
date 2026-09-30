/**
 * Sync the running bridge's free models into WorkBuddy's models.json.
 *
 * Reads <bridge home>/endpoint.json (written by bridge.mjs) and appends one
 * Custom, OpenAI-compatible entry per free model. Existing opencode/* entries
 * are replaced so the list stays in sync with the dynamic upstream roster.
 * WorkBuddy must be restarted afterwards to load the change.
 *
 * Env:
 *   OPENCODE_BRIDGE_HOME   bridge state dir (default ~/.workbuddy/opencode-bridge)
 *   WORKBUDDY_HOME         WorkBuddy home (default ~/.workbuddy)
 */

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()
const BRIDGE_HOME = process.env.OPENCODE_BRIDGE_HOME || path.join(HOME, '.workbuddy', 'opencode-bridge')
const WB_HOME = process.env.WORKBUDDY_HOME || path.join(HOME, '.workbuddy')
const ENDPOINT = path.join(BRIDGE_HOME, 'endpoint.json')
const MODELS_JSON = path.join(WB_HOME, 'models.json')

const endpoint = JSON.parse(await fsp.readFile(ENDPOINT, 'utf8'))
const { apiKey, chatCompletions, models } = endpoint
if (!Array.isArray(models) || models.length === 0) {
  console.error('endpoint.json 中没有模型，请先启动桥接（bridge.mjs）')
  process.exit(1)
}

const backup = `${MODELS_JSON}.bak.${Date.now()}`
await fsp.copyFile(MODELS_JSON, backup)
console.log(`已备份 models.json -> ${backup}`)

const current = JSON.parse(await fsp.readFile(MODELS_JSON, 'utf8'))
if (!Array.isArray(current)) { console.error('models.json 不是数组'); process.exit(1) }

const kept = current.filter(m => !(typeof m.id === 'string' && m.id.startsWith('opencode/')))
const display = (name) => String(name).replace(/^OC · /, 'OpenCode · ')

const entries = models.map((m) => {
  const entry = {
    id: m.id,
    name: display(m.name),
    vendor: 'Custom',
    url: chatCompletions,
    apiKey,
    supportsToolCall: m.supportsTools,
    supportsImages: m.supportsImages,
    supportsReasoning: m.supportsReasoning,
    useCustomProtocol: false,
  }
  if (Array.isArray(m.supportedEfforts) && m.supportedEfforts.length > 0) {
    entry.reasoning = { supportedEfforts: m.supportedEfforts }
  }
  return entry
})

const tmp = `${MODELS_JSON}.tmp`
await fsp.writeFile(tmp, JSON.stringify([...kept, ...entries], null, 2))
await fsp.rename(tmp, MODELS_JSON)

console.log(`已写入 ${entries.length} 个 opencode 免费模型（原有 ${kept.length} 条保留）`)
console.log('请重启 WorkBuddy 以加载新模型。')
