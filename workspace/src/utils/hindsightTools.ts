import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

import { localStorageKey } from './enum'
import { createHindsightClient } from './hindsightClient'
import type {
  HindsightConfig,
  HindsightRecallRequest,
  HindsightRecallResponse,
  HindsightReflectRequest,
  HindsightReflectResponse,
  HindsightRetainRequest,
  HindsightRetainResponse,
} from './hindsightTypes'

export interface HindsightToolRequestContext {
  threadId?: string
  sessionId?: string
}

export const DEFAULT_HINDSIGHT_CONFIG: HindsightConfig = {
  enableHindsightTools: false,
  hindsightBaseUrl: 'http://127.0.0.1:8888',
  hindsightMemoryBankId: 'word-gpt-plus',
  hindsightToolTimeoutMs: 12000,
  hindsightMaxRetries: 2,
}

function clampNumber(raw: string | null | number | undefined, fallback: number): number {
  const value = Number(raw)
  if (Number.isFinite(value) && value > 0) return Math.max(1, value)
  return fallback
}

function getHindsightBaseUrl(): string {
  const stored = typeof window !== 'undefined' ? localStorage.getItem(localStorageKey.hindsightBaseUrl) : null
  return stored && stored.trim() ? stored : DEFAULT_HINDSIGHT_CONFIG.hindsightBaseUrl
}

function getHindsightMemoryBankId(): string {
  const stored = typeof window !== 'undefined' ? localStorage.getItem(localStorageKey.hindsightMemoryBankId) : null
  return stored && stored.trim() ? stored : DEFAULT_HINDSIGHT_CONFIG.hindsightMemoryBankId
}

export function getHindsightToolsConfigFromStorage(context: HindsightToolRequestContext = {}): HindsightConfig {
  const baseUrl = getHindsightBaseUrl()
  const memoryBankId = getHindsightMemoryBankId()

  return {
    enableHindsightTools: localStorage.getItem(localStorageKey.enableHindsightTools) === 'true',
    hindsightBaseUrl: baseUrl,
    hindsightMemoryBankId: memoryBankId,
    hindsightApiKey: localStorage.getItem(localStorageKey.hindsightApiKey) || undefined,
    hindsightToolTimeoutMs: clampNumber(
      localStorage.getItem(localStorageKey.hindsightToolTimeoutMs),
      DEFAULT_HINDSIGHT_CONFIG.hindsightToolTimeoutMs,
    ),
    hindsightMaxRetries: clampNumber(
      localStorage.getItem(localStorageKey.hindsightMaxRetries),
      DEFAULT_HINDSIGHT_CONFIG.hindsightMaxRetries,
    ),
    context,
  }
}

function buildRetainToolSchema(): z.ZodObject<any> {
  return z.object({
    content: z
      .string()
      .describe('The content to store in memory. Can be a conversation excerpt, fact, observation, or any text.'),
    timestamp: z
      .string()
      .optional()
      .describe(
        'ISO 8601 timestamp when the content occurred (e.g., "2024-01-15T10:30:00Z"). Omit for current time, use "unset" for timeless content.',
      ),
    context: z.string().optional().describe('Optional context for the memory (e.g., "team meeting", "code review").'),
    document_id: z.string().optional().describe('Optional document ID to group related memories together.'),
    tags: z
      .array(z.string())
      .optional()
      .describe('Optional tags for filtering during recall (e.g., ["user_a", "project_x"]).'),
  })
}

function buildRecallToolSchema(): z.ZodObject<any> {
  return z.object({
    query: z.string().describe('The search query to find relevant memories.'),
    types: z
      .array(z.enum(['world', 'experience', 'observation']))
      .optional()
      .describe(
        'Fact types to search: "world" (general knowledge), "experience" (conversations/events), "observation" (synthesized opinions). Defaults to ["world", "experience"].',
      ),
    budget: z
      .enum(['low', 'mid', 'high'])
      .optional()
      .describe(
        'Search budget: "low" (fast, fewer results), "mid" (balanced), "high" (thorough, more tokens). Default: "mid".',
      ),
    max_tokens: z.number().optional().describe('Maximum tokens in response. Default: 4096.'),
    trace: z.boolean().optional().describe('Include reasoning trace. Default: false.'),
    tags: z.array(z.string()).optional().describe('Filter memories by tags.'),
  })
}

