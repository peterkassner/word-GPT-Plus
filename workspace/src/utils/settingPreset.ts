import { i18n } from '@/i18n'

import { forceNumber, optionLists } from './common'
import { availableModels, availableModelsForGemini, availableModelsForGroq, availableModelsForOllama } from './constant'
import { localStorageKey } from './enum'
import { resolveProxyBase } from './proxyResolver'

type componentType = 'input' | 'select' | 'inputNum'

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
  if (oldModel?.trim()) {
    const models = [oldModel]
    localStorage.setItem(key, JSON.stringify(models))
    return models
  }
  return []
}

const saveCustomModels = (key: string, models: string[]) => localStorage.setItem(key, JSON.stringify(models))

interface ISettingOption<T> {
  defaultValue: T
  saveKey?: string
  type?: componentType
  stepStyle?: 'temperature' | 'maxTokens'
  optionObj?: { label: string; value: string }[]
  optionList?: string[]
  saveFunc?: (value: T) => void
  getFunc?: () => T
}

export const Setting_Names = [
  'api',
  'localLanguage',
  'replyLanguage',
  'officialAPIKey',
  'officialBasePath',
  'officialCustomModel',
  'officialCustomModels',
  'officialTemperature',
  'officialMaxTokens',
  'officialModelSelect',
  'azureAPIKey',
  'azureAPIEndpoint',
  'azureDeploymentName',
  'azureTemperature',
  'azureMaxTokens',
  'azureAPIVersion',
  'enableMemorixTools',
  'mcpProxyHubUrl',
  'memorixAgentId',
  'memorixToolsEndpoint',
  'memorixToolsCallEndpoint',
  'memorixToolTimeoutMs',
  'memorixMaxRetries',
  'enableQdrantResourcesTools',
  'qdrantResourcesAgentId',
  'qdrantResourcesToolsEndpoint',
  'qdrantResourcesToolsCallEndpoint',
  'qdrantResourcesToolTimeoutMs',
  'qdrantResourcesMaxRetries',
  'enableDocSuiteReferenceTools',
  'docSuiteAgentId',
  'docSuiteToolsEndpoint',
  'docSuiteToolsCallEndpoint',
  'docSuiteToolTimeoutMs',
  'docSuiteMaxRetries',
  'telemetryEnabled',
  'telemetryFlushIntervalSeconds',
  'telemetryMaxQueueSize',
  'telemetryConfigVersion',
  'telemetryRedactSensitive',
  'geminiAPIKey',
  'geminiCustomModel',
  'geminiCustomModels',
  'geminiModelSelect',
  'geminiTemperature',
  'geminiMaxTokens',
  'ollamaEndpoint',
  'ollamaCustomModel',
  'ollamaCustomModels',
  'ollamaModelSelect',
  'ollamaTemperature',
  'groqAPIKey',
  'groqTemperature',
  'groqMaxTokens',
  'groqModelSelect',
  'groqCustomModel',
  'groqCustomModels',
  'systemPrompt',
  'userPrompt',
  'agentMaxIterations',
] as const

export type SettingNames = (typeof Setting_Names)[number]

type keyOfLocalStorageKey = keyof typeof localStorageKey

// Helper functions
const createStorageFuncs = (key: string, defaultValue: number) => ({
  getFunc: () => forceNumber(localStorage.getItem(key)) || defaultValue,
  saveFunc: (value: number) => localStorage.setItem(key, value.toString()),
})

const inputSetting = (defaultValue: string, saveKey?: keyOfLocalStorageKey): ISettingOption<string> => ({
  defaultValue,
  saveKey,
  type: 'input',
})

const inputNumSetting = (
  defaultValue: number,
  saveKey: keyOfLocalStorageKey,
  stepStyle: 'temperature' | 'maxTokens',
): ISettingOption<number> => ({
  defaultValue,
  saveKey,
  type: 'inputNum',
  stepStyle,
  ...createStorageFuncs(localStorageKey[saveKey], defaultValue),
})

const selectSetting = (
  defaultValue: string,
  saveKey: keyOfLocalStorageKey,
  optionList: string[],
): ISettingOption<string> => ({
  defaultValue,
  saveKey,
  type: 'select',
  optionList,
  getFunc: () => localStorage.getItem(localStorageKey[saveKey]) || defaultValue,
})

const customModelsetting = (saveKey: keyOfLocalStorageKey, oldKey: keyOfLocalStorageKey): ISettingOption<string[]> => ({
  defaultValue: [],
  saveKey,
  getFunc: () => getCustomModels(localStorageKey[saveKey], localStorageKey[oldKey]),
  saveFunc: (value: string[]) => saveCustomModels(localStorageKey[saveKey], value),
})

