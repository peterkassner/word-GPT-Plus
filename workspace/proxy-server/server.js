import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import process from 'node:process'
import { URL } from 'node:url'

const PORT = Number(process.env.PORT || 3100)
const LOG_DIR = process.env.LOG_DIR || `${process.cwd()}/logs`
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'
const HOST_SERVICE_HOST = process.env.HOST_SERVICE_HOST || '127.0.0.1'
const MCP_PROXY_HUB_URL =
  process.env.MCP_PROXY_HUB_URL || process.env.MEMORIX_PROXY_HUB_URL || `http://${HOST_SERVICE_HOST}:8096`
const MCP_PROTOCOL_VERSION = '2024-11-05'
const QDRANT_SERVER_NAME = 'Qdrant_Resources'
const QDRANT_DISCOVER_PATH = '/api/tools/qdrant'
const QDRANT_CALL_PATH = '/api/tools/qdrant/call'
const QDRANT_MCP_PATH = `/servers/${QDRANT_SERVER_NAME}/mcp`
const DOCSUITE_SERVER_NAME = 'docsuite'
const DOCSUITE_DISCOVER_PATH = '/api/tools/docsuite'
const DOCSUITE_CALL_PATH = '/api/tools/docsuite/call'
const DOCSUITE_MCP_PATH = `/servers/${DOCSUITE_SERVER_NAME}/mcp`
const HINDSIGHT_PROXY_PATH = '/api/hindsight'
const HINDSIGHT_TARGET = process.env.HINDSIGHT_BASE_URL || `http://${HOST_SERVICE_HOST}:8888`
const TELEMETRY_PATH = '/api/telemetry'

const providerTargets = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  lmstudio: process.env.LMSTUDIO_ENDPOINT || `http://${HOST_SERVICE_HOST}:1234/v1`,
  groq: 'https://api.groq.com/openai/v1',
  gemini: 'https://generativelanguage.googleapis.com',
  ollama: process.env.OLLAMA_ENDPOINT || `http://${HOST_SERVICE_HOST}:11434`,
}

function stripSearchParam(parsedUrl, paramName) {
  const pairs = []
  parsedUrl.searchParams.forEach((v, k) => {
    if (k !== paramName) pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
  })
  return pairs.join('&')
}

function writeEntry(stream, entry) {
  stream.write(`${JSON.stringify(entry)}\n`)
}

async function getRequestBodyBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function getRequestTarget(url) {
  const parsed = new URL(url, 'http://localhost')
  const pathname = parsed.pathname || ''

  if (pathname === '/api/openai/v1' || pathname.startsWith('/api/openai/v1/')) {
    const tail = pathname.replace('/api/openai/v1', '') || '/'
    const upstreamPath = tail
    return { provider: 'openai', upstreamURL: `${providerTargets.openai}${upstreamPath}${parsed.search}` }
  }

  if (pathname === '/api/openrouter/v1' || pathname.startsWith('/api/openrouter/v1/')) {
    const tail = pathname.replace('/api/openrouter/v1', '') || '/'
    const upstreamPath = tail
    return { provider: 'openrouter', upstreamURL: `${providerTargets.openrouter}${upstreamPath}${parsed.search}` }
  }

  if (pathname === '/api/lmstudio/v1' || pathname.startsWith('/api/lmstudio/v1/')) {
    const tail = pathname.replace('/api/lmstudio/v1', '') || '/'
    const upstreamPath = tail
    return { provider: 'lmstudio', upstreamURL: `${providerTargets.lmstudio}${upstreamPath}${parsed.search}` }
  }

  if (pathname === '/api/groq/v1' || pathname.startsWith('/api/groq/v1/')) {
    const tail = pathname.replace('/api/groq/v1', '') || '/'
    const upstreamPath = tail
    return { provider: 'groq', upstreamURL: `${providerTargets.groq}${upstreamPath}${parsed.search}` }
  }

  if (pathname === '/api/gemini' || pathname.startsWith('/api/gemini/')) {
    const tail = pathname.replace('/api/gemini', '') || '/'
    return { provider: 'gemini', upstreamURL: `${providerTargets.gemini}${tail}${parsed.search}` }
  }

  if (pathname === '/api/azure' || pathname.startsWith('/api/azure/')) {
    const azureEndpoint = parsed.searchParams.get('azureEndpoint')
    if (!azureEndpoint) return null
    const tail = pathname.replace('/api/azure', '') || '/'
    const cleanBase = azureEndpoint.replace(/\/$/, '')
    const qs = stripSearchParam(parsed, 'azureEndpoint')
    return { provider: 'azure', upstreamURL: `${cleanBase}${tail}${qs ? `?${qs}` : ''}` }
  }

  if (pathname === '/api/ollama' || pathname.startsWith('/api/ollama/')) {
    const customEndpoint = parsed.searchParams.get('ollamaEndpoint')
    const base = customEndpoint ? customEndpoint.replace(/\/$/, '') : providerTargets.ollama
    const tail = pathname.replace('/api/ollama', '') || '/'
    const qs = stripSearchParam(parsed, 'ollamaEndpoint')
    return { provider: 'ollama', upstreamURL: `${base}${tail}${qs ? `?${qs}` : ''}` }
  }

  return null
}