function buildReflectToolSchema(): z.ZodObject<any> {
  return z.object({
    query: z.string().describe('The question to answer using memory.'),
    budget: z
      .enum(['low', 'mid', 'high'])
      .optional()
      .describe('Reasoning budget: "low" (fast), "mid" (balanced), "high" (thorough). Default: "mid".'),
    context: z.string().optional().describe('Additional context to provide to the reflection.'),
    max_tokens: z.number().optional().describe('Maximum tokens in response. Default: 4096.'),
    tags: z.array(z.string()).optional().describe('Filter memories by tags during the reflection.'),
    fact_types: z
      .array(z.string())
      .optional()
      .describe('Fact types to include in reflection (e.g., ["world", "experience", "mental-models"]).'),
  })
}

export async function createHindsightTools(config: HindsightConfig): Promise<DynamicStructuredTool[]> {
  if (!config.enableHindsightTools) return []

  const client = createHindsightClient(config)
  const bankId = config.hindsightMemoryBankId

  const retainTool = new DynamicStructuredTool({
    name: 'hindsight_retain',
    description:
      'Store a memory in Hindsight for later retrieval. Use this to remember facts, conversations, observations, or any information you want to persist across sessions.',
    schema: buildRetainToolSchema(),
    func: async (args: Record<string, unknown>) => {
      const request: HindsightRetainRequest = {
        items: [
          {
            content: args.content as string,
            timestamp: args.timestamp as string | undefined,
            context: args.context as string | undefined,
            document_id: args.document_id as string | undefined,
            tags: args.tags as string[] | undefined,
          },
        ],
        async: false,
      }

      try {
        const response: HindsightRetainResponse = await client.retain(bankId, request)
        return JSON.stringify({
          success: response.success,
          items_count: response.items_count,
          bank_id: response.bank_id,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[Hindsight] Retain failed', { bankId, error: message })
        return `Error storing memory: ${message}`
      }
    },
  })

  const recallTool = new DynamicStructuredTool({
    name: 'hindsight_recall',
    description:
      'Search and retrieve memories from Hindsight. Use this to find previously stored information, facts, or conversations relevant to a query.',
    schema: buildRecallToolSchema(),
    func: async (args: Record<string, unknown>) => {
      const request: HindsightRecallRequest = {
        query: args.query as string,
        types: args.types as string[] | undefined,
        budget: args.budget as 'low' | 'mid' | 'high' | undefined,
        max_tokens: args.max_tokens as number | undefined,
        trace: args.trace as boolean | undefined,
        tags: args.tags as string[] | undefined,
      }

      try {
        const response: HindsightRecallResponse = await client.recall(bankId, request)
        const results = response.results.map(r => ({
          id: r.id,
          text: r.text,
          type: r.type,
          context: r.context,
          occurred_start: r.occurred_start,
          occurred_end: r.occurred_end,
          mentioned_at: r.mentioned_at,
          document_id: r.document_id,
          tags: r.tags,
        }))
        return JSON.stringify({ results, count: results.length })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[Hindsight] Recall failed', { bankId, error: message })
        return `Error searching memories: ${message}`
      }
    },
  })

  const reflectTool = new DynamicStructuredTool({
    name: 'hindsight_reflect',
    description:
      'Generate a reasoned answer using Hindsight memory. This combines relevant memories (world facts, experiences, opinions) and uses an LLM to synthesize a contextual response. Use for questions requiring synthesis of past information.',
    schema: buildReflectToolSchema(),
    func: async (args: Record<string, unknown>) => {
      const request: HindsightReflectRequest = {
        query: args.query as string,
        budget: args.budget as 'low' | 'mid' | 'high' | undefined,
        context: args.context as string | undefined,
        max_tokens: args.max_tokens as number | undefined,
        tags: args.tags as string[] | undefined,
        fact_types: args.fact_types as string[] | undefined,
      }

      try {
        const response: HindsightReflectResponse = await client.reflect(bankId, request)
        return JSON.stringify({
          text: response.text,
          based_on: response.based_on,
          usage: response.usage,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[Hindsight] Reflect failed', { bankId, error: message })
        return `Error generating reflection: ${message}`
      }
    },
  })

  return [retainTool, recallTool, reflectTool]
}
