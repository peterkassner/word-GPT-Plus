<template>
  <CheckPointsPage
    v-if="showCheckpoints"
    :thread-id="threadId"
    :saver="saver"
    :current-checkpoint-id="currentCheckpointId"
    @close="showCheckpoints = false"
    @restore="handleRestore"
    @select-thread="handleSelectThread"
  />
  <div
    v-show="!showCheckpoints"
    class="itemse-center relative flex h-full w-full flex-col justify-center bg-bg-secondary p-1.5"
  >
    <div class="relative flex h-full w-full flex-col gap-1.5 rounded-md">
      <!-- Header -->
      <div class="flex items-center justify-between rounded-md border border-border-secondary bg-surface px-2 py-1.5">
        <div class="flex flex-1 items-center gap-2">
          <span class="text-sm font-semibold tracking-tight text-main">Assistant</span>
        </div>
        <div class="flex items-center gap-1 rounded-md border border-border-secondary bg-bg-secondary p-0.5">
          <CustomButton
            :title="t('newChat')"
            :icon="Plus"
            text=""
            type="secondary"
            class="border-none p-1!"
            :icon-size="18"
            @click="startNewChat"
          />
          <CustomButton
            :title="t('settings')"
            :icon="Settings"
            text=""
            type="secondary"
            class="border-none p-1!"
            :icon-size="18"
            @click="settings"
          />
          <CustomButton
            :title="t('checkPoints')"
            :icon="History"
            text=""
            type="secondary"
            class="border-none p-1!"
            :icon-size="18"
            @click="checkPoints"
          />
        </div>
      </div>

      <!-- Quick Actions Bar -->
      <div
        class="flex w-full items-center justify-center gap-2 overflow-hidden rounded-md border border-border-secondary bg-surface p-1.5"
      >
        <CustomButton
          v-for="action in quickActions"
          :key="action.key"
          :title="action.label"
          text=""
          :icon="action.icon"
          type="secondary"
          :icon-size="16"
          class="shrink-0! bg-surface! p-1.5!"
          :disabled="loading"
          @click="applyQuickAction(action.key)"
        />
        <SingleSelect
          v-model="selectedPromptId"
          :key-list="savedPrompts.map(prompt => prompt.id)"
          :placeholder="t('selectPrompt')"
          title=""
          :fronticon="false"
          class="max-w-xs! flex-1! bg-surface! text-xs!"
          @change="loadSelectedPrompt"
        >
          <template #item="{ item }">
            {{ savedPrompts.find(prompt => prompt.id === item)?.name || item }}
          </template>
        </SingleSelect>
      </div>

      <!-- Chat Messages Container -->
      <div
        ref="messagesContainer"
        class="flex flex-1 flex-col gap-4 overflow-y-auto rounded-md border border-border-secondary bg-surface p-2.5 shadow-sm"
      >
        <div v-if="history.length === 0" class="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
          <p class="font-semibold tracking-tight text-main">
            {{ $t('emptyTitle') }}
          </p>
          <p class="text-xs font-semibold text-secondary">
            {{ $t('emptySubtitle') }}
          </p>
        </div>

        <div
          v-for="(msg, index) in displayHistory"
          :key="msg.id || index"
          class="group flex items-end gap-4 [.user]:flex-row-reverse"
          :class="msg instanceof AIMessage ? 'assistant' : 'user'"
        >
          <div
            class="flex min-w-0 flex-1 flex-col gap-1 group-[.assistant]:items-start group-[.assistant]:text-left group-[.user]:items-end group-[.user]:text-left"
          >
            <div
              class="group max-w-[95%] rounded-md border border-border-secondary p-1 text-sm leading-[1.4] wrap-break-word whitespace-pre-wrap text-main/90 shadow-sm group-[.assistant]:bg-bg-tertiary group-[.assistant]:text-left group-[.user]:bg-accent/10"
            >
              <template v-for="(segment, idx) in renderSegments(msg)" :key="idx">
                <span v-if="segment.type === 'text'">{{ segment.text.trim() }}</span>
                <details v-else class="mb-1 rounded-sm border border-border-secondary bg-bg-secondary">
                  <summary class="cursor-pointer list-none p-1 text-sm font-semibold text-secondary">
                    Thought process
                  </summary>
                  <pre class="m-0 p-1 text-xs wrap-break-word whitespace-pre-wrap text-secondary">{{
                    segment.text.trim()
                  }}</pre>
                </details>
              </template>
            </div>
            <div v-if="msg instanceof AIMessage" class="flex gap-1">
              <CustomButton
                :title="t('replaceSelectedText')"
                text=""
                :icon="FileText"
                type="secondary"
                class="bg-surface! p-1.5! text-secondary!"
                :icon-size="12"
                @click="insertToDocument(cleanMessageText(msg), 'replace')"
              />
              <CustomButton
                :title="t('appendToSelection')"
                text=""
                :icon="Plus"
                type="secondary"
                class="bg-surface! p-1.5! text-secondary!"
                :icon-size="12"
                @click="insertToDocument(cleanMessageText(msg), 'append')"
              />
              <CustomButton
                :title="t('copyToClipboard')"
                text=""
                :icon="Copy"
                type="secondary"
                class="bg-surface! p-1.5! text-secondary!"
                :icon-size="12"
                @click="copyToClipboard(cleanMessageText(msg))"
              />
            </div>
          </div>
        </div>
        <div
          v-if="hasAgentActivityPanel"
          class="rounded-md border border-border-secondary bg-bg-secondary p-2 shadow-sm"
        >
          <div class="mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium text-main">Agent Activity</span>
              <div v-if="loading && mode === 'agent'" class="flex items-center gap-1">
                <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:140ms]" />
                <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:280ms]" />
              </div>
            </div>
            <span class="text-[11px] text-secondary">
              {{ runningToolCallsCount > 0 ? `${runningToolCallsCount} running` : loading ? 'thinking' : 'idle' }}
            </span>
          </div>
          <div v-if="recentToolCalls.length > 0" class="flex flex-col gap-1.5">
            <details
              v-for="toolCall in recentToolCalls"
              :key="toolCall.id"
              class="rounded-sm border border-border-secondary bg-surface"
            >
              <summary class="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5">
                <div class="flex min-w-0 items-center gap-2">
                  <LoaderCircle
                    v-if="toolCall.status === 'running'"
                    :size="13"
                    class="shrink-0 animate-spin text-accent"
                  />
                  <CheckCircle v-else :size="13" class="shrink-0 text-success" />
                  <span class="truncate text-xs font-medium text-main">{{ toolCall.name }}</span>
                  <span
                    v-if="toolCall.isMemorixTool"
                    class="rounded-sm border border-border bg-bg-secondary px-1.5 py-0.5 text-[10px] text-secondary uppercase"
                  >
                    memorix
                  </span>
                  <span
                    v-if="toolCall.isQdrantTool"
                    class="rounded-sm border border-border bg-bg-secondary px-1.5 py-0.5 text-[10px] text-secondary uppercase"
                  >
                    qdrant
                  </span>
                  <span
                    v-if="toolCall.isDocSuiteTool"
                    class="rounded-sm border border-border bg-bg-secondary px-1.5 py-0.5 text-[10px] text-secondary uppercase"
                  >
                    docsuite
                  </span>
                </div>
                <span class="text-[11px] text-secondary">{{ toolCall.status }}</span>
              </summary>
              <div class="flex flex-col gap-1.5 px-2 pb-2">
                <div v-if="toolCall.argsPreview" class="rounded-sm bg-bg px-1.5 py-1">
                  <p class="mb-0.5 text-[10px] tracking-wide text-tertiary uppercase">Args</p>
                  <pre class="m-0 overflow-x-auto text-[11px] leading-tight whitespace-pre-wrap text-secondary">{{
                    toolCall.argsPreview
                  }}</pre>
                </div>
                <div v-if="toolCall.resultPreview" class="rounded-sm bg-bg px-1.5 py-1">
                  <p class="mb-0.5 text-[10px] tracking-wide text-tertiary uppercase">Result</p>
                  <pre class="m-0 overflow-x-auto text-[11px] leading-tight whitespace-pre-wrap text-secondary">{{
                    toolCall.resultPreview
                  }}</pre>
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>

      <!-- Input Area -->
      <div class="flex flex-col gap-1 rounded-md">
        <div class="flex items-center justify-between gap-2 overflow-hidden">
          <div class="flex shrink-0 gap-1 rounded-sm border border-border bg-surface p-0.5">
            <button
              class="group cursor-po relative flex h-7 w-7 items-center justify-center rounded-md border-none text-secondary hover:bg-accent/30 hover:text-white! [.active]:text-accent"
              :class="{ active: mode === 'ask' }"
              :title="t('askAnything')"
              @click="mode = 'ask'"
            >
              <MessageSquare :size="14" />
              <span
                class="pointer-events-none absolute -top-8 left-1/2 z-20 -translate-x-1/2 rounded-sm border border-border bg-bg-secondary px-2 py-1 text-[11px] leading-none whitespace-nowrap text-secondary opacity-0 shadow-sm transition-opacity duration-fast group-hover:opacity-100"
              >
                Ask Mode
              </span>
            </button>
            <button
              class="group cursor-po relative flex h-7 w-7 items-center justify-center rounded-md border-none text-secondary hover:bg-accent/30 hover:text-white! [.active]:text-accent"
              :class="{ active: mode === 'agent' }"
              :title="t('directTheAgent')"
              @click="mode = 'agent'"
            >
              <BotMessageSquare :size="17" />
              <span
                class="pointer-events-none absolute -top-8 left-1/2 z-20 -translate-x-1/2 rounded-sm border border-border bg-bg-secondary px-2 py-1 text-[11px] leading-none whitespace-nowrap text-secondary opacity-0 shadow-sm transition-opacity duration-fast group-hover:opacity-100"
              >
                Agent Mode
              </span>
            </button>
          </div>
          <div class="flex min-w-0 flex-1 gap-1 overflow-hidden">
            <select
              v-model="settingForm.api"
              class="h-7 max-w-full min-w-0 cursor-pointer rounded-md border border-border bg-surface p-1 text-xs text-secondary hover:border-accent focus:outline-none disabled:cursor-not-allowed disabled:bg-secondary"
            >
              <option v-for="item in settingPreset.api.optionObj" :key="item.value" :value="item.value">
                {{ item.label.replace('official', 'OpenAI') }}
              </option>
            </select>
            <select
              v-if="currentModelOptions && currentModelOptions.length > 0"
              v-model="currentModelSelect"
              class="h-7 max-w-full min-w-0 cursor-pointer rounded-md border border-border bg-surface p-1 text-xs text-secondary hover:border-accent focus:outline-none"
            >
              <option v-for="item in currentModelOptions" :key="item" :value="item">
                {{ item }}
              </option>
            </select>
          </div>
        </div>
        <div
          class="flex min-w-12 items-center gap-2 rounded-md border border-border bg-surface p-2 focus-within:border-accent"
        >
          <textarea
            ref="inputTextarea"
            v-model="userInput"
            class="placeholder::text-secondary block min-h-[20vh] flex-1 resize-none overflow-y-auto border-none bg-transparent py-2 text-xs leading-normal text-main outline-none placeholder:text-xs"
            :placeholder="mode === 'ask' ? $t('askAnything') : $t('directTheAgent')"
            rows="1"
            @keydown.enter.exact.prevent="sendMessage"
            @input="adjustTextareaHeight"
          />
          <button
            v-if="loading"
            class="group relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-danger text-white"
            title="Stop"
            @click="stopGeneration"
          >
            <Square :size="18" />
            <span
              class="pointer-events-none absolute -top-8 left-1/2 z-20 -translate-x-1/2 rounded-sm border border-border bg-bg-secondary px-2 py-1 text-[11px] leading-none whitespace-nowrap text-secondary opacity-0 shadow-sm transition-opacity duration-fast group-hover:opacity-100"
            >
              Stop
            </span>
          </button>
          <button
            v-else
            class="group relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-accent text-white disabled:cursor-not-allowed disabled:bg-accent/50"
            title="Send"
            :disabled="!userInput.trim()"
            @click="sendMessage"
          >
            <Send :size="18" />
            <span
              class="pointer-events-none absolute -top-8 left-1/2 z-20 -translate-x-1/2 rounded-sm border border-border bg-bg-secondary px-2 py-1 text-[11px] leading-none whitespace-nowrap text-secondary opacity-0 shadow-sm transition-opacity duration-fast group-hover:opacity-100"
            >
              Send
            </span>
          </button>
        </div>
        <div class="flex justify-center gap-3 px-1">
          <label class="flex h-3.5 w-3.5 flex-1 cursor-pointer items-center gap-1 text-xs text-secondary">
            <input v-model="useWordFormatting" type="checkbox" />
            <span>{{ $t('useWordFormattingLabel') }}</span>
          </label>
          <label class="flex h-3.5 w-3.5 flex-1 cursor-pointer items-center gap-1 text-xs text-secondary">
            <input v-model="useSelectedText" type="checkbox" />
            <span>{{ $t('includeSelectionLabel') }}</span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { AIMessage, HumanMessage, Message, SystemMessage } from '@langchain/core/messages'
