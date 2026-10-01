/**
 * Standalone OpenCode free-model bridge for WorkBuddy.
 *
 * Exposes OpenCode Zen's free models as a fixed-port, OpenAI-compatible endpoint
 * that WorkBuddy can consume as a Custom model provider. It reuses the core
 * modules of the `dsh-opencode-xdbridge` plugin (runtime / backend / protocol) to
 * run a real, isolated `opencode serve` process.
 *
 * Why a real process is required: OpenCode Zen's free tier only answers traffic
 * originating from a genuine OpenCode runtime (FreeTierError otherwise). The
 * plugin launches `opencode serve` with permission:{'*':'ask'} and isolated
 * agents, which keeps the gate open while executing nothing locally.
 *
 * This file is portable: it auto-detects the DSH home, the plugin's core lib and
 * an opencode binary. Override any of them with the env vars below.
 *
 * Env:
 *   DSH_HOME                    DSH home (default ~/.dsh)
 *   OPENCODE_BRIDGE_HOME        bridge state dir (default ~/.workbuddy/opencode-bridge)
 *   OPENCODE_BRIDGE_PLUGIN_LIB  path to dsh-opencode-xdbridge/lib
 *   OPENCODE_BRIDGE_BINARY      path to the opencode binary
 *   OPENCODE_BRIDGE_PORT        loopback port (default 3199)
 *   OPENCODE_BRIDGE_TOKEN       bearer token WorkBuddy must send
 *   OPENCODE_BRIDGE_NO_DOWNLOAD =1 to never download the opencode binary
 *                               (fails fast when none is installed locally)
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const HOME = os.homedir()
const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh')
const BRIDGE_HOME = process.env.OPENCODE_BRIDGE_HOME || path.join(HOME, '.workbuddy', 'opencode-bridge')
const DATA_DIR = process.env.OPENCODE_BRIDGE_DATA_DIR || path.join(BRIDGE_HOME, 'runtime-data')
const ENDPOINT_JSON = path.join(BRIDGE_HOME, 'endpoint.json')
const PORT = Number(process.env.OPENCODE_BRIDGE_PORT || 3199)
const TOKEN = process.env.OPENCODE_BRIDGE_TOKEN
  || '5b3a9c2e1b6d4f8a0c5e2b9d1a4f6c8e7f3a9c2e1b6d4f8a0c5e2b9d1a4f6c8e'

const REQUEST_BODY_LIMIT = 16 * 1024 * 1024
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

const log = (m) => console.log(`${new Date().toISOString()} ${m}`)

function requireNode() {
  const [maj, min] = process.versions.node.split('.').map(Number)
  if (maj < 22 || (maj === 22 && min < 19)) {
    console.error(`需要 Node ^22.19 || >=24，当前 v${process.versions.node}`)
    process.exit(1)
  }
}

/** Locate the plugin's core lib, so we can reuse its proven bridge logic. */
async function resolvePluginLib() {
  if (process.env.OPENCODE_BRIDGE_PLUGIN_LIB) return process.env.OPENCODE_BRIDGE_PLUGIN_LIB
  const profiles = path.join(DSH_HOME, 'profiles')
  try {
    for (const e of await fsp.readdir(profiles, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const lib = path.join(profiles, e.name, 'node_modules', 'dsh-opencode-xdbridge', 'lib')
      if (fs.existsSync(path.join(lib, 'runtime.js'))) return lib
    }
  } catch { /* no profiles dir */ }
  return null
}

/** opencode binaries already installed by the DSH plugin runtime. */
async function dshRuntimeBinaries() {
  const root = path.join(DSH_HOME, 'opencode-xdbridge', 'runtime')
  const out = []
  try {
    for (const e of await fsp.readdir(root, { withFileTypes: true })) {
      if (e.isDirectory()) out.push(path.join(root, e.name, 'opencode'))
    }
  } catch { /* none installed */ }
  return out.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
}

function hostIsLoopback(host) {
  if (!host) return false
  let h = host.trim().toLowerCase()
  if (h.startsWith('[')) { const e = h.indexOf(']'); if (e !== -1) h = h.slice(0, e + 1) }
  const c = h.lastIndexOf(':')
  if (c !== -1 && /^\d+$/.test(h.slice(c + 1))) h = h.slice(0, c)
  return LOOPBACK_HOSTS.has(h)
}
function originIsLoopback(origin) {
  if (!origin) return true
  try { return LOOPBACK_HOSTS.has(new URL(origin).hostname) } catch { return false }
}
function authorized(req) {
  const actual = Buffer.from(req.headers.authorization || '')
  const expected = Buffer.from(`Bearer ${TOKEN}`)
  return actual.length === expected.length && actual.equals(expected)
}
async function readBody(req) {
  const chunks = []; let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > REQUEST_BODY_LIMIT) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString())
}
function writeJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

