import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import net from 'node:net'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import pty, { type IPty } from 'node-pty'

type GlossaryMatchType = 'exact' | 'caseInsensitive' | 'pattern'
type GlossaryDomain = 'common' | 'network-cisco' | 'network-huawei' | 'network-h3c' | 'network-ruijie'

type GlossaryEntry = {
  id?: string
  source: string
  target: string
  matchType?: GlossaryMatchType
  caseInsensitive?: boolean
  note?: string
  domain?: GlossaryDomain
  createdAt?: string
  updatedAt?: string
  uiOnly?: boolean
  wholeWord?: boolean
}

type GlossaryEntryUpsertInput = {
  id?: string
  source: string
  target: string
  matchType?: GlossaryMatchType
  caseInsensitive?: boolean
  note?: string
  domain?: GlossaryDomain
  uiOnly?: boolean
  wholeWord?: boolean
}

type GlossaryPayload = {
  path: string
  entries: GlossaryEntry[]
}

type CommandActionType = 'sendText' | 'sendKey' | 'sendAnsi'
type CommandRisk = 'safe' | 'caution' | 'destructive'

type CommandContext = {
  id: string
  label: string
  detectHints: string[]
}

type CommandButton = {
  id: string
  labelZh: string
  actionType: CommandActionType
  payload: string
  contextId: string
  risk: CommandRisk
  order: number
}

type CommandConfig = {
  version: number
  defaultContextId: string
  contexts: CommandContext[]
  buttons: CommandButton[]
}

type CommandConfigPayload = {
  path: string
  config: CommandConfig
}

type TranslationProvider = 'google-free' | 'openai-compatible' | 'tencent-tmt'
type MatchStrategy = 'exact' | 'caseInsensitive' | 'pattern'

type TranslationMirrorPolicy = {
  skipRules: {
    stackLike: boolean
    symbolOnly: boolean
    protectedOnly: boolean
    outOfViewport: boolean
  }
  localMatchPriority: MatchStrategy[]
  fallbackUiOnly: boolean
}

type TranslationConfig = {
  version: number
  defaultProvider: TranslationProvider
  timeoutMs: number
  fallbackProviders?: TranslationProvider[]
  mirror: TranslationMirrorPolicy
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

type TranslationConfigPayload = {
  path: string
  config: TranslationConfig
}

type OnlineTranslateRequest = {
  text: string
  sourceLang?: string
  targetLang?: string
  provider?: TranslationProvider
  timeoutMs?: number
  baseUrl?: string
  model?: string
  apiKey?: string
  secretId?: string
  secretKey?: string
  region?: string
  projectId?: number
}

type OnlineTranslateResult = {
  translatedText: string
  provider: TranslationProvider
}

type SessionLogExportRequest = {
  tabId: string
  tabTitle: string
  sessionName?: string
  cleanText: string
  jsonl: string
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const preloadPath =
  fs.existsSync(path.join(__dirname, 'preload.mjs'))
    ? path.join(__dirname, 'preload.mjs')
    : path.join(__dirname, 'preload.js')

let mainWindow: BrowserWindow | null = null
const ptySessions = new Map<string, IPty>()
type LocalSessionProtocol = 'telnet' | 'raw'
type LocalSocketSession = {
  protocol: LocalSessionProtocol
  socket: net.Socket
}
const localSocketSessions = new Map<string, LocalSocketSession>()

const closeLocalSocketSession = (tabId: string): boolean => {
  const existing = localSocketSessions.get(tabId)
  if (!existing) {
    return false
  }
  existing.socket.destroy()
  localSocketSessions.delete(tabId)
  return true
}

const writeToSession = (tabId: string, data: string): void => {
  if (data.length === 0) {
    return
  }

  const ptySession = ptySessions.get(tabId)
  if (ptySession) {
    ptySession.write(data)
    return
  }

  const localSession = localSocketSessions.get(tabId)
  if (!localSession) {
    return
  }
  try {
    localSession.socket.write(data)
  } catch {
    // ignore socket write failures
  }
}

const GLOSSARY_FILENAME = 'glossary.json'
const CONTEXTS_FILENAME = 'contexts.json'
const TRANSLATION_CONFIG_FILENAME = 'translation.config.json'
const TRANSLATION_CONFIG_LOCAL_FILENAME = 'translation.config.local'

const DEFAULT_TRANSLATION_CONFIG: TranslationConfig = {
  version: 1,
  defaultProvider: 'google-free',
  timeoutMs: 12000,
  fallbackProviders: [],
  mirror: {
    skipRules: {
      stackLike: true,
      symbolOnly: true,
      protectedOnly: true,
      outOfViewport: true,
    },
    localMatchPriority: ['exact', 'caseInsensitive', 'pattern'],
    fallbackUiOnly: true,
  },
  providers: {
    googleFree: {
      endpoint: 'https://translate.googleapis.com/translate_a/single',
      endpoints: [
        'https://translate.googleapis.com/translate_a/single',
        'https://translate.google.com/translate_a/single',
      ],
    },
    openaiCompatible: {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKeyEnv: 'OPENAI_API_KEY',
      apiKey: undefined,
    },
    tencentTmt: {
      endpoint: 'https://tmt.tencentcloudapi.com',
      region: 'ap-guangzhou',
      source: 'en',
      target: 'zh',
      projectId: 0,
      secretIdEnv: 'TENCENT_SECRET_ID',
      secretKeyEnv: 'TENCENT_SECRET_KEY',
    },
  },
}

const DEFAULT_COMMAND_CONFIG: CommandConfig = {
  version: 1,
  defaultContextId: 'shell',
  contexts: [
    { id: 'shell', label: 'Shell', detectHints: ['zsh', 'bash', 'shell', '$ ', '% ', '# '] },
    {
      id: 'opencode',
      label: 'OpenCode',
      detectHints: ['opencode', 'ask anything', 'tip press', '/task', '/plan', '/help'],
    },
    {
      id: 'codex',
      label: 'Codex',
      detectHints: ['codex', 'gpt-5.3-codex', '/apply_patch', '/check', '/help'],
    },
  ],
  buttons: [
    {
      id: 'shell-ls-la',
      labelZh: '列出目录',
      actionType: 'sendText',
      payload: 'ls -la\n',
      contextId: 'shell',
      risk: 'safe',
      order: 1,
    },
    {
      id: 'shell-pwd',
      labelZh: '当前路径',
      actionType: 'sendText',
      payload: 'pwd\n',
      contextId: 'shell',
      risk: 'safe',
      order: 2,
    },
    {
      id: 'shell-clear',
      labelZh: '清屏',
      actionType: 'sendText',
      payload: 'clear\n',
      contextId: 'shell',
      risk: 'safe',
      order: 3,
    },
    {
      id: 'shell-up',
      labelZh: '上一条',
      actionType: 'sendAnsi',
      payload: '\\x1b[A',
      contextId: 'shell',
      risk: 'safe',
      order: 4,
    },
    {
      id: 'shell-down',
      labelZh: '下一条',
      actionType: 'sendAnsi',
      payload: '\\x1b[B',
      contextId: 'shell',
      risk: 'safe',
      order: 5,
    },
    {
      id: 'shell-ctrl-c',
      labelZh: '中断 (Ctrl+C)',
      actionType: 'sendKey',
      payload: 'Ctrl+C',
      contextId: 'shell',
      risk: 'caution',
      order: 6,
    },
    {
      id: 'opencode-help',
      labelZh: '显示帮助',
      actionType: 'sendText',
      payload: '/help\n',
      contextId: 'opencode',
      risk: 'safe',
      order: 1,
    },
    {
      id: 'opencode-clear',
      labelZh: '清屏',
      actionType: 'sendText',
      payload: 'clear\n',
      contextId: 'opencode',
      risk: 'safe',
      order: 2,
    },
    {
      id: 'opencode-stop',
      labelZh: '停止输出',
      actionType: 'sendKey',
      payload: 'Ctrl+C',
      contextId: 'opencode',
      risk: 'caution',
      order: 3,
    },
    {
      id: 'codex-help',
      labelZh: '查看帮助',
      actionType: 'sendText',
      payload: '/help\n',
      contextId: 'codex',
      risk: 'safe',
      order: 1,
    },
    {
      id: 'codex-continue',
      labelZh: '继续执行',
      actionType: 'sendText',
      payload: '/continue\n',
      contextId: 'codex',
      risk: 'safe',
      order: 2,
    },
    {
      id: 'codex-stop',
      labelZh: '终止当前任务',
      actionType: 'sendKey',
      payload: 'Ctrl+C',
      contextId: 'codex',
      risk: 'caution',
      order: 3,
    },
  ],
}

type NormalizeGlossaryOptions = {
  legacyDefaultCaseInsensitive?: boolean
}

const normalizeGlossaryMatchType = (
  value: unknown,
  fallback: GlossaryMatchType = 'exact',
): GlossaryMatchType => {
  if (value === 'exact' || value === 'caseInsensitive' || value === 'pattern') {
    return value
  }

  return fallback
}

const normalizeGlossaryDomain = (value: unknown): GlossaryDomain => {
  if (
    value === 'network-cisco' ||
    value === 'network-huawei' ||
    value === 'network-h3c' ||
    value === 'network-ruijie' ||
    value === 'common'
  ) {
    return value
  }
  return 'common'
}

const normalizeTimestamp = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return fallback
  }

  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) {
    return fallback
  }

  return new Date(parsed).toISOString()
}

