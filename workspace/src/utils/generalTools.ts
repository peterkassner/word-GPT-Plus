import { DynamicStructuredTool } from '@langchain/core/tools'
import { evaluate } from 'mathjs'
import { z } from 'zod'

import { localStorageKey } from './enum'

export type GeneralToolName = 'fetchWebContent' | 'searchWeb' | 'getCurrentDate' | 'calculateMath'

export const TELEMETRY_QUEUE_KEY = 'agentEventQueue'
const DEFAULT_TELEMETRY_QUEUE_SIZE = 150

export interface TelemetryEventRecord {
  type: string
  ts: string
  [key: string]: unknown
}

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|secret|token|password|api[_-]?key|bearer)/i

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

function toUrlOrNull(input: string): URL | null {
  try {
    return new URL(input)
  } catch {
    return null
  }
}

function resolveProxyBaseFromStorage(): string | null {
  const storage = getTelemetryStorage()
  if (!storage) return null

  const proxyEnabled = storage.getItem(localStorageKey.enableProxy) === 'true'
  const proxyUrl = trimTrailingSlashes(storage.getItem(localStorageKey.proxy) || '')
  if (proxyEnabled && proxyUrl && toUrlOrNull(proxyUrl)) {
    return proxyUrl
  }

  const mcpProxy = trimTrailingSlashes(storage.getItem(localStorageKey.mcpProxyHubUrl) || '')
  if (mcpProxy && toUrlOrNull(mcpProxy)) {
    return mcpProxy
  }

  return null
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function sanitizeTelemetryValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[max-depth]'

  if (value === null || value === undefined) return value
  if (typeof value === 'number' || typeof value === 'boolean') return value

  if (typeof value === 'string') {
    if (value.length > 4000) {
      return `${value.slice(0, 4000)}...[truncated]`
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.slice(0, 80).map(item => sanitizeTelemetryValue(item, depth + 1))
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    Object.entries(value as Record<string, unknown>).forEach(([key, inner]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = '[redacted]'
      } else {
        output[key] = sanitizeTelemetryValue(inner, depth + 1)
      }
    })
    return output
  }

  return String(value)
}

function safeParseQueue(raw: string | null): TelemetryEventRecord[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function getTelemetryStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    try {
      return window.sessionStorage
    } catch {
      return null
    }
  }
}

export function loadTelemetryQueue(): TelemetryEventRecord[] {
  const storage = getTelemetryStorage()
  if (!storage) return []
  return safeParseQueue(storage.getItem(TELEMETRY_QUEUE_KEY))
}

export function persistTelemetryQueue(events: TelemetryEventRecord[]) {
  const storage = getTelemetryStorage()
  if (!storage) return
  const rawMaxSize = storage.getItem(localStorageKey.telemetryMaxQueueSize)
  const maxSize = Number.isFinite(Number(rawMaxSize)) ? Math.max(50, Number(rawMaxSize)) : DEFAULT_TELEMETRY_QUEUE_SIZE
  const normalized = events.slice(-maxSize)
  storage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(normalized))
}

export function appendTelemetryEvent(event: TelemetryEventRecord) {
  const storage = getTelemetryStorage()
  const redactSensitive = storage?.getItem(localStorageKey.telemetryRedactSensitive) !== 'false'
  const queue = loadTelemetryQueue()
  queue.push({
    ...(redactSensitive ? (sanitizeTelemetryValue(event) as TelemetryEventRecord) : event),
    queuedAt: new Date().toISOString(),
  })
  persistTelemetryQueue(queue)
}

export function clearTelemetryQueue() {
  const storage = getTelemetryStorage()
  if (!storage) return
  storage.removeItem(TELEMETRY_QUEUE_KEY)
}

export async function flushTelemetryQueueToProxy(
  endpoint = '/api/telemetry',
): Promise<{ success: boolean; flushed: number }> {
  const queue = loadTelemetryQueue()
  const queueSize = queue.length

  if (queue.length === 0) {
    return { success: true, flushed: 0 }
  }

  const configuredBase = resolveProxyBaseFromStorage()
  const resolvedEndpoint = isAbsoluteUrl(endpoint)
    ? endpoint
    : new URL(endpoint, configuredBase || window.location.origin).toString()

  try {
    const payload = { events: queue }
    const response = await fetch(resolvedEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const responseText = await response.text().catch(() => '')
      throw new Error(`Telemetry flush failed: ${response.status} ${response.statusText} ${responseText}`)
    }

    clearTelemetryQueue()
    return { success: true, flushed: queueSize }
  } catch (error) {
    appendTelemetryEvent({
      type: 'agent.telemetry.flush.failed',
      ts: new Date().toISOString(),
      queueSize,
      endpoint: resolvedEndpoint,
      error: error instanceof Error ? error.message : String(error),
    })
    return { success: false, flushed: 0 }
  }
}