function buildUpstreamHeaders(reqHeaders) {
  const headers = {}
  Object.entries(reqHeaders).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      headers[key] = value.join(',')
      return
    }
    if (typeof value === 'string') {
      headers[key] = value
    }
  })

  if (headers.host) {
    delete headers.host
  }
  // Node's built-in fetch (undici) automatically decompresses compressed upstream
  // responses, so forwarding the browser's Accept-Encoding causes a mismatch:
  // the proxy streams already-decompressed bytes while the original Content-Encoding
  // header is still forwarded to the browser, which then fails to decode the body
  // (ERR_CONTENT_DECODING_FAILED). Remove it so upstream always returns plain bytes.
  delete headers['accept-encoding']
  return headers
}

function copyResponseHeaders(upstreamRes, res) {
  upstreamRes.headers.forEach((value, key) => {
    const lk = key.toLowerCase()
    // content-length is excluded because we may re-chunk the body.
    // content-encoding and transfer-encoding must also be excluded: Node's
    // undici fetch auto-decompresses the response body, so these headers are
    // stale by the time we forward to the browser and cause decode errors.
    if (lk === 'content-length' || lk === 'content-encoding' || lk === 'transfer-encoding') {
      return
    }
    res.setHeader(key, value)
  })
}

function createNoopLogger() {
  return {
    write: () => undefined,
    writeRaw: () => undefined,
    close: () => undefined,
  }
}

async function resolveLogDir() {
  const primary = LOG_DIR
  const fallback = `${process.cwd()}/logs`
  try {
    await mkdir(primary, { recursive: true })
    return primary
  } catch {
    try {
      await mkdir(fallback, { recursive: true })
      return fallback
    } catch {
      return '/tmp/word-gpt-plus-proxy-logs'
    }
  }
}

function getMcpHeaders(sessionId = '') {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
  }
}

function parseMcpResponseText(text) {
  const trimmed = (text || '').trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    // Streamable HTTP may return SSE framing. The final data line is the JSON-RPC message.
  }

  const lines = trimmed.split(/\r?\n/).reverse()
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line === 'data: [DONE]') continue
    const candidate = line.startsWith('data:') ? line.slice(5).trim() : line
    if (!candidate) continue
    try {
      return JSON.parse(candidate)
    } catch {
      // keep scanning
    }
  }

  return null
}

function assertMcpResult(message, methodName, rawText) {
  if (!message) {
    throw new Error(`MCP ${methodName} returned no JSON-RPC message: ${(rawText || '').slice(0, 500)}`)
  }
  if (message.error) {
    throw new Error(`MCP ${methodName} error: ${JSON.stringify(message.error).slice(0, 1000)}`)
  }
  return message.result || {}
}

async function postMcpRpc(mcpUrl, payload, headers, config) {
  const response = await fetchWithRetry(
    mcpUrl,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    },
    config.maxRetries,
    config.timeoutMs,
  )
  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(`MCP ${payload.method || 'request'} HTTP ${response.status}: ${responseText.slice(0, 1000)}`)
  }
  return {
    message: parseMcpResponseText(responseText),
    sessionId: response.headers.get('mcp-session-id') || headers['mcp-session-id'] || '',
    responseText,
  }
}

async function initializeMcpSession(mcpUrl, config, clientName) {
  const init = await postMcpRpc(
    mcpUrl,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: `word-gpt-plus-${clientName}`,
          version: '1',
        },
      },
    },
    getMcpHeaders(),
    config,
  )
  assertMcpResult(init.message, 'initialize', init.responseText)

  const headers = getMcpHeaders(init.sessionId)
  await postMcpRpc(
    mcpUrl,
    {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    },
    headers,
    config,
  )

  return headers
}

