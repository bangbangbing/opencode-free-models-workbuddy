/**
 * Self-healing doctor for the OpenCode free-model bridge (macOS / Windows / Linux).
 *
 * Answers one question: "the models don't work — fix it". It probes the bridge,
 * classifies what is actually broken, and repairs what it can:
 *
 *   bridge not running      -> start it detached (survives this process)
 *   upstream runtime dead   -> POST /admin/restart; if that fails, restart the bridge
 *   port held by a stranger -> report it, never kill something we don't own
 *   models.json out of sync -> re-run the sync so WorkBuddy sees the roster
 *
 * Everything is Node-only (no bash, no PowerShell), so the same command works on
 * every platform. Nothing here registers an autostart entry — that stays a
 * documented, opt-in step (see references/persistence.md).
 *
 * Usage:
 *   node scripts/doctor.mjs            # diagnose and repair (default)
 *   node scripts/doctor.mjs --check    # diagnose only, change nothing
 *   node scripts/doctor.mjs --json     # machine-readable result
 *
 * Exit codes: 0 healthy (or repaired), 1 still broken.
 *
 * Env:
 *   OPENCODE_BRIDGE_PORT          bridge port            (default 3199)
 *   OPENCODE_BRIDGE_TOKEN         bearer token           (default built-in)
 *   OPENCODE_BRIDGE_HOME          state dir              (default ~/.workbuddy/opencode-bridge)
 *   WORKBUDDY_HOME                WorkBuddy home         (default ~/.workbuddy)
 *   OPENCODE_BRIDGE_START_TIMEOUT_MS  how long to wait for a cold start (default 300000;
 *                                 a first run may download opencode, ~57 MB)
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BRIDGE_SCRIPT = path.join(HERE, 'bridge.mjs')
const SYNC_SCRIPT = path.join(HERE, 'sync-workbuddy-models.mjs')

const HOME = os.homedir()
const BRIDGE_HOME = process.env.OPENCODE_BRIDGE_HOME || path.join(HOME, '.workbuddy', 'opencode-bridge')
const WB_HOME = process.env.WORKBUDDY_HOME || path.join(HOME, '.workbuddy')
const ENDPOINT_JSON = path.join(BRIDGE_HOME, 'endpoint.json')
const MODELS_JSON = path.join(WB_HOME, 'models.json')
const PORT = Number(process.env.OPENCODE_BRIDGE_PORT || 3199)
const TOKEN = process.env.OPENCODE_BRIDGE_TOKEN
  || '5b3a9c2e1b6d4f8a0c5e2b9d1a4f6c8e7f3a9c2e1b6d4f8a0c5e2b9d1a4f6c8e'
const START_TIMEOUT_MS = Number(process.env.OPENCODE_BRIDGE_START_TIMEOUT_MS ?? 300000)

const argv = process.argv.slice(2)
const CHECK_ONLY = argv.includes('--check') || argv.includes('--dry-run')
const AS_JSON = argv.includes('--json')
const BASE = `http://127.0.0.1:${PORT}`
const AUTH = { Authorization: `Bearer ${TOKEN}` }

/** Steps taken / findings, in order. Also the human-readable report. */
const steps = []
const record = (state, message, extra) => {
  steps.push({ state, message, ...(extra ? { detail: extra } : {}) })
  if (!AS_JSON) {
    const icon = state === 'ok' ? '✓' : state === 'fixed' ? '✚' : state === 'warn' ? '!' : '✗'
    console.log(`${icon} ${message}`)
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * A local HTTP call that never goes through a proxy.
 *
 * On hosts with HTTP_PROXY set, a loopback request would otherwise be handed to
 * the proxy and fail with "upstream connect failed" — a confusing error that
 * looks like the bridge is down when it is not.
 */
async function callApi(pathname, { method = 'GET', timeoutMs = 5000 } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: AUTH,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 200) } }
  return { status: res.status, body }
}

/** Is anything listening on the port at all? */
function portInUse(port = PORT) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = (value) => { socket.destroy(); resolve(value) }
    socket.setTimeout(1500)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * Classify the bridge: healthy / degraded (upstream dead) / foreign (a different
 * service owns the port) / down (nothing listening).
 */