const buildGlossaryEntryKey = (entry: GlossaryEntry): string => {
  const source = entry.source.trim()
  const matchType = normalizeGlossaryMatchType(entry.matchType, 'exact')
  const caseInsensitive =
    typeof entry.caseInsensitive === 'boolean' ? entry.caseInsensitive : matchType === 'caseInsensitive'
  const comparableSource = caseInsensitive ? source.toLocaleLowerCase() : source
  const domain = normalizeGlossaryDomain(entry.domain)
  return `${domain}:${matchType}:${caseInsensitive ? 'i' : 's'}:${comparableSource}`
}

const normalizeGlossaryEntries = (
  entries: GlossaryEntry[],
  options: NormalizeGlossaryOptions = {},
): GlossaryEntry[] => {
  const deduped = new Map<string, GlossaryEntry>()
  const defaultMatchType: GlossaryMatchType = options.legacyDefaultCaseInsensitive ? 'caseInsensitive' : 'exact'

  for (const entry of entries) {
    const source = entry.source.trim()
    const target = entry.target.trim()
    if (source.length < 2 || target.length === 0) {
      continue
    }

    const now = new Date().toISOString()
    const matchType = normalizeGlossaryMatchType(entry.matchType, defaultMatchType)
    const caseInsensitive =
      typeof entry.caseInsensitive === 'boolean' ? entry.caseInsensitive : matchType === 'caseInsensitive'
    const note = typeof entry.note === 'string' ? entry.note.trim() : ''
    const id = typeof entry.id === 'string' && entry.id.trim().length > 0 ? entry.id.trim() : randomUUID()
    const createdAt = normalizeTimestamp(entry.createdAt, now)
    const updatedAt = normalizeTimestamp(entry.updatedAt, now)
    const domain = normalizeGlossaryDomain(entry.domain)

    const normalizedEntry: GlossaryEntry = {
      id,
      source,
      target,
      matchType,
      caseInsensitive,
      note,
      domain,
      createdAt,
      updatedAt,
      uiOnly: typeof entry.uiOnly === 'boolean' ? entry.uiOnly : undefined,
      wholeWord: typeof entry.wholeWord === 'boolean' ? entry.wholeWord : undefined,
    }

    deduped.set(buildGlossaryEntryKey(normalizedEntry), normalizedEntry)
  }

  return Array.from(deduped.values())
}

const parseGlossaryArrayEntries = (rawEntries: unknown[]): GlossaryEntry[] => {
  const entries: GlossaryEntry[] = []

  for (const item of rawEntries) {
    if (typeof item !== 'object' || !item) {
      continue
    }

    const source = (item as { source?: unknown }).source
    const target = (item as { target?: unknown }).target
    if (typeof source !== 'string' || typeof target !== 'string') {
      continue
    }

    entries.push({
      id: typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id : undefined,
      source,
      target,
      matchType: normalizeGlossaryMatchType((item as { matchType?: unknown }).matchType, 'caseInsensitive'),
      caseInsensitive:
        typeof (item as { caseInsensitive?: unknown }).caseInsensitive === 'boolean'
          ? (item as { caseInsensitive: boolean }).caseInsensitive
          : undefined,
      note: typeof (item as { note?: unknown }).note === 'string' ? (item as { note: string }).note : undefined,
      domain: normalizeGlossaryDomain((item as { domain?: unknown }).domain),
      createdAt:
        typeof (item as { createdAt?: unknown }).createdAt === 'string'
          ? (item as { createdAt: string }).createdAt
          : undefined,
      updatedAt:
        typeof (item as { updatedAt?: unknown }).updatedAt === 'string'
          ? (item as { updatedAt: string }).updatedAt
          : undefined,
      uiOnly: typeof (item as { uiOnly?: unknown }).uiOnly === 'boolean' ? (item as { uiOnly: boolean }).uiOnly : undefined,
      wholeWord:
        typeof (item as { wholeWord?: unknown }).wholeWord === 'boolean'
          ? (item as { wholeWord: boolean }).wholeWord
          : undefined,
    })
  }

  return normalizeGlossaryEntries(entries, { legacyDefaultCaseInsensitive: true })
}

const parseGlossaryRaw = (raw: string): GlossaryEntry[] => {
  const parsed = JSON.parse(raw) as unknown
  if (Array.isArray(parsed)) {
    return parseGlossaryArrayEntries(parsed)
  }

  if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { entries?: unknown }).entries)) {
    return parseGlossaryArrayEntries((parsed as { entries: unknown[] }).entries)
  }

  if (typeof parsed === 'object' && parsed !== null) {
    const mappedEntries: GlossaryEntry[] = []

    for (const [source, target] of Object.entries(parsed)) {
      if (typeof target !== 'string') {
        continue
      }

      mappedEntries.push({ source, target, matchType: 'caseInsensitive', caseInsensitive: true })
    }

    return normalizeGlossaryEntries(mappedEntries, { legacyDefaultCaseInsensitive: true })
  }

  return []
}

const getGlossaryPath = (): string => {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), GLOSSARY_FILENAME)
  }

  return path.join(process.cwd(), GLOSSARY_FILENAME)
}

const writeGlossaryToPath = (filePath: string, entries: GlossaryEntry[]): void => {
  const normalizedEntries = normalizeGlossaryEntries(entries)
  const payload = {
    version: 2,
    entries: normalizedEntries,
  }

  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

const ensureGlossaryFile = (): string => {
  const glossaryPath = getGlossaryPath()
  if (!fs.existsSync(glossaryPath)) {
    writeGlossaryToPath(glossaryPath, [])
  }

  return glossaryPath
}

const readGlossary = (): GlossaryPayload => {
  const glossaryPath = ensureGlossaryFile()

  try {
    const raw = fs.readFileSync(glossaryPath, 'utf8')
    const entries = parseGlossaryRaw(raw)
    writeGlossaryToPath(glossaryPath, entries)
    return {
      path: glossaryPath,
      entries,
    }
  } catch {
    writeGlossaryToPath(glossaryPath, [])
    return {
      path: glossaryPath,
      entries: [],
    }
  }
}

const importGlossaryFromPath = (filePath: string): GlossaryPayload | null => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const entries = parseGlossaryRaw(raw)
    const glossaryPath = ensureGlossaryFile()
    writeGlossaryToPath(glossaryPath, entries)

    return {
      path: glossaryPath,
      entries,
    }
  } catch {
    return null
  }
}

