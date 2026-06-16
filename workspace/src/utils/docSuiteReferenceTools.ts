import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

import { localStorageKey } from './enum'
import { fetchJsonWithRetry } from './http'
import { resolveProxyBase } from './proxyResolver'

export interface DocSuiteToolDescriptor {
  tool_name?: string
  name?: string
  description?: string
  parameters_json_schema?: unknown
  returns_json_schema?: unknown
  transport?: unknown
}

export interface DocSuiteToolRequestContext {
  threadId?: string
  sessionId?: string
  activeDocumentUrl?: string
  activeDocumentTitle?: string
  activeDocumentName?: string
}

export interface DocSuiteToolsConfig {
  enableDocSuiteReferenceTools: boolean
  mcpProxyHubUrl: string
  docSuiteAgentId: string
  docSuiteToolsEndpoint: string
  docSuiteToolsCallEndpoint: string
  docSuiteForwardToolsEndpoint?: string
  docSuiteForwardToolsCallEndpoint?: string
  docSuiteToolTimeoutMs: number
  docSuiteMaxRetries: number
  context?: DocSuiteToolRequestContext
}

export const DEFAULT_DOCSUITE_CONFIG: DocSuiteToolsConfig = {
  enableDocSuiteReferenceTools: false,
  mcpProxyHubUrl: resolveProxyBase('http://127.0.0.1:8096'),
  docSuiteAgentId: 'word-gpt-plus',
  docSuiteToolsEndpoint: '/api/tools/docsuite',
  docSuiteToolsCallEndpoint: '/api/tools/docsuite/call',
  docSuiteToolTimeoutMs: 12000,
  docSuiteMaxRetries: 2,
}

const READ_TOOL_ALLOW_PATTERNS: RegExp[] = [
  /find/i,
  /search/i,
  /query/i,
  /lookup/i,
  /retrieve/i,
  /read/i,
  /get/i,
  /list/i,
  /inspect/i,
  /info/i,
  /preview/i,
  /extract/i,
]

const MUTATION_OR_FILE_IO_BLOCK_PATTERNS: RegExp[] = [
  /insert/i,
  /replace/i,
  /delete/i,
  /remove/i,
  /update/i,
  /edit/i,
  /format/i,
  /create/i,
  /save/i,
  /close/i,
  /accept/i,
  /reject/i,
  /reply/i,
  /resolve/i,
  /upload/i,
  /download/i,
  /open/i,
  /write/i,
  /transform/i,
  /convert/i,
  /patch/i,
]

const NON_UNIQUE_ACTIVE_DOC_TOKENS = new Set(['doc', 'docx', 'document', 'untitled', 'word', 'microsoft'])

function clampNumber(raw: string | null | number | undefined, fallback: number): number {
  const value = Number(raw)
  if (Number.isFinite(value) && value > 0) return Math.max(1, value)
  return fallback
}

function normalizeDocSuiteLocalEndpoint(raw: string | null, fallback: string): string {
  const next = (raw || '').trim()
  if (!next) return fallback
  if (next.startsWith('/servers/')) return fallback
  return next
}