async function diagnose() {
  const attempt = async () => {
    try {
      const { status, body } = await callApi('/health')
      if (status === 401) return { state: 'foreign', why: '端口被占用：对方返回 401，不是本桥接（token 不匹配）' }
      if (status !== 200 || typeof body?.ok !== 'boolean') {
        return { state: 'foreign', why: `端口被占用：/health 返回 HTTP ${status}，不是本桥接` }
      }
      if (body.ok === true) return { state: 'healthy', health: body }
      return { state: 'degraded', health: body, why: '桥接在线但上游运行时不可用' }
    } catch (error) {
      // Node's fetch wraps connection failures in a bare `TypeError: fetch failed`;
      // the useful text (`ECONNREFUSED`) lives on `cause`.
      const cause = error?.cause?.code || error?.cause?.message || error?.code
      return { state: 'unreachable', why: cause ? `无响应（${cause}）` : '无响应' }
    }
  }

  let verdict = await attempt()
  if (verdict.state !== 'unreachable') return verdict

  // A bridge that is mid-restart listens but answers slowly. Give it one more
  // chance before we conclude the port belongs to somebody else — declaring
  // "foreign" would wrongly stop us from repairing our own bridge.
  if (await portInUse()) {
    await sleep(2500)
    verdict = await attempt()
    if (verdict.state !== 'unreachable') return verdict
    return { state: 'foreign', why: `端口 ${PORT} 被占用，但没有 HTTP 响应（可能是本桥接卡死，也可能是别的程序）` }
  }
  return { state: 'down', why: `桥接未运行（${verdict.why}）` }
}

/**
 * Start the bridge as an independent process.
 *
 * `detached: true` + `unref()` is the cross-platform way to leave it running
 * after this process exits: on POSIX it gets its own session, on Windows its own
 * process group. `windowsHide` keeps a console window from flashing up.
 */
function spawnBridge() {
  const child = spawn(process.execPath, [BRIDGE_SCRIPT], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: BRIDGE_HOME,
    env: { ...process.env },
  })
  child.unref()
  return child.pid
}

/** Poll /health until healthy or the budget runs out. */
async function waitHealthy(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last
  let announced = false
  while (Date.now() < deadline) {
    try {
      const { status, body } = await callApi('/health', { timeoutMs: 3000 })
      if (status === 200 && body?.ok === true) return { ok: true, health: body }
      last = body
    } catch { /* still starting */ }
    if (!announced && !AS_JSON) {
      console.log('  … 正在启动（首次运行可能需下载 opencode，约 57MB，请耐心等待）')
      announced = true
    }
    await sleep(1500)
  }
  return { ok: false, last }
}

/** Does models.json already list exactly what the bridge advertises? */
async function modelsInSync() {
  try {
    const ep = JSON.parse(await fsp.readFile(ENDPOINT_JSON, 'utf8'))
    const models = JSON.parse(await fsp.readFile(MODELS_JSON, 'utf8'))
    const oc = models.filter(m => typeof m?.id === 'string' && m.id.startsWith('opencode/'))
    const want = new Set((ep.models ?? []).map(m => m.id))
    const have = new Set(oc.map(m => m.id))
    const same = want.size === have.size && [...want].every(id => have.has(id))
    const urlOk = oc.every(m => String(m.url || '').includes(`:${PORT}`))
    const keyOk = oc.every(m => m.apiKey === ep.apiKey)
    return { inSync: same && urlOk && keyOk, want: want.size, have: have.size, urlOk, keyOk }
  } catch (error) {
    return { inSync: false, reason: error.message }
  }
}

/** Run a sibling script and capture its output. */
function runNodeScript(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { cwd: HERE, env: { ...process.env } })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    child.on('error', e => resolve({ code: -1, out: e.message }))
    child.on('close', code => resolve({ code, out: out.trim() }))
  })
}