const upsertGlossaryEntry = (raw: unknown): GlossaryPayload => {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid glossary payload')
  }

  const source = (raw as Partial<GlossaryEntryUpsertInput>).source
  const target = (raw as Partial<GlossaryEntryUpsertInput>).target
  if (typeof source !== 'string' || typeof target !== 'string') {
    throw new Error('Invalid glossary source or target')
  }

  const sourceText = source.trim()
  const targetText = target.trim()
  if (sourceText.length < 2 || targetText.length === 0) {
    throw new Error('Glossary source or target is empty')
  }

  const now = new Date().toISOString()
  const rawId = (raw as Partial<GlossaryEntryUpsertInput>).id
  const draftId = typeof rawId === 'string' && rawId.trim().length > 0 ? rawId.trim() : ''
  const matchType = normalizeGlossaryMatchType((raw as Partial<GlossaryEntryUpsertInput>).matchType, 'exact')
  const rawCaseInsensitive = (raw as Partial<GlossaryEntryUpsertInput>).caseInsensitive
  const caseInsensitive = typeof rawCaseInsensitive === 'boolean' ? rawCaseInsensitive : matchType === 'caseInsensitive'
  const rawNote = (raw as Partial<GlossaryEntryUpsertInput>).note
  const note = typeof rawNote === 'string' ? rawNote.trim() : ''
  const domain = normalizeGlossaryDomain((raw as Partial<GlossaryEntryUpsertInput>).domain)

  const draftEntry: GlossaryEntry = {
    id: draftId.length > 0 ? draftId : randomUUID(),
    source: sourceText,
    target: targetText,
    matchType,
    caseInsensitive,
    note,
    domain,
    createdAt: now,
    updatedAt: now,
    uiOnly:
      typeof (raw as Partial<GlossaryEntryUpsertInput>).uiOnly === 'boolean'
        ? (raw as Partial<GlossaryEntryUpsertInput>).uiOnly
        : undefined,
    wholeWord:
      typeof (raw as Partial<GlossaryEntryUpsertInput>).wholeWord === 'boolean'
        ? (raw as Partial<GlossaryEntryUpsertInput>).wholeWord
        : undefined,
  }

  const glossaryPath = ensureGlossaryFile()
  const current = readGlossary()
  const draftKey = buildGlossaryEntryKey(draftEntry)
  const existingById = draftId.length > 0 ? current.entries.find((entry) => entry.id === draftId) ?? null : null
  const existingByKey = current.entries.find((entry) => buildGlossaryEntryKey(entry) === draftKey) ?? null
  const existing = existingById ?? existingByKey

  const nextEntry: GlossaryEntry = {
    ...draftEntry,
    id: existing?.id ?? draftEntry.id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  const filtered = current.entries.filter((entry) => {
    if (existing && entry.id === existing.id) {
      return false
    }

    return buildGlossaryEntryKey(entry) !== draftKey
  })

  const nextEntries = normalizeGlossaryEntries([...filtered, nextEntry])
  writeGlossaryToPath(glossaryPath, nextEntries)

  return {
    path: glossaryPath,
    entries: nextEntries,
  }
}

const deleteGlossaryEntry = (raw: unknown): GlossaryPayload => {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid glossary delete payload')
  }

  const id = (raw as { id?: unknown }).id
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('Invalid glossary entry id')
  }

  const entryId = id.trim()
  const glossaryPath = ensureGlossaryFile()
  const current = readGlossary()
  const nextEntries = current.entries.filter((entry) => entry.id !== entryId)

  if (nextEntries.length === current.entries.length) {
    return {
      path: glossaryPath,
      entries: current.entries,
    }
  }

  writeGlossaryToPath(glossaryPath, nextEntries)
  return {
    path: glossaryPath,
    entries: nextEntries,
  }
}

const normalizeContextId = (value: string): string => {
  const normalized = value.trim().toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  return normalized.length > 0 ? normalized : 'shell'
}

const normalizeDetectHints = (hints: string[]): string[] => {
  const deduped = new Set<string>()
  for (const hint of hints) {
    const normalized = hint.trim().toLocaleLowerCase()
    if (normalized.length < 2) {
      continue
    }

    deduped.add(normalized)
  }

  return Array.from(deduped)
}

const defaultHintsByContextId = (contextId: string): string[] => {
  if (contextId === 'shell') {
    return ['zsh', 'bash', 'shell', '$ ', '% ', '# ', 'pwd', 'ls -']
  }

  if (contextId === 'opencode') {
    return ['opencode', 'ask anything', 'tip press', '/plan', '/task', '/help']
  }

  if (contextId === 'codex') {
    return ['codex', 'gpt-5.3-codex', '/apply_patch', '/check', '/help']
  }

  return []
}

const normalizeCommandContexts = (contexts: CommandContext[]): CommandContext[] => {
  const deduped = new Map<string, CommandContext>()

  for (const context of contexts) {
    const id = normalizeContextId(context.id)
    const label = context.label.trim()
    if (label.length === 0) {
      continue
    }

    deduped.set(id, {
      id,
      label,
      detectHints: normalizeDetectHints([...defaultHintsByContextId(id), ...context.detectHints]),
    })
  }

  if (!deduped.has('shell')) {
    deduped.set('shell', {
      id: 'shell',
      label: 'Shell',
      detectHints: defaultHintsByContextId('shell'),
    })
  }

  return Array.from(deduped.values())
}

const normalizeActionType = (value: unknown): CommandActionType => {
  if (value === 'sendKey' || value === 'sendAnsi' || value === 'sendText') {
    return value
  }

  return 'sendText'
}

const normalizeRisk = (value: unknown): CommandRisk => {
  if (value === 'caution' || value === 'destructive' || value === 'safe') {
    return value
  }

  return 'safe'
}

