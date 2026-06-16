const JSON_PREVIEW_LIMIT = 4096

function summarizeBody(body: string): string {
  const trimmed = body || ''
  return trimmed.length > JSON_PREVIEW_LIMIT ? `${trimmed.slice(0, JSON_PREVIEW_LIMIT)}...` : trimmed
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false

  const first = trimmed[0]
  return (
    first === '{' ||
    first === '[' ||
    first === '"' ||
    first === 't' ||
    first === 'f' ||
    first === 'n' ||
    /^\d/.test(first)
  )
}

function toErrorString(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function parseJsonResponseBody(url: string, responseText: string, contentType: string | null): unknown {
  const trimmed = responseText.trim()
  if (!trimmed) {
    throw new Error(`Invalid JSON response from ${url}: empty body`)
  }

  const isJsonLike = looksLikeJson(trimmed)
  const isJsonContentType = !!contentType && contentType.toLowerCase().includes('application/json')

  if (!isJsonContentType && !isJsonLike) {
    throw new Error(
      `Invalid JSON response from ${url}: unexpected content-type "${contentType || 'unknown'}"; body starts "${trimmed.slice(0, 80)}"`,
    )
  }

  try {
    return JSON.parse(responseText)
  } catch (error: unknown) {
    const parsed = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid JSON response from ${url}: ${parsed}. Body: ${summarizeBody(trimmed)}`)
  }
}

export async function fetchJsonWithRetry(
  url: string,
  options: RequestInit,
  retries = 1,
  timeoutMs = 12000,
): Promise<any> {
  let attempts = 0
  let lastError: Error | null = null
  const maxAttempts = retries + 1

  while (attempts < maxAttempts) {
    attempts += 1

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(timeoutId)

      const responseText = await response.text()

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status} ${response.statusText} ${summarizeBody(responseText)}`)
      }

      return parseJsonResponseBody(url, responseText, response.headers.get('content-type'))
    } catch (error: unknown) {
      const parsed = toErrorString(error)
      console.warn(`[fetchJsonWithRetry] Attempt ${attempts}/${maxAttempts} failed for ${url}: ${parsed}`)
      clearTimeout(timeoutId)
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, Math.min(200 * attempts, 800)))
        continue
      }
      console.error(`[fetchJsonWithRetry] All attempts failed for ${url}: ${parsed}`)
      throw lastError
    }
  }

  throw lastError || new Error('Unknown fetch failure')
}
