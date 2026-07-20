import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatGroq } from '@langchain/groq'
// import { MemorySaver } from '@langchain/langgraph'
import { ChatOllama } from '@langchain/ollama'
import { AzureChatOpenAI, ChatOpenAI } from '@langchain/openai'
import { createAgent } from 'langchain'

import { IndexedDBSaver } from '@/api/checkpoints'
import { createUUID } from '@/utils/uuid'

import {
  AgentOptions,
  AzureOptions,
  GeminiOptions,
  GroqOptions,
  LMStudioOptions,
  OllamaOptions,
  OpenAIOptions,
  OpenRouterOptions,
  ProviderOptions,
} from './types'

function createOpenAIModel(opts: OpenAIOptions) {
  const modelName = opts.model || 'gpt-5'
  const hasProxy = opts.proxy?.enabled && opts.proxy?.baseURL
  const baseURL = hasProxy ? `${opts.proxy.baseURL}/api/openai/v1` : opts.config.baseURL || 'https://api.openai.com/v1'
  return new ChatOpenAI({
    modelName,
    apiKey: opts.config.apiKey,
    configuration: {
      baseURL,
      dangerouslyAllowBrowser: opts.config.dangerouslyAllowBrowser,
    },
    temperature: opts.temperature ?? 0.7,
    maxTokens: opts.maxTokens ?? 800,
  })
}

function createOpenRouterModel(opts: OpenRouterOptions) {
  const modelName = opts.model || 'anthropic/claude-sonnet-4'
  const hasProxy = opts.proxy?.enabled && opts.proxy?.baseURL
  const baseURL = hasProxy
    ? `${opts.proxy.baseURL}/api/openrouter/v1`
    : opts.config.baseURL || 'https://openrouter.ai/api/v1'
  return new ChatOpenAI({
    modelName,
    apiKey: opts.config.apiKey,
    configuration: {
      baseURL,
      dangerouslyAllowBrowser: opts.config.dangerouslyAllowBrowser,
    },
    temperature: opts.temperature ?? 0.7,
    maxTokens: opts.maxTokens ?? 800,
  })
}

function createLMStudioModel(opts: LMStudioOptions) {
  const modelName = opts.model || 'qwen/qwen3.6-27b'
  const hasProxy = opts.proxy?.enabled && opts.proxy?.baseURL
  const baseURL = hasProxy ? `${opts.proxy.baseURL}/api/lmstudio/v1` : opts.config.baseURL || 'http://127.0.0.1:1234/v1'
  return new ChatOpenAI({
    modelName,
    apiKey: opts.config.apiKey,
    configuration: {
      baseURL,
      dangerouslyAllowBrowser: opts.config.dangerouslyAllowBrowser,
    },
    temperature: opts.temperature ?? 0.7,
    maxTokens: opts.maxTokens ?? 800,
  })
}