const normalizeCommandButtons = (buttons: CommandButton[], contextIds: Set<string>): CommandButton[] => {
  const normalized: CommandButton[] = []
  const usedIds = new Set<string>()

  for (const button of buttons) {
    const contextId = normalizeContextId(button.contextId)
    if (!contextIds.has(contextId)) {
      continue
    }

    const labelZh = button.labelZh.trim()
    const payload = button.payload
    if (labelZh.length === 0 || payload.length === 0) {
      continue
    }

    let id = button.id.trim()
    if (id.length === 0 || usedIds.has(id)) {
      id = `${contextId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    }

    usedIds.add(id)

    normalized.push({
      id,
      labelZh,
      actionType: normalizeActionType(button.actionType),
      payload,
      contextId,
      risk: normalizeRisk(button.risk),
      order: Number.isFinite(button.order) ? Math.max(1, Math.floor(button.order)) : normalized.length + 1,
    })
  }

  const grouped = new Map<string, CommandButton[]>()
  for (const button of normalized) {
    const bucket = grouped.get(button.contextId)
    if (bucket) {
      bucket.push(button)
      continue
    }

    grouped.set(button.contextId, [button])
  }

  const output: CommandButton[] = []
  for (const [contextId, group] of grouped.entries()) {
    group
      .sort((a, b) => {
        if (a.order !== b.order) {
          return a.order - b.order
        }

        return a.labelZh.localeCompare(b.labelZh)
      })
      .forEach((button, index) => {
        output.push({
          ...button,
          contextId,
          order: index + 1,
        })
      })
  }

  return output
}

const normalizeCommandConfig = (raw: unknown): CommandConfig => {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_COMMAND_CONFIG }
  }

  const source = raw as Partial<CommandConfig>
  const contextsInput = Array.isArray(source.contexts) ? source.contexts : DEFAULT_COMMAND_CONFIG.contexts
  const contexts = normalizeCommandContexts(
    contextsInput
      .map((context) => {
        if (typeof context !== 'object' || context === null) {
          return null
        }

        const id = (context as { id?: unknown }).id
        const label = (context as { label?: unknown }).label
        const detectHints = (context as { detectHints?: unknown }).detectHints
        if (typeof id !== 'string' || typeof label !== 'string') {
          return null
        }

        const hints = Array.isArray(detectHints)
          ? detectHints.filter((hint): hint is string => typeof hint === 'string')
          : []

        return { id, label, detectHints: hints }
      })
      .filter((item): item is CommandContext => item !== null),
  )

  const contextIds = new Set(contexts.map((context) => context.id))
  const buttonsInput = Array.isArray(source.buttons) ? source.buttons : DEFAULT_COMMAND_CONFIG.buttons
  const buttons = normalizeCommandButtons(
    buttonsInput
      .map((button) => {
        if (typeof button !== 'object' || button === null) {
          return null
        }

        const candidate = button as Partial<CommandButton>
        if (
          typeof candidate.labelZh !== 'string' ||
          typeof candidate.payload !== 'string' ||
          typeof candidate.contextId !== 'string'
        ) {
          return null
        }

        return {
          id: typeof candidate.id === 'string' ? candidate.id : '',
          labelZh: candidate.labelZh,
          actionType: normalizeActionType(candidate.actionType),
          payload: candidate.payload,
          contextId: candidate.contextId,
          risk: normalizeRisk(candidate.risk),
          order: typeof candidate.order === 'number' ? candidate.order : 0,
        }
      })
      .filter((item): item is CommandButton => item !== null),
    contextIds,
  )

  const defaultContextRaw =
    typeof source.defaultContextId === 'string' ? normalizeContextId(source.defaultContextId) : 'shell'
  const defaultContextId = contextIds.has(defaultContextRaw) ? defaultContextRaw : 'shell'

  return {
    version: 1,
    defaultContextId,
    contexts,
    buttons,
  }
}

const getContextsPath = (): string => {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), CONTEXTS_FILENAME)
  }

  return path.join(process.cwd(), CONTEXTS_FILENAME)
}

const writeContextsToPath = (filePath: string, config: CommandConfig): void => {
  fs.writeFileSync(filePath, `${JSON.stringify(normalizeCommandConfig(config), null, 2)}\n`, 'utf8')
}

const ensureContextsFile = (): string => {
  const contextsPath = getContextsPath()
  if (!fs.existsSync(contextsPath)) {
    writeContextsToPath(contextsPath, DEFAULT_COMMAND_CONFIG)
  }

  return contextsPath
}

const readCommandConfig = (): CommandConfigPayload => {
  const contextsPath = ensureContextsFile()
  try {
    const raw = fs.readFileSync(contextsPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    const config = normalizeCommandConfig(parsed)
    return { path: contextsPath, config }
  } catch {
    const config = normalizeCommandConfig(DEFAULT_COMMAND_CONFIG)
    writeContextsToPath(contextsPath, config)
    return { path: contextsPath, config }
  }
}

const saveCommandConfig = (raw: unknown): CommandConfigPayload => {
  const contextsPath = ensureContextsFile()
  const config = normalizeCommandConfig(raw)
  writeContextsToPath(contextsPath, config)
  return {
    path: contextsPath,
    config,
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  return value as Record<string, unknown>
}

const normalizeTranslationProvider = (
  value: unknown,
  fallback: TranslationProvider = DEFAULT_TRANSLATION_CONFIG.defaultProvider,
): TranslationProvider => {
  if (value === 'google-free' || value === 'openai-compatible' || value === 'tencent-tmt') {
    return value
  }

  return fallback
}

const normalizeProviderChain = (value: unknown): TranslationProvider[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized = value
    .map((item) => {
      if (item === 'google-free' || item === 'openai-compatible' || item === 'tencent-tmt') {
        return item
      }

      return null
    })
    .filter((item): item is TranslationProvider => item !== null)
    .filter((item, index, array) => array.indexOf(item) === index)

  return normalized
}

const normalizeUrl = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return fallback
  }

  try {
    const url = new URL(trimmed)
    if (url.protocol === 'http:') {
      url.protocol = 'https:'
    }

    return url.toString()
  } catch {
    return fallback
  }
}

const normalizeUrlList = (value: unknown, fallback: string[]): string[] => {
  const candidates = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
  const source = candidates.length > 0 ? candidates : fallback

  const normalized = source
    .map((item) => normalizeUrl(item, ''))
    .filter((item) => item.length > 0)

  if (normalized.length === 0) {
    return fallback
  }

  return Array.from(new Set(normalized))
}

const normalizeTimeoutMs = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  const rounded = Math.floor(value)
  if (rounded < 1500) {
    return 1500
  }

  if (rounded > 60000) {
    return 60000
  }

  return rounded
}

const normalizePositiveInt = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  const rounded = Math.floor(value)
  if (rounded < 0) {
    return fallback
  }

  return rounded
}

const normalizeTranslationConfig = (raw: unknown): TranslationConfig => {
  const root = asRecord(raw)
  const providers = asRecord(root?.providers)
  const googleFree = asRecord(providers?.googleFree)
  const openaiCompatible = asRecord(providers?.openaiCompatible)
  const tencentTmt = asRecord(providers?.tencentTmt)

  const defaultProvider = normalizeTranslationProvider(root?.defaultProvider)
  const fallbackProviders = normalizeProviderChain(root?.fallbackProviders).filter(
    (provider) => provider !== defaultProvider,
  )
  const timeoutMs = normalizeTimeoutMs(root?.timeoutMs, DEFAULT_TRANSLATION_CONFIG.timeoutMs)
  const mirrorRoot = asRecord(root?.mirror)
  const skipRoot = asRecord(mirrorRoot?.skipRules)
  const rawPriority = Array.isArray(mirrorRoot?.localMatchPriority) ? mirrorRoot?.localMatchPriority : []
  const localMatchPriority: MatchStrategy[] = []
  for (const item of rawPriority) {
    if (item !== 'exact' && item !== 'caseInsensitive' && item !== 'pattern') {
      continue
    }
    if (!localMatchPriority.includes(item)) {
      localMatchPriority.push(item)
    }
  }
  for (const fallback of DEFAULT_TRANSLATION_CONFIG.mirror.localMatchPriority) {
    if (!localMatchPriority.includes(fallback)) {
      localMatchPriority.push(fallback)
    }
  }
  const mirror: TranslationMirrorPolicy = {
    skipRules: {
      stackLike:
        typeof skipRoot?.stackLike === 'boolean'
          ? skipRoot.stackLike
          : DEFAULT_TRANSLATION_CONFIG.mirror.skipRules.stackLike,
      symbolOnly:
        typeof skipRoot?.symbolOnly === 'boolean'
          ? skipRoot.symbolOnly
          : DEFAULT_TRANSLATION_CONFIG.mirror.skipRules.symbolOnly,
      protectedOnly:
        typeof skipRoot?.protectedOnly === 'boolean'
          ? skipRoot.protectedOnly
          : DEFAULT_TRANSLATION_CONFIG.mirror.skipRules.protectedOnly,
      outOfViewport:
        typeof skipRoot?.outOfViewport === 'boolean'
          ? skipRoot.outOfViewport
          : DEFAULT_TRANSLATION_CONFIG.mirror.skipRules.outOfViewport,
    },
    localMatchPriority,
    fallbackUiOnly:
      typeof mirrorRoot?.fallbackUiOnly === 'boolean'
        ? mirrorRoot.fallbackUiOnly
        : DEFAULT_TRANSLATION_CONFIG.mirror.fallbackUiOnly,
  }
  const googleEndpoint = normalizeUrl(googleFree?.endpoint, DEFAULT_TRANSLATION_CONFIG.providers.googleFree.endpoint)
  const googleEndpoints = normalizeUrlList(
    googleFree?.endpoints,
    DEFAULT_TRANSLATION_CONFIG.providers.googleFree.endpoints,
  )
  if (!googleEndpoints.includes(googleEndpoint)) {
    googleEndpoints.unshift(googleEndpoint)
  }
  const openaiBaseUrl = normalizeUrl(
    openaiCompatible?.baseUrl,
    DEFAULT_TRANSLATION_CONFIG.providers.openaiCompatible.baseUrl,
  )

  const modelRaw = openaiCompatible?.model
  const model =
    typeof modelRaw === 'string' && modelRaw.trim().length > 0
      ? modelRaw.trim()
      : DEFAULT_TRANSLATION_CONFIG.providers.openaiCompatible.model

  const apiKeyEnvRaw = openaiCompatible?.apiKeyEnv
  const apiKeyEnv =
    typeof apiKeyEnvRaw === 'string' && apiKeyEnvRaw.trim().length > 0
      ? apiKeyEnvRaw.trim()
      : DEFAULT_TRANSLATION_CONFIG.providers.openaiCompatible.apiKeyEnv
  const openaiApiKeyRaw = openaiCompatible?.apiKey
  const openaiApiKey =
    typeof openaiApiKeyRaw === 'string' && openaiApiKeyRaw.trim().length > 0 ? openaiApiKeyRaw.trim() : undefined

  const tencentEndpoint = normalizeUrl(
    tencentTmt?.endpoint,
    DEFAULT_TRANSLATION_CONFIG.providers.tencentTmt.endpoint,
  )
  const regionRaw = tencentTmt?.region
  const tencentRegion =
    typeof regionRaw === 'string' && regionRaw.trim().length > 0
      ? regionRaw.trim()
      : DEFAULT_TRANSLATION_CONFIG.providers.tencentTmt.region
  const sourceRaw = tencentTmt?.source
  const tencentSource =
    typeof sourceRaw === 'string' && sourceRaw.trim().length > 0
      ? sourceRaw.trim()
      : DEFAULT_TRANSLATION_CONFIG.providers.tencentTmt.source
  const targetRaw = tencentTmt?.target
  const tencentTarget =
    typeof targetRaw === 'string' && targetRaw.trim().length > 0
      ? targetRaw.trim()
      : DEFAULT_TRANSLATION_CONFIG.providers.tencentTmt.target
  const tencentProjectId = normalizePositiveInt(
    tencentTmt?.projectId,
    DEFAULT_TRANSLATION_CONFIG.providers.tencentTmt.projectId,
  )
  const secretIdEnvRaw = tencentTmt?.secretIdEnv
  const secretIdEnv =
    typeof secretIdEnvRaw === 'string' && secretIdEnvRaw.trim().length > 0
      ? secretIdEnvRaw.trim()
      : DEFAULT_TRANSLATION_CONFIG.providers.tencentTmt.secretIdEnv
  const secretKeyEnvRaw = tencentTmt?.secretKeyEnv
  const secretKeyEnv =
    typeof secretKeyEnvRaw === 'string' && secretKeyEnvRaw.trim().length > 0
      ? secretKeyEnvRaw.trim()
      : DEFAULT_TRANSLATION_CONFIG.providers.tencentTmt.secretKeyEnv
  const secretIdRaw = tencentTmt?.secretId
  const secretId = typeof secretIdRaw === 'string' && secretIdRaw.trim().length > 0 ? secretIdRaw.trim() : undefined
  const secretKeyRaw = tencentTmt?.secretKey
  const secretKey =
    typeof secretKeyRaw === 'string' && secretKeyRaw.trim().length > 0 ? secretKeyRaw.trim() : undefined

  return {
    version: 1,
    defaultProvider,
    fallbackProviders,
    timeoutMs,
    mirror,
    providers: {
      googleFree: {
        endpoint: googleEndpoint,
        endpoints: googleEndpoints,
      },
      openaiCompatible: {
        baseUrl: openaiBaseUrl,
        model,
        apiKeyEnv,
        apiKey: openaiApiKey,
      },
      tencentTmt: {
        endpoint: tencentEndpoint,
        region: tencentRegion,
        source: tencentSource,
        target: tencentTarget,
        projectId: tencentProjectId,
        secretIdEnv,
        secretKeyEnv,
        secretId,
        secretKey,
      },
    },
  }
}

const getTranslationConfigPath = (): string => {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), TRANSLATION_CONFIG_FILENAME)
  }

  return path.join(process.cwd(), TRANSLATION_CONFIG_FILENAME)
}

const getTranslationConfigLocalPath = (): string => {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), TRANSLATION_CONFIG_LOCAL_FILENAME)
  }

  return path.join(process.cwd(), TRANSLATION_CONFIG_LOCAL_FILENAME)
}

const mergeTranslationConfigRaw = (baseRaw: unknown, localRaw: unknown): unknown => {
  const base = asRecord(baseRaw) ?? {}
  const local = asRecord(localRaw)
  if (!local) {
    return base
  }

  const baseProviders = asRecord(base.providers) ?? {}
  const localProviders = asRecord(local.providers) ?? {}

  return {
    ...base,
    ...local,
    providers: {
      ...baseProviders,
      ...localProviders,
      googleFree: {
        ...(asRecord(baseProviders.googleFree) ?? {}),
        ...(asRecord(localProviders.googleFree) ?? {}),
      },
      openaiCompatible: {
        ...(asRecord(baseProviders.openaiCompatible) ?? {}),
        ...(asRecord(localProviders.openaiCompatible) ?? {}),
      },
      tencentTmt: {
        ...(asRecord(baseProviders.tencentTmt) ?? {}),
        ...(asRecord(localProviders.tencentTmt) ?? {}),
      },
    },
  }
}

const readTranslationConfigLocalRaw = (): unknown | null => {
  const localPath = getTranslationConfigLocalPath()
  if (!fs.existsSync(localPath)) {
    return null
  }

  try {
    const raw = fs.readFileSync(localPath, 'utf8')
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

const writeTranslationConfigToPath = (filePath: string, config: TranslationConfig): void => {
  const normalized = normalizeTranslationConfig(config)
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
}

const ensureTranslationConfigFile = (): string => {
  const configPath = getTranslationConfigPath()
  if (!fs.existsSync(configPath)) {
    writeTranslationConfigToPath(configPath, DEFAULT_TRANSLATION_CONFIG)
  }

  return configPath
}

const readTranslationConfig = (): TranslationConfigPayload => {
  const configPath = ensureTranslationConfigFile()
  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsedBase = JSON.parse(raw) as unknown
    const baseConfig = normalizeTranslationConfig(parsedBase)
    writeTranslationConfigToPath(configPath, baseConfig)
    const localRaw = readTranslationConfigLocalRaw()
    const mergedConfig = localRaw ? normalizeTranslationConfig(mergeTranslationConfigRaw(baseConfig, localRaw)) : baseConfig
    return { path: configPath, config: mergedConfig }
  } catch {
    const baseConfig = normalizeTranslationConfig(DEFAULT_TRANSLATION_CONFIG)
    writeTranslationConfigToPath(configPath, baseConfig)
    const localRaw = readTranslationConfigLocalRaw()
    const mergedConfig = localRaw ? normalizeTranslationConfig(mergeTranslationConfigRaw(baseConfig, localRaw)) : baseConfig
    return { path: configPath, config: mergedConfig }
  }
}

const saveTranslationConfig = (raw: unknown): TranslationConfigPayload => {
  const configPath = ensureTranslationConfigFile()
  const config = normalizeTranslationConfig(raw)
  writeTranslationConfigToPath(configPath, config)
  return {
    path: configPath,
    config,
  }
}

const parseGoogleTranslateResponse = (raw: unknown): string => {
  if (!Array.isArray(raw) || raw.length === 0 || !Array.isArray(raw[0])) {
    throw new Error('Unexpected Google response format')
  }

  const translated = (raw[0] as unknown[])
    .map((part) => {
      if (!Array.isArray(part) || part.length === 0) {
        return ''
      }

      const value = part[0]
      return typeof value === 'string' ? value : ''
    })
    .join('')

  if (translated.length === 0) {
    throw new Error('Google translation result is empty')
  }

  return translated
}

const parseOpenAiTranslation = (raw: unknown): string => {
  const root = asRecord(raw)
  const choices = root?.choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('OpenAI response missing choices')
  }

  const first = asRecord(choices[0])
  const message = asRecord(first?.message)
  const content = message?.content

  if (typeof content === 'string' && content.trim().length > 0) {
    return content.trim()
  }

  if (Array.isArray(content)) {
    const chunks = content
      .map((item) => {
        const chunk = asRecord(item)
        const type = chunk?.type
        const text = chunk?.text
        if (type === 'text' && typeof text === 'string') {
          return text
        }

        return ''
      })
      .join('')
      .trim()

    if (chunks.length > 0) {
      return chunks
    }
  }

  throw new Error('OpenAI response missing translated content')
}

const toTencentLanguageCode = (language: string, fallback: string): string => {
  const normalized = language.trim().toLocaleLowerCase()
  if (normalized.length === 0) {
    return fallback
  }

  if (normalized === 'zh' || normalized === 'zh-cn' || normalized === 'zh-hans') {
    return 'zh'
  }

  if (normalized === 'zh-tw' || normalized === 'zh-hant') {
    return 'zh-TW'
  }

  if (normalized === 'en' || normalized === 'en-us' || normalized === 'en-gb') {
    return 'en'
  }

  return language
}

const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')

const hmacSha256 = (key: Buffer | string, value: string): Buffer =>
  createHmac('sha256', key).update(value, 'utf8').digest()

const hmacSha256Hex = (key: Buffer | string, value: string): string =>
  createHmac('sha256', key).update(value, 'utf8').digest('hex')

const fetchJsonWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> => {
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    })
    if (!response.ok) {
      const fallbackMessage = `HTTP ${response.status}`
      let detail = fallbackMessage
      try {
        detail = (await response.text()).trim() || fallbackMessage
      } catch {
        detail = fallbackMessage
      }
      throw new Error(detail)
    }

    const bodyText = await response.text()
    if (bodyText.trim().length === 0) {
      throw new Error('Empty JSON response body')
    }

    try {
      return JSON.parse(bodyText) as unknown
    } catch {
      const stripped = bodyText.replace(/^\)\]\}'\s*/, '')
      try {
        return JSON.parse(stripped) as unknown
      } catch {
        const preview = stripped.slice(0, 160).replace(/\s+/g, ' ')
        throw new Error(`Invalid JSON response: ${preview}`)
      }
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`Translation request timeout (${timeoutMs}ms)`)
    }

    const message = (error as Error).message
    if (typeof message === 'string' && message.trim().length > 0) {
      throw new Error(message.trim())
    }

    throw new Error('Unknown translation request error')
  } finally {
    clearTimeout(timeoutHandle)
  }
}

const translateWithGoogleFree = async (
  text: string,
  sourceLang: string,
  targetLang: string,
  config: TranslationConfig,
  timeoutMs: number,
): Promise<string> => {
  const endpointCandidates = Array.from(
    new Set([config.providers.googleFree.endpoint, ...config.providers.googleFree.endpoints]),
  )

  const errors: string[] = []
  for (const endpoint of endpointCandidates) {
    try {
      const requestUrl = new URL(endpoint)
      requestUrl.searchParams.set('client', 'gtx')
      requestUrl.searchParams.set('sl', sourceLang)
      requestUrl.searchParams.set('tl', targetLang)
      requestUrl.searchParams.set('dt', 't')
      requestUrl.searchParams.set('q', text)

      const payload = await fetchJsonWithTimeout(requestUrl.toString(), { method: 'GET' }, timeoutMs)
      return parseGoogleTranslateResponse(payload)
    } catch (error) {
      const message = (error as Error).message
      const detail = typeof message === 'string' && message.trim().length > 0 ? message.trim() : 'unknown error'
      errors.push(`${endpoint} -> ${detail}`)
    }
  }

  throw new Error(`Google free translation failed: ${errors.join(' | ')}`)
}

const translateWithOpenAiCompatible = async (
  request: OnlineTranslateRequest,
  sourceLang: string,
  targetLang: string,
  config: TranslationConfig,
  timeoutMs: number,
): Promise<string> => {
  const providerConfig = config.providers.openaiCompatible
  const baseUrl = normalizeUrl(request.baseUrl, providerConfig.baseUrl).replace(/\/+$/, '')
  const apiKey =
    typeof request.apiKey === 'string' && request.apiKey.trim().length > 0
      ? request.apiKey.trim()
      : providerConfig.apiKey ?? process.env[providerConfig.apiKeyEnv] ?? ''

  if (apiKey.length === 0) {
    throw new Error(`Missing API key: request.apiKey or env ${providerConfig.apiKeyEnv}`)
  }

  const model =
    typeof request.model === 'string' && request.model.trim().length > 0
      ? request.model.trim()
      : providerConfig.model

  const body = {
    model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are a translation engine. Translate the user text faithfully and keep code, paths, URLs, flags, prompts, and placeholders unchanged. Return only the translated text.',
      },
      {
        role: 'user',
        content: `Source language: ${sourceLang}\nTarget language: ${targetLang}\n\n${request.text}`,
      },
    ],
  }

  const payload = await fetchJsonWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
  )

  return parseOpenAiTranslation(payload)
}

const translateWithTencentTmt = async (
  request: OnlineTranslateRequest,
  sourceLang: string,
  targetLang: string,
  config: TranslationConfig,
  timeoutMs: number,
): Promise<string> => {
  const providerConfig = config.providers.tencentTmt
  const endpoint = normalizeUrl(request.baseUrl, providerConfig.endpoint)
  const endpointUrl = new URL(endpoint)
  const host = endpointUrl.host
  const region =
    typeof request.region === 'string' && request.region.trim().length > 0
      ? request.region.trim()
      : providerConfig.region

  const source = toTencentLanguageCode(sourceLang, providerConfig.source)
  const target = toTencentLanguageCode(targetLang, providerConfig.target)
  const projectId = normalizePositiveInt(request.projectId, providerConfig.projectId)

  const secretId =
    typeof request.secretId === 'string' && request.secretId.trim().length > 0
      ? request.secretId.trim()
      : providerConfig.secretId ?? process.env[providerConfig.secretIdEnv] ?? ''
  const secretKey =
    typeof request.secretKey === 'string' && request.secretKey.trim().length > 0
      ? request.secretKey.trim()
      : providerConfig.secretKey ?? process.env[providerConfig.secretKeyEnv] ?? ''

  if (secretId.length === 0 || secretKey.length === 0) {
    throw new Error(
      `Missing Tencent credentials: tencentTmt.secretId/secretKey or env ${providerConfig.secretIdEnv}/${providerConfig.secretKeyEnv}`,
    )
  }

  const action = 'TextTranslate'
  const version = '2018-03-21'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)

  const payload = JSON.stringify({
    SourceText: request.text,
    Source: source,
    Target: target,
    ProjectId: projectId,
  })
  const hashedRequestPayload = sha256Hex(payload)

  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLocaleLowerCase()}\n`
  const signedHeaders = 'content-type;host;x-tc-action'
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedRequestPayload}`

  const credentialScope = `${date}/tmt/tc3_request`
  const hashedCanonicalRequest = sha256Hex(canonicalRequest)
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`

  const secretDate = hmacSha256(`TC3${secretKey}`, date)
  const secretService = hmacSha256(secretDate, 'tmt')
  const secretSigning = hmacSha256(secretService, 'tc3_request')
  const signature = hmacSha256Hex(secretSigning, stringToSign)

  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const responsePayload = await fetchJsonWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json; charset=utf-8',
        Host: host,
        'X-TC-Action': action,
        'X-TC-Version': version,
        'X-TC-Region': region,
        'X-TC-Timestamp': String(timestamp),
      },
      body: payload,
    },
    timeoutMs,
  )

  const root = asRecord(responsePayload)
  const response = asRecord(root?.Response)
  if (!response) {
    throw new Error('Tencent TMT response format invalid')
  }

  const errorObject = asRecord(response.Error)
  if (errorObject) {
    const code = typeof errorObject.Code === 'string' ? errorObject.Code : 'UnknownError'
    const message = typeof errorObject.Message === 'string' ? errorObject.Message : 'Unknown Tencent error'
    throw new Error(`${code}: ${message}`)
  }

  const translated = response.TargetText
  if (typeof translated !== 'string' || translated.trim().length === 0) {
    throw new Error('Tencent TMT returned empty translation')
  }

  return translated
}

