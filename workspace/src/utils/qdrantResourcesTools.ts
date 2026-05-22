import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

import { localStorageKey } from './enum'
import { fetchJsonWithRetry } from './http'
import { resolveProxyBase } from './proxyResolver'

export interface QdrantToolDescriptor {
  tool_name?: string
  name?: string
  description?: string
  parameters_json_schema?: unknown
  returns_json_schema?: unknown
  transport?: unknown
}

export interface QdrantToolRequestContext {
  threadId?: string
  sessionId?: string
}

export interface QdrantToolsConfig {
  enableQdrantResourcesTools: boolean
  mcpProxyHubUrl: string
  qdrantResourcesAgentId: string
  qdrantResourcesToolsEndpoint: string
  qdrantResourcesToolsCallEndpoint: string
  qdrantResourcesForwardToolsEndpoint?: string
  qdrantResourcesForwardToolsCallEndpoint?: string
  qdrantResourcesToolTimeoutMs: number
  qdrantResourcesMaxRetries: number
  context?: QdrantToolRequestContext
}

export const DEFAULT_QDRANT_CONFIG: QdrantToolsConfig = {
  enableQdrantResourcesTools: false,
  mcpProxyHubUrl: resolveProxyBase('http://127.0.0.1:8096'),
  qdrantResourcesAgentId: 'word-gpt-plus',
  qdrantResourcesToolsEndpoint: '/api/tools/qdrant',
  qdrantResourcesToolsCallEndpoint: '/api/tools/qdrant/call',
  qdrantResourcesToolTimeoutMs: 12000,
  qdrantResourcesMaxRetries: 2,
}

