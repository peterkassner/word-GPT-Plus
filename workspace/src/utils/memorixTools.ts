import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

import { localStorageKey } from './enum'
import { fetchJsonWithRetry } from './http'
import { resolveProxyBase } from './proxyResolver'

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
  memorixForwardToolsEndpoint?: string
  memorixForwardToolsCallEndpoint?: string
  memorixToolTimeoutMs: number
  memorixMaxRetries: number
  context?: MemorixToolRequestContext
}

export const DEFAULT_MEMORIX_CONFIG: MemorixToolsConfig = {
  enableMemorixTools: false,
  mcpProxyHubUrl: resolveProxyBase('http://127.0.0.1:8096'),
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

function normalizeMemorixServerPath(raw: string | null): string {
  const next = (raw || '').trim()
  if (!next) return ''
  if (!next.includes('/servers/')) return next
  try {
    const parsed = new URL(next, typeof window === 'undefined' ? 'http://localhost' : window.location.origin)
    if (parsed.pathname.startsWith('/servers/')) return parsed.pathname
  } catch {
    if (next.startsWith('/servers/')) return next
  }
  return next
}

function normalizeMemorixLocalEndpoint(raw: string | null, fallback: string): string {
  const next = normalizeMemorixServerPath(raw)
  if (!next) return fallback
  if (next.startsWith('/servers/')) return fallback
  return next
}

function normalizeMemorixForwardEndpoint(raw: string | null): string | undefined {
  const next = normalizeMemorixServerPath(raw)
  if (!next) return undefined
  if (next.startsWith('/servers/')) return next
  return undefined
}

export function getMemorixToolsConfigFromStorage(context: MemorixToolRequestContext = {}): MemorixToolsConfig {
  const storedToolsEndpoint = localStorage.getItem(localStorageKey.memorixToolsEndpoint)
  const storedCallEndpoint = localStorage.getItem(localStorageKey.memorixToolsCallEndpoint)

  return {
    enableMemorixTools: localStorage.getItem(localStorageKey.enableMemorixTools) === 'true',
    mcpProxyHubUrl:
      resolveProxyBase(localStorage.getItem(localStorageKey.mcpProxyHubUrl)) || DEFAULT_MEMORIX_CONFIG.mcpProxyHubUrl,
    memorixAgentId: localStorage.getItem(localStorageKey.memorixAgentId) || DEFAULT_MEMORIX_CONFIG.memorixAgentId,
    memorixToolsEndpoint: normalizeMemorixLocalEndpoint(
      storedToolsEndpoint,
      DEFAULT_MEMORIX_CONFIG.memorixToolsEndpoint,
    ),
    memorixToolsCallEndpoint: normalizeMemorixLocalEndpoint(
      storedCallEndpoint,
      DEFAULT_MEMORIX_CONFIG.memorixToolsCallEndpoint,
    ),
    memorixForwardToolsEndpoint: normalizeMemorixForwardEndpoint(storedToolsEndpoint),
    memorixForwardToolsCallEndpoint: normalizeMemorixForwardEndpoint(storedCallEndpoint),
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
  return (raw || 'memorix_tool')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80)
}

function getToolProxyBase(): string {
  const proxySetting = typeof window !== 'undefined' ? localStorage.getItem(localStorageKey.proxy) : null
  const proxyBaseInput =
    proxySetting && proxySetting.trim()
      ? proxySetting
      : typeof window === 'undefined'
        ? 'http://localhost:3100'
        : window.location.origin
  return resolveProxyBase(proxyBaseInput)
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
    const next = z.string()
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

function buildLocalProxyUrl(
  endpoint: string,
  params: {
    mcpProxyHubUrl: string
    memorixAgentId: string
    memorixToolTimeoutMs: number
    memorixMaxRetries: number
    forwardEndpoint?: string
    toolName?: string
  },
): string {
  const base = new URL(endpoint, getToolProxyBase())
  base.searchParams.set('mcpProxyHubUrl', params.mcpProxyHubUrl)
  base.searchParams.set('agentId', params.memorixAgentId)
  base.searchParams.set('memorixToolTimeoutMs', String(params.memorixToolTimeoutMs))
  base.searchParams.set('memorixMaxRetries', String(params.memorixMaxRetries))
  if (params.forwardEndpoint) {
    base.searchParams.set('forwardEndpoint', params.forwardEndpoint)
  }
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
      forwardEndpoint: config.memorixForwardToolsEndpoint,
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
  console.warn('[Memorix] Unexpected tool descriptor shape', {
    hasTools: !!response && Array.isArray((response as { tools?: unknown }).tools),
    hasToolDescriptors: !!response && Array.isArray((response as { toolDescriptors?: unknown }).toolDescriptors),
    type: response ? typeof response : typeof response,
  })
  return []
}

export async function invokeMemorixTool(
  config: MemorixToolsConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const callEndpoint = buildLocalProxyUrl(
    config.memorixToolsCallEndpoint || DEFAULT_MEMORIX_CONFIG.memorixToolsCallEndpoint,
    {
      mcpProxyHubUrl: config.mcpProxyHubUrl || DEFAULT_MEMORIX_CONFIG.mcpProxyHubUrl,
      memorixAgentId: config.memorixAgentId || DEFAULT_MEMORIX_CONFIG.memorixAgentId,
      memorixToolTimeoutMs: config.memorixToolTimeoutMs || DEFAULT_MEMORIX_CONFIG.memorixToolTimeoutMs,
      memorixMaxRetries: config.memorixMaxRetries || DEFAULT_MEMORIX_CONFIG.memorixMaxRetries,
      forwardEndpoint: config.memorixForwardToolsCallEndpoint,
      toolName,
    },
  )
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
    const toolError = typeof response.error === 'string' ? response.error : JSON.stringify(response.error)
    console.error('[Memorix] Tool invocation returned error', { toolName, error: toolError, response })
    return toolError
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