const translateOnline = async (raw: unknown): Promise<OnlineTranslateResult> => {
  const requestRecord = asRecord(raw)
  if (!requestRecord) {
    throw new Error('Invalid translate request payload')
  }

  const textRaw = requestRecord.text
  if (typeof textRaw !== 'string') {
    throw new Error('Invalid translate request: text is required')
  }

  if (textRaw.length === 0) {
    return {
      translatedText: '',
      provider: DEFAULT_TRANSLATION_CONFIG.defaultProvider,
    }
  }

  const request: OnlineTranslateRequest = {
    text: textRaw,
    sourceLang: typeof requestRecord.sourceLang === 'string' ? requestRecord.sourceLang : undefined,
    targetLang: typeof requestRecord.targetLang === 'string' ? requestRecord.targetLang : undefined,
    provider: typeof requestRecord.provider === 'string' ? (requestRecord.provider as TranslationProvider) : undefined,
    timeoutMs: typeof requestRecord.timeoutMs === 'number' ? requestRecord.timeoutMs : undefined,
    baseUrl: typeof requestRecord.baseUrl === 'string' ? requestRecord.baseUrl : undefined,
    model: typeof requestRecord.model === 'string' ? requestRecord.model : undefined,
    apiKey: typeof requestRecord.apiKey === 'string' ? requestRecord.apiKey : undefined,
    secretId: typeof requestRecord.secretId === 'string' ? requestRecord.secretId : undefined,
    secretKey: typeof requestRecord.secretKey === 'string' ? requestRecord.secretKey : undefined,
    region: typeof requestRecord.region === 'string' ? requestRecord.region : undefined,
    projectId: typeof requestRecord.projectId === 'number' ? requestRecord.projectId : undefined,
  }

  const config = readTranslationConfig().config
  const requestedProvider = request.provider
    ? normalizeTranslationProvider(request.provider, config.defaultProvider)
    : null
  const primaryProvider = requestedProvider ?? config.defaultProvider
  const configuredFallbacks = (config.fallbackProviders ?? []).filter((provider) => provider !== primaryProvider)
  const providerChain = [primaryProvider, ...configuredFallbacks].filter(
    (provider, index, array) => array.indexOf(provider) === index,
  )

  const timeoutMs = normalizeTimeoutMs(request.timeoutMs, config.timeoutMs)

  const buildSourceLang = (provider: TranslationProvider): string => {
    if (typeof request.sourceLang === 'string' && request.sourceLang.trim().length > 0) {
      return request.sourceLang.trim()
    }

    if (provider === 'tencent-tmt') {
      return config.providers.tencentTmt.source
    }

    return 'en'
  }

  const buildTargetLang = (provider: TranslationProvider): string => {
    if (typeof request.targetLang === 'string' && request.targetLang.trim().length > 0) {
      return request.targetLang.trim()
    }

    if (provider === 'tencent-tmt') {
      return config.providers.tencentTmt.target
    }

    return 'zh-CN'
  }

  const errors: string[] = []
  for (const provider of providerChain) {
    const sourceLang = buildSourceLang(provider)
    const targetLang = buildTargetLang(provider)

    try {
      const translatedText =
        provider === 'openai-compatible'
          ? await translateWithOpenAiCompatible(request, sourceLang, targetLang, config, timeoutMs)
          : provider === 'tencent-tmt'
            ? await translateWithTencentTmt(request, sourceLang, targetLang, config, timeoutMs)
            : await translateWithGoogleFree(request.text, sourceLang, targetLang, config, timeoutMs)

      return {
        translatedText,
        provider,
      }
    } catch (error) {
      const message = (error as Error).message
      const detail = typeof message === 'string' && message.trim().length > 0 ? message.trim() : 'unknown error'
      errors.push(`${provider} translation failed: ${detail}`)
    }
  }

  throw new Error(errors.join(' | '))
}