import { useStorage } from '@vueuse/core'
import {
  BookOpen,
  BotMessageSquare,
  CheckCircle,
  Copy,
  FileCheck,
  FileText,
  Globe,
  History,
  LoaderCircle,
  MessageSquare,
  Plus,
  Send,
  Settings,
  Sparkle,
  Square,
} from 'lucide-vue-next'
import { v4 as uuidv4 } from 'uuid'
import { computed, nextTick, onBeforeMount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { type CheckpointTuple, IndexedDBSaver } from '@/api/checkpoints'
import { insertFormattedResult, insertResult } from '@/api/common'
import { getAgentResponse, getChatResponse } from '@/api/union'
import CustomButton from '@/components/CustomButton.vue'
import SingleSelect from '@/components/SingleSelect.vue'
import CheckPointsPage from '@/pages/checkPointsPage.vue'
import { checkAuth } from '@/utils/common'
import { buildInPrompt, getBuiltInPrompt } from '@/utils/constant'
import {
  createDocSuiteReferenceTools,
  type DocSuiteToolRequestContext,
  getDocSuiteToolsConfigFromStorage,
} from '@/utils/docSuiteReferenceTools'
import { localStorageKey } from '@/utils/enum'
import {
  appendTelemetryEvent,
  createGeneralTools,
  flushTelemetryQueueToProxy,
  GeneralToolName,
} from '@/utils/generalTools'
import { createMemorixTools, getMemorixToolsConfigFromStorage } from '@/utils/memorixTools'
import { message as messageUtil } from '@/utils/message'
import { resolveProxyBase } from '@/utils/proxyResolver'
import { createQdrantResourcesTools, getQdrantToolsConfigFromStorage } from '@/utils/qdrantResourcesTools'
import useSettingForm from '@/utils/settingForm'
import { settingPreset } from '@/utils/settingPreset'
import { createWordTools, WordToolName } from '@/utils/wordTools'

const router = useRouter()
const { t } = useI18n()

const settingForm = useSettingForm()

interface SavedPrompt {
  id: string
  name: string
  systemPrompt: string
  userPrompt: string
}

const savedPrompts = ref<SavedPrompt[]>([])
const selectedPromptId = ref<string>('')
const customSystemPrompt = ref<string>('')

const allWordToolNames: WordToolName[] = [
  'getSelectedText',
  'getDocumentContent',
  'insertText',
  'replaceSelectedText',
  'appendText',
  'insertParagraph',
  'formatText',
  'searchAndReplace',
  'getDocumentProperties',
  'insertTable',
  'insertList',
  'deleteText',
  'clearFormatting',
  'setFontName',
  'insertPageBreak',
  'getRangeInfo',
  'selectText',
  'insertImage',
  'getTableInfo',
  'insertBookmark',
  'goToBookmark',
  'insertContentControl',
  'findText',
]

const allGeneralToolNames: GeneralToolName[] = ['fetchWebContent', 'searchWeb', 'getCurrentDate', 'calculateMath']

// Tool state
const enabledWordTools = ref<WordToolName[]>(loadEnabledWordTools())
const enabledGeneralTools = ref<GeneralToolName[]>(loadEnabledGeneralTools())

function loadEnabledWordTools(): WordToolName[] {
  const stored = localStorage.getItem('enabledWordTools')
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      return parsed.filter((name: string) => allWordToolNames.includes(name as WordToolName))
    } catch {
      return [...allWordToolNames]
    }
  }
  return [...allWordToolNames]
}