const ModelCreators: Record<string, (opts: any) => BaseChatModel> = {
  official: createOpenAIModel,
  openrouter: createOpenRouterModel,
  lmstudio: createLMStudioModel,

  ollama: (opts: OllamaOptions) => {
    const hasProxy = opts.proxy?.enabled && opts.proxy?.baseURL
    const directEndpoint = opts.ollamaEndpoint?.replace(/\/$/, '') || 'http://localhost:11434'
    const baseUrl = hasProxy
      ? `${opts.proxy.baseURL}/api/ollama?ollamaEndpoint=${encodeURIComponent(directEndpoint)}`
      : directEndpoint
    return new ChatOllama({
      model: opts.ollamaModel,
      baseUrl,
      temperature: opts.temperature,
    })
  },

  groq: (opts: GroqOptions) => {
    const hasProxy = opts.proxy?.enabled && opts.proxy?.baseURL
    return new ChatGroq({
      model: opts.groqModel,
      baseUrl: hasProxy ? `${opts.proxy.baseURL}/api/groq/v1` : undefined,
      apiKey: opts.groqAPIKey,
      temperature: opts.temperature ?? 0.5,
      maxTokens: opts.maxTokens ?? 1024,
    })
  },

  gemini: (opts: GeminiOptions) => {
    const hasProxy = opts.proxy?.enabled && opts.proxy?.baseURL
    if (hasProxy) {
      return new ChatGoogleGenerativeAI({
        model: opts.geminiModel ?? 'gemini-3-pro-preview',
        apiKey: opts.geminiAPIKey,
        temperature: opts.temperature ?? 0.7,
        maxOutputTokens: opts.maxTokens ?? 800,
        baseUrl: `${opts.proxy!.baseURL}/api/gemini`,
      })
    }
    return new ChatGoogleGenerativeAI({
      model: opts.geminiModel ?? 'gemini-3-pro-preview',
      apiKey: opts.geminiAPIKey,
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxTokens ?? 800,
    })
  },

  azure: (opts: AzureOptions) => {
    const hasProxy = opts.proxy?.enabled && opts.proxy?.baseURL
    if (hasProxy) {
      const azureEndpoint = opts.azureAPIEndpoint?.replace(/\/$/, '') || ''
      return new AzureChatOpenAI({
        model: opts.azureDeploymentName,
        temperature: opts.temperature ?? 0.7,
        maxTokens: opts.maxTokens ?? 800,
        azureOpenAIApiKey: opts.azureAPIKey,
        azureOpenAIEndpoint: `${opts.proxy!.baseURL}/api/azure?azureEndpoint=${encodeURIComponent(azureEndpoint)}`,
        azureOpenAIApiDeploymentName: opts.azureDeploymentName,
        azureOpenAIApiVersion: opts.azureAPIVersion ?? '2024-10-01',
      })
    }
    return new AzureChatOpenAI({
      model: opts.azureDeploymentName,
      temperature: opts.temperature ?? 0.7,
      maxTokens: opts.maxTokens ?? 800,
      azureOpenAIApiKey: opts.azureAPIKey,
      azureOpenAIEndpoint: opts.azureAPIEndpoint,
      azureOpenAIApiDeploymentName: opts.azureDeploymentName,
      azureOpenAIApiVersion: opts.azureAPIVersion ?? '2024-10-01',
    })
  },
}

// const checkpointer = new MemorySaver()
const checkpointer = new IndexedDBSaver()

async function executeChatFlow(model: BaseChatModel, options: ProviderOptions): Promise<void> {
  try {
    if (!options.threadId) {
      options.threadId = createUUID()
      console.log(`[Chat] New thread started: ${options.threadId}`)
    }
    const agent = createAgent({
      model,
      tools: [],
      checkpointer,
    })
    const stream = await agent.stream(
      {
        messages: options.messages,
      },
      {
        signal: options.abortSignal,
        configurable: { thread_id: options.threadId },
        streamMode: 'messages',
      },
    )

    let fullContent = ''
    for await (const chunk of stream) {
      if (options.abortSignal?.aborted) {
        break
      }

      const content = typeof chunk[0].content === 'string' ? chunk[0].content : ''
      fullContent += content
      options.onStream(fullContent)
    }
  } catch (error: any) {
    if (error.name === 'AbortError' || options.abortSignal?.aborted) {
      // Don't mark as error if intentionally aborted
      throw error
    }
    options.errorIssue.value = true
    console.error(error)
  } finally {
    options.loading.value = false
  }
}

