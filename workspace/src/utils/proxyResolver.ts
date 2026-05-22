export const DEFAULT_PROXY_PORT = 3100
const rewriteWarnings = new Set<string>()

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

function withNoTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function resolveProxyBase(raw?: string | null, fallbackPort: number = DEFAULT_PROXY_PORT): string {
  const input = withNoTrailingSlash(raw || '')
  const normalizedInput =
    input && !/^[a-z][a-z\d+\-.]*:\/\//i.test(input) && !input.startsWith('/') ? `http://${input}` : input

  let candidate: URL
  try {
    // Keep backward compatibility for relative inputs saved from previous versions.
    candidate = new URL(
      normalizedInput || `http://localhost:${fallbackPort}`,
      typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
    )
  } catch {
    return `http://localhost:${fallbackPort}`
  }

  const protocol = candidate.protocol || 'http:'
  const hasExplicitPort = typeof input === 'string' ? /:\d+$/.test(candidate.host) : false
  const effectivePort = candidate.port || (hasExplicitPort ? '' : String(fallbackPort))

  if (typeof window !== 'undefined' && isLoopbackHostname(candidate.hostname)) {
    const currentHost = window.location.hostname
    if (currentHost && !isLoopbackHostname(currentHost)) {
      const port = candidate.port || String(fallbackPort)
      const rewritten = `${protocol}//${currentHost}:${port}`
      if (rewritten !== candidate.origin) {
        const originWithPath = `${candidate.origin}${candidate.pathname}`
        const warningKey = `${originWithPath}=>${rewritten}`
        if (import.meta.env?.DEV && !rewriteWarnings.has(warningKey)) {
          rewriteWarnings.add(warningKey)
          console.warn('[proxy-resolver] Rewrote loopback proxy host for LAN client', {
            from: originWithPath,
            to: rewritten,
            windowHost: window.location.host,
          })
        }
      }
      return withNoTrailingSlash(rewritten)
    }
  }

  const path = candidate.pathname && candidate.pathname !== '/' ? candidate.pathname : ''
  const normalized = `${protocol}//${candidate.hostname}${effectivePort ? `:${effectivePort}` : ''}${path}`

  return withNoTrailingSlash(normalized)
}