function loadEnabledGeneralTools(): GeneralToolName[] {
  const stored = localStorage.getItem('enabledGeneralTools')
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      return parsed.filter((name: string) => allGeneralToolNames.includes(name as GeneralToolName))
    } catch {
      return [...allGeneralToolNames]
    }
  }
  return [...allGeneralToolNames]
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function logToolDiscoveryFailure(provider: string, error: unknown) {
  appendTelemetryEvent({
    type: 'tool.discovery.failed',
    ts: new Date().toISOString(),
    threadId: threadId.value,
    provider,
    error: toErrorMessage(error),
  })
}

async function getActiveToolsWithProviders(): Promise<ReturnType<typeof createGeneralTools>> {
  const wordTools = createWordTools(enabledWordTools.value)
  const generalTools = createGeneralTools(enabledGeneralTools.value)
  const allTools = [...generalTools, ...wordTools]
  const docSuiteContext = await getDocSuiteContext()

  const memorixConfig = getMemorixToolsConfigFromStorage({
    threadId: threadId.value || undefined,
  })
  const qdrantConfig = getQdrantToolsConfigFromStorage({
    threadId: threadId.value || undefined,
  })
  const docSuiteConfig = getDocSuiteToolsConfigFromStorage(docSuiteContext)

  memorixToolNames.value = new Set()
  qdrantToolNames.value = new Set()
  docSuiteToolNames.value = new Set()
  currentMemorixAgentId.value = memorixConfig.memorixAgentId || 'word-gpt-plus'
  currentQdrantAgentId.value = qdrantConfig.qdrantResourcesAgentId || 'word-gpt-plus'
  currentDocSuiteAgentId.value = docSuiteConfig.docSuiteAgentId || 'word-gpt-plus'

  if (memorixConfig.enableMemorixTools) {
    try {
      const memorixTools = await createMemorixTools(memorixConfig)
      memorixToolNames.value = new Set(memorixTools.map(tool => tool.name))
      allTools.push(...memorixTools)
    } catch (error) {
      console.error('[Memorix] Failed to load tools', error)
      logToolDiscoveryFailure('memorix', error)
      messageUtil.error('Memorix tool discovery failed')
      memorixToolNames.value = new Set()
    }
  }

  if (qdrantConfig.enableQdrantResourcesTools) {
    try {
      const qdrantTools = await createQdrantResourcesTools(qdrantConfig)
      qdrantToolNames.value = new Set(qdrantTools.map(tool => tool.name))
      allTools.push(...qdrantTools)
    } catch (error) {
      console.error('[Qdrant] Failed to load tools', error)
      logToolDiscoveryFailure('qdrant', error)
      messageUtil.error('Qdrant tool discovery failed')
      qdrantToolNames.value = new Set()
    }
  }

  if (docSuiteConfig.enableDocSuiteReferenceTools) {
    try {
      const docSuiteTools = await createDocSuiteReferenceTools(docSuiteConfig)
      docSuiteToolNames.value = new Set(docSuiteTools.map(tool => tool.name))
      allTools.push(...docSuiteTools)
    } catch (error) {
      console.error('[DocSuite] Failed to load tools', error)
      logToolDiscoveryFailure('docsuite', error)
      messageUtil.error('DocSuite tool discovery failed')
      docSuiteToolNames.value = new Set()
    }
  }

  return allTools
}

function extractFileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter(Boolean)
    return segments[segments.length - 1] || ''
  } catch {
    const segments = url.split('/').filter(Boolean)
    return segments[segments.length - 1] || ''
  }
}

async function getDocSuiteContext(): Promise<DocSuiteToolRequestContext> {
  const base: DocSuiteToolRequestContext = {
    threadId: threadId.value || undefined,
  }

  try {
    if (typeof Office !== 'undefined') {
      const activeDocumentUrl = (Office.context?.document?.url || '').trim()
      if (activeDocumentUrl) {
        base.activeDocumentUrl = activeDocumentUrl
        const fileName = extractFileNameFromUrl(activeDocumentUrl)
        if (fileName) {
          base.activeDocumentName = fileName
        }
      }
    }
  } catch {
    // ignore context URL errors
  }

  try {
    const activeDocumentTitle = await Word.run(async context => {
      const props = context.document.properties
      props.load('title')
      await context.sync()
      return (props.title || '').trim()
    })
    if (activeDocumentTitle) {
      base.activeDocumentTitle = activeDocumentTitle
    }
  } catch {
    // ignore property load errors
  }

  return base
}

