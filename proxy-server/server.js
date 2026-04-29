import { createServer } from 'node:http'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'

const PORT = Number(process.env.PORT || 3100)
const LOG_DIR = process.env.LOG_DIR || '/app/data/logs'
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'

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

function createLogger(proxyUrl) {
  const stream = createWriteStream(proxyUrl, { flags: 'a' })
  return {
    stream,
    write: entry => writeEntry(stream, entry),
    writeRaw: raw => writeEntry(stream, { type: 'raw', data: raw }),
    close: () => stream.end(),
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
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'authorization,content-type,accept',
      'Access-Control-Max-Age': '86400',
    })
    res.end()
    return
  }

  if (req.method !== 'POST') {
    res.writeHead(405, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(JSON.stringify({ error: 'Only POST is supported' }))
    return
  }

  const route = getRequestTarget(req.url || '/')
  if (!route) {
    res.writeHead(404, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Content-Type': 'application/json',
    })
    res.end(JSON.stringify({ error: 'Proxy route not found', supported: ['/api/openai/v1', '/api/groq/v1'] }))
    return
  }

  await mkdir(LOG_DIR, { recursive: true })
  const requestId = crypto.randomUUID()
  const logFile = `${LOG_DIR}/${requestId}-${route.provider}.jsonl`
  const logger = createLogger(logFile)

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
