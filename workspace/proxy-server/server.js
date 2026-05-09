import { createServer } from 'node:http'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'

const PORT = Number(process.env.PORT || 3100)
const LOG_DIR = process.env.LOG_DIR || `${process.cwd()}/logs`
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'
const MEMORIX_DISCOVER_PATH = '/api/tools/memorix'
const MEMORIX_CALL_PATH = '/api/tools/memorix/call'
const TELEMETRY_PATH = '/api/telemetry'

const providerTargets = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
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

  if (pathname === '/api/groq/v1' || pathname.startsWith('/api/groq/v1/')) {
    const tail = pathname.replace('/api/groq/v1', '') || '/'
    const upstreamPath = tail
    return { provider: 'groq', upstreamURL: `${providerTargets.groq}${upstreamPath}${parsed.search}` }
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
  return headers
}

function copyResponseHeaders(upstreamRes, res) {
  upstreamRes.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'content-length') {
      return
    }
    res.setHeader(key, value)
  })
}

function createNoopLogger() {
  return {
    write: () => {},
    writeRaw: () => {},
    close: () => {},
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

async function handleMemorixDiscover(req, res, logger, requestId) {
  const requestUrl = new URL(req.url || '/', 'http://localhost')
  const config = getMemorixProxyConfig(req.url || '/')
  const forwardEndpoint = requestUrl.searchParams.get('forwardEndpoint') || config.toolEndpoint || MEMORIX_DISCOVER_PATH
  const upstreamPath = forwardEndpoint.startsWith('/') ? forwardEndpoint : `/${forwardEndpoint}`
  const upstreamBase = config.mcpProxyHubUrl.replace(/\/+$/, '')
  if (isSelfLoopUrl(config.mcpProxyHubUrl, req.headers.host || '')) {
    res.writeHead(500, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(JSON.stringify({ error: 'Invalid memorix configuration: mcpProxyHubUrl points to the current proxy host' }))
    return
  }
  const upstreamUrl = `${upstreamBase}${upstreamPath}`
  const targetUrl = withProxyQuery(upstreamUrl, {
    agentId: config.agentId,
    memorixToolTimeoutMs: String(config.timeoutMs),
    memorixMaxRetries: String(config.maxRetries),
  })

  logger.write({
    type: 'memorix.discover.start',
    requestId,
    upstream: targetUrl,
    config,
  })

  const response = await fetchWithRetry(
    targetUrl,
    {
    method: 'GET',
    headers: { accept: 'application/json' },
    },
    config.maxRetries,
    config.timeoutMs,
  )

  const responseText = await response.text()
  res.writeHead(response.status, {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Content-Type': 'application/json',
  })
  logger.write({
    type: 'memorix.discover.response',
    requestId,
    status: response.status,
    bodyPreview: responseText ? responseText.slice(0, 2048) : '',
  })

  if (!response.ok) {
    res.end(JSON.stringify({ error: responseText || 'mcp discover failed', status: response.status }))
    return
  }

  if (!responseText) {
    res.end('[]')
    return
  }

  try {
    const parsed = JSON.parse(responseText)
    const payload = Array.isArray(parsed) ? parsed : parsed.tools || parsed.toolDescriptors || []
    res.end(JSON.stringify(payload))
  } catch {
    res.end(JSON.stringify({ error: 'invalid discover response', raw: responseText.slice(0, 4096) }))
  }
}

async function handleMemorixCall(req, res, logger, requestId) {
  const config = getMemorixProxyConfig(req.url || '/')
  const requestUrl = new URL(req.url || '/', 'http://localhost')
  const forwardEndpoint = requestUrl.searchParams.get('forwardEndpoint') || config.callEndpoint || MEMORIX_CALL_PATH
  const upstreamPath = forwardEndpoint.startsWith('/') ? forwardEndpoint : `/${forwardEndpoint}`
  const upstreamBase = config.mcpProxyHubUrl.replace(/\/+$/, '')
  if (isSelfLoopUrl(config.mcpProxyHubUrl, req.headers.host || '')) {
    res.writeHead(500, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(JSON.stringify({ error: 'Invalid memorix configuration: mcpProxyHubUrl points to the current proxy host' }))
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
    type: 'memorix.call.start',
    requestId,
    upstream: upstreamUrl,
    toolName: payload.toolName || parsedBody.toolName || config.toolName || 'unknown',
    requestIdFromClient: payload.requestId,
  })

  const targetUrl = withProxyQuery(upstreamUrl, {
    agentId: payload.agentId,
    memorixToolTimeoutMs: String(config.timeoutMs),
    memorixMaxRetries: String(config.maxRetries),
  })

  const response = await fetchWithRetry(
    targetUrl,
    {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
    },
    config.maxRetries,
    config.timeoutMs,
  )

  const responseText = await response.text()
  res.writeHead(response.status, {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Content-Type': 'application/json',
  })

  logger.write({
    type: 'memorix.call.response',
    requestId,
    status: response.status,
    toolName: payload.toolName || parsedBody.toolName || config.toolName,
    bodyPreview: responseText ? responseText.slice(0, 2048) : '',
  })

  if (!responseText) {
    res.end('{}')
    return
  }
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

function getMemorixProxyConfig(reqUrl) {
  const url = new URL(reqUrl, 'http://localhost')
  return {
    mcpProxyHubUrl: url.searchParams.get('mcpProxyHubUrl') || process.env.MEMORIX_PROXY_HUB_URL || 'http://localhost:3100',
    agentId: url.searchParams.get('agentId') || 'word-gpt-plus',
    toolEndpoint:
      url.searchParams.get('memorixToolsEndpoint') || url.searchParams.get('forwardEndpoint') || MEMORIX_DISCOVER_PATH,
    callEndpoint: url.searchParams.get('memorixToolsCallEndpoint') || MEMORIX_CALL_PATH,
    timeoutMs: parseNumeric(url.searchParams.get('memorixToolTimeoutMs'), 12000),
    maxRetries: parseNumeric(url.searchParams.get('memorixMaxRetries'), 2),
    toolName: url.searchParams.get('toolName') || '',
  }
}

function withProxyQuery(url, queryParams) {
  if (!url || !queryParams) return url
  const target = new URL(url, 'http://localhost')
  Object.entries(queryParams).forEach(([key, value]) => {
    if (value) target.searchParams.set(key, value)
  })
  return target.toString()
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
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
      clearTimeout(timeout)
      return response
    } catch (error) {
      clearTimeout(timeout)
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
  const requestId = crypto.randomUUID()
  const routeProvider = route?.provider || 'memorix'
  const logDir = await resolveLogDir()
  let logger = createNoopLogger()
  if (logDir) {
    const requestLogFile = `${logDir}/${requestId}-${routeProvider}.jsonl`
    logger = createLogger(requestLogFile)
  }

  if (pathname === MEMORIX_DISCOVER_PATH && req.method === 'GET') {
    try {
      await handleMemorixDiscover(req, res, logger, requestId)
    } catch (error) {
      logger.write({
        type: 'memorix.discover.error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      })
      res.writeHead(502, {
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Content-Type': 'application/json',
      })
      res.end(JSON.stringify({ error: 'Memorix discover failed' }))
    } finally {
      logger.close()
    }
    return
  }

  if (pathname === MEMORIX_CALL_PATH && req.method === 'POST') {
    try {
      await handleMemorixCall(req, res, logger, requestId)
    } catch (error) {
      logger.write({
        type: 'memorix.call.error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      })
      res.writeHead(502, {
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Content-Type': 'application/json',
      })
      res.end(JSON.stringify({ error: 'Memorix call failed' }))
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
    res.end(JSON.stringify({ error: 'Proxy route not found', supported: ['/api/openai/v1', '/api/groq/v1'] }))
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

    const upstreamResponse = await fetch(route.upstreamURL, {
      method: req.method,
      headers: buildUpstreamHeaders(req.headers),
      body: requestBody,
    })

    copyResponseHeaders(upstreamResponse, res)
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN)
    res.statusCode = upstreamResponse.status

    logger.write({
      type: 'meta',
      requestId,
      provider: route.provider,
      upstream: route.upstreamURL,
      request: {
        method: req.method,
        headers: sanitizeHeaders(buildUpstreamHeaders(req.headers)),
        bodyPreview: requestBody ? requestBody.slice(0, 2048) : '',
      },
      status: upstreamResponse.status,
      requestStream,
    })

    const responseContentType = upstreamResponse.headers.get('content-type') || ''

    if (!upstreamResponse.body) {
      const text = await upstreamResponse.text()
      const textPayload = text || ''
      logger.writeRaw(textPayload)
      res.end(textPayload)
      return
    }

    const decoder = new TextDecoder()
    const reader = upstreamResponse.body.getReader()
    let carry = ''
    let byteCount = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      byteCount += value.byteLength
      res.write(value)
      const chunkText = decoder.decode(value, { stream: true })
      logger.writeRaw(chunkText)

      if (requestStream && responseContentType.includes('text/event-stream')) {
        carry += chunkText
        const chunks = carry.split('\n\n')
        carry = chunks.pop() || ''

        chunks.forEach(rawEvent => {
          const dataLine = rawEvent
            .split('\n')
            .find(line => line.trim().toLowerCase().startsWith('data:'))

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

    logger.write({
      type: 'end',
      requestId,
      totalBytes: byteCount,
    })
    res.end()
  } catch (error) {
    console.error('[proxy] Failed request', error)
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
  console.log(`[proxy] listening on ${PORT}`)
  console.log(`[proxy] logs: ${LOG_DIR}`)
})