function loadSavedPrompts() {
  const stored = localStorage.getItem('savedPrompts')
  if (stored) {
    try {
      savedPrompts.value = JSON.parse(stored)
    } catch (error) {
      console.error('Error loading saved prompts:', error)
      savedPrompts.value = []
    }
  }
}

function loadSelectedPrompt() {
  if (!selectedPromptId.value) {
    customSystemPrompt.value = ''
    return
  }

  const prompt = savedPrompts.value.find(p => p.id === selectedPromptId.value)
  if (prompt) {
    customSystemPrompt.value = prompt.systemPrompt
    userInput.value = prompt.userPrompt
    adjustTextareaHeight()

    if (inputTextarea.value) {
      inputTextarea.value.focus()
    }
  }
}

// Chat state
const mode = useStorage(localStorageKey.chatMode, 'ask' as 'ask' | 'agent')
const history = ref<Message[]>([])
const userInput = ref('')
const loading = ref(false)
const messagesContainer = ref<HTMLElement>()
const inputTextarea = ref<HTMLTextAreaElement>()
const abortController = ref<AbortController | null>(null)
const threadId = useStorage(localStorageKey.threadId, uuidv4())
const showCheckpoints = ref(false)
const saver = new IndexedDBSaver()
const currentCheckpointId = ref<string>('')

type AgentToolCallStatus = 'running' | 'completed' | 'failed'
interface AgentToolCallUiItem {
  id: string
  name: string
  status: AgentToolCallStatus
  argsPreview: string
  resultPreview: string
  isMemorixTool: boolean
  isQdrantTool: boolean
  isDocSuiteTool: boolean
}
const agentToolCalls = ref<AgentToolCallUiItem[]>([])
const recentToolCalls = computed(() => agentToolCalls.value.slice(-6))
const runningToolCallsCount = computed(() => agentToolCalls.value.filter(item => item.status === 'running').length)
const hasAgentActivityPanel = computed(
  () => mode.value === 'agent' && (loading.value || agentToolCalls.value.length > 0),
)

// Settings
const useWordFormatting = useStorage(localStorageKey.useWordFormatting, true)
const useSelectedText = useStorage(localStorageKey.useSelectedText, true)
const insertType = ref<insertTypes>('replace')

const errorIssue = ref<boolean | string | null>(false)
const telemetryEnabled = ref(localStorage.getItem(localStorageKey.telemetryEnabled) !== 'false')
const memorixToolNames = ref<Set<string>>(new Set())
const qdrantToolNames = ref<Set<string>>(new Set())
const docSuiteToolNames = ref<Set<string>>(new Set())
const currentMemorixAgentId = ref('word-gpt-plus')
const currentQdrantAgentId = ref('word-gpt-plus')
const currentDocSuiteAgentId = ref('word-gpt-plus')

const enqueueTelemetryEvent = (event: Record<string, unknown>) => {
  if (!telemetryEnabled.value) return
  appendTelemetryEvent({
    ts: new Date().toISOString(),
    ...event,
    type: event.type || 'agent.event',
  })
}

const flushTelemetryQueue = async (): Promise<void> => {
  if (!telemetryEnabled.value) return
  const { success, flushed } = await flushTelemetryQueueToProxy()
  if (!success && flushed === 0) {
    console.warn('[Telemetry] Queue flush failed; events retained locally')
  }
}

