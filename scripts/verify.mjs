/**
 * Verify the bridge is reachable and WorkBuddy's models.json matches it.
 * Usage: node verify.mjs
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()
const BRIDGE_HOME = process.env.OPENCODE_BRIDGE_HOME || path.join(HOME, '.workbuddy', 'opencode-bridge')
const WB_HOME = process.env.WORKBUDDY_HOME || path.join(HOME, '.workbuddy')
const ep = JSON.parse(fs.readFileSync(path.join(BRIDGE_HOME, 'endpoint.json'), 'utf8'))

let healthy
try {
  const res = await fetch(`${ep.baseUrl}/health`, { headers: { Authorization: `Bearer ${ep.apiKey}` } })
  healthy = await res.json()
} catch (e) {
  console.log('桥接未响应：', e.message)
  process.exit(1)
}
console.log('桥接 /health:', JSON.stringify(healthy))

const m = JSON.parse(fs.readFileSync(path.join(WB_HOME, 'models.json'), 'utf8'))
const oc = m.filter(x => typeof x.id === 'string' && x.id.startsWith('opencode/'))
const portOk = oc.every(x => x.url.includes(new URL(ep.baseUrl).port))
const keyOk = oc.every(x => x.apiKey === ep.apiKey)
const idsMatch = oc.length === ep.models.length && oc.every(x => ep.models.some(e => e.id === x.id))

console.log('models.json opencode 条目:', oc.length, '| 桥接模型:', ep.models.length)
console.log('端口一致:', portOk, '| apiKey 一致:', keyOk, '| id 全部命中:', idsMatch)
const ok = portOk && keyOk && idsMatch && oc.length === ep.models.length && healthy.ok === true
console.log('整体可用:', ok)
process.exit(ok ? 0 : 1)