async function listMcpTools(mcpUrl, config, clientName) {
  const headers = await initializeMcpSession(mcpUrl, config, clientName)
  const response = await postMcpRpc(
    mcpUrl,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    },
    headers,
    config,
  )
  const result = assertMcpResult(response.message, 'tools/list', response.responseText)
  return Array.isArray(result.tools) ? result.tools : []
}

async function callMcpTool(mcpUrl, toolName, args, config, clientName) {
  if (!toolName || typeof toolName !== 'string') {
    throw new Error('Missing MCP tool name')
  }

  const headers = await initializeMcpSession(mcpUrl, config, clientName)
  const response = await postMcpRpc(
    mcpUrl,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args || {},
      },
    },
    headers,
    config,
  )
  return assertMcpResult(response.message, 'tools/call', response.responseText)
}

function normalizeMcpToolPayload(result) {
  if (!result || typeof result !== 'object') return result ?? ''

  if (Array.isArray(result.content)) {
    const textParts = result.content
      .map(entry => {
        if (entry && typeof entry.text === 'string') return entry.text
        if (entry && typeof entry === 'object') return JSON.stringify(entry)
        return ''
      })
      .filter(Boolean)
    if (textParts.length > 0) {
      return textParts.join('\n')
    }
  }

  if (Object.prototype.hasOwnProperty.call(result, 'structuredContent')) {
    return result.structuredContent
  }

  return result
}