const summarizeTelemetryText = (value: string, maxLength = 1200): string => {
  if (!value) return ''
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...[truncated]`
}

const summarizeTelemetryPayload = (payload: unknown, maxLength = 1200): string => {
  try {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
    return summarizeTelemetryText(text, maxLength)
  } catch {
    return '[unserializable]'
  }
}

const migrateLegacy3232Endpoints = () => {
  if (typeof window === 'undefined') return

  const keysToMigrate: string[] = [
    localStorageKey.proxy,
    localStorageKey.mcpProxyHubUrl,
    localStorageKey.memorixToolsEndpoint,
    localStorageKey.memorixToolsCallEndpoint,
    localStorageKey.qdrantResourcesToolsEndpoint,
    localStorageKey.qdrantResourcesToolsCallEndpoint,
    localStorageKey.docSuiteToolsEndpoint,
    localStorageKey.docSuiteToolsCallEndpoint,
  ]

  const normalize = (raw: string): string => {
    const trimmed = raw.trim()
    if (!trimmed.includes(':3232')) return trimmed

    try {
      const parsed = new URL(trimmed, window.location.origin)
      if (parsed.port === '3232') {
        parsed.port = '3100'
      }
      return parsed.toString()
    } catch {
      return trimmed.replace(':3232', ':3100')
    }
  }

  keysToMigrate.forEach(key => {
    const current = localStorage.getItem(key)
    if (!current || !current.includes(':3232')) return
    const migrated = normalize(current)
    if (migrated !== current) {
      localStorage.setItem(key, migrated)
    }
  })
}

interface SelectionSnapshot {
  text: string
  style?: string
  styleBuiltIn?: string
  fontName?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: string
  color?: string
}

async function getSelectionSnapshot(): Promise<SelectionSnapshot> {
  return Word.run(async context => {
    const range = context.document.getSelection()
    range.load([
      'text',
      'style',
      'styleBuiltIn',
      'font/name',
      'font/size',
      'font/bold',
      'font/italic',
      'font/underline',
      'font/color',
    ])
    await context.sync()
    return {
      text: range.text || '',
      style: range.style || undefined,
      styleBuiltIn: (range.styleBuiltIn as string) || undefined,
      fontName: range.font.name || undefined,
      fontSize: typeof range.font.size === 'number' ? range.font.size : undefined,
      bold: typeof range.font.bold === 'boolean' ? range.font.bold : undefined,
      italic: typeof range.font.italic === 'boolean' ? range.font.italic : undefined,
      underline: range.font.underline || undefined,
      color: range.font.color || undefined,
    }
  })
}

function buildSelectionStyleContext(snapshot: SelectionSnapshot): string {
  const parts = [
    snapshot.styleBuiltIn ? `styleBuiltIn=${snapshot.styleBuiltIn}` : null,
    snapshot.style ? `style=${snapshot.style}` : null,
    snapshot.fontName ? `fontName=${snapshot.fontName}` : null,
    typeof snapshot.fontSize === 'number' ? `fontSize=${snapshot.fontSize}` : null,
    typeof snapshot.bold === 'boolean' ? `bold=${snapshot.bold}` : null,
    typeof snapshot.italic === 'boolean' ? `italic=${snapshot.italic}` : null,
    snapshot.underline ? `underline=${snapshot.underline}` : null,
    snapshot.color ? `color=${snapshot.color}` : null,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(', ') : 'unavailable'
}

const resetAgentToolCalls = () => {
  agentToolCalls.value = []
}

const addAgentToolCall = (
  toolName: string,
  args: unknown,
  isMemorixTool: boolean,
  isQdrantTool: boolean,
  isDocSuiteTool: boolean,
) => {
  agentToolCalls.value.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: toolName,
    status: 'running',
    argsPreview: summarizeTelemetryPayload(args, 800),
    resultPreview: '',
    isMemorixTool,
    isQdrantTool,
    isDocSuiteTool,
  })
}

const completeAgentToolCall = (toolName: string, result: string, status: AgentToolCallStatus = 'completed') => {
  const index = [...agentToolCalls.value]
    .reverse()
    .findIndex(item => item.name === toolName && item.status === 'running')
  if (index === -1) return

  const actualIndex = agentToolCalls.value.length - 1 - index
  agentToolCalls.value[actualIndex] = {
    ...agentToolCalls.value[actualIndex],
    status,
    resultPreview: summarizeTelemetryText(result || '', 1000),
  }
}

const failActiveToolCalls = (message = 'Tool call did not finish') => {
  agentToolCalls.value = agentToolCalls.value.map(item =>
    item.status === 'running'
      ? {
          ...item,
          status: 'failed',
          resultPreview: summarizeTelemetryText(message, 500),
        }
      : item,
  )
}

const getProxyConfig = () => {
  const enabled = localStorage.getItem(localStorageKey.enableProxy) === 'true'
  const rawProxyUrl = localStorage.getItem(localStorageKey.proxy)?.trim()
  if (!rawProxyUrl) return undefined
  const proxyUrl = resolveProxyBase(rawProxyUrl)

  if (!enabled || !proxyUrl) {
    return undefined
  }

  return {
    enabled: true,
    baseURL: `${proxyUrl}`,
  }
}

const displayHistory = computed(() => {
  return history.value.filter(msg => !(msg instanceof SystemMessage))
})

// Quick actions
const quickActions: {
  key: keyof typeof buildInPrompt
  label: string
  icon: any
}[] = [
  { key: 'translate', label: t('translate'), icon: Globe },
  { key: 'polish', label: t('polish'), icon: Sparkle },
  { key: 'academic', label: t('academic'), icon: BookOpen },
  { key: 'summary', label: t('summary'), icon: FileCheck },
  { key: 'grammar', label: t('grammar'), icon: CheckCircle },
]

const getCustomModels = (key: string, oldKey: string): string[] => {
  const stored = localStorage.getItem(key)
  if (stored) {
    try {
      return JSON.parse(stored)
    } catch {
      return []
    }
  }
  const oldModel = localStorage.getItem(oldKey)
  if (oldModel && oldModel.trim()) {
    return [oldModel]
  }
  return []
}

const currentModelProvider = computed(() =>
  settingForm.value.api === 'openrouter' ? 'official' : settingForm.value.api,
)
const currentModelSourceProvider = computed(() => settingForm.value.api)
const remoteModelOptions = ref<Record<string, string[]>>({})

const parseModelResponse = (payload: any): string[] => {
  if (Array.isArray(payload)) {
    return payload
      .map(model => (typeof model === 'string' ? model.trim() : model?.id || model?.name || ''))
      .filter(Boolean)
  }

  if (Array.isArray(payload?.data)) {
    return payload.data
      .map((model: any) => (typeof model === 'string' ? model.trim() : model?.id || model?.name || ''))
      .filter(Boolean)
  }

  if (Array.isArray(payload?.models)) {
    return payload.models
      .map((model: any) => (typeof model === 'string' ? model.trim() : model?.id || model?.name || ''))
      .filter(Boolean)
  }

  return []
}

const resolveModelEndpoint = (apiProvider: 'official' | 'openrouter') => {
  const proxyEnabled = localStorage.getItem(localStorageKey.enableProxy) === 'true'
  const proxyUrl = localStorage.getItem(localStorageKey.proxy)?.trim()
  if (proxyEnabled && proxyUrl) {
    const base = resolveProxyBase(proxyUrl)
    return `${base}${apiProvider === 'openrouter' ? '/api/openrouter/v1' : '/api/openai/v1'}/models`
  }

  if (apiProvider === 'openrouter') {
    return `${(settingForm.value.officialBasePath || 'https://openrouter.ai/api/v1').replace(/\/+$/, '')}/models`
  }

  return `${(settingForm.value.officialBasePath || 'https://api.openai.com/v1').replace(/\/+$/, '')}/models`
}

let modelAbortController: AbortController | null = null
const fetchModelList = async (apiProvider: 'official' | 'openrouter') => {
  const cacheKey = apiProvider
  const apiKey = (settingForm.value.officialAPIKey || '').trim()
  if (!apiKey) {
    remoteModelOptions.value[cacheKey] = []
    return
  }

  if (modelAbortController) {
    modelAbortController.abort()
  }

  const controller = new AbortController()
  modelAbortController = controller

  try {
    const response = await fetch(resolveModelEndpoint(apiProvider), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      console.warn(`[model-poll] Failed to load ${apiProvider} models`, response.status)
      remoteModelOptions.value[cacheKey] = []
      return
    }

    const payload = await response.json()
    const models = parseModelResponse(payload)
    remoteModelOptions.value[cacheKey] = [...new Set(models)]
  } catch (error: any) {
    if (error?.name === 'AbortError') return
    console.error('[model-poll] Model fetch failed', error)
    remoteModelOptions.value[cacheKey] = []
  }
}

const currentModelOptions = computed(() => {
  let presetOptions: string[] = []
  let customModels: string[] = []

  switch (currentModelProvider.value) {
    case 'official':
      presetOptions = settingPreset.officialModelSelect.optionList || []
      customModels = getCustomModels('customModels', 'customModel')
      break
    case 'gemini':
      presetOptions = settingPreset.geminiModelSelect.optionList || []
      customModels = getCustomModels('geminiCustomModels', 'geminiCustomModel')
      break
    case 'ollama':
      presetOptions = settingPreset.ollamaModelSelect.optionList || []
      customModels = getCustomModels('ollamaCustomModels', 'ollamaCustomModel')
      break
    case 'groq':
      presetOptions = settingPreset.groqModelSelect.optionList || []
      customModels = getCustomModels('groqCustomModels', 'groqCustomModel')
      break
    case 'azure':
      return []
    default:
      return []
  }

  const remoteOptions = remoteModelOptions.value[currentModelSourceProvider.value] || []
  const finalOptions = remoteOptions.length > 0 ? remoteOptions : presetOptions
  return [...new Set([...customModels, ...finalOptions])]
})

const syncCurrentModelSelection = async () => {
  const options = currentModelOptions.value
  if (!options.length) return
  if (!options.includes(currentModelSelect.value)) {
    currentModelSelect.value = options[0]
  }
}

const currentModelSelect = computed({
  get() {
    switch (currentModelProvider.value) {
      case 'official':
        return settingForm.value.officialModelSelect
      case 'gemini':
        return settingForm.value.geminiModelSelect
      case 'ollama':
        return settingForm.value.ollamaModelSelect
      case 'groq':
        return settingForm.value.groqModelSelect
      case 'azure':
        return settingForm.value.azureDeploymentName
      default:
        return ''
    }
  },
  set(value) {
    switch (currentModelProvider.value) {
      case 'official':
        settingForm.value.officialModelSelect = value
        localStorage.setItem(localStorageKey.model, value)
        break
      case 'gemini':
        settingForm.value.geminiModelSelect = value
        localStorage.setItem(localStorageKey.geminiModel, value)
        break
      case 'ollama':
        settingForm.value.ollamaModelSelect = value
        localStorage.setItem(localStorageKey.ollamaModel, value)
        break
      case 'groq':
        settingForm.value.groqModelSelect = value
        localStorage.setItem(localStorageKey.groqModel, value)
        break
      case 'azure':
        settingForm.value.azureDeploymentName = value
        localStorage.setItem(localStorageKey.azureDeploymentName, value)
        break
      default:
        break
    }
  },
})

watch(
  () => currentModelSourceProvider.value,
  async provider => {
    if (provider === 'official' || provider === 'openrouter') {
      await fetchModelList(provider)
    }
    await syncCurrentModelSelection()
  },
  { immediate: true },
)

watch(
  () => settingForm.value.officialAPIKey,
  async () => {
    const provider = currentModelSourceProvider.value
    if (provider === 'official' || provider === 'openrouter') {
      await fetchModelList(provider)
    }
    await syncCurrentModelSelection()
  },
)

watch(
  () => settingForm.value.officialBasePath,
  async () => {
    const provider = currentModelSourceProvider.value
    if (provider === 'official' || provider === 'openrouter') {
      await fetchModelList(provider)
    }
    await syncCurrentModelSelection()
  },
)

watch(currentModelOptions, syncCurrentModelSelection)

function settings() {
  // FIXME: 使用路由方式会改变当前的threadID,进而重置页面
  router.push('/settings')
}

function checkPoints() {
  showCheckpoints.value = true
}

function startNewChat() {
  if (loading.value) {
    stopGeneration()
  }
  userInput.value = ''
  history.value = []
  resetAgentToolCalls()
  threadId.value = uuidv4()
  customSystemPrompt.value = ''
  selectedPromptId.value = ''
  adjustTextareaHeight()
}

function stopGeneration() {
  if (abortController.value) {
    abortController.value.abort()
    abortController.value = null
  }
  if (mode.value === 'agent') {
    failActiveToolCalls('Stopped by user')
  }
  loading.value = false
}

function adjustTextareaHeight() {
  if (inputTextarea.value) {
    const minHeight = Math.max(96, Math.round(window.innerHeight * 0.2))
    const maxHeight = Math.max(minHeight + 40, Math.round(window.innerHeight * 0.5))
    inputTextarea.value.style.height = 'auto'
    const nextHeight = Math.min(Math.max(inputTextarea.value.scrollHeight, minHeight), maxHeight)
    inputTextarea.value.style.height = `${nextHeight}px`
  }
}

async function scrollToBottom() {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

async function sendMessage() {
  if (!userInput.value.trim() || loading.value) return
  if (!checkApiKey()) return

  const userMessage = userInput.value.trim()
  userInput.value = ''
  adjustTextareaHeight()

  // Get selected text from Word
  let selectionSnapshot: SelectionSnapshot | null = null
  if (useSelectedText.value) {
    selectionSnapshot = await getSelectionSnapshot()
  }

  // Add user message
  const selectedText = selectionSnapshot?.text || ''
  const selectedStyleContext = selectionSnapshot ? buildSelectionStyleContext(selectionSnapshot) : ''
  const fullMessage = new HumanMessage(
    selectedText
      ? `${userMessage}\n\n[Selected text: "${selectedText}"]\n[Selected text style context: ${selectedStyleContext}]`
      : userMessage,
  )

  scrollToBottom()

  loading.value = true
  abortController.value = new AbortController()

  try {
    await processChat(fullMessage, undefined)
  } catch (error: any) {
    if (error.name === 'AbortError') {
      messageUtil.info(t('generationStop'))
      if (mode.value === 'agent') {
        failActiveToolCalls('Stopped by user')
      }
      if (mode.value !== 'agent' && telemetryEnabled.value) {
        enqueueTelemetryEvent({
          type: 'chat.request.aborted',
          threadId: threadId.value,
          error: error?.message || String(error),
        })
        flushTelemetryQueueToProxy().catch(() => {})
      }
    } else {
      console.error(error)
      messageUtil.error(t('failedToResponse'))
      history.value.pop()
      if (mode.value === 'agent') {
        failActiveToolCalls(error?.message || 'Agent request failed')
      }
      if (mode.value !== 'agent' && telemetryEnabled.value) {
        enqueueTelemetryEvent({
          type: 'chat.request.failed',
          threadId: threadId.value,
          error: error?.message || String(error),
        })
        flushTelemetryQueueToProxy().catch(() => {})
      }
    }
  } finally {
    loading.value = false
    abortController.value = null
  }
}

async function applyQuickAction(actionKey: keyof typeof buildInPrompt) {
  if (!checkApiKey()) return

  // Get selected text
  const selectedText = await Word.run(async ctx => {
    const range = ctx.document.getSelection()
    range.load('text')
    await ctx.sync()
    return range.text
  })

  if (!selectedText) {
    messageUtil.error(t('selectTextPrompt'))
    return
  }

  const builtInPrompts = getBuiltInPrompt()
  const action = builtInPrompts[actionKey]
  const settings = settingForm.value
  const { replyLanguage: lang } = settings

  const systemMessage = action.system(lang)
  const userMessage = new HumanMessage(action.user(selectedText, lang))

  scrollToBottom()

  loading.value = true
  abortController.value = new AbortController()

  try {
    await processChat(userMessage, systemMessage)
  } catch (error: any) {
    if (error.name === 'AbortError') {
      messageUtil.info(t('generationStop'))
      if (mode.value === 'agent') {
        failActiveToolCalls('Stopped by user')
      }
      enqueueTelemetryEvent({
        type: 'agent.request.aborted',
        error: error?.message || String(error),
      })
    } else {
      console.error(error)
      messageUtil.error(t('failedToProcessAction'))
      if (mode.value === 'agent') {
        failActiveToolCalls(error?.message || 'Agent quick action failed')
      }
      enqueueTelemetryEvent({
        type: 'agent.request.failed',
        error: error?.message || String(error),
      })
      // Remove failed message
      history.value.pop()
    }
  } finally {
    loading.value = false
    abortController.value = null
  }
}

const agentPrompt = (lang: string) =>
  `
# Role
You are a highly skilled Microsoft Word Expert Agent. Your goal is to assist users in creating, editing, and formatting documents with professional precision.

# Capabilities
- You can interact with the document directly using provided tools (reading text, applying styles, inserting content, etc.).
- You understand document structure, typography, and professional writing standards.

# Guidelines
1. **Tool First**: If a request requires document modification or inspection or web search and fetch, prioritize using the available tools.
2. **Accuracy**: Ensure formatting and content changes are precise and follow the user's intent.
3. **Conciseness**: Provide brief, helpful explanations of your actions.
4. **Language**: You must communicate entirely in ${lang}.

# Safety
Do not perform destructive actions (like clearing the whole document) unless explicitly instructed.
`.trim()

const standardPrompt = (lang: string) =>
  `You are a helpful Microsoft Word specialist. Help users with drafting, brainstorming, and Word-related questions. Reply in ${lang}.`

async function processChat(userMessage: HumanMessage, systemMessage?: string) {
  const settings = settingForm.value
  const { replyLanguage: lang, api: provider } = settings

  const isAgentMode = mode.value === 'agent'

  const finalSystemMessage =
    customSystemPrompt.value || systemMessage || (isAgentMode ? agentPrompt(lang) : standardPrompt(lang))

  const defaultSystemMessage = new SystemMessage(finalSystemMessage)

  const userInputText = getMessageText(userMessage)
  if (isAgentMode) {
    enqueueTelemetryEvent({
      type: 'agent.turn.input',
      mode: 'agent',
      threadId: threadId.value,
      userInputLength: userInputText.length,
      userInputPreview: summarizeTelemetryText(userInputText, 1600),
      selectedPromptId: selectedPromptId.value || null,
      provider,
      model: currentModelSelect.value,
    })
  } else if (telemetryEnabled.value) {
    enqueueTelemetryEvent({
      type: 'chat.turn.input',
      mode: 'chat',
      threadId: threadId.value,
      userInputLength: userInputText.length,
      userInputPreview: summarizeTelemetryText(userInputText, 1600),
      selectedPromptId: selectedPromptId.value || null,
      provider,
      model: currentModelSelect.value,
    })
  }

  // Add user message to history
  history.value.push(userMessage)

  // Prepare messages for LLM (always include system message first, followed by all history)
  const finalMessages = [defaultSystemMessage, ...history.value]
  // Build provider configuration
  const officialProviderConfig = {
    provider: 'official',
    config: {
      apiKey: settings.officialAPIKey,
      baseURL: settings.officialBasePath,
      dangerouslyAllowBrowser: true,
    },
    proxy: getProxyConfig(),
    maxTokens: settings.officialMaxTokens,
    temperature: settings.officialTemperature,
    model: settings.officialModelSelect,
  }
  const providerConfigs: Record<string, any> = {
    official: officialProviderConfig,
    openrouter: { ...officialProviderConfig, provider: 'openrouter' },
    groq: {
      provider: 'groq',
      groqAPIKey: settings.groqAPIKey,
      groqModel: settings.groqModelSelect,
      proxy: getProxyConfig(),
      maxTokens: settings.groqMaxTokens,
      temperature: settings.groqTemperature,
    },
    azure: {
      provider: 'azure',
      azureAPIKey: settings.azureAPIKey,
      azureAPIEndpoint: settings.azureAPIEndpoint,
      azureDeploymentName: settings.azureDeploymentName,
      azureAPIVersion: settings.azureAPIVersion,
      maxTokens: settings.azureMaxTokens,
      temperature: settings.azureTemperature,
    },
    gemini: {
      provider: 'gemini',
      geminiAPIKey: settings.geminiAPIKey,
      maxTokens: settings.geminiMaxTokens,
      temperature: settings.geminiTemperature,
      geminiModel: settings.geminiModelSelect,
    },
    ollama: {
      provider: 'ollama',
      ollamaEndpoint: settings.ollamaEndpoint,
      ollamaModel: settings.ollamaModelSelect,
      temperature: settings.ollamaTemperature,
    },
  }

  const currentConfig = providerConfigs[provider]
  if (!currentConfig) {
    messageUtil.error(t('notSupportedProvider'))
    return
  }

  history.value.push(new AIMessage(''))

  // Use agent mode with tools if enabled
  if (isAgentMode) {
    resetAgentToolCalls()
    const tools = await getActiveToolsWithProviders()

    await getAgentResponse({
      ...currentConfig,
      recursionLimit: settings.agentMaxIterations,
      messages: finalMessages,
      tools,
      errorIssue,
      loading,
      abortSignal: abortController.value?.signal,
      threadId: threadId.value,
      checkpointId: currentCheckpointId.value,
      onStream: (text: string) => {
        const lastIndex = history.value.length - 1
        history.value[lastIndex] = new AIMessage(text)
        scrollToBottom()
      },
      onToolCall: (toolName: string, _args: any) => {
        const isMemorixTool = memorixToolNames.value.has(toolName)
        const isQdrantTool = qdrantToolNames.value.has(toolName)
        const isDocSuiteTool = docSuiteToolNames.value.has(toolName)
        addAgentToolCall(toolName, _args, isMemorixTool, isQdrantTool, isDocSuiteTool)
        enqueueTelemetryEvent({
          type: 'agent.tool.call',
          toolName,
          toolArgsPreview: summarizeTelemetryPayload(_args),
          isMemorixTool,
          isQdrantTool,
          isDocSuiteTool,
          memorixAgentId: isMemorixTool ? currentMemorixAgentId.value : undefined,
          qdrantAgentId: isQdrantTool ? currentQdrantAgentId.value : undefined,
          docSuiteAgentId: isDocSuiteTool ? currentDocSuiteAgentId.value : undefined,
        })
        scrollToBottom()
      },
      onToolResult: (toolName: string, _result: string) => {
        completeAgentToolCall(toolName, _result, 'completed')
        const isMemorixTool = memorixToolNames.value.has(toolName)
        const isQdrantTool = qdrantToolNames.value.has(toolName)
        const isDocSuiteTool = docSuiteToolNames.value.has(toolName)
        enqueueTelemetryEvent({
          type: 'agent.tool.result',
          toolName,
          toolResultLength: _result?.length || 0,
          toolResultPreview: summarizeTelemetryText(_result || '', 1600),
          isMemorixTool,
          isQdrantTool,
          isDocSuiteTool,
          memorixAgentId: isMemorixTool ? currentMemorixAgentId.value : undefined,
          qdrantAgentId: isQdrantTool ? currentQdrantAgentId.value : undefined,
          docSuiteAgentId: isDocSuiteTool ? currentDocSuiteAgentId.value : undefined,
        })
        scrollToBottom()
      },
      onAgentEvent: event => {
        enqueueTelemetryEvent({
          type: event.type,
          requestId: event.requestId,
          turnId: event.turnId,
          sourceTs: event.ts,
          threadId: threadId.value,
          ...event.data,
        })
        if (event.type === 'agent.turn.complete') {
          failActiveToolCalls('No tool result returned')
          const lastMessage = history.value[history.value.length - 1]
          const outputText = lastMessage ? getMessageText(lastMessage) : ''
          enqueueTelemetryEvent({
            type: 'agent.turn.output',
            requestId: event.requestId,
            turnId: event.turnId,
            threadId: threadId.value,
            outputLength: outputText.length,
            outputPreview: summarizeTelemetryText(outputText, 2000),
          })
        }
        if (event.type === 'agent.turn.complete' || event.type === 'agent.error') {
          if (event.type === 'agent.error') {
            failActiveToolCalls('Agent run failed')
          }
          setTimeout(() => {
            flushTelemetryQueue().catch(() => {
              console.error('[Telemetry] flush failed')
            })
          }, 0)
        }
      },
    })
  } else {
    await getChatResponse({
      ...currentConfig,
      messages: finalMessages,
      errorIssue,
      loading,
      abortSignal: abortController.value?.signal,
      threadId: threadId.value,
      onStream: (text: string) => {
        const lastIndex = history.value.length - 1
        history.value[lastIndex] = new AIMessage(text)
        scrollToBottom()
      },
    })
    if (telemetryEnabled.value && !errorIssue.value) {
      const lastMessage = history.value[history.value.length - 1]
      const outputText = lastMessage ? getMessageText(lastMessage) : ''
      enqueueTelemetryEvent({
        type: 'chat.turn.complete',
        mode: 'chat',
        threadId: threadId.value,
        provider,
        model: currentModelSelect.value,
        outputLength: outputText.length,
        outputPreview: summarizeTelemetryText(outputText, 2000),
      })
      flushTelemetryQueue().catch(() => {
        console.error('[Telemetry] flush failed')
      })
    }
  }

  if (errorIssue.value) {
    if (!isAgentMode && telemetryEnabled.value) {
      enqueueTelemetryEvent({
        type: 'chat.turn.failed',
        mode: 'chat',
        threadId: threadId.value,
        provider,
        model: currentModelSelect.value,
        issue: typeof errorIssue.value === 'string' ? errorIssue.value : 'unknown',
      })
      flushTelemetryQueue().catch(() => {
        console.error('[Telemetry] flush failed')
      })
    }
    if (typeof errorIssue.value === 'string') {
      messageUtil.error(t(errorIssue.value))
    } else {
      messageUtil.error(t('somethingWentWrong'))
    }
    errorIssue.value = null
    return
  }

  scrollToBottom()
}

async function insertToDocument(content: string, type: insertTypes) {
  insertType.value = type

  if (useWordFormatting.value) {
    await insertFormattedResult(content, insertType)
  } else {
    insertResult(content, insertType)
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  messageUtil.success(t('copied'))
}

function checkApiKey() {
  const auth = {
    type: settingForm.value.api as supportedPlatforms,
    apiKey: settingForm.value.officialAPIKey,
    azureAPIKey: settingForm.value.azureAPIKey,
    geminiAPIKey: settingForm.value.geminiAPIKey,
    groqAPIKey: settingForm.value.groqAPIKey,
  }
  if (!checkAuth(auth)) {
    messageUtil.error(t('noAPIKey'))
    return false
  }
  return true
}

const THINK_TAG = '<think>'
const THINK_TAG_END = '</think>'

interface RenderSegment {
  type: 'text' | 'think'
  text: string
}

const flattenContentArray = (content: any[]): string =>
  content
    .map((part: any) => {
      if (typeof part === 'string') return part
      if (part?.text && typeof part.text === 'string') return part.text
      if (part?.data && typeof part.data === 'string') return part.data
      return ''
    })
    .join('')

const getMessageText = (msg: Message): string => {
  const content: any = (msg as any).content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return flattenContentArray(content)
  return ''
}

const cleanMessageText = (msg: Message): string => {
  const raw = getMessageText(msg)
  const regex = new RegExp(`${THINK_TAG}[\\s\\S]*?${THINK_TAG_END}`, 'g')
  return raw.replace(regex, '').trim()
}

const splitThinkSegments = (text: string): RenderSegment[] => {
  if (!text) return []

  const segments: RenderSegment[] = []
  let cursor = 0

  while (cursor < text.length) {
    const start = text.indexOf(THINK_TAG, cursor)
    if (start === -1) {
      segments.push({ type: 'text', text: text.slice(cursor) })
      break
    }

    if (start > cursor) {
      segments.push({ type: 'text', text: text.slice(cursor, start) })
    }

    const end = text.indexOf(THINK_TAG_END, start + THINK_TAG.length)
    if (end === -1) {
      segments.push({
        type: 'think',
        text: text.slice(start + THINK_TAG.length),
      })
      break
    }

    segments.push({
      type: 'think',
      text: text.slice(start + THINK_TAG.length, end),
    })
    cursor = end + THINK_TAG_END.length
  }

  return segments.filter(segment => segment.text)
}

const renderSegments = (msg: Message): RenderSegment[] => {
  const raw = getMessageText(msg)
  return splitThinkSegments(raw)
}

const addWatch = () => {
  watch(
    () => settingForm.value.replyLanguage,
    () => {
      localStorage.setItem(localStorageKey.replyLanguage, settingForm.value.replyLanguage)
    },
  )
  watch(
    () => settingForm.value.api,
    () => {
      localStorage.setItem(localStorageKey.api, settingForm.value.api)
    },
  )
}

async function initData() {
  insertType.value = (localStorage.getItem(localStorageKey.insertType) as insertTypes) || 'replace'
}

async function handleRestore(checkpointId: string) {
  currentCheckpointId.value = checkpointId
  showCheckpoints.value = false

  // Fetch the history up to the selected checkpoint
  const checkpointTuple = await saver.getTuple({
    configurable: { thread_id: threadId.value, checkpoint_id: checkpointId },
  })

  if (checkpointTuple) {
    const messages = checkpointTuple.checkpoint.channel_values.messages
    if (messages && Array.isArray(messages)) {
      history.value = messages
        .filter((msg: any) => ['human', 'ai'].includes(msg.type))
        .map((msg: any) => {
          return msg.type === 'human' ? new HumanMessage(msg.content) : new AIMessage(msg.content)
        })
    }
  }
}

async function loadThreadHistory(targetThreadId: string) {
  const checkpoints: CheckpointTuple[] = []
  const iterator = saver.list({
    configurable: { thread_id: targetThreadId },
  })

  for await (const checkpoint of iterator) {
    checkpoints.push(checkpoint)
  }

  if (checkpoints.length > 0) {
    checkpoints.sort((a, b) => (a.metadata?.step ?? 0) - (b.metadata?.step ?? 0))

    const latestCheckpoint = checkpoints[checkpoints.length - 1]
    const messages = latestCheckpoint.checkpoint.channel_values.messages
    // TODO: 优化过滤策略
    if (messages && Array.isArray(messages)) {
      history.value = messages
        .filter((msg: any) => ['human', 'ai'].includes(msg.type))
        .map((msg: any) => {
          return msg.type === 'human' ? new HumanMessage(msg.content) : new AIMessage(msg.content)
        })
      currentCheckpointId.value = latestCheckpoint.config.configurable?.checkpoint_id || ''
    } else {
      history.value = []
      currentCheckpointId.value = ''
    }
  } else {
    // No checkpoints found for this thread
    history.value = []
    currentCheckpointId.value = ''
  }
  await scrollToBottom()
}

async function handleSelectThread(newThreadId: string) {
  threadId.value = newThreadId
  showCheckpoints.value = false
  await loadThreadHistory(newThreadId)
}

onBeforeMount(() => {
  migrateLegacy3232Endpoints()
  addWatch()
  initData()
  loadSavedPrompts()

  if (threadId.value) {
    loading.value = true // 可选：显示加载状态
    try {
      loadThreadHistory(threadId.value)
    } catch (e) {
      console.error('Auto reload history failed:', e)
    } finally {
      loading.value = false
    }
  }
})
</script>