const getDefaultShell = (): string => {
  if (process.platform === 'win32') {
    const candidates = [
      process.env.COMSPEC,
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'pwsh.exe',
    ]

    for (const shell of candidates) {
      if (!shell) {
        continue
      }

      if (shell.endsWith('.exe') && shell.includes('\\')) {
        if (fs.existsSync(shell)) {
          return shell
        }
      } else {
        return shell
      }
    }

    return 'pwsh.exe'
  }

  const candidates = [
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
    '/usr/bin/zsh',
    '/usr/bin/bash',
    'zsh',
    'bash',
  ]

  for (const shell of candidates) {
    if (!shell) {
      continue
    }

    if (shell.startsWith('/')) {
      if (fs.existsSync(shell)) {
        return shell
      }
      continue
    }

    return shell
  }

  return '/bin/zsh'
}

const getShellArgs = (): string[] => {
  if (process.platform === 'win32') {
    return ['-NoLogo']
  }

  return ['-l']
}

const stripTelnetIac = (input: Buffer, socket: net.Socket): Buffer => {
  const out: number[] = []
  let index = 0
  while (index < input.length) {
    const byte = input[index]
    if (byte !== 255) {
      out.push(byte)
      index += 1
      continue
    }
    if (index + 1 >= input.length) {
      break
    }
    const cmd = input[index + 1]
    if (cmd === 255) {
      out.push(255)
      index += 2
      continue
    }
    if (cmd === 250) {
      index += 2
      while (index + 1 < input.length) {
        if (input[index] === 255 && input[index + 1] === 240) {
          index += 2
          break
        }
        index += 1
      }
      continue
    }
    if (index + 2 >= input.length) {
      break
    }
    const option = input[index + 2]
    // Reply with conservative negotiation: reject remote capability changes.
    if (cmd === 251 || cmd === 252) {
      socket.write(Buffer.from([255, 254, option]))
    } else if (cmd === 253 || cmd === 254) {
      socket.write(Buffer.from([255, 252, option]))
    }
    index += 3
  }
  return Buffer.from(out)
}