async function executeAgentFlow(model: BaseChatModel, options: AgentOptions): Promise<void> {
  type AgentEventType = Exclude<Parameters<NonNullable<AgentOptions['onAgentEvent']>>[0]['type'], undefined>
  const requestId = createUUID()
  const turnId = options.threadId || createUUID()
  const emitAgentEvent = (type: AgentEventType, data?: Record<string, unknown>) => {
    if (!options.onAgentEvent) return
    options.onAgentEvent({
      type,
      requestId,
      turnId,
      ts: new Date().toISOString(),
      data,
    })
  }

  try {
    if (!options.threadId) {
      options.threadId = createUUID()
      console.log(`[Agent] New thread started: ${options.threadId}`)
    }
    emitAgentEvent('agent.turn.start', {
      provider: options.provider,
      toolCount: options.tools?.length || 0,
      recursionLimit: options.recursionLimit,
      threadId: options.threadId,
      turnId,
    })
    const agent = createAgent({
      model,
      tools: options.tools || [],
      checkpointer,
    })

    const stream = await agent.stream(
      {
        messages: options.messages,
      },
      {
        recursionLimit: Number(options.recursionLimit), //最大迭代次数
        signal: options.abortSignal,
        configurable: {
          thread_id: options.threadId,
          checkpoint_id: options.checkpointId,
        },
        streamMode: 'values',
      },
    )

    let fullContent = ''
    let stepCount = 0

    for await (const step of stream) {
      if (options.abortSignal?.aborted) {
        break
      }

      stepCount++
      emitAgentEvent('agent.step', {
        stepIndex: stepCount,
      })
      console.log(`[Agent] Step ${stepCount}:`, {
        messageCount: step.messages?.length || 0,
        lastMessageType: step.messages?.[step.messages.length - 1]?.constructor?.name,
      })

      const messages = step.messages || []
      const lastMessage = messages[messages.length - 1]

      if (!lastMessage) continue

      // Cast to any for accessing tool-related properties
      const msg = lastMessage as any

      console.log(`[Agent] Message type: ${msg._getType?.() || 'unknown'}`)

      // Handle AI messages with tool calls
      if (msg._getType?.() === 'ai' && msg.tool_calls?.length > 0) {
        console.log('[Agent] Tool calls detected:', msg.tool_calls.length)
        for (const toolCall of msg.tool_calls) {
          console.log('[Agent] Tool call:', {
            name: toolCall.name,
            args: toolCall.args,
          })
          // Tool-call telemetry is emitted from HomePage onToolCall (previews + provider flags).
          if (options.onToolCall) {
            options.onToolCall(toolCall.name, toolCall.args)
          }
        }
      }

      // Handle tool result messages
      if (msg._getType?.() === 'tool') {
        const toolName = msg.name || 'unknown'
        const toolContent = String(msg.content || '')
        console.log('[Agent] Tool result:', {
          name: toolName,
          contentLength: toolContent.length,
          contentPreview: toolContent.substring(0, 100),
        })
        // Tool-result telemetry is emitted from HomePage onToolResult (richer previews + flags).
        if (options.onToolResult) {
          options.onToolResult(toolName, toolContent)
        }
      }

      // Handle AI message content (the final response)
      if (msg._getType?.() === 'ai' && msg.content) {
        const content = typeof msg.content === 'string' ? msg.content : ''
        if (content && (!msg.tool_calls || msg.tool_calls.length === 0)) {
          fullContent = content
          console.log('[Agent] AI response:', {
            content,
          })
          options.onStream(fullContent)
        }
      }
    }

    console.log('[Agent] Flow completed. Total steps:', stepCount)
    emitAgentEvent('agent.turn.complete', { stepCount })
  } catch (error: any) {
    emitAgentEvent('agent.error', {
      message: error?.message || String(error),
      name: error?.name || 'UnknownError',
    })
    console.error('[Agent] Error:', error)
    if (error.name === 'AbortError' || options.abortSignal?.aborted) {
      throw error
    }
    if (error.name === 'GraphRecursionError') {
      options.errorIssue.value = 'recursionLimitExceeded'
    } else {
      options.errorIssue.value = true
    }
    // TODO: more specific error handling based on LangGraph error
    console.error(error)
  } finally {
    options.loading.value = false
  }
}

export async function getChatResponse(options: ProviderOptions) {
  const creator = ModelCreators[options.provider]
  if (!creator) {
    throw new Error(`Unsupported provider: ${options.provider}`)
  }
  const model = creator(options)
  return executeChatFlow(model, options)
}

export async function getAgentResponse(options: AgentOptions) {
  const creator = ModelCreators[options.provider]
  if (!creator) {
    throw new Error(`Unsupported provider: ${options.provider}`)
  }
  const model = creator(options)
  return executeAgentFlow(model, options)
}