/** Runtime-shape models -> the shape prepare()/checkContextFit() read. */
function enrich(model, usableContextWindow) {
  return {
    ...model,
    contextWindow: usableContextWindow(model),
    reportedContextWindow: model.context ?? model.input ?? 128_000,
    maxOutputTokens: model.output ?? 32_000,
    supportsImages: model.images === true,
    supportsTools: model.toolcall !== false,
    supportsReasoning: model.reasoning === true,
    supportedEfforts: Object.values(model.variants ?? {})
      .filter(o => !o?.disabled && typeof o?.reasoningEffort === 'string')
      .map(o => o.reasoningEffort),
    variants: model.variants ?? {},
  }
}

async function main() {
  requireNode()

  const pluginLib = await resolvePluginLib()
  if (!pluginLib) {
    console.error(
      '未找到 dsh-opencode-xdbridge 插件的核心模块。请先安装该插件：\n'
      + `  dsh plugin --profile <profile> add github:XDTrees/dsh-opencode-xdbridge\n`
      + '或用 OPENCODE_BRIDGE_PLUGIN_LIB 指向其 lib 目录。',
    )
    process.exit(1)
  }

  const runtimeMod = await import(pathToFileURL(path.join(pluginLib, 'runtime.js')).href)
  const backendMod = await import(pathToFileURL(path.join(pluginLib, 'backend.js')).href)
  const protocolMod = await import(pathToFileURL(path.join(pluginLib, 'protocol.js')).href)
  const budgetMod = await import(pathToFileURL(path.join(pluginLib, 'context-budget.js')).href)
  const { startBackend, findRuntime } = runtimeMod
  const { clientModelID } = backendMod
  const { prepare, sendSSE, BridgeError } = protocolMod
  const { usableContextWindow } = budgetMod

  await fsp.mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
  const logStream = fs.createWriteStream(path.join(DATA_DIR, 'opencode.log'), { flags: 'a', mode: 0o600 })
  const note = (m) => { logStream.write(`${new Date().toISOString()} ${m}\n`); log(m) }

  // Reuse an installed opencode; downloading is opt-in for locked-down hosts:
  // set OPENCODE_BRIDGE_NO_DOWNLOAD=1 (or provide OPENCODE_BRIDGE_BINARY) to
  // never fetch anything from the network in this step.
  const noDownload = /^(1|true|yes)$/i.test(process.env.OPENCODE_BRIDGE_NO_DOWNLOAD || '')
  const candidates = [
    process.env.OPENCODE_BRIDGE_BINARY,
    path.join(HOME, '.opencode', 'bin', 'opencode'),
    '/opt/homebrew/bin/opencode',
    '/usr/local/bin/opencode',
    ...(await dshRuntimeBinaries()),
  ].filter(Boolean)
  note('正在解析 opencode 运行时…')
  if (noDownload && !candidates.some((f) => fs.existsSync(f))) {
    console.error(
      'OPENCODE_BRIDGE_NO_DOWNLOAD=1 且本机未找到 opencode 二进制。\n'
      + '请先自行安装 opencode（npm i -g opencode-ai 或 brew install opencode），\n'
      + '或用 OPENCODE_BRIDGE_BINARY 指向已有二进制，或不设置该环境变量以允许下载。',
    )
    process.exit(1)
  }
  const binary = await findRuntime(DATA_DIR, note, { candidates })
  note(`使用 opencode 二进制：${binary}`)

  const proxyEnv = {}
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy']) {
    if (process.env[k]) proxyEnv[k] = process.env[k]
  }

  note('启动隔离 OpenCode 运行时…')
  const runtime = await startBackend(binary, DATA_DIR, logStream, proxyEnv)
  const backend = runtime.backend
  note(`OpenCode ${runtime.version} 运行时就绪`)

  let models = (await backend.models()).map(m => enrich(m, usableContextWindow))
  note(`读取到 ${models.length} 个免费模型`)

  const refreshModels = async () => {
    try { models = (await backend.models()).map(m => enrich(m, usableContextWindow)); note(`刷新模型清单：${models.length} 个`) }
    catch (e) { note(`刷新失败：${e.message}`) }
    return models.length
  }

  const server = createServer(async (req, res) => {
    try {
      if (!hostIsLoopback(req.headers.host) || !originIsLoopback(req.headers.origin)) {
        return writeJson(res, 403, { error: { message: '仅允许本机回环访问', type: 'permission_error' } })
      }
      if (!authorized(req)) {
        return writeJson(res, 401, { error: { message: '需要本地桥接 API key', type: 'authentication_error' } })
      }
      const route = new URL(req.url, 'http://127.0.0.1').pathname

      if (req.method === 'GET' && route === '/health') return writeJson(res, 200, { ok: true, models: models.length })
      if (req.method === 'GET' && route === '/v1/models') {
        return writeJson(res, 200, {
          object: 'list',
          data: models.map(m => ({ id: m.id, object: 'model', owned_by: 'opencode', name: clientModelID(m) })),
        })
      }
      if (req.method === 'POST' && route === '/admin/refresh') return writeJson(res, 200, { ok: true, models: await refreshModels() })
      if (req.method !== 'POST' || route !== '/v1/chat/completions') {
        return writeJson(res, 404, { error: { message: '未找到该路径', type: 'not_found' } })
      }

      const body = await readBody(req)
      let request
      try { request = prepare(body, models) }
      catch (error) {
        if (error instanceof BridgeError) {
          return writeJson(res, error.status || 400, { error: { message: error.message, type: 'invalid_request_error', code: error.code } })
        }
        throw error
      }

      const controller = new AbortController()
      res.on('close', () => { if (!res.writableEnded) controller.abort() })

      let heartbeat; let streamStart
      const meta = {
        tools: request.tools.length,
        model: request.model.id,
        activity: body.stream
          ? (progress) => {
            if (progress.content === true && !streamStart && !controller.signal.aborted
              && !res.destroyed && !res.writableEnded) {
              streamStart = { id: `chatcmpl-${randomBytes(16).toString('hex')}`, created: Math.floor(Date.now() / 1000) }
              res.write(`data: ${JSON.stringify({
                ...streamStart, object: 'chat.completion.chunk', model: body.model,
                choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
              })}\n\n`)
            }
          }
          : undefined,
      }

      try {
        if (body.stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
          res.write(': validating model response before emission\n\n')
          heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(': waiting\n\n') }, 10000)
          heartbeat.unref?.()
        }
        const result = await backend.complete(request, controller.signal, meta)
        if (controller.signal.aborted) return
        result.model = body.model
        if (body.stream) {
          if (streamStart) Object.assign(result, streamStart)
          sendSSE(res, result, Boolean(body.stream_options?.include_usage), Boolean(streamStart))
        } else {
          writeJson(res, 200, result)
        }
      } catch (error) {
        if (controller.signal.aborted) return
        const message = error.name === 'TimeoutError' ? '模型请求超时' : error.message
        const payload = { message, type: error.code || 'upstream_error', code: error.code || 'upstream_error' }
        note(`请求失败：${error.code || error.name}: ${message}`)
        if (res.headersSent) res.end(`data: ${JSON.stringify({ error: payload })}\n\n`)
        else writeJson(res, error.status || 502, { error: payload })
      } finally {
        if (heartbeat) clearInterval(heartbeat)
      }
    } catch (error) {
      if (res.headersSent) { res.end(); return }
      if (error instanceof BridgeError) {
        return writeJson(res, error.status || 400, { error: { message: error.message, type: 'invalid_request_error', code: error.code } })
      }
      note(`shim 内部错误：${error?.message ?? error}`)
      writeJson(res, 500, { error: { message: `内部错误：${error?.message ?? error}`, type: 'internal_error' } })
    }
  })

  server.requestTimeout = 0
  server.headersTimeout = 30000
  server.keepAliveTimeout = 72000

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORT, '127.0.0.1', resolve)
  })

  const baseUrl = `http://127.0.0.1:${PORT}`
  await fsp.writeFile(ENDPOINT_JSON, JSON.stringify({
    baseUrl,
    chatCompletions: `${baseUrl}/v1/chat/completions`,
    modelsUrl: `${baseUrl}/v1/models`,
    health: `${baseUrl}/health`,
    apiKey: TOKEN,
    runtimeVersion: runtime.version,
    dataDir: DATA_DIR,
    models: models.map(m => ({
      id: m.id, name: clientModelID(m), contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens, supportsImages: m.supportsImages,
      supportsTools: m.supportsTools, supportsReasoning: m.supportsReasoning,
      supportedEfforts: m.supportedEfforts,
    })),
  }, null, 2))
  note(`桥接已就绪：${baseUrl}  (apiKey=${TOKEN})`)
  note(`已写入 ${ENDPOINT_JSON}`)

  const shutdown = async () => {
    note('正在关闭桥接…')
    server.closeAllConnections?.()
    await runtime.stop().catch(() => {})
    logStream.end()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error('bridge 启动失败：', error)
  process.exit(1)
})