async function handleQdrantDiscover(req, res, logger, requestId) {
  const config = getQdrantProxyConfig(req.url || '/')
  const upstreamPath = config.mcpEndpoint.startsWith('/') ? config.mcpEndpoint : `/${config.mcpEndpoint}`
  const upstreamBase = config.mcpProxyHubUrl.replace(/\/+$/, '')
  if (isSelfLoopUrl(config.mcpProxyHubUrl, req.headers.host || '')) {
    res.writeHead(500, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(JSON.stringify({ error: 'Invalid qdrant configuration: mcpProxyHubUrl points to the current proxy host' }))
    return
  }
  const targetUrl = `${upstreamBase}${upstreamPath}`

  logger.write({
    type: 'qdrant.discover.start',
    requestId,
    upstream: targetUrl,
    config,
  })

  const tools = await listMcpTools(targetUrl, config, 'qdrant')
  res.writeHead(200, {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Content-Type': 'application/json',
  })
  logger.write({
    type: 'qdrant.discover.response',
    requestId,
    status: 200,
    toolCount: tools.length,
  })

  res.end(JSON.stringify(tools))
}

async function handleQdrantCall(req, res, logger, requestId) {
  const config = getQdrantProxyConfig(req.url || '/')
  const upstreamPath = config.mcpEndpoint.startsWith('/') ? config.mcpEndpoint : `/${config.mcpEndpoint}`
  const upstreamBase = config.mcpProxyHubUrl.replace(/\/+$/, '')
  if (isSelfLoopUrl(config.mcpProxyHubUrl, req.headers.host || '')) {
    res.writeHead(500, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(JSON.stringify({ error: 'Invalid qdrant configuration: mcpProxyHubUrl points to the current proxy host' }))
    return
  }
  const upstreamUrl = `${upstreamBase}${upstreamPath}`
  const body = await getRequestBodyBody(req)
  let parsedBody = {}
  try {
    parsedBody = body ? JSON.parse(body) : {}
  } catch {
    res.writeHead(400, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(JSON.stringify({ error: 'Invalid JSON payload' }))
    return
  }
  const payload = {
    ...parsedBody,
    agentId: parsedBody.agentId || config.agentId,
  }

  logger.write({
    type: 'qdrant.call.start',
    requestId,
    upstream: upstreamUrl,
    toolName: payload.toolName || parsedBody.toolName || config.toolName || 'unknown',
    requestIdFromClient: payload.requestId,
  })

  const result = await callMcpTool(
    upstreamUrl,
    payload.toolName || config.toolName,
    payload.arguments || {},
    config,
    'qdrant',
  )
  const normalizedPayload = normalizeMcpToolPayload(result)
  res.writeHead(200, {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Content-Type': 'application/json',
  })

  logger.write({
    type: 'qdrant.call.response',
    requestId,
    status: 200,
    toolName: payload.toolName || parsedBody.toolName || config.toolName,
    isError: result?.isError === true,
    bodyPreview: JSON.stringify(normalizedPayload).slice(0, 2048),
  })

  res.end(
    JSON.stringify({
      ...(result?.isError ? { error: normalizedPayload || 'MCP tool returned error' } : {}),
      payload: normalizedPayload,
      result,
    }),
  )
}

async function handleDocSuiteDiscover(req, res, logger, requestId) {
  const config = getDocSuiteProxyConfig(req.url || '/')
  const upstreamPath = config.mcpEndpoint.startsWith('/') ? config.mcpEndpoint : `/${config.mcpEndpoint}`
  const upstreamBase = config.mcpProxyHubUrl.replace(/\/+$/, '')
  if (isSelfLoopUrl(config.mcpProxyHubUrl, req.headers.host || '')) {
    res.writeHead(500, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(
      JSON.stringify({ error: 'Invalid docsuite configuration: mcpProxyHubUrl points to the current proxy host' }),
    )
    return
  }
  const targetUrl = `${upstreamBase}${upstreamPath}`

  logger.write({
    type: 'docsuite.discover.start',
    requestId,
    upstream: targetUrl,
    config,
  })

  const tools = await listMcpTools(targetUrl, config, 'docsuite')
  res.writeHead(200, {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Content-Type': 'application/json',
  })
  logger.write({
    type: 'docsuite.discover.response',
    requestId,
    status: 200,
    toolCount: tools.length,
  })

  res.end(JSON.stringify(tools))
}

async function handleDocSuiteCall(req, res, logger, requestId) {
  const config = getDocSuiteProxyConfig(req.url || '/')
  const upstreamPath = config.mcpEndpoint.startsWith('/') ? config.mcpEndpoint : `/${config.mcpEndpoint}`
  const upstreamBase = config.mcpProxyHubUrl.replace(/\/+$/, '')
  if (isSelfLoopUrl(config.mcpProxyHubUrl, req.headers.host || '')) {
    res.writeHead(500, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(
      JSON.stringify({ error: 'Invalid docsuite configuration: mcpProxyHubUrl points to the current proxy host' }),
    )
    return
  }
  const upstreamUrl = `${upstreamBase}${upstreamPath}`
  const body = await getRequestBodyBody(req)
  let parsedBody = {}
  try {
    parsedBody = body ? JSON.parse(body) : {}
  } catch {
    res.writeHead(400, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(JSON.stringify({ error: 'Invalid JSON payload' }))
    return
  }
  const payload = {
    ...parsedBody,
    agentId: parsedBody.agentId || config.agentId,
  }

  logger.write({
    type: 'docsuite.call.start',
    requestId,
    upstream: upstreamUrl,
    toolName: payload.toolName || parsedBody.toolName || config.toolName || 'unknown',
    requestIdFromClient: payload.requestId,
  })

  const result = await callMcpTool(
    upstreamUrl,
    payload.toolName || config.toolName,
    payload.arguments || {},
    config,
    'docsuite',
  )
  const normalizedPayload = normalizeMcpToolPayload(result)
  res.writeHead(200, {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Content-Type': 'application/json',
  })

  logger.write({
    type: 'docsuite.call.response',
    requestId,
    status: 200,
    toolName: payload.toolName || parsedBody.toolName || config.toolName,
    isError: result?.isError === true,
    bodyPreview: JSON.stringify(normalizedPayload).slice(0, 2048),
  })

  res.end(
    JSON.stringify({
      ...(result?.isError ? { error: normalizedPayload || 'MCP tool returned error' } : {}),
      payload: normalizedPayload,
      result,
    }),
  )
}

async function handleHindsightProxy(req, res, logger, requestId) {
  const parsed = new URL(req.url || '/', 'http://localhost')
  const config = getHindsightProxyConfig(req.url || '/')
  const upstreamBase = config.targetBase.replace(/\/+$/, '')
  const tail = parsed.pathname === HINDSIGHT_PROXY_PATH ? '/' : parsed.pathname.slice(HINDSIGHT_PROXY_PATH.length)
  const upstreamPath = tail.startsWith('/') ? tail : `/${tail}`
  const upstreamUrl = `${upstreamBase}${upstreamPath}${parsed.search}`
  const requestBody = req.method === 'GET' ? '' : await getRequestBodyBody(req)

  logger.write({
    type: 'hindsight.proxy.start',
    requestId,
    upstream: upstreamUrl,
    request: {
      method: req.method,
      headers: sanitizeHeaders(buildUpstreamHeaders(req.headers)),
      bodyPreview: requestBody ? requestBody.slice(0, 2048) : null,
    },
  })

  const response = await fetchWithRetry(
    upstreamUrl,
    {
      method: req.method,
      headers: buildUpstreamHeaders(req.headers),
      body: requestBody || undefined,
    },
    config.maxRetries,
    config.timeoutMs,
  )

  const responseText = await response.text()
  copyResponseHeaders(response, res)
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN)
  res.statusCode = response.status

  const responseHeaders = {}
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })
  logger.write({
    type: 'hindsight.proxy.response',
    requestId,
    status: response.status,
    responseHeaders: sanitizeHeaders(responseHeaders),
    bodyPreview: responseText ? responseText.slice(0, 2048) : '',
  })

  res.end(responseText)
}

async function handleTelemetryRequest(req, res, logger, requestId) {
  if (req.method !== 'POST') {
    res.writeHead(405, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(JSON.stringify({ error: 'Only POST is supported for telemetry ingestion' }))
    return
  }

  const body = await getRequestBodyBody(req)
  let parsedBody
  try {
    parsedBody = body ? JSON.parse(body) : null
  } catch {
    res.writeHead(400, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(JSON.stringify({ error: 'Invalid JSON payload' }))
    return
  }

  const events = Array.isArray(parsedBody?.events) ? parsedBody.events : []
  if (!Array.isArray(events) || events.length === 0) {
    res.writeHead(400, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(JSON.stringify({ error: 'Payload must include non-empty events array' }))
    return
  }

  logger.write({
    type: 'agent.telemetry.request',
    requestId,
    count: events.length,
    ts: new Date().toISOString(),
  })

  events.forEach(event => {
    logger.write({
      ...event,
      requestId: event.requestId || requestId,
      persistedAt: new Date().toISOString(),
    })
  })

  res.writeHead(200, {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Content-Type': 'application/json',
  })
  res.end(JSON.stringify({ ok: true, accepted: events.length, requestId }))
}

async function handleTelemetryGet(_req, res, parsedUrl) {
  const logDir = await resolveLogDir()
  if (!logDir) {
    res.writeHead(503, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(JSON.stringify({ error: 'Telemetry log directory unavailable' }))
    return
  }

  const threadId = parsedUrl.searchParams.get('threadId') || ''
  const requestId = parsedUrl.searchParams.get('requestId') || ''
  const type = parsedUrl.searchParams.get('type') || ''
  const since = parsedUrl.searchParams.get('since') || ''
  let limit = Number.parseInt(parsedUrl.searchParams.get('limit') || '500', 10)
  if (!Number.isFinite(limit) || limit < 1) limit = 500
  limit = Math.min(limit, 5000)

  let maxFiles = Number.parseInt(parsedUrl.searchParams.get('maxFiles') || '120', 10)
  if (!Number.isFinite(maxFiles) || maxFiles < 1) maxFiles = 120
  maxFiles = Math.min(maxFiles, 500)

  let names
  try {
    names = await readdir(logDir)
  } catch (error) {
    res.writeHead(500, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(
      JSON.stringify({
        error: 'Failed to read log directory',
        message: error instanceof Error ? error.message : String(error),
      }),
    )
    return
  }

  const telemetryFiles = names.filter(n => n.endsWith('-telemetry.jsonl'))
  const withStat = await Promise.all(
    telemetryFiles.map(async name => {
      const filePath = join(logDir, name)
      try {
        const s = await stat(filePath)
        return { filePath, mtime: s.mtimeMs }
      } catch {
        return null
      }
    }),
  )
  const sorted = withStat
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, maxFiles)

  const events = []
  for (const { filePath } of sorted) {
    let raw = ''
    try {
      raw = await readFile(filePath, 'utf8')
    } catch {
      // skip unreadable
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const ev = JSON.parse(line)
        if (threadId && String(ev.threadId || '') !== threadId) continue
        if (requestId && String(ev.requestId || '') !== requestId) continue
        if (type && !String(ev.type || '').includes(type)) continue
        if (since) {
          const t = ev.persistedAt || ev.ts || ev.queuedAt
          if (!t || String(t) < since) continue
        }
        events.push(ev)
      } catch {
        // skip malformed line
      }
    }
  }

  events.sort((a, b) => {
    const tb = String(b.persistedAt || b.ts || b.queuedAt || '')
    const ta = String(a.persistedAt || a.ts || a.queuedAt || '')
    return tb.localeCompare(ta)
  })

  const sliced = events.slice(0, limit)

  res.writeHead(200, {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Content-Type': 'application/json',
  })
  res.end(JSON.stringify({ ok: true, count: sliced.length, events: sliced }))
}

function logResponseBody(logger, requestId, text, contentType) {
  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(text)
      logger.write({ type: 'response', requestId, body: parsed })
      return
    } catch {
      // fall through to raw
    }
  }
  logger.write({ type: 'response', requestId, body: text })
}

function createLogger(proxyUrl) {
  const stream = createWriteStream(proxyUrl, { flags: 'a' })
  return {
    stream,
    write: entry => writeEntry(stream, entry),
    writeRaw: raw => writeEntry(stream, { type: 'raw', data: raw }),
    close: () => stream.end(),
  }
}

function parseNumeric(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function getQdrantProxyConfig(reqUrl) {
  const url = new URL(reqUrl, 'http://localhost')
  return {
    mcpProxyHubUrl: process.env.QDRANT_PROXY_HUB_URL || MCP_PROXY_HUB_URL,
    agentId: url.searchParams.get('agentId') || 'word-gpt-plus',
    mcpEndpoint: process.env.QDRANT_MCP_ENDPOINT || QDRANT_MCP_PATH,
    timeoutMs: parseNumeric(
      url.searchParams.get('qdrantToolTimeoutMs') || url.searchParams.get('memorixToolTimeoutMs'),
      12000,
    ),
    maxRetries: parseNumeric(url.searchParams.get('qdrantMaxRetries') || url.searchParams.get('memorixMaxRetries'), 2),
    toolName: url.searchParams.get('toolName') || '',
  }
}

function getDocSuiteProxyConfig(reqUrl) {
  const url = new URL(reqUrl, 'http://localhost')
  return {
    mcpProxyHubUrl: process.env.DOCSUITE_PROXY_HUB_URL || MCP_PROXY_HUB_URL,
    agentId: url.searchParams.get('agentId') || 'word-gpt-plus',
    mcpEndpoint: process.env.DOCSUITE_MCP_ENDPOINT || DOCSUITE_MCP_PATH,
    timeoutMs: parseNumeric(
      url.searchParams.get('docSuiteToolTimeoutMs') || url.searchParams.get('memorixToolTimeoutMs'),
      12000,
    ),
    maxRetries: parseNumeric(
      url.searchParams.get('docSuiteMaxRetries') || url.searchParams.get('memorixMaxRetries'),
      2,
    ),
    toolName: url.searchParams.get('toolName') || '',
  }
}

function getHindsightProxyConfig(reqUrl) {
  const url = new URL(reqUrl, 'http://localhost')
  return {
    targetBase: HINDSIGHT_TARGET,
    timeoutMs: parseNumeric(url.searchParams.get('hindsightToolTimeoutMs'), 12000),
    maxRetries: parseNumeric(url.searchParams.get('hindsightMaxRetries'), 2),
  }
}

function isSelfLoopUrl(rawUrl, requestHost) {
  if (!rawUrl || !requestHost) return false
  try {
    const parsed = new URL(rawUrl, 'http://localhost')
    return parsed.host === requestHost
  } catch {
    return false
  }
}

async function fetchWithRetry(url, options, retries = 1, timeoutMs = 12000) {
  let attempt = 0
  while (attempt <= retries) {
    attempt += 1
    const controller = new globalThis.AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await globalThis.fetch(url, {
        ...options,
        signal: controller.signal,
      })
      globalThis.clearTimeout(timeout)
      return response
    } catch (error) {
      globalThis.clearTimeout(timeout)
      if (attempt > retries) {
        throw error
      }
    }
  }
}

function sanitizeHeaders(headers) {
  const output = {}
  Object.entries(headers).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      output[key] = value.join(',')
      return
    }

    if (typeof value !== 'string') {
      output[key] = String(value)
      return
    }

    if (key.toLowerCase() === 'authorization' || key.toLowerCase() === 'cookie') {
      output[key] = '[redacted]'
      return
    }

    output[key] = value
  })

  return output
}

async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'authorization,content-type,accept',
      'Access-Control-Max-Age': '86400',
    })
    res.end()
    return
  }

  const parsedUrlForTelemetry = new URL(req.url || '/', 'http://localhost')
  const pathnameForTelemetry = parsedUrlForTelemetry.pathname || '/'
  if (pathnameForTelemetry === TELEMETRY_PATH && req.method === 'GET') {
    try {
      await handleTelemetryGet(req, res, parsedUrlForTelemetry)
    } catch (error) {
      res.writeHead(500, {
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Content-Type': 'application/json',
      })
      res.end(
        JSON.stringify({
          error: 'Telemetry query failed',
          message: error instanceof Error ? error.message : String(error),
        }),
      )
    }
    return
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(JSON.stringify({ error: 'Only GET and POST are supported' }))
    return
  }

  const route = getRequestTarget(req.url || '/')
  const parsedUrl = new URL(req.url || '/', 'http://localhost')
  const pathname = parsedUrl.pathname || '/'
  const requestId = randomUUID()
  const routeProvider =
    route?.provider ||
    (pathname === QDRANT_DISCOVER_PATH || pathname === QDRANT_CALL_PATH
      ? 'qdrant'
      : pathname === DOCSUITE_DISCOVER_PATH || pathname === DOCSUITE_CALL_PATH
        ? 'docsuite'
        : pathname === HINDSIGHT_PROXY_PATH || pathname.startsWith(`${HINDSIGHT_PROXY_PATH}/`)
          ? 'hindsight'
          : pathname === TELEMETRY_PATH
            ? 'telemetry'
            : 'proxy')
  const logDir = await resolveLogDir()
  let logger = createNoopLogger()
  if (logDir) {
    const requestLogFile = `${logDir}/${requestId}-${routeProvider}.jsonl`
    logger = createLogger(requestLogFile)
  }

  if (pathname === QDRANT_DISCOVER_PATH && req.method === 'GET') {
    try {
      await handleQdrantDiscover(req, res, logger, requestId)
    } catch (error) {
      logger.write({
        type: 'qdrant.discover.error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      })
      res.writeHead(502, {
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Content-Type': 'application/json',
      })
      res.end(JSON.stringify({ error: 'Qdrant discover failed' }))
    } finally {
      logger.close()
    }
    return
  }

  if (pathname === QDRANT_CALL_PATH && req.method === 'POST') {
    try {
      await handleQdrantCall(req, res, logger, requestId)
    } catch (error) {
      logger.write({
        type: 'qdrant.call.error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      })
      res.writeHead(502, {
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Content-Type': 'application/json',
      })
      res.end(JSON.stringify({ error: 'Qdrant call failed' }))
    } finally {
      logger.close()
    }
    return
  }

  if (pathname === DOCSUITE_DISCOVER_PATH && req.method === 'GET') {
    try {
      await handleDocSuiteDiscover(req, res, logger, requestId)
    } catch (error) {
      logger.write({
        type: 'docsuite.discover.error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      })
      res.writeHead(502, {
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Content-Type': 'application/json',
      })
      res.end(JSON.stringify({ error: 'DocSuite discover failed' }))
    } finally {
      logger.close()
    }
    return
  }

  if (pathname === DOCSUITE_CALL_PATH && req.method === 'POST') {
    try {
      await handleDocSuiteCall(req, res, logger, requestId)
    } catch (error) {
      logger.write({
        type: 'docsuite.call.error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      })
      res.writeHead(502, {
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Content-Type': 'application/json',
      })
      res.end(JSON.stringify({ error: 'DocSuite call failed' }))
    } finally {
      logger.close()
    }
    return
  }

  if (pathname === HINDSIGHT_PROXY_PATH || pathname.startsWith(`${HINDSIGHT_PROXY_PATH}/`)) {
    try {
      await handleHindsightProxy(req, res, logger, requestId)
    } catch (error) {
      logger.write({
        type: 'hindsight.proxy.error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      })
      res.writeHead(502, {
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Content-Type': 'application/json',
      })
      res.end(JSON.stringify({ error: 'Hindsight proxy failed' }))
    } finally {
      logger.close()
    }
    return
  }

  if (pathname === TELEMETRY_PATH) {
    try {
      await handleTelemetryRequest(req, res, logger, requestId)
    } catch (error) {
      logger.write({
        type: 'telemetry.error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      })
      res.writeHead(500, {
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Content-Type': 'application/json',
      })
      res.end(JSON.stringify({ error: 'Telemetry ingestion failed' }))
    } finally {
      logger.close()
    }
    return
  }

  if (!route) {
    res.writeHead(404, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(
      JSON.stringify({
        error: 'Proxy route not found',
        supported: [
          '/api/openai/v1',
          '/api/openrouter/v1',
          '/api/lmstudio/v1',
          '/api/groq/v1',
          '/api/gemini',
          '/api/azure',
          '/api/ollama',
          HINDSIGHT_PROXY_PATH,
          TELEMETRY_PATH,
          QDRANT_DISCOVER_PATH,
          QDRANT_CALL_PATH,
          DOCSUITE_DISCOVER_PATH,
          DOCSUITE_CALL_PATH,
        ],
      }),
    )
    return
  }

  let requestBody = ''
  let requestStream = false

  try {
    requestBody = await getRequestBodyBody(req)
    try {
      const requestParsed = requestBody ? JSON.parse(requestBody) : null
      requestStream = requestParsed?.stream === true
    } catch {
      requestStream = false
    }

    const t0 = Date.now()
    const upstreamResponse = await globalThis.fetch(route.upstreamURL, {
      method: req.method,
      headers: buildUpstreamHeaders(req.headers),
      body: requestBody || undefined,
    })
    const ttfb = Date.now() - t0

    copyResponseHeaders(upstreamResponse, res)
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN)
    res.statusCode = upstreamResponse.status

    const responseHeaders = {}
    upstreamResponse.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })

    logger.write({
      type: 'meta',
      requestId,
      provider: route.provider,
      upstream: route.upstreamURL,
      request: {
        method: req.method,
        headers: sanitizeHeaders(buildUpstreamHeaders(req.headers)),
        body: requestBody || null,
      },
      status: upstreamResponse.status,
      requestStream,
      ttfbMs: ttfb,
      responseHeaders: sanitizeHeaders(responseHeaders),
    })

    const responseContentType = upstreamResponse.headers.get('content-type') || ''

    if (!upstreamResponse.body) {
      const text = await upstreamResponse.text()
      const textPayload = text || ''
      logResponseBody(logger, requestId, textPayload, responseContentType)
      res.end(textPayload)
      return
    }

    const decoder = new globalThis.TextDecoder()
    const reader = upstreamResponse.body.getReader()
    let carry = ''
    let byteCount = 0
    let fullResponseText = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      byteCount += value.byteLength
      res.write(value)
      const chunkText = decoder.decode(value, { stream: true })
      fullResponseText += chunkText

      if (requestStream && responseContentType.includes('text/event-stream')) {
        carry += chunkText
        const chunks = carry.split('\n\n')
        carry = chunks.pop() || ''

        chunks.forEach(rawEvent => {
          const dataLine = rawEvent.split('\n').find(line => line.trim().toLowerCase().startsWith('data:'))

          if (!dataLine) {
            return
          }

          const dataText = dataLine.replace(/^data:\s*/i, '').trim()
          if (dataText === '[DONE]') {
            logger.write({ type: 'stream.done', requestId })
            return
          }

          try {
            const payload = JSON.parse(dataText)
            logger.write({
              type: 'stream.chunk',
              requestId,
              payload,
            })
          } catch {
            logger.write({
              type: 'stream.parse_error',
              requestId,
              raw: dataText,
            })
          }
        })
      }
    }

    if (carry.trim()) {
      logger.write({
        type: 'stream.chunk.partial',
        requestId,
        raw: carry,
      })
    }

    if (!requestStream) {
      logResponseBody(logger, requestId, fullResponseText, responseContentType)
    }

    const elapsed = Date.now() - t0
    logger.write({
      type: 'end',
      requestId,
      totalBytes: byteCount,
      elapsedMs: elapsed,
      ttfbMs: ttfb,
    })
    res.end()
  } catch (error) {
    globalThis.console.error('[proxy] Failed request', error)
    logger.write({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error),
    })

    res.writeHead(502, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(JSON.stringify({ error: 'Proxy upstream request failed' }))
  } finally {
    logger.close()
  }
}

const server = createServer(handleRequest)
server.listen(PORT, () => {
  globalThis.console.log(`[proxy] listening on ${PORT}`)
  globalThis.console.log(`[proxy] logs: ${LOG_DIR}`)
})
