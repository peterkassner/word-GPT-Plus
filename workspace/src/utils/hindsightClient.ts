import type {
  HindsightBankListResponse,
  HindsightConfig,
  HindsightHealthResponse,
  HindsightMemoryBank,
  HindsightRecallRequest,
  HindsightRecallResponse,
  HindsightReflectRequest,
  HindsightReflectResponse,
  HindsightRetainRequest,
  HindsightRetainResponse,
} from './hindsightTypes'
import { resolveProxyBase } from './proxyResolver'

export class HindsightClient {
  private baseUrl: string
  private apiKey?: string
  private timeoutMs: number
  private maxRetries: number

  constructor(config: HindsightConfig) {
    this.baseUrl = resolveProxyBase(config.hindsightBaseUrl).replace(/\/$/, '')
    this.apiKey = config.hindsightApiKey
    this.timeoutMs = config.hindsightToolTimeoutMs
    this.maxRetries = config.hindsightMaxRetries
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }
    return headers
  }

  private async request<T>(path: string, options: RequestInit = {}, retryCount = 0): Promise<T> {
    const url = `${this.baseUrl}${path};`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...this.getHeaders(),
          ...options.headers,
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(`Hindsight API error: ${response.status} ${response.statusText} - ${errorText}`)
      }

      return await response.json()
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Hindsight request timeout after ${this.timeoutMs}ms`)
      }

      if (retryCount < this.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)))
        return this.request<T>(path, options, retryCount + 1)
      }

      throw error
    }
  }

  async healthCheck(): Promise<HindsightHealthResponse> {
    return this.request<HindsightHealthResponse>('/health', { method: 'GET' })
  }

  async listBanks(): Promise<HindsightBankListResponse> {
    return this.request<HindsightBankListResponse>('/v1/default/banks', { method: 'GET' })
  }

  async getBank(bankId: string): Promise<HindsightMemoryBank> {
    return this.request<HindsightMemoryBank>(`/v1/default/banks/${encodeURIComponent(bankId)}`, {
      method: 'GET',
    })
  }

  async createBank(name: string, background?: string): Promise<HindsightMemoryBank> {
    return this.request<HindsightMemoryBank>('/v1/default/banks', {
      method: 'POST',
      body: JSON.stringify({ name, background }),
    })
  }

  async retain(bankId: string, request: HindsightRetainRequest): Promise<HindsightRetainResponse> {
    return this.request<HindsightRetainResponse>(`/v1/default/banks/${encodeURIComponent(bankId)}/memories`, {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  async recall(bankId: string, request: HindsightRecallRequest): Promise<HindsightRecallResponse> {
    return this.request<HindsightRecallResponse>(`/v1/default/banks/${encodeURIComponent(bankId)}/memories/recall`, {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  async reflect(bankId: string, request: HindsightReflectRequest): Promise<HindsightReflectResponse> {
    return this.request<HindsightReflectResponse>(`/v1/default/banks/${encodeURIComponent(bankId)}/reflect`, {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }
}

export function createHindsightClient(config: HindsightConfig): HindsightClient {
  return new HindsightClient(config)
}
