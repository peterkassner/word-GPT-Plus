export interface HindsightConfig {
  enableHindsightTools: boolean
  hindsightBaseUrl: string
  hindsightMemoryBankId: string
  hindsightApiKey?: string
  hindsightToolTimeoutMs: number
  hindsightMaxRetries: number
}

export interface HindsightMemoryBank {
  id: string
  name: string
  background?: string
  created_at: string
  updated_at: string
}

export interface HindsightRetainItem {
  content: string
  timestamp?: string | null
  context?: string
  metadata?: Record<string, string>
  document_id?: string
  entities?: { text: string; type?: string }[]
  tags?: string[]
  observation_scopes?: 'per_tag' | 'combined' | 'all_combinations' | string[][]
  strategy?: string
  update_mode?: 'replace' | 'append'
}

export interface HindsightRetainRequest {
  items: HindsightRetainItem[]
  async?: boolean
}

export interface HindsightRetainResponse {
  success: boolean
  bank_id: string
  items_count: number
  async: boolean
  operation_id?: string
  operation_ids?: string[]
  usage?: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
}

export interface HindsightRecallRequest {
  query: string
  types?: string[]
  budget?: 'low' | 'mid' | 'high'
  max_tokens?: number
  trace?: boolean
  query_timestamp?: string
  include?: {
    entities?: { max_tokens?: number }
    chunks?: { max_tokens?: number }
    source_facts?: { max_tokens?: number; max_tokens_per_observation?: number }
  }
  tags?: string[]
  tags_match?: 'any' | 'all' | 'any_strict' | 'all_strict'
  tag_groups?: {
    tags: string[]
    match: 'any' | 'all' | 'any_strict' | 'all_strict'
  }[]
}

export interface HindsightRecallResult {
  id: string
  text: string
  type: string
  entities?: Record<string, string[]>
  context?: string
  occurred_start?: string
  occurred_end?: string
  mentioned_at?: string
  document_id?: string
  metadata?: Record<string, unknown>
  chunk_id?: string
  tags?: string[]
  source_fact_ids?: string[]
}

export interface HindsightRecallResponse {
  results: HindsightRecallResult[]
  trace?: unknown
  entities?: Record<string, unknown>
  chunks?: Record<string, unknown>
  source_facts?: Record<string, HindsightRecallResult>
}

export interface HindsightReflectRequest {
  query: string
  budget?: 'low' | 'mid' | 'high'
  context?: string
  max_tokens?: number
  response_schema?: Record<string, unknown>
  tags?: string[]
  tags_match?: 'any' | 'all' | 'any_strict' | 'all_strict'
  tag_groups?: {
    tags: string[]
    match: 'any' | 'all' | 'any_strict' | 'all_strict'
  }[]
  fact_types?: string[]
  exclude_mental_models?: boolean
  exclude_mental_model_ids?: string[]
  include?: {
    facts?: { output?: boolean }
    tool_calls?: { output?: boolean }
  }
}

export interface HindsightReflectResponse {
  text: string
  based_on?: {
    memories?: {
      id: string
      text: string
      type: string
      context?: string
      occurred_start?: string
      occurred_end?: string
    }[]
    mental_models?: {
      id: string
      text: string
      context?: string
    }[]
    directives?: {
      id: string
      name: string
      content: string
    }[]
  }
  structured_output?: unknown
  usage?: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
  trace?: {
    tool_calls?: {
      tool: string
      input: unknown
      output?: unknown
      duration_ms: number
      iteration: number
    }[]
    llm_calls?: {
      scope: string
      duration_ms: number
    }[]
  }
}

export interface HindsightBankListResponse {
  banks: HindsightMemoryBank[]
}

export interface HindsightHealthResponse {
  status: 'healthy' | 'unhealthy'
  database?: string
  version?: string
}