export interface GeneralToolDefinition {
  name: GeneralToolName
  description: string
  tool: DynamicStructuredTool
}

const fetchWebContentTool = new DynamicStructuredTool({
  name: 'fetchWebContent',
  description:
    'Fetches content from a given URL. Useful for gathering reference material, quotes, or information to include in the document. Returns the main text content of the webpage.',
  schema: z.object({
    url: z.string().describe('The URL to fetch content from'),
  }),
  func: async ({ url }) => {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      })

      if (!response.ok) {
        return `Failed to fetch content: ${response.status} ${response.statusText}`
      }

      const html = await response.text()

      const textContent = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      const maxLength = 5000
      const content = textContent.length > maxLength ? textContent.substring(0, maxLength) + '...' : textContent

      return `Content from ${url}:\n\n${content}`
    } catch (error: any) {
      return `Error fetching content: ${error.message}`
    }
  },
})

const searchWebTool = new DynamicStructuredTool({
  name: 'searchWeb',
  description:
    'Searches the web for information. Returns top search results with titles and snippets. Useful for finding references, facts, or background information for the document. If you need to look up information you do not know, use this tool.',
  schema: z.object({
    query: z.string().describe('The search query'),
    maxResults: z.number().optional().default(10).describe('Maximum number of results to return (default: 10)'),
  }),
  func: async ({ query, maxResults = 10 }) => {
    try {
      const url = `https://ddgs.horosama.com/search/text?query=${encodeURIComponent(query)}&max_results=${maxResults <= 10 ? maxResults : 10}`
      const response = await fetch(url)
      if (!response.ok) {
        return `Search failed: ${response.status}`
      }
      const data = await response.json()
      let results = ''
      data.results.forEach((result: any, index: number) => {
        results += `Result ${index + 1}:\nTitle: ${result.title}\nLink: ${result.href}\nSnippet: ${result.body}\n\n`
      })
      return results
    } catch (error: any) {
      return `Error searching: ${error.message}`
    }
  },
})

const getCurrentDateTool = new DynamicStructuredTool({
  name: 'getCurrentDate',
  description:
    'Returns the current date and time. Useful for adding timestamps, dates to documents, or understanding temporal context.',
  schema: z.object({
    format: z
      .enum(['full', 'date', 'time', 'iso'])
      .optional()
      .default('full')
      .describe('Format: "full" (date and time), "date" (date only), "time" (time only), "iso" (ISO 8601)'),
  }),
  func: async ({ format = 'full' }) => {
    const now = new Date()

    switch (format) {
      case 'date':
        return now.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      case 'time':
        return now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      case 'iso':
        return now.toISOString()
      case 'full':
      default:
        return now.toLocaleString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
    }
  },
})

const calculateMathTool = new DynamicStructuredTool({
  name: 'calculateMath',
  description:
    'Evaluates mathematical expressions safely. Useful for calculations, statistics, or numerical data in documents. Supports basic arithmetic (+, -, *, /), parentheses, and common math functions.',
  schema: z.object({
    expression: z.string().describe('The mathematical expression to evaluate (e.g., "2 + 2 * 3")'),
  }),
  func: async ({ expression }) => {
    try {
      const result = evaluate(expression)

      if (typeof result !== 'number' && typeof result !== 'bigint') {
        return `Calculation completed, but result is not a simple number: ${result}`
      }

      return `${expression} = ${result}`
    } catch (error: any) {
      return `Error evaluating expression: ${error.message}`
    }
  },
})

export const generalToolDefinitions: GeneralToolDefinition[] = [
  {
    name: 'fetchWebContent',
    description: fetchWebContentTool.description,
    tool: fetchWebContentTool,
  },
  {
    name: 'searchWeb',
    description: searchWebTool.description,
    tool: searchWebTool,
  },
  {
    name: 'getCurrentDate',
    description: getCurrentDateTool.description,
    tool: getCurrentDateTool,
  },
  {
    name: 'calculateMath',
    description: calculateMathTool.description,
    tool: calculateMathTool,
  },
]

export function createGeneralTools(enabledTools?: GeneralToolName[]): DynamicStructuredTool[] {
  if (!enabledTools || enabledTools.length === 0) {
    return generalToolDefinitions.map(def => def.tool)
  }

  return generalToolDefinitions.filter(def => enabledTools.includes(def.name)).map(def => def.tool)
}

export function getGeneralToolDefinitions(): GeneralToolDefinition[] {
  return generalToolDefinitions
}

export function getGeneralTool(name: GeneralToolName): GeneralToolDefinition | undefined {
  return generalToolDefinitions.find(def => def.name === name)
}