function clampNumber(raw: string | null | number | undefined, fallback: number): number {
  const value = Number(raw)
  if (Number.isFinite(value) && value > 0) return Math.max(1, value)
  return fallback
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

function normalizeQdrantServerPath(raw: string | null): string {
  const next = (raw || '').trim()
  if (!next) return ''

  if (!next.includes('/servers/')) return next

  try {
    const parsed = new URL(next, typeof window === 'undefined' ? 'http://localhost' : window.location.origin)
    if (parsed.pathname.startsWith('/servers/')) {
      return parsed.pathname
    }
  } catch {
    if (next.startsWith('/servers/')) {
      return next
    }
  }

  return next
}

function normalizeQdrantLocalEndpoint(raw: string | null, fallback: string): string {
  const next = normalizeQdrantServerPath(raw)
  if (!next) return fallback
  if (next.startsWith('/servers/')) return fallback
  return next
}

function normalizeQdrantForwardEndpoint(raw: string | null): string | undefined {
  const next = normalizeQdrantServerPath(raw)
  if (!next) return undefined
  if (next.startsWith('/servers/')) return next
  return undefined
}

export function getQdrantToolsConfigFromStorage(context: QdrantToolRequestContext = {}): QdrantToolsConfig {
  const storedToolsEndpoint = localStorage.getItem(localStorageKey.qdrantResourcesToolsEndpoint)
  const storedCallEndpoint = localStorage.getItem(localStorageKey.qdrantResourcesToolsCallEndpoint)

  return {
    enableQdrantResourcesTools: localStorage.getItem(localStorageKey.enableQdrantResourcesTools) === 'true',
    mcpProxyHubUrl:
      resolveProxyBase(localStorage.getItem(localStorageKey.mcpProxyHubUrl)) || DEFAULT_QDRANT_CONFIG.mcpProxyHubUrl,
    qdrantResourcesAgentId:
      localStorage.getItem(localStorageKey.qdrantResourcesAgentId) || DEFAULT_QDRANT_CONFIG.qdrantResourcesAgentId,
    qdrantResourcesToolsEndpoint: normalizeQdrantLocalEndpoint(
      storedToolsEndpoint,
      DEFAULT_QDRANT_CONFIG.qdrantResourcesToolsEndpoint,
    ),
    qdrantResourcesToolsCallEndpoint: normalizeQdrantLocalEndpoint(
      storedCallEndpoint,
      DEFAULT_QDRANT_CONFIG.qdrantResourcesToolsCallEndpoint,
    ),
    qdrantResourcesForwardToolsEndpoint: normalizeQdrantForwardEndpoint(storedToolsEndpoint),
    qdrantResourcesForwardToolsCallEndpoint: normalizeQdrantForwardEndpoint(storedCallEndpoint),
    qdrantResourcesToolTimeoutMs: clampNumber(
      localStorage.getItem(localStorageKey.qdrantResourcesToolTimeoutMs),
      DEFAULT_QDRANT_CONFIG.qdrantResourcesToolTimeoutMs,
    ),
    qdrantResourcesMaxRetries: clampNumber(
      localStorage.getItem(localStorageKey.qdrantResourcesMaxRetries),
      DEFAULT_QDRANT_CONFIG.qdrantResourcesMaxRetries,
    ),
    context,
  }
}

function normalizeToolName(raw: string | undefined): string {
  return (raw || 'qdrant_tool')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80)
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

function normalizeDescriptorToToolInput(descriptor: QdrantToolDescriptor): { name: string; schema: z.ZodTypeAny } {
  const name = normalizeToolName(descriptor.tool_name || descriptor.name || 'qdrant_tool')
  const schema = schemaToZod(descriptor.parameters_json_schema)
  return { name, schema }
}

function buildLocalProxyUrl(
  endpoint: string,
  params: {
    mcpProxyHubUrl: string
    qdrantResourcesAgentId: string
    qdrantResourcesToolTimeoutMs: number
    qdrantResourcesMaxRetries: number
    forwardEndpoint?: string
    toolName?: string
  },
): string {
  const base = new URL(endpoint, getToolProxyBase())
  base.searchParams.set('mcpProxyHubUrl', params.mcpProxyHubUrl)
  base.searchParams.set('agentId', params.qdrantResourcesAgentId)
  base.searchParams.set('qdrantToolTimeoutMs', String(params.qdrantResourcesToolTimeoutMs))
  base.searchParams.set('qdrantMaxRetries', String(params.qdrantResourcesMaxRetries))
  if (params.forwardEndpoint) {
    base.searchParams.set('forwardEndpoint', params.forwardEndpoint)
  }
  if (params.toolName) {
    base.searchParams.set('toolName', params.toolName)
  }
  return base.toString()
}

export async function getQdrantToolDescriptors(config: QdrantToolsConfig): Promise<QdrantToolDescriptor[]> {
  const url = new URL(
    buildLocalProxyUrl(config.qdrantResourcesToolsEndpoint || DEFAULT_QDRANT_CONFIG.qdrantResourcesToolsEndpoint, {
      mcpProxyHubUrl: config.mcpProxyHubUrl || DEFAULT_QDRANT_CONFIG.mcpProxyHubUrl,
      qdrantResourcesAgentId: config.qdrantResourcesAgentId || DEFAULT_QDRANT_CONFIG.qdrantResourcesAgentId,
      qdrantResourcesToolTimeoutMs:
        config.qdrantResourcesToolTimeoutMs || DEFAULT_QDRANT_CONFIG.qdrantResourcesToolTimeoutMs,
      qdrantResourcesMaxRetries: config.qdrantResourcesMaxRetries || DEFAULT_QDRANT_CONFIG.qdrantResourcesMaxRetries,
      forwardEndpoint: config.qdrantResourcesForwardToolsEndpoint,
    }),
  )
  const response = await fetchJsonWithRetry(
    url.toString(),
    { method: 'GET', headers: { 'content-type': 'application/json' } },
    config.qdrantResourcesMaxRetries,
    config.qdrantResourcesToolTimeoutMs,
  )

  if (Array.isArray(response)) return response as QdrantToolDescriptor[]
  if (response && Array.isArray(response.tools)) return response.tools as QdrantToolDescriptor[]
  if (response && Array.isArray(response.toolDescriptors)) return response.toolDescriptors as QdrantToolDescriptor[]
  console.warn('[Qdrant] Unexpected tool descriptor shape', {
    hasTools: !!response && Array.isArray((response as { tools?: unknown }).tools),
    hasToolDescriptors: !!response && Array.isArray((response as { toolDescriptors?: unknown }).toolDescriptors),
    type: response ? typeof response : typeof response,
  })
  return []
}

export async function invokeQdrantTool(
  config: QdrantToolsConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const callEndpoint = buildLocalProxyUrl(
    config.qdrantResourcesToolsCallEndpoint || DEFAULT_QDRANT_CONFIG.qdrantResourcesToolsCallEndpoint,
    {
      mcpProxyHubUrl: config.mcpProxyHubUrl || DEFAULT_QDRANT_CONFIG.mcpProxyHubUrl,
      qdrantResourcesAgentId: config.qdrantResourcesAgentId || DEFAULT_QDRANT_CONFIG.qdrantResourcesAgentId,
      qdrantResourcesToolTimeoutMs:
        config.qdrantResourcesToolTimeoutMs || DEFAULT_QDRANT_CONFIG.qdrantResourcesToolTimeoutMs,
      qdrantResourcesMaxRetries: config.qdrantResourcesMaxRetries || DEFAULT_QDRANT_CONFIG.qdrantResourcesMaxRetries,
      forwardEndpoint: config.qdrantResourcesForwardToolsCallEndpoint,
      toolName,
    },
  )

  const requestPayload = {
    agentId: config.qdrantResourcesAgentId || 'word-gpt-plus',
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
    config.qdrantResourcesMaxRetries,
    config.qdrantResourcesToolTimeoutMs,
  )

  if (!response) {
    return ''
  }

  if (response.error) {
    const toolError = typeof response.error === 'string' ? response.error : JSON.stringify(response.error)
    console.error('[Qdrant] Tool invocation returned error', { toolName, error: toolError, response })
    return toolError
  }

  return typeof response.payload === 'string' ? response.payload : JSON.stringify(response.payload ?? response)
}

export async function createQdrantResourcesTools(config: QdrantToolsConfig): Promise<DynamicStructuredTool[]> {
  if (!config.enableQdrantResourcesTools) return []

  const descriptors = await getQdrantToolDescriptors(config)
  const toolEntries = descriptors
    .map(descriptor => {
      const { name, schema } = normalizeDescriptorToToolInput(descriptor)
      const description = descriptor.description || `Qdrant tool: ${name}`

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
          return invokeQdrantTool(config, toolName, args || {})
        },
      }),
    )
  }

  return result
}