function normalizeDocSuiteForwardEndpoint(raw: string | null): string | undefined {
  const next = (raw || '').trim()
  if (!next) return undefined
  if (next.startsWith('/servers/')) return next
  return undefined
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

export function getDocSuiteToolsConfigFromStorage(context: DocSuiteToolRequestContext = {}): DocSuiteToolsConfig {
  const storedToolsEndpoint = localStorage.getItem(localStorageKey.docSuiteToolsEndpoint)
  const storedCallEndpoint = localStorage.getItem(localStorageKey.docSuiteToolsCallEndpoint)

  return {
    enableDocSuiteReferenceTools: localStorage.getItem(localStorageKey.enableDocSuiteReferenceTools) === 'true',
    mcpProxyHubUrl:
      resolveProxyBase(localStorage.getItem(localStorageKey.mcpProxyHubUrl)) || DEFAULT_DOCSUITE_CONFIG.mcpProxyHubUrl,
    docSuiteAgentId: localStorage.getItem(localStorageKey.docSuiteAgentId) || DEFAULT_DOCSUITE_CONFIG.docSuiteAgentId,
    docSuiteToolsEndpoint: normalizeDocSuiteLocalEndpoint(
      storedToolsEndpoint,
      DEFAULT_DOCSUITE_CONFIG.docSuiteToolsEndpoint,
    ),
    docSuiteToolsCallEndpoint: normalizeDocSuiteLocalEndpoint(
      storedCallEndpoint,
      DEFAULT_DOCSUITE_CONFIG.docSuiteToolsCallEndpoint,
    ),
    docSuiteForwardToolsEndpoint: normalizeDocSuiteForwardEndpoint(storedToolsEndpoint),
    docSuiteForwardToolsCallEndpoint: normalizeDocSuiteForwardEndpoint(storedCallEndpoint),
    docSuiteToolTimeoutMs: clampNumber(
      localStorage.getItem(localStorageKey.docSuiteToolTimeoutMs),
      DEFAULT_DOCSUITE_CONFIG.docSuiteToolTimeoutMs,
    ),
    docSuiteMaxRetries: clampNumber(
      localStorage.getItem(localStorageKey.docSuiteMaxRetries),
      DEFAULT_DOCSUITE_CONFIG.docSuiteMaxRetries,
    ),
    context,
  }
}

function normalizeToolName(raw: string | undefined): string {
  return (raw || 'docsuite_tool')
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

function normalizeDescriptorToToolInput(descriptor: DocSuiteToolDescriptor): { name: string; schema: z.ZodTypeAny } {
  const name = normalizeToolName(descriptor.tool_name || descriptor.name || 'docsuite_tool')
  const schema = schemaToZod(descriptor.parameters_json_schema)
  return { name, schema }
}

function buildLocalProxyUrl(
  endpoint: string,
  params: {
    mcpProxyHubUrl: string
    docSuiteAgentId: string
    docSuiteToolTimeoutMs: number
    docSuiteMaxRetries: number
    forwardEndpoint?: string
    toolName?: string
  },
): string {
  const base = new URL(endpoint, getToolProxyBase())
  base.searchParams.set('mcpProxyHubUrl', params.mcpProxyHubUrl)
  base.searchParams.set('agentId', params.docSuiteAgentId)
  base.searchParams.set('docSuiteToolTimeoutMs', String(params.docSuiteToolTimeoutMs))
  base.searchParams.set('docSuiteMaxRetries', String(params.docSuiteMaxRetries))
  if (params.forwardEndpoint) {
    base.searchParams.set('forwardEndpoint', params.forwardEndpoint)
  }
  if (params.toolName) {
    base.searchParams.set('toolName', params.toolName)
  }
  return base.toString()
}

function isAllowedDocSuiteToolName(name: string): boolean {
  const normalized = name.toLowerCase()

  if (MUTATION_OR_FILE_IO_BLOCK_PATTERNS.some(pattern => pattern.test(normalized))) {
    return false
  }

  return READ_TOOL_ALLOW_PATTERNS.some(pattern => pattern.test(normalized))
}

function collectStringValues(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') {
    output.push(value)
    return output
  }

  if (Array.isArray(value)) {
    value.forEach(item => collectStringValues(item, output))
    return output
  }

  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(item => collectStringValues(item, output))
  }

  return output
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 4)
    .filter(token => !NON_UNIQUE_ACTIVE_DOC_TOKENS.has(token))
}

function referencesActiveWordDocument(args: Record<string, unknown>, context?: DocSuiteToolRequestContext): boolean {
  if (!context) return false

  const payload = collectStringValues(args).join(' | ').toLowerCase()
  if (!payload) return false

  const tokens = new Set<string>()
  ;[context.activeDocumentUrl, context.activeDocumentTitle, context.activeDocumentName].forEach(value => {
    if (!value) return
    const normalized = value.trim().toLowerCase()
    if (normalized.length >= 4) {
      tokens.add(normalized)
    }
    tokenize(normalized).forEach(token => tokens.add(token))
  })

  for (const token of tokens) {
    if (payload.includes(token)) {
      return true
    }
  }

  return false
}

function policyBlock(message: string): string {
  return `DocSuite policy block: ${message}`
}