async function main() {
  if (!AS_JSON) {
    console.log(`opencode 桥接自检 —— http://127.0.0.1:${PORT}`)
    console.log(`平台：${process.platform}/${process.arch}  Node ${process.versions.node}`)
    console.log('')
  }

  if (!fs.existsSync(BRIDGE_SCRIPT)) {
    record('fail', `找不到 bridge.mjs（预期在 ${BRIDGE_SCRIPT}）`)
    return finish(false)
  }

  let verdict = await diagnose()
  record(verdict.state === 'healthy' ? 'ok' : 'warn', `探测：${verdict.why ?? '健康'}`)

  // --- repair 1: nothing listening (or a stranger owns the port) -------------
  if (verdict.state === 'down' || verdict.state === 'degraded') {
    if (CHECK_ONLY) {
      record('warn', '仅检查模式：未做修复')
      return finish(false)
    }

    if (verdict.state === 'degraded') {
      record('fixed', '上游不可用，请求桥接重启上游…')
      try {
        const { status, body } = await callApi('/admin/restart', { method: 'POST', timeoutMs: 120000 })
        if (status === 200 && body?.ok) record('fixed', `上游已恢复（${body.models ?? '?'} 个模型）`)
        else record('warn', `上游重启未成功（HTTP ${status}），改为重启桥接进程`)
      } catch (error) {
        record('warn', `上游重启请求失败（${error.message}），改为重启桥接进程`)
      }
    }

    // Re-probe; a successful upstream restart above may already be enough.
    verdict = await diagnose()
    if (verdict.state !== 'healthy') {
      record('fixed', '正在启动桥接进程…')
      const pid = spawnBridge()
      record('fixed', `已拉起桥接（pid ${pid}），等待就绪…`)
      const started = await waitHealthy(START_TIMEOUT_MS)
      if (!started.ok) {
        record('fail', `桥接启动超时（${Math.round(START_TIMEOUT_MS / 1000)}s）。请查看 ${path.join(BRIDGE_HOME, 'runtime-data', 'opencode.log')}`)
        return finish(false)
      }
      record('fixed', `桥接已就绪（${started.health.models} 个模型）`)
      verdict = { state: 'healthy', health: started.health }
    }
  }

  // --- repair 2: port owned by something else -------------------------------
  if (verdict.state === 'foreign') {
    record('fail', verdict.why)
    record('warn', `端口 ${PORT} 被其他程序占用。改用别的端口即可：OPENCODE_BRIDGE_PORT=3399 node scripts/doctor.mjs`)
    record('warn', '本工具不会结束不属于它的进程——请自行确认占用者。')
    return finish(false)
  }

  // --- repair 3: roster drift ----------------------------------------------
  const sync = await modelsInSync()
  if (sync.inSync) {
    record('ok', `models.json 与桥接一致（${sync.have} 个模型）`)
  } else if (CHECK_ONLY) {
    record('warn', '仅检查模式：models.json 与桥接不一致，未修复')
  } else {
    record('fixed', `models.json 与桥接不一致（有 ${sync.have} / 期望 ${sync.want}），重新同步…`)
    const res = await runNodeScript(SYNC_SCRIPT)
    if (res.code === 0) record('fixed', 'models.json 已同步（需重启 WorkBuddy 才加载）')
    else record('fail', `同步失败：${res.out.split('\n').slice(-3).join(' / ')}`)
  }

  const final = await diagnose()
  const healthy = final.state === 'healthy'
  if (!healthy) record('fail', `仍未恢复：${final.why ?? final.state}`)

  return finish(healthy, final.health)
}

function finish(ok, health) {
  if (AS_JSON) {
    console.log(JSON.stringify({
      ok,
      platform: process.platform,
      arch: process.arch,
      port: PORT,
      health: health ?? null,
      steps,
    }, null, 2))
  } else {
    console.log('')
    console.log(ok
      ? `结果：可用${health ? `（${health.models} 个模型，${health.upstreamAlive ? '上游在线' : '上游异常'}）` : ''}`
      : '结果：仍不可用——见上面标 ✗ 的条目')
    if (ok && steps.some(s => s.state === 'fixed')) {
      console.log('提示：若 WorkBuddy 里仍看不到模型，重启 WorkBuddy 以重新加载 models.json。')
    }
  }
  process.exit(ok ? 0 : 1)
}

main().catch((error) => {
  record('fail', `自检脚本异常：${error?.message ?? error}`)
  finish(false)
})
