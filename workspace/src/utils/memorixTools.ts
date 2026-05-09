import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

import { localStorageKey } from './enum'

export interface MemorixToolDescriptor {
  tool_name?: string
  name?: string
  description?: string
  parameters_json_schema?: unknown
  returns_json_schema?: unknown
  transport?: unknown
}

export interface MemorixToolRequestContext {
  threadId?: string
  sessionId?: string
}

export interface MemorixToolsConfig {
  enableMemorixTools: boolean
  mcpProxyHubUrl: string
  memorixAgentId: string
  memorixToolsEndpoint: string
  memorixToolsCallEndpoint: string
  memorixToolTimeoutMs: number
  memorixMaxRetries: number
  context?: MemorixToolRequestContext
}

export const DEFAULT_MEMORIX_CONFIG: MemorixToolsConfig = {
  enableMemorixTools: false,
  mcpProxyHubUrl: 'http://localhost:3100',
  memorixAgentId: 'word-gpt-plus',
  memorixToolsEndpoint: '/api/tools/memorix',
  memorixToolsCallEndpoint: '/api/tools/memorix/call',
  memorixToolTimeoutMs: 12000,
  memorixMaxRetries: 2,
}

function clampNumber(raw: string | null | number | undefined, fallback: number): number {
  const value = Number(raw)
  if (Number.isFinite(value) && value > 0) return Math.max(1, value)
  return fallback
}

export function getMemorixToolsConfigFromStorage(context: MemorixToolRequestContext = {}): MemorixToolsConfig {
  return {
    enableMemorixTools: localStorage.getItem(localStorageKey.enableMemorixTools) === 'true',
    mcpProxyHubUrl: localStorage.getItem(localStorageKey.mcpProxyHubUrl) || DEFAULT_MEMORIX_CONFIG.mcpProxyHubUrl,
    memorixAgentId: localStorage.getItem(localStorageKey.memorixAgentId) || DEFAULT_MEMORIX_CONFIG.memorixAgentId,
    memorixToolsEndpoint:
      localStorage.getItem(localStorageKey.memorixToolsEndpoint) || DEFAULT_MEMORIX_CONFIG.memorixToolsEndpoint,
    memorixToolsCallEndpoint:
      localStorage.getItem(localStorageKey.memorixToolsCallEndpoint) || DEFAULT_MEMORIX_CONFIG.memorixToolsCallEndpoint,
    memorixToolTimeoutMs: clampNumber(
      localStorage.getItem(localStorageKey.memorixToolTimeoutMs),
      DEFAULT_MEMORIX_CONFIG.memorixToolTimeoutMs,
    ),
    memorixMaxRetries: clampNumber(
      localStorage.getItem(localStorageKey.memorixMaxRetries),
      DEFAULT_MEMORIX_CONFIG.memorixMaxRetries,
    ),
    context,
  }
}

function normalizeToolName(raw: string | undefined): string {
  return (raw || 'memorix_tool').replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').slice(0, 80)
}

function schemaToZod(schema: any): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') {
    return z.record(z.any())
  }

  if (Array.isArray(schema)) {
    if (schema.length > 0) {
      return z.array(schemaToZod(schema[0]))
    }
    return z.array(z.any())
  }

  if (schema.const !== undefined) {
    return z.literal(schema.const)
  }

  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const variants = schema.anyOf.filter((entry: unknown) => !!entry).map((entry: unknown) => schemaToZod(entry))
    if (variants.length > 0) {
      return z.union(variants)
    }
  }

  if (schema.type === 'string' || schema.jsonType === 'string') {
    let next = z.string()
    if (schema.description) {
      next.describe(schema.description)
    }
    return next
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    return z.number()
  }

  if (schema.type === 'boolean') {
    return z.boolean()
  }

  if (schema.type === 'array') {
    return z.array(schemaToZod(schema.items))
  }

  if (schema.type === 'object' || schema.properties) {
    const shape: Record<string, z.ZodTypeAny> = {}
    const required = new Set<string>(Array.isArray(schema.required) ? schema.required : [])
    const props = schema.properties || {}

    Object.keys(props).forEach(key => {
      const next = schemaToZod(props[key])
      shape[key] = required.has(key) ? next : next.optional()
    })

    return z.object(shape).passthrough()
  }

  return z.record(z.any())
}

function normalizeDescriptorToToolInput(descriptor: MemorixToolDescriptor): { name: string; schema: z.ZodTypeAny } {
  const name = normalizeToolName(descriptor.tool_name || descriptor.name || 'memorix_tool')
  const schema = schemaToZod(descriptor.parameters_json_schema)
  return { name, schema }
}

async function fetchJsonWithRetry(url: string, options: RequestInit, retries = 1, timeoutMs = 12000): Promise<any> {
  let attempts = 0
  let lastError: Error | null = null

  while (attempts <= retries) {
    attempts += 1

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(timeoutId)

      if (!response.ok) {
        const body = await response.text()
        throw new Error(`Request failed: ${response.status} ${response.statusText} ${body}`)
      }

      return await response.json()
    } catch (error: unknown) {
      clearTimeout(timeoutId)
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempts <= retries) {
        await new Promise(resolve => setTimeout(resolve, Math.min(200 * attempts, 800)))
        continue
      }
      throw lastError
    }
  }

  throw lastError || new Error('Unknown fetch failure')
}