export async function getDocSuiteToolDescriptors(config: DocSuiteToolsConfig): Promise<DocSuiteToolDescriptor[]> {
  const url = new URL(
    buildLocalProxyUrl(config.docSuiteToolsEndpoint || DEFAULT_DOCSUITE_CONFIG.docSuiteToolsEndpoint, {
      mcpProxyHubUrl: config.mcpProxyHubUrl || DEFAULT_DOCSUITE_CONFIG.mcpProxyHubUrl,
      docSuiteAgentId: config.docSuiteAgentId || DEFAULT_DOCSUITE_CONFIG.docSuiteAgentId,
      docSuiteToolTimeoutMs: config.docSuiteToolTimeoutMs || DEFAULT_DOCSUITE_CONFIG.docSuiteToolTimeoutMs,
      docSuiteMaxRetries: config.docSuiteMaxRetries || DEFAULT_DOCSUITE_CONFIG.docSuiteMaxRetries,
      forwardEndpoint: config.docSuiteForwardToolsEndpoint,
    }),
  )

  const response = await fetchJsonWithRetry(
    url.toString(),
    { method: 'GET', headers: { 'content-type': 'application/json' } },
    config.docSuiteMaxRetries,
    config.docSuiteToolTimeoutMs,
  )

  if (Array.isArray(response)) return response as DocSuiteToolDescriptor[]
  if (response && Array.isArray(response.tools)) return response.tools as DocSuiteToolDescriptor[]
  if (response && Array.isArray(response.toolDescriptors)) return response.toolDescriptors as DocSuiteToolDescriptor[]
  console.warn('[DocSuite] Unexpected tool descriptor shape', {
    hasTools: !!response && Array.isArray((response as { tools?: unknown }).tools),
    hasToolDescriptors: !!response && Array.isArray((response as { toolDescriptors?: unknown }).toolDescriptors),
    type: response ? typeof response : typeof response,
  })
  return []
}

export async function invokeDocSuiteTool(
  config: DocSuiteToolsConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (!isAllowedDocSuiteToolName(toolName)) {
    return policyBlock('only read/reference tools are allowed; mutation or transport actions are disabled')
  }

  if (referencesActiveWordDocument(args, config.context)) {
    return policyBlock('current Word document is not allowed through DocSuite; reference an external document instead')
  }

  const callEndpoint = buildLocalProxyUrl(
    config.docSuiteToolsCallEndpoint || DEFAULT_DOCSUITE_CONFIG.docSuiteToolsCallEndpoint,
    {
      mcpProxyHubUrl: config.mcpProxyHubUrl || DEFAULT_DOCSUITE_CONFIG.mcpProxyHubUrl,
      docSuiteAgentId: config.docSuiteAgentId || DEFAULT_DOCSUITE_CONFIG.docSuiteAgentId,
      docSuiteToolTimeoutMs: config.docSuiteToolTimeoutMs || DEFAULT_DOCSUITE_CONFIG.docSuiteToolTimeoutMs,
      docSuiteMaxRetries: config.docSuiteMaxRetries || DEFAULT_DOCSUITE_CONFIG.docSuiteMaxRetries,
      forwardEndpoint: config.docSuiteForwardToolsCallEndpoint,
      toolName,
    },
  )

  const requestPayload = {
    agentId: config.docSuiteAgentId || 'word-gpt-plus',
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
    config.docSuiteMaxRetries,
    config.docSuiteToolTimeoutMs,
  )

  if (!response) {
    return ''
  }

  if (response.error) {
    const toolError = typeof response.error === 'string' ? response.error : JSON.stringify(response.error)
    console.error('[DocSuite] Tool invocation returned error', { toolName, error: toolError, response })
    return toolError
  }

  return typeof response.payload === 'string' ? response.payload : JSON.stringify(response.payload ?? response)
}

export async function createDocSuiteReferenceTools(config: DocSuiteToolsConfig): Promise<DynamicStructuredTool[]> {
  if (!config.enableDocSuiteReferenceTools) return []

  const descriptors = await getDocSuiteToolDescriptors(config)
  const toolEntries = descriptors
    .map(descriptor => {
      const { name, schema } = normalizeDescriptorToToolInput(descriptor)
      const description = descriptor.description || `DocSuite reference tool: ${name}`

      return {
        ...descriptor,
        __name: name,
        schema,
        description,
      }
    })
    .filter(tool => !!tool.__name)
    .filter(tool => isAllowedDocSuiteToolName(tool.__name))

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
        func: async (args: Record<string, unknown>) => invokeDocSuiteTool(config, toolName, args || {}),
      }),
    )
  }

  return result
}
