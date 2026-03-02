declare global {
  type TermbridgeGlossaryMatchType = 'exact' | 'caseInsensitive' | 'pattern'
  type TermbridgeGlossaryDomain = 'common' | 'network-cisco' | 'network-huawei' | 'network-h3c' | 'network-ruijie'

  type TermbridgeGlossaryEntry = {
    id?: string
    source: string
    target: string
    matchType?: TermbridgeGlossaryMatchType
    caseInsensitive?: boolean
    note?: string
    domain?: TermbridgeGlossaryDomain
    createdAt?: string
    updatedAt?: string
    uiOnly?: boolean
    wholeWord?: boolean
  }

  type TermbridgeGlossaryEntryUpsertInput = {
    id?: string
    source: string
    target: string
    matchType?: TermbridgeGlossaryMatchType
    caseInsensitive?: boolean
    note?: string
    domain?: TermbridgeGlossaryDomain
    uiOnly?: boolean
    wholeWord?: boolean
  }

  type TermbridgeGlossaryEntryDeleteInput = {
    id: string
  }

  type TermbridgeGlossaryPayload = {
    path: string
    entries: TermbridgeGlossaryEntry[]
  }

  type TermbridgeTranslationProvider = 'google-free' | 'openai-compatible' | 'tencent-tmt'
  type TermbridgeMatchStrategy = 'exact' | 'caseInsensitive' | 'pattern'

  type TermbridgeTranslationMirrorPolicy = {
    skipRules: {
      stackLike: boolean
      symbolOnly: boolean
      protectedOnly: boolean
      outOfViewport: boolean
    }
    localMatchPriority: TermbridgeMatchStrategy[]
    fallbackUiOnly: boolean
  }

  type TermbridgeTranslationConfig = {
    version: number
    defaultProvider: TermbridgeTranslationProvider
    timeoutMs: number
    fallbackProviders?: TermbridgeTranslationProvider[]
    mirror: TermbridgeTranslationMirrorPolicy
    providers: {
      googleFree: {
        endpoint: string
        endpoints: string[]
      }
      openaiCompatible: {
        baseUrl: string
        model: string
        apiKeyEnv: string
        apiKey?: string
      }
      tencentTmt: {
        endpoint: string
        region: string
        source: string
        target: string
        projectId: number
        secretIdEnv: string
        secretKeyEnv: string
        secretId?: string
        secretKey?: string
      }
    }
  }

  type TermbridgeTranslationConfigPayload = {
    path: string
    config: TermbridgeTranslationConfig
  }

  type TermbridgeOnlineTranslateRequest = {
    text: string
    sourceLang?: string
    targetLang?: string
    provider?: TermbridgeTranslationProvider
    timeoutMs?: number
    baseUrl?: string
    model?: string
    apiKey?: string
    secretId?: string
    secretKey?: string
    region?: string
    projectId?: number
  }

  type TermbridgeOnlineTranslateResult = {
    translatedText: string
    provider: TermbridgeTranslationProvider
  }

  type TermbridgeCommandActionType = 'sendText' | 'sendKey' | 'sendAnsi'
  type TermbridgeCommandRisk = 'safe' | 'caution' | 'destructive'

  type TermbridgeCommandContext = {
    id: string
    label: string
    detectHints: string[]
  }

  type TermbridgeCommandButton = {
    id: string
    labelZh: string
    actionType: TermbridgeCommandActionType
    payload: string
    contextId: string
    risk: TermbridgeCommandRisk
    order: number
  }

  type TermbridgeCommandConfig = {
    version: number
    defaultContextId: string
    contexts: TermbridgeCommandContext[]
    buttons: TermbridgeCommandButton[]
  }

  type TermbridgeCommandConfigPayload = {
    path: string
    config: TermbridgeCommandConfig
  }

  type TermbridgeSessionLogExportRequest = {
    tabId: string
    tabTitle: string
    sessionName?: string
    cleanText: string
    jsonl: string
  }

  type TermbridgeSessionLogExportResult = {
    txtPath: string
    jsonlPath: string
  } | null

  type TermbridgeLocalConnectProtocol = 'telnet' | 'raw'

  interface Window {
    termbridge: {
      spawn: (tabId: string, cols: number, rows: number) => Promise<boolean>
      connectLocal: (tabId: string, host: string, port: number, protocol: TermbridgeLocalConnectProtocol) => Promise<boolean>
      write: (tabId: string, data: string) => void
      resize: (tabId: string, cols: number, rows: number) => Promise<boolean>
      kill: (tabId: string) => Promise<boolean>
      loadGlossary: () => Promise<TermbridgeGlossaryPayload>
      reloadGlossary: () => Promise<TermbridgeGlossaryPayload>
      importGlossary: () => Promise<TermbridgeGlossaryPayload | null>
      exportGlossary: () => Promise<boolean>
      upsertGlossaryEntry: (entry: TermbridgeGlossaryEntryUpsertInput) => Promise<TermbridgeGlossaryPayload>
      deleteGlossaryEntry: (payload: TermbridgeGlossaryEntryDeleteInput) => Promise<TermbridgeGlossaryPayload>
      loadTranslationConfig: () => Promise<TermbridgeTranslationConfigPayload>
      saveTranslationConfig: (nextConfig: TermbridgeTranslationConfig) => Promise<TermbridgeTranslationConfigPayload>
      translateOnline: (request: TermbridgeOnlineTranslateRequest) => Promise<TermbridgeOnlineTranslateResult>
      loadContexts: () => Promise<TermbridgeCommandConfigPayload>
      reloadContexts: () => Promise<TermbridgeCommandConfigPayload>
      saveContexts: (nextConfig: TermbridgeCommandConfig) => Promise<TermbridgeCommandConfigPayload>
      exportSessionLog: (payload: TermbridgeSessionLogExportRequest) => Promise<TermbridgeSessionLogExportResult>
      onPtyData: (listener: (payload: { tabId: string; data: string }) => void) => () => void
      onPtyExit: (listener: (payload: { tabId: string; exitCode: number }) => void) => () => void
    }
  }
}

export {}