function buildLocalProxyUrl(
  endpoint: string,
  params: {
    mcpProxyHubUrl: string
    memorixAgentId: string
    memorixToolTimeoutMs: number
    memorixMaxRetries: number
    forwardEndpoint: string
    toolName?: string
  },
): string {
  const base = new URL(endpoint, window.location.origin)
  base.searchParams.set('mcpProxyHubUrl', params.mcpProxyHubUrl)
  base.searchParams.set('agentId', params.memorixAgentId)
  base.searchParams.set('memorixToolTimeoutMs', String(params.memorixToolTimeoutMs))
  base.searchParams.set('memorixMaxRetries', String(params.memorixMaxRetries))
  base.searchParams.set('forwardEndpoint', params.forwardEndpoint)
  if (params.toolName) {
    base.searchParams.set('toolName', params.toolName)
  }
  return base.toString()
}

export async function getMemorixToolDescriptors(config: MemorixToolsConfig): Promise<MemorixToolDescriptor[]> {
  const url = new URL(
    buildLocalProxyUrl(config.memorixToolsEndpoint || DEFAULT_MEMORIX_CONFIG.memorixToolsEndpoint, {
      mcpProxyHubUrl: config.mcpProxyHubUrl || DEFAULT_MEMORIX_CONFIG.mcpProxyHubUrl,
      memorixAgentId: config.memorixAgentId || DEFAULT_MEMORIX_CONFIG.memorixAgentId,
      memorixToolTimeoutMs: config.memorixToolTimeoutMs || DEFAULT_MEMORIX_CONFIG.memorixToolTimeoutMs,
      memorixMaxRetries: config.memorixMaxRetries || DEFAULT_MEMORIX_CONFIG.memorixMaxRetries,
      forwardEndpoint: config.memorixToolsEndpoint || DEFAULT_MEMORIX_CONFIG.memorixToolsEndpoint,
    }),
  )
  const response = await fetchJsonWithRetry(
    url.toString(),
    { method: 'GET', headers: { 'content-type': 'application/json' } },
    config.memorixMaxRetries,
    config.memorixToolTimeoutMs,
  )

  if (Array.isArray(response)) return response as MemorixToolDescriptor[]
  if (response && Array.isArray(response.tools)) return response.tools as MemorixToolDescriptor[]
  if (response && Array.isArray(response.toolDescriptors)) return response.toolDescriptors as MemorixToolDescriptor[]
  return []
}

export async function invokeMemorixTool(
  config: MemorixToolsConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const callEndpoint = buildLocalProxyUrl(config.memorixToolsCallEndpoint || DEFAULT_MEMORIX_CONFIG.memorixToolsCallEndpoint, {
    mcpProxyHubUrl: config.mcpProxyHubUrl || DEFAULT_MEMORIX_CONFIG.mcpProxyHubUrl,
    memorixAgentId: config.memorixAgentId || DEFAULT_MEMORIX_CONFIG.memorixAgentId,
    memorixToolTimeoutMs: config.memorixToolTimeoutMs || DEFAULT_MEMORIX_CONFIG.memorixToolTimeoutMs,
    memorixMaxRetries: config.memorixMaxRetries || DEFAULT_MEMORIX_CONFIG.memorixMaxRetries,
    forwardEndpoint: config.memorixToolsCallEndpoint || DEFAULT_MEMORIX_CONFIG.memorixToolsCallEndpoint,
    toolName,
  })
  const requestPayload = {
    agentId: config.memorixAgentId || 'word-gpt-plus',
    toolName,
    arguments: args || {},
    ...(config.context?.threadId ? { threadId: config.context.threadId } : {}),
    ...(config.context?.sessionId ? { sessionId: config.context.sessionId } : {}),
  }

  const response = await fetchJsonWithRetry(
    callEndpoint,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
    },
    config.memorixMaxRetries,
    config.memorixToolTimeoutMs,
  )

  if (!response) {
    return ''
  }

  if (response.error) {
    return typeof response.error === 'string' ? response.error : JSON.stringify(response.error)
  }

  return typeof response.payload === 'string' ? response.payload : JSON.stringify(response.payload ?? response)
}

export async function createMemorixTools(config: MemorixToolsConfig): Promise<DynamicStructuredTool[]> {
  if (!config.enableMemorixTools) return []

  const descriptors = await getMemorixToolDescriptors(config)
  const toolEntries = descriptors
    .map(descriptor => {
      const { name, schema } = normalizeDescriptorToToolInput(descriptor)
      const description = descriptor.description || `Memorix tool: ${name}`

      return {
        ...descriptor,
        __name: name,
        schema,
        description,
      }
    })
    .filter(tool => !!tool.__name)

  const seen = new Set<string>()
  const result: DynamicStructuredTool[] = []

  for (const tool of toolEntries) {
    const toolName = tool.__name
    if (seen.has(toolName)) continue
    seen.add(toolName)

    result.push(
      new DynamicStructuredTool({
        name: toolName,
        description: tool.description,
        schema: tool.schema,
        func: async (args: Record<string, unknown>) => {
          return invokeMemorixTool(config, toolName, args || {})
        },
      }),
    )
  }

  return result
}