const LEGACY_MCP_PROXY_HUB_URLS = new Set([
  'http://localhost:3100',
  'https://localhost:3100',
  'http://127.0.0.1:3100',
  'https://127.0.0.1:3100',
  'http://127.0.0.1:9999',
  'https://127.0.0.1:9999',
  '127.0.0.1:9999',
  'localhost:9999',
  'localhost:3100',
  '127.0.0.1:3100',
])

const getMcpProxyHubUrl = () => {
  const defaultValue = resolveProxyBase('http://127.0.0.1:8096')
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return defaultValue
  const saved = localStorage.getItem(localStorageKey.mcpProxyHubUrl)?.trim()
  if (!saved) return defaultValue
  const normalizedSaved = saved.replace(/\/+$/, '')
  if (LEGACY_MCP_PROXY_HUB_URLS.has(normalizedSaved)) {
    localStorage.setItem(localStorageKey.mcpProxyHubUrl, defaultValue)
    return defaultValue
  }
  return saved
}

export const settingPreset = {
  api: {
    ...inputSetting('official'),
    type: 'select',
    optionObj: optionLists.apiList,
  },
  localLanguage: {
    ...inputSetting('en'),
    type: 'select',
    optionObj: optionLists.localLanguageList,
    saveFunc: (value: string) => {
      i18n.global.locale.value = value as 'en' | 'zh-cn'
      localStorage.setItem(localStorageKey.localLanguage, value)
    },
  },
  replyLanguage: {
    ...inputSetting('English'),
    type: 'select',
    optionObj: optionLists.replyLanguageList,
  },
  officialAPIKey: inputSetting('', 'apiKey'),
  officialBasePath: inputSetting('', 'basePath'),
  officialCustomModel: inputSetting('', 'customModel'),
  officialCustomModels: customModelsetting('customModels', 'customModel'),
  officialTemperature: inputNumSetting(0.7, 'temperature', 'temperature'),
  officialMaxTokens: inputNumSetting(800, 'maxTokens', 'maxTokens'),
  officialModelSelect: selectSetting('gpt-5', 'model', availableModels),
  azureAPIKey: inputSetting(''),
  azureAPIEndpoint: inputSetting(''),
  azureDeploymentName: inputSetting(''),
  azureTemperature: inputNumSetting(0.7, 'azureTemperature', 'temperature'),
  azureMaxTokens: inputNumSetting(800, 'azureMaxTokens', 'maxTokens'),
  azureAPIVersion: inputSetting(''),
  enableMemorixTools: {
    defaultValue: false,
    saveKey: 'enableMemorixTools',
    getFunc: () => localStorage.getItem(localStorageKey.enableMemorixTools) === 'true',
    saveFunc: value => localStorage.setItem(localStorageKey.enableMemorixTools, String(value)),
  },
  mcpProxyHubUrl: {
    type: 'input',
    defaultValue: resolveProxyBase('http://127.0.0.1:8096'),
    saveKey: 'mcpProxyHubUrl',
    getFunc: () => getMcpProxyHubUrl(),
    saveFunc: (value: string) => localStorage.setItem(localStorageKey.mcpProxyHubUrl, String(value)),
  },
  memorixAgentId: inputSetting('word-gpt-plus', 'memorixAgentId'),
  memorixToolsEndpoint: inputSetting('/api/tools/memorix', 'memorixToolsEndpoint'),
  memorixToolsCallEndpoint: inputSetting('/api/tools/memorix/call', 'memorixToolsCallEndpoint'),
  memorixToolTimeoutMs: inputNumSetting(12000, 'memorixToolTimeoutMs', 'maxTokens'),
  memorixMaxRetries: inputNumSetting(2, 'memorixMaxRetries', 'maxTokens'),
  enableQdrantResourcesTools: {
    defaultValue: false,
    saveKey: 'enableQdrantResourcesTools',
    getFunc: () => localStorage.getItem(localStorageKey.enableQdrantResourcesTools) === 'true',
    saveFunc: value => localStorage.setItem(localStorageKey.enableQdrantResourcesTools, String(value)),
  },
  qdrantResourcesAgentId: inputSetting('word-gpt-plus', 'qdrantResourcesAgentId'),
  qdrantResourcesToolsEndpoint: inputSetting('/api/tools/qdrant', 'qdrantResourcesToolsEndpoint'),
  qdrantResourcesToolsCallEndpoint: inputSetting('/api/tools/qdrant/call', 'qdrantResourcesToolsCallEndpoint'),
  qdrantResourcesToolTimeoutMs: inputNumSetting(12000, 'qdrantResourcesToolTimeoutMs', 'maxTokens'),
  qdrantResourcesMaxRetries: inputNumSetting(2, 'qdrantResourcesMaxRetries', 'maxTokens'),
  enableDocSuiteReferenceTools: {
    defaultValue: false,
    saveKey: 'enableDocSuiteReferenceTools',
    getFunc: () => localStorage.getItem(localStorageKey.enableDocSuiteReferenceTools) === 'true',
    saveFunc: value => localStorage.setItem(localStorageKey.enableDocSuiteReferenceTools, String(value)),
  },
  docSuiteAgentId: inputSetting('word-gpt-plus', 'docSuiteAgentId'),
  docSuiteToolsEndpoint: inputSetting('/api/tools/docsuite', 'docSuiteToolsEndpoint'),
  docSuiteToolsCallEndpoint: inputSetting('/api/tools/docsuite/call', 'docSuiteToolsCallEndpoint'),
  docSuiteToolTimeoutMs: inputNumSetting(12000, 'docSuiteToolTimeoutMs', 'maxTokens'),
  docSuiteMaxRetries: inputNumSetting(2, 'docSuiteMaxRetries', 'maxTokens'),
  telemetryEnabled: {
    defaultValue: true,
    getFunc: () => localStorage.getItem(localStorageKey.telemetryEnabled) !== 'false',
    saveFunc: value => localStorage.setItem(localStorageKey.telemetryEnabled, String(value)),
  },
  telemetryFlushIntervalSeconds: {
    ...inputNumSetting(30, 'telemetryFlushIntervalSeconds', 'maxTokens'),
    saveFunc: value => {
      const normalized = Number.isFinite(value) ? Math.max(5, Math.min(300, Math.floor(value))) : 30
      localStorage.setItem(localStorageKey.telemetryFlushIntervalSeconds, String(normalized))
    },
  },
  telemetryMaxQueueSize: {
    ...inputNumSetting(150, 'telemetryMaxQueueSize', 'maxTokens'),
    saveFunc: value => {
      const normalized = Number.isFinite(value) ? Math.max(50, Math.floor(value)) : 150
      localStorage.setItem(localStorageKey.telemetryMaxQueueSize, String(normalized))
    },
  },
  telemetryConfigVersion: {
    defaultValue: 1,
    saveKey: 'telemetryConfigVersion',
    getFunc: () => {
      const stored = localStorage.getItem(localStorageKey.telemetryConfigVersion)
      const parsed = stored ? Number.parseInt(stored, 10) : 1
      return Number.isFinite(parsed) ? parsed : 1
    },
    saveFunc: value => localStorage.setItem(localStorageKey.telemetryConfigVersion, String(value)),
  },
  telemetryRedactSensitive: {
    defaultValue: true,
    getFunc: () => localStorage.getItem(localStorageKey.telemetryRedactSensitive) !== 'false',
    saveFunc: value => localStorage.setItem(localStorageKey.telemetryRedactSensitive, String(value)),
  },
  geminiAPIKey: inputSetting(''),
  geminiCustomModel: inputSetting(''),
  geminiCustomModels: customModelsetting('geminiCustomModels', 'geminiCustomModel'),
  geminiModelSelect: selectSetting('gemini-3-pro-preview', 'geminiModel', availableModelsForGemini),
  geminiTemperature: inputNumSetting(0.7, 'geminiTemperature', 'temperature'),
  geminiMaxTokens: inputNumSetting(800, 'geminiMaxTokens', 'maxTokens'),
  ollamaEndpoint: inputSetting(''),
  ollamaCustomModel: inputSetting(''),
  ollamaCustomModels: customModelsetting('ollamaCustomModels', 'ollamaCustomModel'),
  ollamaModelSelect: selectSetting('qwen3:latest', 'ollamaModel', availableModelsForOllama),
  ollamaTemperature: inputNumSetting(0.7, 'ollamaTemperature', 'temperature'),
  groqAPIKey: inputSetting(''),
  groqTemperature: inputNumSetting(0.5, 'groqTemperature', 'temperature'),
  groqMaxTokens: inputNumSetting(1024, 'groqMaxTokens', 'maxTokens'),
  groqModelSelect: selectSetting('qwen/qwen3-32b', 'groqModel', availableModelsForGroq),
  groqCustomModel: inputSetting(''),
  groqCustomModels: customModelsetting('groqCustomModels', 'groqCustomModel'),
  systemPrompt: inputSetting('', 'defaultSystemPrompt'),
  userPrompt: inputSetting('', 'defaultPrompt'),
  agentMaxIterations: inputNumSetting(25, 'agentMaxIterations', 'maxTokens'),
} as const satisfies Record<SettingNames, ISettingOption<any>>