const spawnPty = (tabId: string, cols = 120, rows = 40): void => {
  closeLocalSocketSession(tabId)
  ptySessions.get(tabId)?.kill()

  const shell = getDefaultShell()
  const session = pty.spawn(shell, getShellArgs(), {
    cols,
    rows,
    cwd: os.homedir(),
    env: process.env as Record<string, string>,
    name: process.platform === 'win32' ? 'xterm-256color' : 'xterm-256color',
  })
  ptySessions.set(tabId, session)

  session.onData((data) => {
    mainWindow?.webContents.send('pty:data', { tabId, data })
  })

  session.onExit(({ exitCode }) => {
    mainWindow?.webContents.send('pty:exit', { tabId, exitCode })
    const active = ptySessions.get(tabId)
    if (active === session) {
      ptySessions.delete(tabId)
    }
  })
}

const connectLocalSocket = async (
  tabId: string,
  host: string,
  port: number,
  protocol: LocalSessionProtocol,
): Promise<boolean> => {
  if (host.trim().length === 0 || !Number.isFinite(port)) {
    return false
  }
  ptySessions.get(tabId)?.kill()
  ptySessions.delete(tabId)
  closeLocalSocketSession(tabId)

  const socket = new net.Socket()
  socket.setNoDelay(true)
  localSocketSessions.set(tabId, { protocol, socket })

  const ok = await new Promise<boolean>((resolve) => {
    let settled = false
    const finalize = (value: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(value)
    }

    socket.once('connect', () => {
      mainWindow?.webContents.send('pty:data', {
        tabId,
        data: `\r\n[local ${protocol} connected ${host}:${port}]\r\n`,
      })
      finalize(true)
    })
    socket.once('error', (error) => {
      mainWindow?.webContents.send('pty:data', {
        tabId,
        data: `\r\n[local ${protocol} connect failed: ${(error as Error).message}]\r\n`,
      })
      finalize(false)
    })
    socket.connect(port, host)
  })

  if (!ok) {
    closeLocalSocketSession(tabId)
    return false
  }

  socket.on('data', (chunk: Buffer) => {
    const payload = protocol === 'telnet' ? stripTelnetIac(chunk, socket) : chunk
    if (payload.length === 0) {
      return
    }
    mainWindow?.webContents.send('pty:data', { tabId, data: payload.toString('utf8') })
  })
  socket.on('error', (error) => {
    mainWindow?.webContents.send('pty:data', {
      tabId,
      data: `\r\n[local ${protocol} error: ${(error as Error).message}]\r\n`,
    })
  })
  socket.on('close', () => {
    const active = localSocketSessions.get(tabId)
    if (active && active.socket === socket) {
      localSocketSessions.delete(tabId)
    }
    mainWindow?.webContents.send('pty:exit', { tabId, exitCode: 0 })
  })
  return true
}

const killPty = (tabId: string): boolean => {
  const closedSocket = closeLocalSocketSession(tabId)
  const session = ptySessions.get(tabId)
  if (!session) {
    return closedSocket
  }

  session.kill()
  ptySessions.delete(tabId)
  return true
}

const killAllPtySessions = (): void => {
  for (const session of ptySessions.values()) {
    session.kill()
  }
  ptySessions.clear()
  for (const [tabId] of localSocketSessions) {
    closeLocalSocketSession(tabId)
  }
}

const createWindow = async (): Promise<void> => {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    title: 'termbridge-v2',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  ipcMain.on('pty:write', (_event: unknown, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return
    }

    const input = payload as { tabId?: unknown; data?: unknown }
    if (typeof input.tabId !== 'string' || typeof input.data !== 'string') {
      return
    }

    writeToSession(input.tabId, input.data)
  })

  ipcMain.handle('pty:spawn', (_event: unknown, tabId: string, cols: number, rows: number) => {
    if (typeof tabId !== 'string' || tabId.length === 0) {
      return false
    }

    try {
      spawnPty(tabId, cols, rows)
      return true
    } catch (error) {
      mainWindow?.webContents.send('pty:data', {
        tabId,
        data: `\r\n[pty spawn failed: ${(error as Error).message}]\r\n`,
      })
      return false
    }
  })

  ipcMain.handle('pty:write', (_event: unknown, tabId: string, data: string) => {
    if (typeof tabId !== 'string' || tabId.length === 0 || typeof data !== 'string') {
      return false
    }
    writeToSession(tabId, data)
    return true
  })

  ipcMain.handle('session:connectLocal', async (
    _event: unknown,
    tabId: string,
    host: string,
    port: number,
    protocol: LocalSessionProtocol,
  ) => {
    if (typeof tabId !== 'string' || tabId.length === 0) {
      return false
    }
    if (typeof host !== 'string' || host.trim().length === 0) {
      return false
    }
    if (typeof port !== 'number' || !Number.isFinite(port)) {
      return false
    }
    if (protocol !== 'telnet' && protocol !== 'raw') {
      return false
    }
    return connectLocalSocket(tabId, host.trim(), Math.floor(port), protocol)
  })

  ipcMain.handle('pty:resize', (_event: unknown, tabId: string, cols: number, rows: number) => {
    if (typeof tabId !== 'string' || tabId.length === 0) {
      return false
    }

    const session = ptySessions.get(tabId)
    if (!session) {
      if (localSocketSessions.has(tabId)) {
        return true
      }
      return false
    }
    session.resize(cols, rows)
    return true
  })

  ipcMain.handle('pty:kill', (_event: unknown, tabId: string) => {
    if (typeof tabId !== 'string' || tabId.length === 0) {
      return false
    }
    return killPty(tabId)
  })

  ipcMain.handle('glossary:load', () => {
    return readGlossary()
  })

  ipcMain.handle('glossary:reload', () => {
    return readGlossary()
  })

  ipcMain.handle('glossary:import', async () => {
    const dialogOptions: OpenDialogOptions = {
      title: 'Import glossary.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return importGlossaryFromPath(result.filePaths[0])
  })

  ipcMain.handle('glossary:export', async () => {
    const payload = readGlossary()
    const dialogOptions: SaveDialogOptions = {
      title: 'Export glossary.json',
      defaultPath: path.join(path.dirname(payload.path), 'glossary.export.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    }
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)

    if (result.canceled || !result.filePath) {
      return false
    }

    writeGlossaryToPath(result.filePath, payload.entries)
    return true
  })

  ipcMain.handle('glossary:upsert', (_event: unknown, entry: unknown) => {
    return upsertGlossaryEntry(entry)
  })

  ipcMain.handle('glossary:delete', (_event: unknown, payload: unknown) => {
    return deleteGlossaryEntry(payload)
  })

  ipcMain.handle('translate:loadConfig', () => {
    return readTranslationConfig()
  })

  ipcMain.handle('translate:saveConfig', (_event: unknown, nextConfig: unknown) => {
    return saveTranslationConfig(nextConfig)
  })

  ipcMain.handle('translate:online', async (_event: unknown, request: unknown) => {
    return translateOnline(request)
  })

  ipcMain.handle('contexts:load', () => {
    return readCommandConfig()
  })

  ipcMain.handle('contexts:reload', () => {
    return readCommandConfig()
  })

  ipcMain.handle('contexts:save', (_event: unknown, nextConfig: unknown) => {
    return saveCommandConfig(nextConfig)
  })

  ipcMain.handle('logs:exportSession', async (_event: unknown, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return null
    }

    const request = payload as Partial<SessionLogExportRequest>
    const tabId = typeof request.tabId === 'string' ? request.tabId.trim() : ''
    const tabTitle = typeof request.tabTitle === 'string' ? request.tabTitle.trim() : ''
    const sessionName = typeof request.sessionName === 'string' ? request.sessionName.trim() : ''
    const cleanText = typeof request.cleanText === 'string' ? request.cleanText : ''
    const jsonl = typeof request.jsonl === 'string' ? request.jsonl : ''
    if (tabId.length === 0 || cleanText.length === 0 || jsonl.length === 0) {
      return null
    }

    const slug = (sessionName || tabTitle || tabId)
      .toLocaleLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    const safeSlug = slug.length > 0 ? slug : tabId
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const defaultBase = `session-log-${safeSlug}-${timestamp}`
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, {
          title: 'Export Session Log',
          defaultPath: path.join(os.homedir(), `${defaultBase}.txt`),
          filters: [{ name: 'Text', extensions: ['txt'] }],
        })
      : await dialog.showSaveDialog({
          title: 'Export Session Log',
          defaultPath: path.join(os.homedir(), `${defaultBase}.txt`),
          filters: [{ name: 'Text', extensions: ['txt'] }],
        })

    if (result.canceled || !result.filePath) {
      return null
    }

    const txtPath = result.filePath
    const jsonlPath =
      txtPath.toLocaleLowerCase().endsWith('.txt') ? `${txtPath.slice(0, -4)}.jsonl` : `${txtPath}.jsonl`
    fs.writeFileSync(txtPath, cleanText, 'utf8')
    fs.writeFileSync(jsonlPath, jsonl, 'utf8')

    return {
      txtPath,
      jsonlPath,
    }
  })

  void createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  killAllPtySessions()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
