import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Terminal } from '@xterm/xterm'
import { createXterm, resolveXtermTheme } from '../terminal/createXterm'
import { ptyClient } from '../terminal/ptyClient'
import { buildBufferSnapshot } from '../mirror/BufferSnapshot'
import {
  buildTranslationPatches,
  DEFAULT_TRANSLATION_POLICY,
  findLocalGlossaryMatch,
  normalizeTranslationPolicy,
  findSelectionProtectedRanges,
  translateSelectionText,
  type ProtectedRange,
  type SelectionTranslationSource,
  type TranslationPolicy,
} from '../mirror/TranslateEngine'
import { applyInlinePatches } from '../mirror/PatchApply'
import type { GlossaryDomain, GlossaryEntry, GlossaryEntryUpsertInput } from '../mirror/GlossaryTypes'
import { MarkerLayer } from '../mirror/MarkerLayer'
import { MirrorRenderer } from '../mirror/MirrorRenderer'
import { LeftHighlightOverlay } from '../mirror/LeftHighlightOverlay'
import { createEmptyScreen, type DebugStats, type Marker, type Screen } from '../mirror/GridModel'
import { GlossaryManagerModal } from './GlossaryManagerModal'
import { TranslationStrategyPanel } from './TranslationStrategyPanel'
import { DebugToggle } from '../debug/DebugToggle'
import { TERMINAL_DISPLAY } from '../terminal/displayConfig'
import { CommandToolbar } from '../commands/CommandToolbar'
import { CommandSearchPanel } from '../commands/CommandSearchPanel'
import type { CommandConfig, CommandContext } from '../commands/types'
import { normalizeCommandConfig } from '../commands/utils'
import { AutomationPanel } from '../automation/AutomationPanel'
import { SettingsPanel, type AppSettings, type SyntaxHighlightRule } from './SettingsPanel'
import { SessionManagerPanel } from '../sessions/SessionManagerPanel'
import {
  DEFAULT_AUTOMATION_CONFIG,
  normalizeAutomationStorage,
  type AutomationConfig,
  type AutomationGroup,
  type AutomationScript,
} from '../automation/catalog'
import {
  DEFAULT_COMMAND_CATALOG_CONFIG,
  createCatalogEntryId,
  normalizeCatalogConfig,
  type CommandCatalogConfig,
  type CommandCatalogEntry,
  type CommandCatalogGroup,
  type CommandCatalogRisk,
} from '../commands/catalog'
import {
  DEFAULT_SESSION_CATALOG_CONFIG,
  createGroupId,
  generateLocalPortPackSessions,
  createSessionTagGroupId,
  createSessionEntryId,
  normalizeSessionCatalogConfig,
  VENDOR_GROUP_DEFS,
  type LocalPortPackConfig,
  type LocalPortVendorPlan,
  type SessionCatalogConfig,
  type SessionTagGroup,
  type SessionProtocol,
  type SessionGroup,
  type SessionEntry,
} from '../sessions/catalog'
import {
  explainCommandByRules,
  loadBuiltinExplainers,
  normalizeUserExplainRules,
  upsertUserExplainRule,
  type ExplainContext,
  type ExplainMatchSource,
  type ExplainMatcherType,
  type ExplainRisk,
  type ExplainRule,
} from '../explainer/engine'
import { CommandExplainPanel } from '../explainer/CommandExplainPanel'

const SNAPSHOT_DEBOUNCE_MS = 60
const SNAPSHOT_IDLE_TIMEOUT_MS = 40
const FAST_BOOT_SNAPSHOT_RUNS = 10
const MIN_PANE_WIDTH_PX = 300
const SPLITTER_WIDTH_PX = 10
const RIGHT_MIRROR_MODE_STORAGE_KEY = 'termbridge:right-mirror-mode'
const COMMAND_CATALOG_STORAGE_KEY = 'termbridge:command-catalog'
const COMMAND_DOCK_SLOTS_STORAGE_KEY = 'termbridge:command-dock-slots'
const AUTOMATION_SCRIPTS_STORAGE_KEY = 'termbridge:automation-scripts'
const APP_SETTINGS_STORAGE_KEY = 'termbridge:app-settings'
const SESSION_CATALOG_STORAGE_KEY = 'termbridge:session-catalog'
const COMMAND_EXPLAIN_RULES_STORAGE_KEY = 'termbridge:command-explainer-rules'
const FLOATING_MENU_WIDTH_PX = 220
const FLOATING_MENU_HEIGHT_PX = 256
const FLOATING_POPOVER_WIDTH_PX = 860
const FLOATING_POPOVER_HEIGHT_PX = 520
const FLOATING_OVERLAY_MARGIN_PX = 8
const AUTOMATION_PROMPT_TIMEOUT_MS = 60_000
const DATA_EXCHANGE_SCHEMA = 'termbridge.exchange.v1'
const DATA_EXCHANGE_PACK_SCHEMA = 'termbridge.exchange.pack.v1'

type RightMirrorMode = 'translated' | 'source'
type SidePanelMode =
  | 'none'
  | 'glossary'
  | 'strategy'
  | 'commandSearch'
  | 'commandExplain'
  | 'automation'
  | 'settings'
  | 'sessions'
type TerminalTab = {
  id: string
  title: string
}
type TerminalTransport = 'pty' | 'local'
type NetworkVendor = 'unknown' | 'cisco' | 'huawei' | 'h3c' | 'ruijie'
type NetworkMode = 'unknown' | 'exec' | 'privileged' | 'config'
type NetworkHints = {
  vendor: NetworkVendor
  mode: NetworkMode
  pagerDetected: boolean
  pagerToken: string | null
  autoPager: boolean
}
type SessionLogEvent = {
  ts: string
  tabId: string
  direction: 'input' | 'output'
  data: string
}
type AutomationStep =
  | { kind: 'send'; command: string }
  | { kind: 'sendAll'; command: string }
  | { kind: 'sendTabs'; selector: string; command: string }
  | { kind: 'setMode'; mode: 'current' | 'all' | 'tabs'; selector?: string }
  | { kind: 'runTagGroup'; label: string; target: 'new' | 'current' }
  | { kind: 'sleep'; timeoutMs: number }
  | { kind: 'clearView' }
  | { kind: 'exportVisible' }
  | { kind: 'exportVisibleTo'; pathTemplate: string }
  | { kind: 'waitPrompt'; timeoutMs: number }

type CommandDockSlot = {
  id: string
  label: string
  command: string
  risk: 'safe' | 'caution' | 'destructive'
} | null

type SelectionMenuState = {
  x: number
  y: number
  text: string
  localEntry: GlossaryEntry | null
}

type LeftContextMenuState = {
  x: number
  y: number
  selectedText: string
}

type ParamContextMenuState = {
  x: number
  y: number
  hasSelection: boolean
}

type CommandExplainPopoverState = {
  x: number
  y: number
  selectedText: string
  normalizedCommand: string
  context: ExplainContext
  source: ExplainMatchSource
  title: string
  explanation: string
  risk: ExplainRisk
  args: string[]
  examples: string[]
  matchedRuleId: string | null
}

type CommandExplainDraftState = {
  id?: string
  title: string
  explanation: string
  risk: ExplainRisk
  matcherType: ExplainMatcherType
  pattern: string
  argsText: string
  examplesText: string
}

type SelectionPopoverSource = SelectionTranslationSource | 'online'

type SelectionPopoverState = {
  x: number
  y: number
  originalText: string
  translatedText: string
  source: SelectionPopoverSource
  onlineProvider?: TermbridgeTranslationProvider
  localEntry: GlossaryEntry | null
  protectedSegments: string[]
}

type DataExchangeModule = 'sessions' | 'automation' | 'command-catalog' | 'command-explain' | 'glossary'

type DataExchangeBundle = {
  schema: string
  module: DataExchangeModule
  version: number
  exportedAt: string
  payload: unknown
}

type DataExchangePack = {
  schema: string
  packType: 'all-modules'
  version: number
  exportedAt: string
  modules: DataExchangeBundle[]
}

const ALL_TRANSLATION_PROVIDERS: TermbridgeTranslationProvider[] = [
  'google-free',
  'openai-compatible',
  'tencent-tmt',
]

const translationProviderLabel = (provider: TermbridgeTranslationProvider): string => {
  if (provider === 'openai-compatible') {
    return 'OpenAI Compatible'
  }
  if (provider === 'tencent-tmt') {
    return 'Tencent TMT'
  }
  return 'Google Free'
}

const resolveSelectionProviderOptions = (
  config: TermbridgeTranslationConfig | null,
): TermbridgeTranslationProvider[] => {
  if (!config) {
    return ALL_TRANSLATION_PROVIDERS
  }
  const providers: TermbridgeTranslationProvider[] = [config.defaultProvider]
  for (const fallback of config.fallbackProviders ?? []) {
    if (!providers.includes(fallback)) {
      providers.push(fallback)
    }
  }
  for (const builtIn of ALL_TRANSLATION_PROVIDERS) {
    if (!providers.includes(builtIn)) {
      providers.push(builtIn)
    }
  }
  return providers
}

type CellMetrics = {
  width: number
  height: number
}

type TerminalWithCore = Terminal & {
  _core?: {
    _renderService?: {
      dimensions?: {
        css?: {
          cell?: {
            width?: number
            height?: number
          }
        }
      }
    }
  }
}

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (
    callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
    options?: { timeout?: number },
  ) => number
  cancelIdleCallback?: (handle: number) => void
}

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min
  }

  if (value > max) {
    return max
  }

  return value
}

const clampFloatingPosition = (
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } => {
  const maxX = Math.max(FLOATING_OVERLAY_MARGIN_PX, window.innerWidth - width - FLOATING_OVERLAY_MARGIN_PX)
  const maxY = Math.max(FLOATING_OVERLAY_MARGIN_PX, window.innerHeight - height - FLOATING_OVERLAY_MARGIN_PX)
  return {
    x: clamp(x, FLOATING_OVERLAY_MARGIN_PX, maxX),
    y: clamp(y, FLOATING_OVERLAY_MARGIN_PX, maxY),
  }
}

const translationSourceLabel = (
  source: SelectionPopoverSource,
  onlineProvider?: TermbridgeTranslationProvider,
): string => {
  if (source === 'online') {
    return onlineProvider ? `在线翻译 (${onlineProvider})` : '在线翻译'
  }

  if (source === 'local') {
    return '本地词库'
  }

  if (source === 'rules') {
    return '内置规则'
  }

  if (source === 'fallback') {
    return 'Fallback'
  }

  return '无命中'
}

const explainSourceLabel = (source: ExplainMatchSource): string => {
  if (source === 'user') {
    return '本地规则'
  }
  if (source === 'builtin') {
    return '内置规则'
  }
  return '未命中'
}

const explainRiskLabel = (risk: ExplainRisk): string => {
  if (risk === 'safe') {
    return 'safe'
  }
  if (risk === 'danger') {
    return 'danger'
  }
  return 'caution'
}

const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (text.length === 0) {
    return false
  }

  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
  }
}

type SelectionChunk = {
  text: string
  protected: boolean
}

const buildSelectionChunks = (text: string, protectedRanges: ProtectedRange[]): SelectionChunk[] => {
  if (protectedRanges.length === 0) {
    return [{ text, protected: false }]
  }

  const chunks: SelectionChunk[] = []
  let cursor = 0
  for (const range of protectedRanges) {
    if (range.start > cursor) {
      chunks.push({
        text: text.slice(cursor, range.start),
        protected: false,
      })
    }

    chunks.push({
      text: text.slice(range.start, range.end),
      protected: true,
    })
    cursor = range.end
  }

  if (cursor < text.length) {
    chunks.push({
      text: text.slice(cursor),
      protected: false,
    })
  }

  return chunks
}

const normalizeMirrorSelectionText = (raw: string): string => {
  const text = raw.replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  if (lines.length < 4) {
    return text
  }

  const nonEmpty = lines.filter((line) => line.trim().length > 0)
  if (nonEmpty.length < 4) {
    return text
  }

  const nearSingleCharCount = nonEmpty.filter((line) => line.trim().length <= 1).length
  const averageTrimmedLength = nonEmpty.reduce((sum, line) => sum + line.trim().length, 0) / nonEmpty.length
  const alphaNumericCount = (nonEmpty.join('').match(/[A-Za-z0-9\u4e00-\u9fff]/g) ?? []).length
  const looksFragmentedByCell =
    nearSingleCharCount / nonEmpty.length >= 0.85 &&
    averageTrimmedLength <= 1.3 &&
    alphaNumericCount >= Math.floor(nonEmpty.length * 0.6)

  if (!looksFragmentedByCell) {
    return text
  }

  return lines.join('')
}

const readMirrorTextFromSelectionRange = (range: Range): string => {
  const fragment = range.cloneContents()
  const wrapper = document.createElement('div')
  wrapper.appendChild(fragment)

  const rows = Array.from(wrapper.querySelectorAll<HTMLElement>('.mirror-row'))
  if (rows.length > 0) {
    return rows
      .map((row) =>
        Array.from(row.querySelectorAll<HTMLElement>('.mirror-cell'))
          .map((cell) => cell.textContent ?? '')
          .join(''),
      )
      .join('\n')
  }

  const cells = Array.from(wrapper.querySelectorAll<HTMLElement>('.mirror-cell'))
  if (cells.length > 0) {
    return cells.map((cell) => cell.textContent ?? '').join('')
  }

  return wrapper.textContent ?? ''
}

const readErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim()
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim()
  }

  return '未知错误'
}

const shortenErrorMessage = (message: string, maxLength = 180): string => {
  const compact = message.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) {
    return compact
  }

  return `${compact.slice(0, maxLength)}...`
}

const extractDirectoryPath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  if (index <= 0) {
    return normalized
  }
  return normalized.slice(0, index)
}

const defaultCellMetrics: CellMetrics = {
  width: 8,
  height: TERMINAL_DISPLAY.fontSize * TERMINAL_DISPLAY.lineHeight,
}

const readCellMetrics = (term: Terminal): CellMetrics => {
  const core = term as TerminalWithCore
  const cell = core._core?._renderService?.dimensions?.css?.cell
  const width = typeof cell?.width === 'number' && cell.width > 0 ? cell.width : defaultCellMetrics.width
  const height =
    typeof cell?.height === 'number' && cell.height > 0 ? cell.height : defaultCellMetrics.height

  return { width, height }
}

const normalizeWheelLines = (deltaY: number, deltaMode: number, lineHeight: number): number => {
  if (deltaY === 0) {
    return 0
  }

  const normalized = deltaMode === 1 ? deltaY : deltaY / Math.max(1, lineHeight)
  if (normalized > 0) {
    return Math.max(1, Math.round(normalized))
  }

  return Math.min(-1, Math.round(normalized))
}

const isLikelyPasteInput = (data: string): boolean => {
  if (data.length >= 512) {
    return true
  }

  if (data.includes('\u001b[200~') || data.includes('\u001b[201~')) {
    return true
  }

  return data.length > 1 && (data.includes('\r') || data.includes('\n'))
}

const normalizeTerminalInputData = (data: string): string => {
  if (data.length === 0) {
    return data
  }
  return data
    .replace(/\u3000/g, ' ')
    .replace(/[\uff01-\uff5e]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
}

const stripAnsiSequences = (text: string): string => {
  let result = ''
  let index = 0

  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code !== 27) {
      result += text[index]
      index += 1
      continue
    }

    const next = text[index + 1]
    if (next === '[') {
      index += 2
      while (index < text.length) {
        const c = text.charCodeAt(index)
        if (c >= 64 && c <= 126) {
          index += 1
          break
        }
        index += 1
      }
      continue
    }

    if (next === ']') {
      index += 2
      while (index < text.length) {
        const c = text.charCodeAt(index)
        if (c === 7) {
          index += 1
          break
        }
        if (c === 27 && text[index + 1] === '\\') {
          index += 2
          break
        }
        index += 1
      }
      continue
    }

    if (next === 'P' || next === '^' || next === '_') {
      index += 2
      while (index < text.length) {
        if (text.charCodeAt(index) === 27 && text[index + 1] === '\\') {
          index += 2
          break
        }
        index += 1
      }
      continue
    }

    index += 1
  }

  return result
}

const defaultNetworkHints: NetworkHints = {
  vendor: 'unknown',
  mode: 'unknown',
  pagerDetected: false,
  pagerToken: null,
  autoPager: false,
}

const detectNetworkHints = (rawText: string, previous: NetworkHints): NetworkHints => {
  const text = stripAnsiSequences(rawText)
  const lower = text.toLocaleLowerCase()

  let vendor: NetworkVendor = previous.vendor
  if (
    lower.includes('huawei') ||
    lower.includes('vrp') ||
    /<[^>\n]+>/.test(text) ||
    /\[[~*][^\]\n]+\]/.test(text)
  ) {
    vendor = 'huawei'
  } else if (lower.includes('h3c') || lower.includes('comware')) {
    vendor = 'h3c'
  } else if (lower.includes('ruijie') || lower.includes('rg-os') || lower.includes('ruijie os')) {
    vendor = 'ruijie'
  } else if (lower.includes('cisco') || lower.includes('ios') || lower.includes('nx-os')) {
    vendor = 'cisco'
  }

  let mode: NetworkMode = previous.mode
  if (/\(config[^)]*\)#\s*$/.test(text)) {
    mode = 'config'
  } else if (/#\s*$/.test(text)) {
    mode = 'privileged'
  } else if (/>\s*$/.test(text)) {
    mode = 'exec'
  }

  const pagerMatch = text.match(/--More--|----\s*More\s*----|Press any key|More\.\.\.|More:/i)
  const pagerToken = pagerMatch ? pagerMatch[0] : null
  let pagerDetected = Boolean(pagerToken)
  if (!pagerDetected && mode !== 'unknown') {
    pagerDetected = false
  } else if (!pagerDetected) {
    pagerDetected = previous.pagerDetected
  }

  return {
    vendor,
    mode,
    pagerDetected,
    pagerToken,
    autoPager: previous.autoPager,
  }
}

const getPreferredGlossaryDomain = (hints: NetworkHints): GlossaryDomain => {
  if (hints.vendor === 'cisco') {
    return 'network-cisco'
  }
  if (hints.vendor === 'huawei') {
    return 'network-huawei'
  }
  if (hints.vendor === 'h3c') {
    return 'network-h3c'
  }
  if (hints.vendor === 'ruijie') {
    return 'network-ruijie'
  }
  return 'common'
}

const getGlossaryDomainOrder = (hints: NetworkHints): GlossaryDomain[] => {
  const preferred = getPreferredGlossaryDomain(hints)
  if (preferred === 'common') {
    return ['common', 'network-cisco', 'network-huawei', 'network-h3c', 'network-ruijie']
  }
  return [
    preferred,
    'common',
    ...(['network-cisco', 'network-huawei', 'network-h3c', 'network-ruijie'] as GlossaryDomain[]).filter(
      (item) => item !== preferred,
    ),
  ]
}

const resolveExplainContext = (activeContextId: string, hints: NetworkHints): ExplainContext => {
  if (hints.vendor === 'cisco') {
    return 'network_cisco'
  }
  if (hints.vendor === 'huawei') {
    return 'network_huawei'
  }
  if (activeContextId.toLocaleLowerCase().includes('docker')) {
    return 'docker'
  }
  return 'linux_shell'
}

const resolveHighlightScope = (
  activeContextId: string,
  hints: NetworkHints,
): SyntaxHighlightRule['scope'] => {
  if (hints.vendor === 'cisco') {
    return 'network_cisco'
  }
  if (hints.vendor === 'huawei') {
    return 'network_huawei'
  }
  if (hints.vendor === 'h3c') {
    return 'network_h3c'
  }
  if (hints.vendor === 'ruijie') {
    return 'network_ruijie'
  }

  const lower = activeContextId.toLocaleLowerCase()
  if (lower.includes('docker')) {
    return 'docker'
  }
  return 'linux_shell'
}

const readInitialRightMirrorMode = (): RightMirrorMode => {
  try {
    const raw = window.localStorage.getItem(RIGHT_MIRROR_MODE_STORAGE_KEY)
    return raw === 'source' ? 'source' : 'translated'
  } catch {
    return 'translated'
  }
}

const readInitialUserExplainRules = (): ExplainRule[] => {
  try {
    const raw = window.localStorage.getItem(COMMAND_EXPLAIN_RULES_STORAGE_KEY)
    if (!raw) {
      return []
    }
    return normalizeUserExplainRules(JSON.parse(raw) as unknown)
  } catch {
    return []
  }
}

const readInitialCommandCatalogConfig = (): CommandCatalogConfig => {
  try {
    const raw = window.localStorage.getItem(COMMAND_CATALOG_STORAGE_KEY)
    if (!raw) {
      return DEFAULT_COMMAND_CATALOG_CONFIG
    }

    return normalizeCatalogConfig(JSON.parse(raw) as unknown)
  } catch {
    return DEFAULT_COMMAND_CATALOG_CONFIG
  }
}

const readInitialDockSlots = (): CommandDockSlot[] => {
  try {
    const raw = window.localStorage.getItem(COMMAND_DOCK_SLOTS_STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    const slots: CommandDockSlot[] = []
    parsed.forEach((item, index) => {
      if (!item || typeof item !== 'object') {
        slots.push(null)
        return
      }
      const candidate = item as Partial<Exclude<CommandDockSlot, null>>
      if (typeof candidate.command !== 'string' || typeof candidate.label !== 'string') {
        slots.push(null)
        return
      }
      const risk =
        candidate.risk === 'caution' || candidate.risk === 'destructive' || candidate.risk === 'safe'
          ? candidate.risk
          : 'safe'
      slots[index] = {
        id: typeof candidate.id === 'string' ? candidate.id : `slot-${index}`,
        label: candidate.label,
        command: candidate.command,
        risk,
      }
    })
    return slots
  } catch {
    return []
  }
}

const DEFAULT_TERMINAL_COLORS: Record<'dark' | 'light', { background: string; foreground: string }> = {
  dark: {
    background: '#111827',
    foreground: '#e5e7eb',
  },
  light: {
    background: '#ffffff',
    foreground: '#0f172a',
  },
}

const isHexColor = (value: string): boolean => /^#[0-9a-fA-F]{6}$/.test(value) || /^#[0-9a-fA-F]{3}$/.test(value)

const normalizeHexColor = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmed = value.trim()
  if (!isHexColor(trimmed)) {
    return fallback
  }

  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const chars = trimmed.slice(1).split('')
    return `#${chars.map((char) => `${char}${char}`).join('').toLowerCase()}`
  }

  return trimmed.toLowerCase()
}

const normalizeSyntaxHighlightRule = (input: unknown, index: number): SyntaxHighlightRule | null => {
  if (!input || typeof input !== 'object') {
    return null
  }

  const candidate = input as Partial<SyntaxHighlightRule>
  const id = typeof candidate.id === 'string' && candidate.id.trim().length > 0 ? candidate.id.trim() : `hl-${index}`
  const label = typeof candidate.label === 'string' && candidate.label.trim().length > 0 ? candidate.label.trim() : `规则 ${index + 1}`
  const scope =
    candidate.scope === 'linux_shell' ||
    candidate.scope === 'docker' ||
    candidate.scope === 'network_cisco' ||
    candidate.scope === 'network_huawei' ||
    candidate.scope === 'network_h3c' ||
    candidate.scope === 'network_ruijie' ||
    candidate.scope === 'all'
      ? candidate.scope
      : 'all'
  const matchType =
    candidate.matchType === 'prefix' || candidate.matchType === 'regex' || candidate.matchType === 'contains'
      ? candidate.matchType
      : 'contains'
  const styleMode = candidate.styleMode === 'foreground' ? 'foreground' : 'background'
  const pattern = typeof candidate.pattern === 'string' ? candidate.pattern : ''
  const color = normalizeHexColor(candidate.color, '#f59e0b')
  const enabled = candidate.enabled !== false

  return {
    id,
    label,
    scope,
    matchType,
    styleMode,
    pattern,
    color,
    enabled,
  }
}

const normalizeSyntaxHighlightRules = (input: unknown): SyntaxHighlightRule[] => {
  if (!Array.isArray(input)) {
    return []
  }

  return input
    .map((item, index) => normalizeSyntaxHighlightRule(item, index))
    .filter((item): item is SyntaxHighlightRule => item !== null)
    .slice(0, 120)
}

const normalizeDockSlots = (slots: CommandDockSlot[], expected: number): CommandDockSlot[] => {
  const safeExpected = Math.max(1, expected)
  return [...slots.slice(0, safeExpected), ...Array.from({ length: Math.max(0, safeExpected - slots.length) }, () => null)]
}

const defaultAppSettings: AppSettings = {
  compactUi: false,
  showDebugButton: true,
  fontScale: 1,
  theme: 'dark',
  terminalBackground: DEFAULT_TERMINAL_COLORS.dark.background,
  terminalForeground: DEFAULT_TERMINAL_COLORS.dark.foreground,
  leftHighlightOpacity: 0.22,
  syntaxHighlightRules: [
    {
      id: 'default-error',
      label: 'Error',
      scope: 'all',
      matchType: 'contains',
      styleMode: 'foreground',
      pattern: 'error',
      color: '#ef4444',
      enabled: true,
    },
    {
      id: 'default-warning',
      label: 'Warning',
      scope: 'all',
      matchType: 'contains',
      styleMode: 'background',
      pattern: 'warning',
      color: '#f59e0b',
      enabled: true,
    },
  ],
  dockSlots: 6,
  shortcutNextTerminalTab: 'ctrl+tab',
  dockShortcutStart: 'f1',
}

const normalizeAppSettings = (input: unknown): AppSettings => {
  if (!input || typeof input !== 'object') {
    return defaultAppSettings
  }

  const candidate = input as Partial<AppSettings>
  const compactUi = candidate.compactUi === true
  const showDebugButton = candidate.showDebugButton !== false
  const rawScale = typeof candidate.fontScale === 'number' ? candidate.fontScale : 1
  const fontScale = clamp(rawScale, 0.85, 1.25)
  const theme = candidate.theme === 'light' ? 'light' : 'dark'
  const defaultColorByTheme = DEFAULT_TERMINAL_COLORS[theme]
  const terminalBackground = normalizeHexColor(candidate.terminalBackground, defaultColorByTheme.background)
  const terminalForeground = normalizeHexColor(candidate.terminalForeground, defaultColorByTheme.foreground)
  const leftHighlightOpacity = clamp(typeof candidate.leftHighlightOpacity === 'number' ? candidate.leftHighlightOpacity : 0.22, 0.08, 0.5)
  const syntaxHighlightRules = normalizeSyntaxHighlightRules(candidate.syntaxHighlightRules)
  const rawDockSlots = typeof candidate.dockSlots === 'number' ? candidate.dockSlots : defaultAppSettings.dockSlots
  const dockSlots = Math.max(4, Math.min(12, Math.round(rawDockSlots)))
  const shortcutNextTerminalTab =
    candidate.shortcutNextTerminalTab === 'ctrl+shift+tab'
      ? 'ctrl+shift+tab'
      : 'ctrl+tab'
  const dockShortcutStart =
    candidate.dockShortcutStart === 'f2' ||
    candidate.dockShortcutStart === 'f3' ||
    candidate.dockShortcutStart === 'f4'
      ? candidate.dockShortcutStart
      : 'f1'

  return {
    compactUi,
    showDebugButton,
    fontScale,
    theme,
    terminalBackground,
    terminalForeground,
    leftHighlightOpacity,
    syntaxHighlightRules,
    dockSlots,
    shortcutNextTerminalTab,
    dockShortcutStart,
  }
}

const readInitialAppSettings = (): AppSettings => {
  try {
    const raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY)
    if (!raw) {
      return defaultAppSettings
    }

    return normalizeAppSettings(JSON.parse(raw) as unknown)
  } catch {
    return defaultAppSettings
  }
}

const parseFunctionKeyNumber = (value: AppSettings['dockShortcutStart']): number => {
  if (value === 'f2') {
    return 2
  }
  if (value === 'f3') {
    return 3
  }
  if (value === 'f4') {
    return 4
  }
  return 1
}

const downloadJsonFile = (filename: string, payload: unknown): void => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const pickJsonFileText = async (): Promise<string | null> => {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        resolve(String(reader.result ?? ''))
      }
      reader.onerror = () => {
        resolve(null)
      }
      reader.readAsText(file)
    }
    input.click()
  })
}

const readInitialAutomationConfig = (): AutomationConfig => {
  try {
    const raw = window.localStorage.getItem(AUTOMATION_SCRIPTS_STORAGE_KEY)
    if (!raw) {
      return DEFAULT_AUTOMATION_CONFIG
    }

    const parsed = JSON.parse(raw) as unknown
    return normalizeAutomationStorage(parsed)
  } catch {
    return DEFAULT_AUTOMATION_CONFIG
  }
}

const readInitialSessionCatalogConfig = (): SessionCatalogConfig => {
  try {
    const raw = window.localStorage.getItem(SESSION_CATALOG_STORAGE_KEY)
    if (!raw) {
      return DEFAULT_SESSION_CATALOG_CONFIG
    }
    return normalizeSessionCatalogConfig(JSON.parse(raw) as unknown)
  } catch {
    return DEFAULT_SESSION_CATALOG_CONFIG
  }
}

const mergeSessionCatalogForImport = (current: SessionCatalogConfig, incoming: SessionCatalogConfig): SessionCatalogConfig => {
  const groupMap = new Map(current.groups.map((group) => [group.id, group]))
  incoming.groups.forEach((group) => {
    const duplicate = Array.from(groupMap.values()).some((item) => item.label.trim().toLowerCase() === group.label.trim().toLowerCase())
    if (!duplicate) {
      groupMap.set(group.id, group)
    }
  })
  const groups = Array.from(groupMap.values())
  const groupIds = new Set(groups.map((group) => group.id))
  const fallbackGroupId = groups[0]?.id ?? 'linux'

  const sessions = [...current.sessions]
  incoming.sessions.forEach((session) => {
    const key = `${session.name.trim().toLowerCase()}|${session.host.trim().toLowerCase()}|${session.port}|${session.protocol}`
    const duplicate = sessions.some((item) => {
      const itemKey = `${item.name.trim().toLowerCase()}|${item.host.trim().toLowerCase()}|${item.port}|${item.protocol}`
      return itemKey === key
    })
    if (!duplicate) {
      sessions.push({
        ...session,
        groupId: groupIds.has(session.groupId) ? session.groupId : fallbackGroupId,
      })
    }
  })

  const localPortPacks = [...current.localPortPacks]
  incoming.localPortPacks.forEach((pack) => {
    const key = `${pack.host.trim().toLowerCase()}|${pack.startPort}|${pack.count}|${pack.protocol}`
    const duplicate = localPortPacks.some((item) => `${item.host.trim().toLowerCase()}|${item.startPort}|${item.count}|${item.protocol}` === key)
    if (!duplicate) {
      localPortPacks.push(pack)
    }
  })

  const sessionIdSet = new Set(sessions.map((session) => session.id))
  const tagGroups = [...current.tagGroups]
  incoming.tagGroups.forEach((group) => {
    const duplicate = tagGroups.some((item) => item.label.trim().toLowerCase() === group.label.trim().toLowerCase())
    if (!duplicate) {
      tagGroups.push({
        ...group,
        sessionIds: group.sessionIds.filter((id) => sessionIdSet.has(id)),
      })
    }
  })

  return normalizeSessionCatalogConfig({
    ...current,
    groups,
    sessions,
    localPortPacks,
    tagGroups,
  })
}

const mergeAutomationConfigForImport = (current: AutomationConfig, incoming: AutomationConfig): AutomationConfig => {
  const groups = [...current.groups]
  incoming.groups.forEach((group) => {
    const duplicate = groups.some((item) => item.label.trim().toLowerCase() === group.label.trim().toLowerCase())
    if (!duplicate) {
      groups.push(group)
    }
  })
  const groupIdSet = new Set(groups.map((group) => group.id))
  const fallbackGroupId = groups[0]?.id ?? 'shell-native'
  const scripts = [...current.scripts]
  incoming.scripts.forEach((script) => {
    const key = `${script.groupId}|${script.name.trim().toLowerCase()}`
    const duplicate = scripts.some((item) => `${item.groupId}|${item.name.trim().toLowerCase()}` === key)
    if (!duplicate) {
      scripts.push({
        ...script,
        groupId: groupIdSet.has(script.groupId) ? script.groupId : fallbackGroupId,
      })
    }
  })
  return normalizeAutomationStorage({
    version: 1,
    groups,
    scripts,
  })
}

const mergeCommandCatalogForImport = (current: CommandCatalogConfig, incoming: CommandCatalogConfig): CommandCatalogConfig => {
  const groups = [...current.groups]
  incoming.groups.forEach((group) => {
    const duplicate = groups.some((item) => item.label.trim().toLowerCase() === group.label.trim().toLowerCase())
    if (!duplicate) {
      groups.push(group)
    }
  })
  const groupIdSet = new Set(groups.map((group) => group.id))
  const fallbackGroupId = groups[0]?.id ?? 'shell'
  const entries = [...current.entries]
  incoming.entries.forEach((entry) => {
    const key = `${entry.groupId}|${entry.title.trim().toLowerCase()}|${entry.command.trim().toLowerCase()}`
    const duplicate = entries.some((item) => `${item.groupId}|${item.title.trim().toLowerCase()}|${item.command.trim().toLowerCase()}` === key)
    if (!duplicate) {
      entries.push({
        ...entry,
        groupId: groupIdSet.has(entry.groupId) ? entry.groupId : fallbackGroupId,
      })
    }
  })
  return normalizeCatalogConfig({
    version: 1,
    groups,
    entries,
  })
}

const mergeExplainRulesForImport = (current: ExplainRule[], incoming: ExplainRule[]): ExplainRule[] => {
  const next = [...current]
  incoming.forEach((rule) => {
    const key = `${rule.context}|${rule.matcherType}|${rule.pattern.trim().toLowerCase()}`
    const duplicate = next.some((item) => `${item.context}|${item.matcherType}|${item.pattern.trim().toLowerCase()}` === key)
    if (!duplicate) {
      next.push(rule)
    }
  })
  return normalizeUserExplainRules(next)
}

const normalizeGlossaryEntriesForImport = (input: unknown): GlossaryEntry[] => {
  const rows = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as { entries?: unknown[] }).entries)
      ? (input as { entries: unknown[] }).entries
      : []

  const next: GlossaryEntry[] = []
  rows.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return
    }
    const candidate = item as Partial<GlossaryEntry>
    const source = typeof candidate.source === 'string' ? candidate.source.trim() : ''
    const target = typeof candidate.target === 'string' ? candidate.target.trim() : ''
    if (source.length === 0 || target.length === 0) {
      return
    }
    const domain =
      candidate.domain === 'network-cisco' ||
      candidate.domain === 'network-huawei' ||
      candidate.domain === 'network-h3c' ||
      candidate.domain === 'network-ruijie' ||
      candidate.domain === 'common'
        ? candidate.domain
        : 'common'
    const matchType =
      candidate.matchType === 'exact' || candidate.matchType === 'caseInsensitive' || candidate.matchType === 'pattern'
        ? candidate.matchType
        : 'exact'
    next.push({
      source,
      target,
      domain,
      matchType,
      caseInsensitive: candidate.caseInsensitive === true,
      note: typeof candidate.note === 'string' ? candidate.note : '',
      uiOnly: candidate.uiOnly === true,
      wholeWord: candidate.wholeWord === true,
    })
  })
  return next
}

const quoteShellArg = (value: string): string => {
  if (value.length === 0) {
    return "''"
  }
  return `'${value.replace(/'/g, `'\\''`)}'`
}

const buildSshCommand = (session: SessionEntry): string => {
  const args: string[] = ['ssh']
  const user = session.user?.trim() ?? ''
  if (user.length === 0) {
    return ''
  }

  if (session.identityFile && session.identityFile.trim().length > 0) {
    args.push('-i', quoteShellArg(session.identityFile.trim()))
  }
  if (session.hostKeyMode === 'loose') {
    args.push('-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null')
  }
  args.push('-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3')
  if (session.port !== 22) {
    args.push('-p', String(session.port))
  }

  args.push(`${user}@${session.host}`)
  return `${args.join(' ')}\n`
}

const initialCommandConfig: CommandConfig = {
  version: 1,
  defaultContextId: 'shell',
  contexts: [{ id: 'shell', label: 'Shell', detectHints: ['zsh', 'bash', '$ ', '% '] }],
  buttons: [],
}

const detectAutoContextId = (visibleLines: string[], contexts: CommandContext[]): string | null => {
  if (visibleLines.length === 0 || contexts.length === 0) {
    return null
  }

  const normalizedLines = visibleLines
    .map((line) => line.replace(/\s+$/g, '').toLocaleLowerCase())
    .filter((line) => line.length > 0)
  if (normalizedLines.length === 0) {
    return null
  }

  const bottomLines = normalizedLines.slice(-8)
  const fullText = normalizedLines.join('\n')
  const bottomText = bottomLines.join('\n')

  const promptRegex =
    /(?:^|\s)(?:[a-z0-9._-]+@[^\s]+\s+)?(?:[~/.a-z0-9_-]+\s+)?[%$#]\s*$|(?:^|\s)(?:zsh|bash|fish|pwsh|powershell|cmd\.exe)\b/i
  const hasPromptTail = bottomLines.some((line) => promptRegex.test(line))

  const scores = new Map<string, number>()
  for (const context of contexts) {
    let score = 0
    for (const hint of context.detectHints) {
      const normalizedHint = hint.trim().toLocaleLowerCase()
      if (normalizedHint.length < 2) {
        continue
      }

      const weight = normalizedHint.length > 7 ? 2 : 1
      if (fullText.includes(normalizedHint)) {
        score += weight
      }

      if (bottomText.includes(normalizedHint)) {
        score += weight + 1
      }
    }

    if (context.id === 'shell' && hasPromptTail) {
      score += 6
    }

    scores.set(context.id, score)
  }

  const shellContext = contexts.find((context) => context.id === 'shell')
  const shellScore = shellContext ? scores.get(shellContext.id) ?? 0 : 0

  let bestContext: CommandContext | null = null
  let bestScore = -1
  for (const context of contexts) {
    const score = scores.get(context.id) ?? 0
    if (score > bestScore) {
      bestScore = score
      bestContext = context
    }
  }

  if (shellContext && hasPromptTail && shellScore >= bestScore - 1) {
    return shellContext.id
  }

  if (bestContext && bestScore >= 2) {
    return bestContext.id
  }

  if (shellContext && hasPromptTail) {
    return shellContext.id
  }

  return null
}

const isPromptLikeTailLine = (line: string): boolean => {
  const normalized = line.trimEnd()
  if (normalized.length === 0 || normalized.length > 180) {
    return false
  }
  if (/--More--|----\s*More\s*----|Press any key|More\.\.\.|More:/i.test(normalized)) {
    return false
  }
  if (/^(?:<[^>\n]+>|\[[~*]?[^\]\n]+\]|[A-Za-z0-9._-]+(?:\([^)]+\))?[>#])\s*$/.test(normalized)) {
    return true
  }
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+(?:\s+[^\s]+)*\s+[%$#]\s*$/.test(normalized)) {
    return true
  }
  return false
}

const sanitizeTerminalExportText = (input: string): string => {
  const lines: string[] = []
  let current = ''
  let cursor = 0

  const flushLine = (): void => {
    lines.push(current)
    current = ''
    cursor = 0
  }

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (char === '\n') {
      flushLine()
      continue
    }
    if (char === '\r') {
      cursor = 0
      continue
    }
    if (char === '\b' || char === String.fromCharCode(8)) {
      cursor = Math.max(0, cursor - 1)
      continue
    }
    if (char < ' ') {
      continue
    }

    if (cursor >= current.length) {
      current = `${current}${' '.repeat(cursor - current.length)}${char}`
    } else {
      current = `${current.slice(0, cursor)}${char}${current.slice(cursor + 1)}`
    }
    cursor += 1
  }
  flushLine()

  return lines
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/--More--|----\s*More\s*----|Press any key|More\.\.\.|More:/gi, '')
    .replace(/\n{3,}/g, '\n\n')
}

const isPagerPromptLine = (line: string): boolean => {
  const normalized = line
    .split(String.fromCharCode(8))
    .join('')
    .trim()
    .toLocaleLowerCase()
  if (normalized.length === 0) {
    return false
  }
  if (/^-+\s*more\s*-+$/.test(normalized)) {
    return true
  }
  if (/^--more--$/.test(normalized)) {
    return true
  }
  if (/^more\.\.\.$/.test(normalized)) {
    return true
  }
  if (/^press any key(?: to continue)?(?:\.\.\.)?$/.test(normalized)) {
    return true
  }
  // Huawei/Cisco variants like "---- More ----", "More (Press 'Q' to break)"
  if (normalized.includes('more')) {
    if (
      normalized.includes('press') ||
      normalized.includes('q') ||
      normalized.includes('break') ||
      normalized.includes('next') ||
      normalized.includes('-')
    ) {
      return true
    }
  }
  return false
}

const readVisibleTerminalTailLines = (term: Terminal, count: number): string[] => {
  const buffer = term.buffer.active
  const startRow = Math.max(0, term.rows - Math.max(1, count))
  const lines: string[] = []
  for (let row = startRow; row < term.rows; row += 1) {
    const line = buffer.getLine(buffer.baseY + row)
    const text = line ? line.translateToString(true).trimEnd() : ''
    if (text.length > 0) {
      lines.push(text)
    }
  }
  return lines
}

const readRenderedTerminalText = (term: Terminal): string => {
  const buffer = term.buffer.active
  const outputLines: string[] = []
  let wrappedPrefix = ''

  for (let row = 0; row < buffer.length; row += 1) {
    const line = buffer.getLine(row)
    const text = line ? line.translateToString(true) : ''
    const isWrapped = Boolean(line?.isWrapped)

    if (isWrapped) {
      wrappedPrefix += text
      continue
    }

    outputLines.push(wrappedPrefix.length > 0 ? `${wrappedPrefix}${text}` : text)
    wrappedPrefix = ''
  }

  if (wrappedPrefix.length > 0) {
    outputLines.push(wrappedPrefix)
  }

  return outputLines.join('\n')
}

const readTailLinesFromBuffer = (bufferText: string, count: number): string[] => {
  return stripAnsiSequences(bufferText)
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-Math.max(1, count))
}

const parseAutomationSteps = (rawContent: string): AutomationStep[] => {
  const steps: AutomationStep[] = []
  const lines = rawContent
    .split('\n')
    .map((line) => line.replace(/\r/g, ''))

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }
    if (line === 'app.clear_view' || line === 'app.clear') {
      steps.push({ kind: 'clearView' })
      continue
    }
    if (line === 'app.export_visible' || line === 'app.export_text') {
      steps.push({ kind: 'exportVisible' })
      continue
    }
    if (line.startsWith('app.export_visible_to ')) {
      const pathTemplate = line.slice('app.export_visible_to '.length).trim()
      if (pathTemplate.length > 0) {
        steps.push({ kind: 'exportVisibleTo', pathTemplate })
      }
      continue
    }
    if (line.startsWith('term.wait_prompt')) {
      const timeoutToken = line.slice('term.wait_prompt'.length).trim()
      const parsedTimeout = Number.parseInt(timeoutToken, 10)
      const timeoutMs =
        Number.isFinite(parsedTimeout) && parsedTimeout > 0
          ? Math.max(1500, Math.min(180_000, parsedTimeout))
          : AUTOMATION_PROMPT_TIMEOUT_MS
      steps.push({ kind: 'waitPrompt', timeoutMs })
      continue
    }
    if (line.startsWith('time.sleep')) {
      const timeoutToken = line.slice('time.sleep'.length).trim()
      const parsedTimeout = Number.parseInt(timeoutToken, 10)
      const timeoutMs =
        Number.isFinite(parsedTimeout) && parsedTimeout > 0
          ? Math.max(50, Math.min(600_000, parsedTimeout))
          : 1000
      steps.push({ kind: 'sleep', timeoutMs })
      continue
    }
    if (line.startsWith('term.send ')) {
      steps.push({ kind: 'send', command: line.slice('term.send '.length) })
      continue
    }
    if (line.startsWith('term.send_all ')) {
      steps.push({ kind: 'sendAll', command: line.slice('term.send_all '.length) })
      continue
    }
    if (line.startsWith('term.send_tabs ')) {
      const payload = line.slice('term.send_tabs '.length).trim()
      if (payload.length === 0) {
        continue
      }
      const separatorIndex = payload.indexOf('::')
      if (separatorIndex >= 0) {
        const selector = payload.slice(0, separatorIndex).trim()
        const command = payload.slice(separatorIndex + 2).trim()
        if (selector.length > 0 && command.length > 0) {
          steps.push({ kind: 'sendTabs', selector, command })
          continue
        }
      }

      const firstSpace = payload.indexOf(' ')
      if (firstSpace > 0) {
        const selector = payload.slice(0, firstSpace).trim()
        const command = payload.slice(firstSpace + 1).trim()
        if (selector.length > 0 && command.length > 0) {
          steps.push({ kind: 'sendTabs', selector, command })
          continue
        }
      }
      continue
    }
    if (line.startsWith('term.mode ')) {
      const payload = line.slice('term.mode '.length).trim()
      const lowered = payload.toLocaleLowerCase()
      if (['broadcast_all', 'all', 'broadcast'].includes(lowered)) {
        steps.push({ kind: 'setMode', mode: 'all' })
        continue
      }
      if (['current', 'single', 'clear', 'off'].includes(lowered)) {
        steps.push({ kind: 'setMode', mode: 'current' })
        continue
      }
      if (lowered.startsWith('tabs ')) {
        const selector = payload.slice(5).trim()
        if (selector.length > 0) {
          steps.push({ kind: 'setMode', mode: 'tabs', selector })
        }
        continue
      }
      continue
    }
    if (line.startsWith('session.run_tag_group ')) {
      const payload = line.slice('session.run_tag_group '.length).trim()
      if (payload.length === 0) {
        continue
      }
      const separatorIndex = payload.indexOf('::')
      if (separatorIndex >= 0) {
        const label = payload.slice(0, separatorIndex).trim()
        const targetToken = payload.slice(separatorIndex + 2).trim().toLocaleLowerCase()
        if (label.length > 0) {
          const target: 'new' | 'current' = targetToken === 'new' ? 'new' : 'current'
          steps.push({ kind: 'runTagGroup', label, target })
        }
        continue
      }
      steps.push({ kind: 'runTagGroup', label: payload, target: 'current' })
      continue
    }
    steps.push({ kind: 'send', command: rawLine })
  }

  return steps
}

const initialStats: DebugStats = {
  scanRuns: 0,
  candidatesFound: 0,
  matchedPhrasesCount: 0,
  glossaryHits: 0,
  rulesHits: 0,
  translatedCount: 0,
  markersRendered: 0,
  topSkipReasons: [],
}

const isDev = import.meta.env.DEV
let terminalTabSeed = 1

const createTerminalTabId = (): string => {
  terminalTabSeed += 1
  return `term-tab-${Date.now()}-${terminalTabSeed}`
}

export const App = () => {
  const paneWrapRef = useRef<HTMLDivElement | null>(null)
  const leftHostRef = useRef<HTMLDivElement | null>(null)
  const mirrorFrameRef = useRef<HTMLDivElement | null>(null)
  const selectionMenuRef = useRef<HTMLDivElement | null>(null)
  const leftContextMenuRef = useRef<HTMLDivElement | null>(null)
  const paramContextMenuRef = useRef<HTMLDivElement | null>(null)
  const paramContextMenuTargetRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const selectionPopoverRef = useRef<HTMLDivElement | null>(null)
  const commandExplainPopoverRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const activeTerminalTabIdRef = useRef('term-tab-1')
  const terminalTabsRef = useRef<TerminalTab[]>([{ id: 'term-tab-1', title: 'Tab 1' }])
  const terminalTabOrderRef = useRef<string[]>(['term-tab-1'])
  const terminalTabBuffersRef = useRef<Map<string, string>>(new Map([['term-tab-1', '']]))
  const terminalTabLogsRef = useRef<Map<string, SessionLogEvent[]>>(new Map([['term-tab-1', []]]))
  const terminalTabAliveRef = useRef<Map<string, boolean>>(new Map([['term-tab-1', true]]))
  const terminalTabTransportRef = useRef<Map<string, TerminalTransport>>(new Map([['term-tab-1', 'pty']]))
  const terminalTabSessionNameRef = useRef<Map<string, string>>(new Map())
  const networkHintsByTabRef = useRef<Map<string, NetworkHints>>(new Map([['term-tab-1', defaultNetworkHints]]))
  const autoPagerRunsByTabRef = useRef<Map<string, number>>(new Map())
  const automationRunningByTabRef = useRef<Map<string, boolean>>(new Map())
  const scanRunsRef = useRef(0)
  const commandConfigRef = useRef<CommandConfig>(initialCommandConfig)
  const activeContextIdRef = useRef(initialCommandConfig.defaultContextId)
  const autoDetectContextRef = useRef(true)
  const glossaryEntriesRef = useRef<GlossaryEntry[]>([])
  const translationConfigRef = useRef<TermbridgeTranslationConfig | null>(null)
  const translationPolicyRef = useRef<TranslationPolicy>(DEFAULT_TRANSLATION_POLICY)
  const runSnapshotRef = useRef<(() => void) | null>(null)
  const fitAndResizeRef = useRef<(() => void) | null>(null)
  const rightViewportYRef = useRef(0)
  const followRightBottomRef = useRef(true)
  const [baseScreen, setBaseScreen] = useState<Screen>(() => createEmptyScreen(24, 80))
  const [translatedScreen, setTranslatedScreen] = useState<Screen>(() => createEmptyScreen(24, 80))
  const [markers, setMarkers] = useState<Marker[]>([])
  const [stats, setStats] = useState<DebugStats>(initialStats)
  const [glossaryPath, setGlossaryPath] = useState('')
  const [glossaryEntryCount, setGlossaryEntryCount] = useState(0)
  const [glossaryEntries, setGlossaryEntries] = useState<GlossaryEntry[]>([])
  const [glossaryStatus, setGlossaryStatus] = useState('loading')
  const [translationConfig, setTranslationConfig] = useState<TermbridgeTranslationConfig | null>(null)
  const [translationConfigStatus, setTranslationConfigStatus] = useState('loading')
  const [translationPolicy, setTranslationPolicy] = useState<TranslationPolicy>(DEFAULT_TRANSLATION_POLICY)
  const [translationPolicyStatus, setTranslationPolicyStatus] = useState('loading')
  const [commandConfig, setCommandConfig] = useState<CommandConfig>(initialCommandConfig)
  const [activeContextId, setActiveContextId] = useState(initialCommandConfig.defaultContextId)
  const [autoDetectContext, setAutoDetectContext] = useState(true)
  const [rightMirrorMode, setRightMirrorMode] = useState<RightMirrorMode>(() => readInitialRightMirrorMode())
  const [cellMetrics, setCellMetrics] = useState<CellMetrics>(defaultCellMetrics)
  const [leftPaneRatio, setLeftPaneRatio] = useState(0.5)
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false)
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenuState | null>(null)
  const [leftContextMenu, setLeftContextMenu] = useState<LeftContextMenuState | null>(null)
  const [paramContextMenu, setParamContextMenu] = useState<ParamContextMenuState | null>(null)
  const [selectionPopover, setSelectionPopover] = useState<SelectionPopoverState | null>(null)
  const [selectionDraftTranslation, setSelectionDraftTranslation] = useState('')
  const [selectionPopoverStatus, setSelectionPopoverStatus] = useState('')
  const [selectionOnlineProvider, setSelectionOnlineProvider] = useState<TermbridgeTranslationProvider>('google-free')
  const [selectionOnlinePending, setSelectionOnlinePending] = useState(false)
  const [commandExplainPopover, setCommandExplainPopover] = useState<CommandExplainPopoverState | null>(null)
  const [commandExplainDraft, setCommandExplainDraft] = useState<CommandExplainDraftState | null>(null)
  const [commandExplainStatus, setCommandExplainStatus] = useState('')
  const [builtinExplainRules, setBuiltinExplainRules] = useState<Record<ExplainContext, ExplainRule[]>>({
    linux_shell: [],
    docker: [],
    network_cisco: [],
    network_huawei: [],
  })
  const [userExplainRules, setUserExplainRules] = useState<ExplainRule[]>(() => readInitialUserExplainRules())
  const [sidePanelMode, setSidePanelMode] = useState<SidePanelMode>('none')
  const [appSettings, setAppSettings] = useState<AppSettings>(() => readInitialAppSettings())
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([{ id: 'term-tab-1', title: 'Tab 1' }])
  const [activeTerminalTabId, setActiveTerminalTabId] = useState('term-tab-1')
  const [draggingTerminalTabId, setDraggingTerminalTabId] = useState<string | null>(null)
  const [sessionCatalogConfig, setSessionCatalogConfig] = useState<SessionCatalogConfig>(() =>
    readInitialSessionCatalogConfig(),
  )
  const [sessionExportStatus, setSessionExportStatus] = useState('')
  const [activeNetworkHints, setActiveNetworkHints] = useState<NetworkHints>(defaultNetworkHints)
  const [commandCatalogConfig, setCommandCatalogConfig] = useState<CommandCatalogConfig>(() =>
    readInitialCommandCatalogConfig(),
  )
  const [commandDockSlots, setCommandDockSlots] = useState<CommandDockSlot[]>(() =>
    normalizeDockSlots(readInitialDockSlots(), readInitialAppSettings().dockSlots),
  )
  const [automationConfig, setAutomationConfig] = useState<AutomationConfig>(() => readInitialAutomationConfig())
  const selectionTranslateReqSeqRef = useRef(0)

  const runSnapshotNow = useCallback((): void => {
    runSnapshotRef.current?.()
  }, [])

  useEffect(() => {
    activeTerminalTabIdRef.current = activeTerminalTabId
  }, [activeTerminalTabId])

  useEffect(() => {
    terminalTabOrderRef.current = terminalTabs.map((tab) => tab.id)
    terminalTabsRef.current = terminalTabs
  }, [terminalTabs])

  const updateTabAliveState = useCallback((tabId: string, alive: boolean): void => {
    terminalTabAliveRef.current.set(tabId, alive)
  }, [])

  const updateTabTransport = useCallback((tabId: string, transport: TerminalTransport): void => {
    terminalTabTransportRef.current.set(tabId, transport)
  }, [])

  const appendTerminalTabBuffer = useCallback((tabId: string, chunk: string): void => {
    const previous = terminalTabBuffersRef.current.get(tabId) ?? ''
    const maxBufferLength = 2_000_000
    const next = previous.length + chunk.length > maxBufferLength
      ? `${previous}${chunk}`.slice(-maxBufferLength)
      : `${previous}${chunk}`
    terminalTabBuffersRef.current.set(tabId, next)
  }, [])

  const appendTerminalTabLog = useCallback((tabId: string, direction: SessionLogEvent['direction'], data: string): void => {
    if (data.length === 0) {
      return
    }

    const previous = terminalTabLogsRef.current.get(tabId) ?? []
    const next: SessionLogEvent = {
      ts: new Date().toISOString(),
      tabId,
      direction,
      data,
    }
    const maxEvents = 8000
    const merged = previous.length >= maxEvents ? [...previous.slice(previous.length - maxEvents + 1), next] : [...previous, next]
    terminalTabLogsRef.current.set(tabId, merged)
  }, [])

  const renderTerminalTabBuffer = useCallback((tabId: string): void => {
    const term = termRef.current
    if (!term) {
      return
    }

    const content = terminalTabBuffersRef.current.get(tabId) ?? ''
    term.reset()
    if (content.length > 0) {
      term.write(content)
    }
    runSnapshotNow()
  }, [runSnapshotNow])

  const updateTerminalTabTitle = useCallback((tabId: string, title: string): void => {
    setTerminalTabs((previous) =>
      previous.map((tab) => (tab.id === tabId ? { ...tab, title: title.trim().length > 0 ? title.trim() : tab.title } : tab)),
    )
  }, [])

  const createTerminalTab = useCallback((title?: string): string => {
    const tabId = createTerminalTabId()
    setTerminalTabs((previous) => [
      ...previous,
      { id: tabId, title: title && title.trim().length > 0 ? title.trim() : `Tab ${previous.length + 1}` },
    ])
    terminalTabBuffersRef.current.set(tabId, '')
    terminalTabLogsRef.current.set(tabId, [])
    terminalTabAliveRef.current.set(tabId, true)
    terminalTabTransportRef.current.set(tabId, 'pty')
    networkHintsByTabRef.current.set(tabId, defaultNetworkHints)
    autoPagerRunsByTabRef.current.set(tabId, 0)
    setActiveTerminalTabId(tabId)
    setActiveNetworkHints(defaultNetworkHints)
    renderTerminalTabBuffer(tabId)
    const term = termRef.current
    if (term) {
      void ptyClient.spawn(tabId, term.cols, term.rows)
        .then((spawned) => {
          updateTabAliveState(tabId, spawned)
          if (spawned) {
            updateTabTransport(tabId, 'pty')
          }
          if (!spawned) {
            appendTerminalTabBuffer(tabId, '\r\n[pty spawn failed]\r\n')
          }
        })
    }
    return tabId
  }, [appendTerminalTabBuffer, renderTerminalTabBuffer, updateTabAliveState, updateTabTransport])

  const handleCreateTerminalTab = useCallback((): void => {
    createTerminalTab()
  }, [createTerminalTab])

  const handleSwitchTerminalTab = useCallback((tabId: string): void => {
    if (tabId === activeTerminalTabIdRef.current) {
      return
    }
    setActiveTerminalTabId(tabId)
    setActiveNetworkHints(networkHintsByTabRef.current.get(tabId) ?? defaultNetworkHints)
    renderTerminalTabBuffer(tabId)
    const term = termRef.current
    if (!term) {
      return
    }
    void ptyClient.resize(tabId, term.cols, term.rows)
  }, [renderTerminalTabBuffer])

  const handleCloseTerminalTab = useCallback((tabId: string): void => {
    const existing = terminalTabOrderRef.current
    if (existing.length <= 1) {
      return
    }

    const closingIndex = existing.findIndex((id) => id === tabId)
    if (closingIndex < 0) {
      return
    }

    const tabTitle = terminalTabs.find((tab) => tab.id === tabId)?.title ?? tabId
    const confirmed = window.confirm(`关闭标签「${tabTitle}」将断开当前连接，是否继续？`)
    if (!confirmed) {
      return
    }

    const nextActiveId = activeTerminalTabIdRef.current === tabId
      ? existing[Math.max(0, closingIndex - 1)] ?? existing[0]
      : activeTerminalTabIdRef.current

    setTerminalTabs((previous) => previous.filter((tab) => tab.id !== tabId))
    terminalTabBuffersRef.current.delete(tabId)
    terminalTabLogsRef.current.delete(tabId)
    terminalTabAliveRef.current.delete(tabId)
    terminalTabTransportRef.current.delete(tabId)
    terminalTabSessionNameRef.current.delete(tabId)
    networkHintsByTabRef.current.delete(tabId)
    autoPagerRunsByTabRef.current.delete(tabId)
    void ptyClient.kill(tabId)

    if (nextActiveId && nextActiveId !== activeTerminalTabIdRef.current) {
      setActiveTerminalTabId(nextActiveId)
      setActiveNetworkHints(networkHintsByTabRef.current.get(nextActiveId) ?? defaultNetworkHints)
      renderTerminalTabBuffer(nextActiveId)
      const term = termRef.current
      if (term) {
        void ptyClient.resize(nextActiveId, term.cols, term.rows)
      }
    }
  }, [renderTerminalTabBuffer, terminalTabs])

  const handleReorderTerminalTabs = useCallback((sourceTabId: string, targetTabId: string): void => {
    if (sourceTabId === targetTabId) {
      return
    }
    setTerminalTabs((previous) => {
      const sourceIndex = previous.findIndex((tab) => tab.id === sourceTabId)
      const targetIndex = previous.findIndex((tab) => tab.id === targetTabId)
      if (sourceIndex < 0 || targetIndex < 0) {
        return previous
      }
      const next = [...previous]
      const [moved] = next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, moved)
      return next
    })
  }, [])

  const persistSessionCatalog = useCallback((nextConfig: SessionCatalogConfig): void => {
    const normalized = normalizeSessionCatalogConfig(nextConfig)
    setSessionCatalogConfig(normalized)
    try {
      window.localStorage.setItem(SESSION_CATALOG_STORAGE_KEY, JSON.stringify(normalized))
    } catch {
      // ignore localStorage write failures
    }
  }, [])

  const handleAddSessionGroup = useCallback((label: string): void => {
    const trimmed = label.trim()
    if (trimmed.length === 0) {
      return
    }

    const id = createGroupId(trimmed, new Set(sessionCatalogConfig.groups.map((group) => group.id)))
    persistSessionCatalog({
      ...sessionCatalogConfig,
      groups: [...sessionCatalogConfig.groups, { id, label: trimmed }],
    })
  }, [persistSessionCatalog, sessionCatalogConfig])

  const handleDeleteSessionGroup = useCallback((group: SessionGroup): void => {
    if (sessionCatalogConfig.groups.length <= 1) {
      return
    }
    const fallbackGroupId = sessionCatalogConfig.groups.find((item) => item.id !== group.id)?.id
    if (!fallbackGroupId) {
      return
    }

    persistSessionCatalog({
      ...sessionCatalogConfig,
      groups: sessionCatalogConfig.groups.filter((item) => item.id !== group.id),
      sessions: sessionCatalogConfig.sessions.map((session) =>
        session.groupId === group.id ? { ...session, groupId: fallbackGroupId, updatedAt: new Date().toISOString() } : session,
      ),
    })
  }, [persistSessionCatalog, sessionCatalogConfig])

  const handleReorderSessionGroups = useCallback((sourceGroupId: string, targetGroupId: string): void => {
    if (sourceGroupId === targetGroupId) {
      return
    }

    const groups = [...sessionCatalogConfig.groups]
    const sourceIndex = groups.findIndex((group) => group.id === sourceGroupId)
    const targetIndex = groups.findIndex((group) => group.id === targetGroupId)
    if (sourceIndex < 0 || targetIndex < 0) {
      return
    }

    const [moved] = groups.splice(sourceIndex, 1)
    groups.splice(targetIndex, 0, moved)
    persistSessionCatalog({
      ...sessionCatalogConfig,
      groups,
    })
  }, [persistSessionCatalog, sessionCatalogConfig])

  const handleUpsertSession = useCallback((form: {
    id?: string
    name: string
    groupId: string
    protocol: SessionProtocol
    host: string
    port: number
    user: string
    identityFile: string
    hostKeyMode: 'ask' | 'loose'
  }): void => {
    const name = form.name.trim()
    const host = form.host.trim()
    const user = form.user.trim()
    if (name.length === 0 || host.length === 0) {
      return
    }
    if (form.protocol === 'ssh' && user.length === 0) {
      return
    }

    const now = new Date().toISOString()
    const nextSession: SessionEntry = {
      id: form.id ?? createSessionEntryId(),
      name,
      groupId: sessionCatalogConfig.groups.some((group) => group.id === form.groupId)
        ? form.groupId
        : sessionCatalogConfig.groups[0]?.id ?? 'linux',
      protocol: form.protocol,
      host,
      port: Math.max(1, Math.min(65535, Math.round(form.port || 22))),
      user: form.protocol === 'ssh' ? user : undefined,
      authMode: form.protocol === 'ssh' ? 'system' : undefined,
      identityFile: form.protocol === 'ssh' && form.identityFile.trim().length > 0 ? form.identityFile.trim() : undefined,
      hostKeyMode: form.protocol === 'ssh' ? form.hostKeyMode : undefined,
      updatedAt: now,
    }

    const existingIndex = sessionCatalogConfig.sessions.findIndex((session) => session.id === nextSession.id)
    if (existingIndex >= 0) {
      const next = [...sessionCatalogConfig.sessions]
      next[existingIndex] = nextSession
      persistSessionCatalog({
        ...sessionCatalogConfig,
        sessions: next,
      })
      return
    }

    persistSessionCatalog({
      ...sessionCatalogConfig,
      sessions: [nextSession, ...sessionCatalogConfig.sessions],
    })
  }, [persistSessionCatalog, sessionCatalogConfig])

  const handleBulkCreateSessions = useCallback((forms: Array<{
    name: string
    groupId: string
    protocol: SessionProtocol
    host: string
    port: number
    user: string
    identityFile: string
    hostKeyMode: 'ask' | 'loose'
  }>): number => {
    if (!Array.isArray(forms) || forms.length === 0) {
      return 0
    }
    const now = new Date().toISOString()
    const nextSessions: SessionEntry[] = []
    for (const form of forms) {
      const name = form.name.trim()
      const host = form.host.trim()
      const user = form.user.trim()
      if (name.length === 0 || host.length === 0) {
        continue
      }
      if (form.protocol === 'ssh' && user.length === 0) {
        continue
      }
      nextSessions.push({
        id: createSessionEntryId(),
        name,
        groupId: sessionCatalogConfig.groups.some((group) => group.id === form.groupId)
          ? form.groupId
          : sessionCatalogConfig.groups[0]?.id ?? 'linux',
        protocol: form.protocol,
        host,
        port: Math.max(1, Math.min(65535, Math.round(form.port || 22))),
        user: form.protocol === 'ssh' ? user : undefined,
        authMode: form.protocol === 'ssh' ? 'system' : undefined,
        identityFile: form.protocol === 'ssh' && form.identityFile.trim().length > 0 ? form.identityFile.trim() : undefined,
        hostKeyMode: form.protocol === 'ssh' ? form.hostKeyMode : undefined,
        updatedAt: now,
      })
    }
    if (nextSessions.length === 0) {
      return 0
    }
    persistSessionCatalog({
      ...sessionCatalogConfig,
      sessions: [...nextSessions, ...sessionCatalogConfig.sessions],
    })
    return nextSessions.length
  }, [persistSessionCatalog, sessionCatalogConfig])

  const handleDeleteSession = useCallback((session: SessionEntry): void => {
    persistSessionCatalog({
      ...sessionCatalogConfig,
      sessions: sessionCatalogConfig.sessions.filter((item) => item.id !== session.id),
      tagGroups: sessionCatalogConfig.tagGroups.map((group) => ({
        ...group,
        sessionIds: group.sessionIds.filter((id) => id !== session.id),
      })),
    })
  }, [persistSessionCatalog, sessionCatalogConfig])

  const handleBulkDeleteSessionGroups = useCallback((groupIds: string[]): void => {
    const targets = new Set(
      groupIds.filter((id) => sessionCatalogConfig.groups.some((group) => group.id === id)),
    )
    if (targets.size === 0) {
      return
    }
    const removableGroups = sessionCatalogConfig.groups.filter((group) => !targets.has(group.id))
    if (removableGroups.length === 0) {
      return
    }
    persistSessionCatalog({
      ...sessionCatalogConfig,
      groups: removableGroups,
      sessions: sessionCatalogConfig.sessions.filter((session) => !targets.has(session.groupId)),
      tagGroups: sessionCatalogConfig.tagGroups.map((group) => ({
        ...group,
        sessionIds: group.sessionIds.filter((id) =>
          sessionCatalogConfig.sessions.some((session) => session.id === id && !targets.has(session.groupId))),
      })),
    })
  }, [persistSessionCatalog, sessionCatalogConfig])

  const handleBulkDeleteSessions = useCallback((sessionIds: string[]): void => {
    const targets = new Set(sessionIds)
    if (targets.size === 0) {
      return
    }
    persistSessionCatalog({
      ...sessionCatalogConfig,
      sessions: sessionCatalogConfig.sessions.filter((session) => !targets.has(session.id)),
      tagGroups: sessionCatalogConfig.tagGroups.map((group) => ({
        ...group,
        sessionIds: group.sessionIds.filter((id) => !targets.has(id)),
      })),
    })
  }, [persistSessionCatalog, sessionCatalogConfig])

  const handleUpsertSessionTagGroup = useCallback((input: {
    id?: string
    label: string
    sessionIds: string[]
  }): void => {
    const label = input.label.trim()
    if (label.length === 0) {
      return
    }
    const existingSessionIds = new Set(sessionCatalogConfig.sessions.map((session) => session.id))
    const sessionIds = Array.from(new Set(input.sessionIds.filter((id) => existingSessionIds.has(id))))
    const nextGroup: SessionTagGroup = {
      id: input.id ?? createSessionTagGroupId(),
      label,
      sessionIds,
      updatedAt: new Date().toISOString(),
    }
    const existingIndex = sessionCatalogConfig.tagGroups.findIndex((group) => group.id === nextGroup.id)
    if (existingIndex >= 0) {
      const nextGroups = [...sessionCatalogConfig.tagGroups]
      nextGroups[existingIndex] = nextGroup
      persistSessionCatalog({
        ...sessionCatalogConfig,
        tagGroups: nextGroups,
      })
      return
    }
    persistSessionCatalog({
      ...sessionCatalogConfig,
      tagGroups: [nextGroup, ...sessionCatalogConfig.tagGroups],
    })
  }, [persistSessionCatalog, sessionCatalogConfig])

  const handleDeleteSessionTagGroup = useCallback((id: string): void => {
    const target = sessionCatalogConfig.tagGroups.find((group) => group.id === id)
    if (!target) {
      return
    }
    const confirmed = window.confirm(`确定删除标签分组「${target.label}」？`)
    if (!confirmed) {
      return
    }
    persistSessionCatalog({
      ...sessionCatalogConfig,
      tagGroups: sessionCatalogConfig.tagGroups.filter((group) => group.id !== id),
    })
  }, [persistSessionCatalog, sessionCatalogConfig])

  const handleReorderSessions = useCallback((sourceSessionId: string, targetSessionId: string | null, targetGroupId: string): void => {
    const sessions = [...sessionCatalogConfig.sessions]
    const sourceIndex = sessions.findIndex((session) => session.id === sourceSessionId)
    if (sourceIndex < 0) {
      return
    }

    const [moved] = sessions.splice(sourceIndex, 1)
    const nextMoved: SessionEntry = moved.groupId === targetGroupId ? moved : { ...moved, groupId: targetGroupId }

    if (targetSessionId) {
      const targetIndex = sessions.findIndex((session) => session.id === targetSessionId)
      if (targetIndex >= 0) {
        sessions.splice(targetIndex, 0, nextMoved)
      } else {
        sessions.push(nextMoved)
      }
    } else {
      let insertIndex = sessions.length
      for (let index = sessions.length - 1; index >= 0; index -= 1) {
        if (sessions[index].groupId === targetGroupId) {
          insertIndex = index + 1
          break
        }
      }
      sessions.splice(insertIndex, 0, nextMoved)
    }

    persistSessionCatalog({
      ...sessionCatalogConfig,
      sessions,
    })
  }, [persistSessionCatalog, sessionCatalogConfig])

  const handleUpsertLocalPortPack = useCallback((form: {
    id?: string
    host: string
    startPort: number
    count: number
    protocol: Extract<SessionProtocol, 'telnet' | 'raw' | 'ssh'>
    vendorPlan: LocalPortVendorPlan
  }): void => {
    const groupMap = new Map(sessionCatalogConfig.groups.map((group) => [group.id, group]))
    const generated = generateLocalPortPackSessions(
      {
        id: form.id,
        host: form.host,
        startPort: form.startPort,
        count: form.count,
        protocol: form.protocol,
        vendorPlan: form.vendorPlan,
      },
      groupMap,
    )

    const ensuredGroups = [...sessionCatalogConfig.groups]
    for (const def of VENDOR_GROUP_DEFS) {
      if (generated.groups.some((group) => group.id === def.groupId) && !ensuredGroups.some((group) => group.id === def.groupId)) {
        ensuredGroups.push({ id: def.groupId, label: def.label })
      }
    }
    ensuredGroups.sort((a, b) => {
      const ai = VENDOR_GROUP_DEFS.findIndex((def) => def.groupId === a.id)
      const bi = VENDOR_GROUP_DEFS.findIndex((def) => def.groupId === b.id)
      if (ai >= 0 && bi >= 0) {
        return ai - bi
      }
      if (ai >= 0) {
        return -1
      }
      if (bi >= 0) {
        return 1
      }
      return a.label.localeCompare(b.label)
    })

    const preserved = sessionCatalogConfig.sessions.filter((session) => session.packId !== generated.pack.id)
    const sessions = [...generated.sessions, ...preserved]
    const localPortPacks = [
      generated.pack,
      ...sessionCatalogConfig.localPortPacks.filter((pack) => pack.id !== generated.pack.id),
    ]

    persistSessionCatalog({
      ...sessionCatalogConfig,
      groups: ensuredGroups,
      sessions,
      localPortPacks,
    })
  }, [persistSessionCatalog, sessionCatalogConfig])

  const handleDeleteLocalPortPack = useCallback((pack: LocalPortPackConfig): void => {
    const removedSessionIds = new Set(
      sessionCatalogConfig.sessions.filter((session) => session.packId === pack.id).map((session) => session.id),
    )
    persistSessionCatalog({
      ...sessionCatalogConfig,
      sessions: sessionCatalogConfig.sessions.filter((session) => session.packId !== pack.id),
      localPortPacks: sessionCatalogConfig.localPortPacks.filter((item) => item.id !== pack.id),
      tagGroups: sessionCatalogConfig.tagGroups.map((group) => ({
        ...group,
        sessionIds: group.sessionIds.filter((id) => !removedSessionIds.has(id)),
      })),
    })
  }, [persistSessionCatalog, sessionCatalogConfig])

  const writeToTabImmediateWithLog = useCallback((tabId: string, data: string): void => {
    if (!(terminalTabAliveRef.current.get(tabId) ?? false)) {
      setSessionExportStatus((previous) => (previous === '当前标签会话已断开，请先重连或新建标签' ? previous : '当前标签会话已断开，请先重连或新建标签'))
      return
    }
    appendTerminalTabLog(tabId, 'input', data)
    ptyClient.writeImmediate(tabId, data)
  }, [appendTerminalTabLog])

  const updateNetworkHintsForTab = useCallback((tabId: string, next: NetworkHints): void => {
    networkHintsByTabRef.current.set(tabId, next)
    if (tabId === activeTerminalTabIdRef.current) {
      setActiveNetworkHints(next)
    }
  }, [])

  const restoreTabToShell = useCallback((tabId: string, restoredNotice?: string): void => {
    const term = termRef.current
    if (!term) {
      return
    }
    updateTabTransport(tabId, 'pty')
    void ptyClient.spawn(tabId, term.cols, term.rows).then((spawned) => {
      updateTabAliveState(tabId, spawned)
      if (!spawned) {
        const failedMessage = '\r\n[shell restore failed]\r\n'
        appendTerminalTabBuffer(tabId, failedMessage)
        appendTerminalTabLog(tabId, 'output', failedMessage)
        if (tabId === activeTerminalTabIdRef.current) {
          term.write(failedMessage)
        }
        runSnapshotNow()
        return
      }
      updateTabTransport(tabId, 'pty')
      if (restoredNotice) {
        appendTerminalTabBuffer(tabId, restoredNotice)
        appendTerminalTabLog(tabId, 'output', restoredNotice)
        if (tabId === activeTerminalTabIdRef.current) {
          term.write(restoredNotice)
        }
      }
      runSnapshotNow()
    })
  }, [appendTerminalTabBuffer, appendTerminalTabLog, runSnapshotNow, updateTabAliveState, updateTabTransport])

  const connectSessionToTab = useCallback((session: SessionEntry, tabId: string): void => {
    if (session.protocol === 'ssh' && session.hostKeyMode === 'loose') {
      const confirmed = window.confirm(
        `该会话将使用宽松 HostKey 校验（存在中间人风险）。\n\n会话：${session.name}\n目标：${session.user}@${session.host}\n\n是否继续连接？`,
      )
      if (!confirmed) {
        return
      }
    }

    const connectWithProtocol = (): void => {
      updateTerminalTabTitle(tabId, session.name)
      terminalTabSessionNameRef.current.set(tabId, session.name)

      if (session.protocol === 'telnet' || session.protocol === 'raw') {
        updateTabTransport(tabId, 'local')
        void ptyClient.connectLocal(tabId, session.host, session.port, session.protocol)
          .then((connected) => {
            updateTabAliveState(tabId, connected)
            if (!connected) {
              setSessionExportStatus(`连接失败：无法连接 ${session.host}:${session.port}`)
              restoreTabToShell(tabId, '\r\n[returned to local shell]\r\n')
              return
            }
          })
          .catch(() => {
            updateTabAliveState(tabId, false)
            setSessionExportStatus(`连接失败：无法连接 ${session.host}:${session.port}`)
            restoreTabToShell(tabId, '\r\n[returned to local shell]\r\n')
          })
        return
      }

      const command = buildSshCommand(session)
      if (command.length === 0) {
        setSessionExportStatus('SSH 会话缺少用户信息，无法连接')
        return
      }
      writeToTabImmediateWithLog(tabId, command)
    }

    if (session.protocol === 'telnet' || session.protocol === 'raw') {
      connectWithProtocol()
      return
    }

    const currentTransport = terminalTabTransportRef.current.get(tabId) ?? 'pty'
    const shouldRespawnPty = session.protocol === 'ssh' && currentTransport !== 'pty'
    if (!shouldRespawnPty && (terminalTabAliveRef.current.get(tabId) ?? false)) {
      connectWithProtocol()
      return
    }

    const term = termRef.current
    if (!term) {
      return
    }

    updateTabTransport(tabId, 'pty')
    void ptyClient.spawn(tabId, term.cols, term.rows).then((spawned) => {
      updateTabAliveState(tabId, spawned)
      if (!spawned) {
        setSessionExportStatus('当前标签重连失败，请新建标签后重试')
        return
      }
      updateTabTransport(tabId, 'pty')
      connectWithProtocol()
    })
  }, [restoreTabToShell, updateTabAliveState, updateTabTransport, updateTerminalTabTitle, writeToTabImmediateWithLog])

  const handleConnectSessionCurrentTab = useCallback((session: SessionEntry): void => {
    connectSessionToTab(session, activeTerminalTabIdRef.current)
  }, [connectSessionToTab])

  const handleConnectSessionNewTab = useCallback((session: SessionEntry): void => {
    const tabId = createTerminalTab(session.name)
    // Ensure spawn completed before sending initial ssh command.
    window.setTimeout(() => {
      connectSessionToTab(session, tabId)
    }, 60)
  }, [connectSessionToTab, createTerminalTab])

  const runSessionTagGroup = useCallback((tagGroupId: string, target: 'current' | 'new'): number => {
    const tagGroup = sessionCatalogConfig.tagGroups.find((group) => group.id === tagGroupId)
    if (!tagGroup) {
      return 0
    }
    const sessionMap = new Map(sessionCatalogConfig.sessions.map((session) => [session.id, session]))
    const sessions = tagGroup.sessionIds
      .map((id) => sessionMap.get(id))
      .filter((session): session is SessionEntry => Boolean(session))
    if (sessions.length === 0) {
      setSessionExportStatus(`标签分组「${tagGroup.label}」中没有可连接设备`)
      return 0
    }

    if (target === 'current') {
      connectSessionToTab(sessions[0], activeTerminalTabIdRef.current)
      for (let index = 1; index < sessions.length; index += 1) {
        const session = sessions[index]
        const tabId = createTerminalTab(session.name)
        window.setTimeout(() => {
          connectSessionToTab(session, tabId)
        }, 60 + index * 30)
      }
    } else {
      sessions.forEach((session, index) => {
        const tabId = createTerminalTab(session.name)
        window.setTimeout(() => {
          connectSessionToTab(session, tabId)
        }, 60 + index * 30)
      })
    }
    setSessionExportStatus(`标签分组已启动连接：${tagGroup.label} (${sessions.length} 台)`)
    return sessions.length
  }, [connectSessionToTab, createTerminalTab, sessionCatalogConfig])

  const handleConnectSessionTagGroupCurrent = useCallback((tagGroupId: string): void => {
    runSessionTagGroup(tagGroupId, 'current')
  }, [runSessionTagGroup])

  const handleConnectSessionTagGroupNew = useCallback((tagGroupId: string): void => {
    runSessionTagGroup(tagGroupId, 'new')
  }, [runSessionTagGroup])

  const applyTranslationConfigPayload = useCallback(
    (payload: TermbridgeTranslationConfigPayload, status: string): void => {
      translationConfigRef.current = payload.config
      setTranslationConfig(payload.config)
      setTranslationConfigStatus(status)
      const normalizedPolicy = normalizeTranslationPolicy(payload.config.mirror)
      translationPolicyRef.current = normalizedPolicy
      setTranslationPolicy(normalizedPolicy)
      setTranslationPolicyStatus(status)
      runSnapshotNow()
    },
    [runSnapshotNow],
  )

  const applyCommandConfigPayload = useCallback(
    (payload: TermbridgeCommandConfigPayload): void => {
      const normalized = normalizeCommandConfig(payload.config)
      commandConfigRef.current = normalized
      setCommandConfig(normalized)

      const hasActiveContext = normalized.contexts.some((context) => context.id === activeContextIdRef.current)
      const nextContextId = hasActiveContext ? activeContextIdRef.current : normalized.defaultContextId
      activeContextIdRef.current = nextContextId
      setActiveContextId(nextContextId)
    },
    [],
  )

  const handleContextChange = useCallback((contextId: string): void => {
    activeContextIdRef.current = contextId
    setActiveContextId(contextId)
    autoDetectContextRef.current = false
    setAutoDetectContext(false)
  }, [])

  const handleAutoDetectToggle = useCallback((enabled: boolean): void => {
    autoDetectContextRef.current = enabled
    setAutoDetectContext(enabled)
    if (enabled) {
      runSnapshotNow()
    }
  }, [runSnapshotNow])

  const handleExportCurrentTabLog = useCallback(async (): Promise<void> => {
    const tabId = activeTerminalTabIdRef.current
    const events = terminalTabLogsRef.current.get(tabId) ?? []
    if (events.length === 0) {
      setSessionExportStatus('当前标签暂无日志可导出')
      return
    }

    const tabTitle = terminalTabs.find((tab) => tab.id === tabId)?.title ?? tabId
    const sessionName = terminalTabSessionNameRef.current.get(tabId) ?? tabTitle
    const cleanText = events
      .map((event) => {
        const sanitized = stripAnsiSequences(event.data)
        if (event.direction === 'input') {
          const normalized = sanitized.replace(/\r?\n+$/g, '')
          return normalized.length > 0 ? `\n[INPUT] ${normalized}\n` : ''
        }
        return sanitized
      })
      .join('')
    const jsonl = events
      .map((event) =>
        JSON.stringify({
          ...event,
          sessionName,
        }),
      )
      .join('\n')

    const result = await window.termbridge.exportSessionLog({
      tabId,
      tabTitle,
      sessionName,
      cleanText,
      jsonl,
    })

    if (!result) {
      setSessionExportStatus('日志导出已取消')
      return
    }

    setSessionExportStatus(`日志已导出：${result.txtPath}`)
  }, [terminalTabs])

  const handleRunCatalogCommand = useCallback((command: string, risk: 'safe' | 'caution' | 'destructive'): void => {
    const raw = command
    const isRawPayload = raw.startsWith('raw:')
    const payload = isRawPayload ? raw.slice(4) : raw.trim()
    if (payload.length === 0) {
      return
    }

    if (risk === 'destructive') {
      const confirmed = window.confirm(`确认发送危险命令？\n\n${payload}`)
      if (!confirmed) {
        return
      }
    }

    if (isRawPayload) {
      writeToTabImmediateWithLog(activeTerminalTabIdRef.current, payload)
      return
    }
    writeToTabImmediateWithLog(activeTerminalTabIdRef.current, payload.endsWith('\n') ? payload : `${payload}\n`)
  }, [writeToTabImmediateWithLog])

  const handleCopyCatalogCommand = useCallback((command: string): void => {
    const output = command.startsWith('raw:') ? command.slice(4) : command
    void copyTextToClipboard(output)
  }, [])

  const persistDockSlots = useCallback((nextSlots: CommandDockSlot[]): void => {
    const normalized = normalizeDockSlots(nextSlots, appSettings.dockSlots)
    setCommandDockSlots(normalized)
    try {
      window.localStorage.setItem(COMMAND_DOCK_SLOTS_STORAGE_KEY, JSON.stringify(normalized))
    } catch {
      // ignore localStorage write failures
    }
  }, [appSettings.dockSlots])

  const handleAssignDockSlot = useCallback(
    (slotIndex: number, payload: Exclude<CommandDockSlot, null>): void => {
      if (slotIndex < 0 || slotIndex >= commandDockSlots.length) {
        return
      }
      const nextSlots = [...commandDockSlots]
      nextSlots[slotIndex] = payload
      persistDockSlots(nextSlots)
    },
    [commandDockSlots, persistDockSlots],
  )

  const handleRunDockSlot = useCallback(
    (slotIndex: number): void => {
      const slot = commandDockSlots[slotIndex]
      if (!slot) {
        return
      }
      handleRunCatalogCommand(slot.command, slot.risk)
    },
    [commandDockSlots, handleRunCatalogCommand],
  )

  const handleClearDockSlot = useCallback(
    (slotIndex: number): void => {
      if (slotIndex < 0 || slotIndex >= commandDockSlots.length) {
        return
      }
      const nextSlots = [...commandDockSlots]
      nextSlots[slotIndex] = null
      persistDockSlots(nextSlots)
    },
    [commandDockSlots, persistDockSlots],
  )

  const handleMoveDockSlot = useCallback(
    (sourceIndex: number, targetIndex: number): void => {
      if (sourceIndex === targetIndex) {
        return
      }
      if (
        sourceIndex < 0 ||
        sourceIndex >= commandDockSlots.length ||
        targetIndex < 0 ||
        targetIndex >= commandDockSlots.length
      ) {
        return
      }

      const nextSlots = [...commandDockSlots]
      const source = nextSlots[sourceIndex]
      nextSlots[sourceIndex] = nextSlots[targetIndex]
      nextSlots[targetIndex] = source
      persistDockSlots(nextSlots)
    },
    [commandDockSlots, persistDockSlots],
  )

  useEffect(() => {
    const onGlobalShortcut = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target) {
        const tagName = target.tagName?.toLowerCase() ?? ''
        const editable = target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select'
        if (editable) {
          return
        }
      }

      const normalizedKey = event.key.toLowerCase()

      if (appSettings.shortcutNextTerminalTab === 'ctrl+tab' && event.ctrlKey && !event.shiftKey && normalizedKey === 'tab') {
        event.preventDefault()
        const currentIndex = terminalTabs.findIndex((tab) => tab.id === activeTerminalTabIdRef.current)
        if (currentIndex >= 0 && terminalTabs.length > 1) {
          const nextIndex = (currentIndex + 1) % terminalTabs.length
          handleSwitchTerminalTab(terminalTabs[nextIndex].id)
        }
        return
      }

      if (appSettings.shortcutNextTerminalTab === 'ctrl+shift+tab' && event.ctrlKey && event.shiftKey && normalizedKey === 'tab') {
        event.preventDefault()
        const currentIndex = terminalTabs.findIndex((tab) => tab.id === activeTerminalTabIdRef.current)
        if (currentIndex >= 0 && terminalTabs.length > 1) {
          const nextIndex = (currentIndex - 1 + terminalTabs.length) % terminalTabs.length
          handleSwitchTerminalTab(terminalTabs[nextIndex].id)
        }
        return
      }

      const startFn = parseFunctionKeyNumber(appSettings.dockShortcutStart)
      if (!event.ctrlKey && !event.metaKey && !event.altKey && normalizedKey.startsWith('f')) {
        const fnNumber = Number.parseInt(normalizedKey.slice(1), 10)
        if (Number.isFinite(fnNumber)) {
          const slotIndex = fnNumber - startFn
          if (slotIndex >= 0 && slotIndex < commandDockSlots.length && commandDockSlots[slotIndex]) {
            event.preventDefault()
            handleRunDockSlot(slotIndex)
          }
        }
      }
    }

    window.addEventListener('keydown', onGlobalShortcut)
    return () => {
      window.removeEventListener('keydown', onGlobalShortcut)
    }
  }, [appSettings.dockShortcutStart, appSettings.shortcutNextTerminalTab, commandDockSlots, handleRunDockSlot, handleSwitchTerminalTab, terminalTabs])

  const persistCommandCatalog = useCallback((nextConfig: CommandCatalogConfig): void => {
    setCommandCatalogConfig(nextConfig)
    try {
      window.localStorage.setItem(COMMAND_CATALOG_STORAGE_KEY, JSON.stringify(nextConfig))
    } catch {
      // ignore localStorage write failures
    }
  }, [])

  const handleAddCatalogGroup = useCallback(
    (label: string): void => {
      const normalizedLabel = label.trim()
      if (normalizedLabel.length === 0) {
        return
      }

      const baseId = normalizedLabel.toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, '-')
      const finalBase = baseId.length > 0 ? baseId : 'custom'
      const existingIds = new Set(commandCatalogConfig.groups.map((group) => group.id))
      let id = finalBase
      let suffix = 1
      while (existingIds.has(id)) {
        id = `${finalBase}-${suffix}`
        suffix += 1
      }

      persistCommandCatalog({
        ...commandCatalogConfig,
        groups: [...commandCatalogConfig.groups, { id, label: normalizedLabel, system: false }],
      })
    },
    [commandCatalogConfig, persistCommandCatalog],
  )

  const handleDeleteCatalogGroup = useCallback(
    (group: CommandCatalogGroup): void => {
      if (group.system) {
        return
      }

      const confirmed = window.confirm(`确定删除分组「${group.label}」？\\n该分组下的命令也会删除。`)
      if (!confirmed) {
        return
      }

      persistCommandCatalog({
        ...commandCatalogConfig,
        groups: commandCatalogConfig.groups.filter((item) => item.id !== group.id),
        entries: commandCatalogConfig.entries.filter((entry) => entry.groupId !== group.id),
      })
    },
    [commandCatalogConfig, persistCommandCatalog],
  )

  const handleReorderCatalogGroups = useCallback(
    (sourceGroupId: string, targetGroupId: string): void => {
      if (sourceGroupId === targetGroupId) {
        return
      }

      const groups = [...commandCatalogConfig.groups]
      const sourceIndex = groups.findIndex((group) => group.id === sourceGroupId)
      const targetIndex = groups.findIndex((group) => group.id === targetGroupId)
      if (sourceIndex < 0 || targetIndex < 0) {
        return
      }

      const [moved] = groups.splice(sourceIndex, 1)
      groups.splice(targetIndex, 0, moved)
      persistCommandCatalog({
        ...commandCatalogConfig,
        groups,
      })
    },
    [commandCatalogConfig, persistCommandCatalog],
  )

  const handleAddCatalogEntry = useCallback(
    (input: {
      groupId: string
      title: string
      command: string
      summary: string
      usage: string
      example: string
      tags: string[]
      risk: CommandCatalogRisk
    }): void => {
      const nextEntry: CommandCatalogEntry = {
        id: createCatalogEntryId(),
        groupId: input.groupId,
        title: input.title,
        command: input.command,
        summary: input.summary,
        usage: input.usage,
        example: input.example,
        tags: input.tags,
        risk: input.risk,
      }

      persistCommandCatalog({
        ...commandCatalogConfig,
        entries: [...commandCatalogConfig.entries, nextEntry],
      })
    },
    [commandCatalogConfig, persistCommandCatalog],
  )

  const handleDeleteCatalogEntry = useCallback(
    (entry: CommandCatalogEntry): void => {
      const confirmed = window.confirm(`确定删除命令条目？\\n\\n${entry.title}\\n${entry.command}`)
      if (!confirmed) {
        return
      }

      persistCommandCatalog({
        ...commandCatalogConfig,
        entries: commandCatalogConfig.entries.filter((item) => item.id !== entry.id),
      })
    },
    [commandCatalogConfig, persistCommandCatalog],
  )

  const handleBulkDeleteCatalogGroups = useCallback((groupIds: string[]): void => {
    const targets = new Set(
      groupIds.filter((id) => commandCatalogConfig.groups.some((group) => group.id === id && !group.system)),
    )
    if (targets.size === 0) {
      return
    }
    persistCommandCatalog({
      ...commandCatalogConfig,
      groups: commandCatalogConfig.groups.filter((group) => !targets.has(group.id)),
      entries: commandCatalogConfig.entries.filter((entry) => !targets.has(entry.groupId)),
    })
  }, [commandCatalogConfig, persistCommandCatalog])

  const handleBulkDeleteCatalogEntries = useCallback((entryIds: string[]): void => {
    const targets = new Set(entryIds)
    if (targets.size === 0) {
      return
    }
    persistCommandCatalog({
      ...commandCatalogConfig,
      entries: commandCatalogConfig.entries.filter((entry) => !targets.has(entry.id)),
    })
  }, [commandCatalogConfig, persistCommandCatalog])

  const handleReorderCatalogEntries = useCallback(
    (sourceEntryId: string, targetEntryId: string): void => {
      if (sourceEntryId === targetEntryId) {
        return
      }

      const entries = [...commandCatalogConfig.entries]
      const sourceIndex = entries.findIndex((entry) => entry.id === sourceEntryId)
      const targetIndex = entries.findIndex((entry) => entry.id === targetEntryId)
      if (sourceIndex < 0 || targetIndex < 0) {
        return
      }

      const [moved] = entries.splice(sourceIndex, 1)
      entries.splice(targetIndex, 0, moved)
      persistCommandCatalog({
        ...commandCatalogConfig,
        entries,
      })
    },
    [commandCatalogConfig, persistCommandCatalog],
  )

  const handleResetCatalogSystemEntries = useCallback((): void => {
    const confirmed = window.confirm('重置命令检索系统项？\n\n将恢复内置分类与内置命令，保留你的自定义项。')
    if (!confirmed) {
      return
    }
    const systemGroupIds = new Set(
      DEFAULT_COMMAND_CATALOG_CONFIG.groups.filter((group) => group.system).map((group) => group.id),
    )
    const systemEntryIds = new Set(DEFAULT_COMMAND_CATALOG_CONFIG.entries.map((entry) => entry.id))
    const customGroups = commandCatalogConfig.groups.filter((group) => !systemGroupIds.has(group.id))
    const customEntries = commandCatalogConfig.entries.filter((entry) => !systemEntryIds.has(entry.id))
    persistCommandCatalog({
      ...commandCatalogConfig,
      groups: [...DEFAULT_COMMAND_CATALOG_CONFIG.groups, ...customGroups],
      entries: [...DEFAULT_COMMAND_CATALOG_CONFIG.entries, ...customEntries],
    })
  }, [commandCatalogConfig, persistCommandCatalog])

  const handleUpsertUserExplainRule = useCallback((input: {
    id?: string
    context: ExplainContext
    matcherType: ExplainMatcherType
    pattern: string
    title: string
    explanation: string
    risk: ExplainRisk
    args: string[]
    examples: string[]
  }): void => {
    setUserExplainRules((previous) => upsertUserExplainRule(previous, input))
  }, [])

  const handleDeleteUserExplainRule = useCallback((id: string): void => {
    setUserExplainRules((previous) => previous.filter((item) => item.id !== id))
  }, [])

  const handleBulkDeleteUserExplainRules = useCallback((ids: string[]): void => {
    const targets = new Set(ids)
    if (targets.size === 0) {
      return
    }
    setUserExplainRules((previous) => previous.filter((item) => !targets.has(item.id)))
  }, [])

  const handleBulkDeleteExplainContexts = useCallback((contexts: ExplainContext[]): void => {
    const targets = new Set(contexts)
    if (targets.size === 0) {
      return
    }
    setUserExplainRules((previous) => previous.filter((item) => !targets.has(item.context)))
  }, [])

  const toggleSidePanel = useCallback((target: Exclude<SidePanelMode, 'none'>): void => {
    setSidePanelMode((previous) => (previous === target ? 'none' : target))
  }, [])

  const closeSidePanel = useCallback((): void => {
    setSidePanelMode('none')
  }, [])

  const toggleRightMirrorMode = useCallback((): void => {
    setRightMirrorMode((previous) => {
      const next: RightMirrorMode = previous === 'translated' ? 'source' : 'translated'
      try {
        window.localStorage.setItem(RIGHT_MIRROR_MODE_STORAGE_KEY, next)
      } catch {
        // ignore localStorage write failures
      }
      return next
    })
  }, [])

  const applyGlossaryPayload = useCallback(
    (payload: TermbridgeGlossaryPayload, status: string): void => {
      glossaryEntriesRef.current = payload.entries
      setGlossaryEntries(payload.entries)
      setGlossaryPath(payload.path)
      setGlossaryEntryCount(payload.entries.length)
      setGlossaryStatus(status)
      runSnapshotNow()
    },
    [runSnapshotNow],
  )

  const reloadGlossary = (): void => {
    setGlossaryStatus('reloading')
    void window.termbridge
      .reloadGlossary()
      .then((payload) => {
        applyGlossaryPayload(payload, 'reloaded')
      })
      .catch(() => {
        setGlossaryStatus('reload_failed')
      })
  }

  const importGlossary = (): void => {
    setGlossaryStatus('importing')
    void window.termbridge
      .importGlossary()
      .then((payload) => {
        if (!payload) {
          setGlossaryStatus('import_cancelled')
          return
        }

        applyGlossaryPayload(payload, 'imported')
      })
      .catch(() => {
        setGlossaryStatus('import_failed')
      })
  }

  const exportGlossary = (): void => {
    setGlossaryStatus('exporting')
    void window.termbridge
      .exportGlossary()
      .then((ok) => {
        setGlossaryStatus(ok ? 'exported' : 'export_cancelled')
      })
      .catch(() => {
        setGlossaryStatus('export_failed')
      })
  }

  const openGlossaryManager = useCallback((): void => {
    toggleSidePanel('glossary')
  }, [toggleSidePanel])

  const openSessionManager = useCallback((): void => {
    toggleSidePanel('sessions')
  }, [toggleSidePanel])

  const openTranslationStrategy = useCallback((): void => {
    setSidePanelMode('strategy')
  }, [])

  const persistAutomationConfig = useCallback((nextConfig: AutomationConfig): void => {
    setAutomationConfig(nextConfig)
    try {
      window.localStorage.setItem(AUTOMATION_SCRIPTS_STORAGE_KEY, JSON.stringify(nextConfig))
    } catch {
      // ignore localStorage write failures
    }
  }, [])

  const exportSessionExchange = useCallback((): void => {
    const bundle: DataExchangeBundle = {
      schema: DATA_EXCHANGE_SCHEMA,
      module: 'sessions',
      version: 1,
      exportedAt: new Date().toISOString(),
      payload: sessionCatalogConfig,
    }
    downloadJsonFile(`termbridge-sessions-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, bundle)
  }, [sessionCatalogConfig])

  const importSessionExchange = useCallback((): void => {
    void pickJsonFileText().then((raw) => {
      if (!raw) {
        return
      }
      try {
        const parsed = JSON.parse(raw) as DataExchangeBundle
        if (parsed.schema !== DATA_EXCHANGE_SCHEMA || parsed.module !== 'sessions') {
          window.alert('导入失败：文件不是会话管理交换包')
          return
        }
        const incoming = normalizeSessionCatalogConfig(parsed.payload)
        const merged = mergeSessionCatalogForImport(sessionCatalogConfig, incoming)
        persistSessionCatalog(merged)
        window.alert(`导入完成：会话总数 ${merged.sessions.length}`)
      } catch {
        window.alert('导入失败：JSON 格式无效')
      }
    })
  }, [persistSessionCatalog, sessionCatalogConfig])

  const exportAutomationExchange = useCallback((): void => {
    const bundle: DataExchangeBundle = {
      schema: DATA_EXCHANGE_SCHEMA,
      module: 'automation',
      version: 1,
      exportedAt: new Date().toISOString(),
      payload: automationConfig,
    }
    downloadJsonFile(`termbridge-automation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, bundle)
  }, [automationConfig])

  const importAutomationExchange = useCallback((): void => {
    void pickJsonFileText().then((raw) => {
      if (!raw) {
        return
      }
      try {
        const parsed = JSON.parse(raw) as DataExchangeBundle
        if (parsed.schema !== DATA_EXCHANGE_SCHEMA || parsed.module !== 'automation') {
          window.alert('导入失败：文件不是自动化交换包')
          return
        }
        const incoming = normalizeAutomationStorage(parsed.payload)
        const merged = mergeAutomationConfigForImport(automationConfig, incoming)
        persistAutomationConfig(merged)
        window.alert(`导入完成：脚本总数 ${merged.scripts.length}`)
      } catch {
        window.alert('导入失败：JSON 格式无效')
      }
    })
  }, [automationConfig, persistAutomationConfig])

  const exportCommandCatalogExchange = useCallback((): void => {
    const bundle: DataExchangeBundle = {
      schema: DATA_EXCHANGE_SCHEMA,
      module: 'command-catalog',
      version: 1,
      exportedAt: new Date().toISOString(),
      payload: commandCatalogConfig,
    }
    downloadJsonFile(`termbridge-command-catalog-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, bundle)
  }, [commandCatalogConfig])

  const importCommandCatalogExchange = useCallback((): void => {
    void pickJsonFileText().then((raw) => {
      if (!raw) {
        return
      }
      try {
        const parsed = JSON.parse(raw) as DataExchangeBundle
        if (parsed.schema !== DATA_EXCHANGE_SCHEMA || parsed.module !== 'command-catalog') {
          window.alert('导入失败：文件不是命令检索交换包')
          return
        }
        const incoming = normalizeCatalogConfig(parsed.payload)
        const merged = mergeCommandCatalogForImport(commandCatalogConfig, incoming)
        persistCommandCatalog(merged)
        window.alert(`导入完成：命令条目总数 ${merged.entries.length}`)
      } catch {
        window.alert('导入失败：JSON 格式无效')
      }
    })
  }, [commandCatalogConfig, persistCommandCatalog])

  const exportCommandExplainExchange = useCallback((): void => {
    const bundle: DataExchangeBundle = {
      schema: DATA_EXCHANGE_SCHEMA,
      module: 'command-explain',
      version: 1,
      exportedAt: new Date().toISOString(),
      payload: userExplainRules,
    }
    downloadJsonFile(`termbridge-command-explain-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, bundle)
  }, [userExplainRules])

  const exportAllDataExchange = useCallback((): void => {
    const exportedAt = new Date().toISOString()
    const pack: DataExchangePack = {
      schema: DATA_EXCHANGE_PACK_SCHEMA,
      packType: 'all-modules',
      version: 1,
      exportedAt,
      modules: [
        {
          schema: DATA_EXCHANGE_SCHEMA,
          module: 'glossary',
          version: 1,
          exportedAt,
          payload: glossaryEntries,
        },
        {
          schema: DATA_EXCHANGE_SCHEMA,
          module: 'sessions',
          version: 1,
          exportedAt,
          payload: sessionCatalogConfig,
        },
        {
          schema: DATA_EXCHANGE_SCHEMA,
          module: 'automation',
          version: 1,
          exportedAt,
          payload: automationConfig,
        },
        {
          schema: DATA_EXCHANGE_SCHEMA,
          module: 'command-catalog',
          version: 1,
          exportedAt,
          payload: commandCatalogConfig,
        },
        {
          schema: DATA_EXCHANGE_SCHEMA,
          module: 'command-explain',
          version: 1,
          exportedAt,
          payload: userExplainRules,
        },
      ],
    }
    downloadJsonFile(`termbridge-all-modules-${exportedAt.replace(/[:.]/g, '-')}.json`, pack)
  }, [automationConfig, commandCatalogConfig, glossaryEntries, sessionCatalogConfig, userExplainRules])

  const importAllDataExchange = useCallback((): void => {
    void pickJsonFileText().then(async (raw) => {
      if (!raw) {
        return
      }
      try {
        const parsed = JSON.parse(raw) as DataExchangePack
        if (parsed.schema !== DATA_EXCHANGE_PACK_SCHEMA || parsed.packType !== 'all-modules' || !Array.isArray(parsed.modules)) {
          window.alert('导入失败：文件不是全部模块交换包')
          return
        }

        let nextSessions = sessionCatalogConfig
        let nextAutomation = automationConfig
        let nextCommandCatalog = commandCatalogConfig
        let nextExplainRules = userExplainRules
        let glossaryImported = 0
        let glossaryFailed = 0
        let glossaryPayload: TermbridgeGlossaryPayload | null = null
        const glossaryKeySet = new Set(
          glossaryEntries.map((item) => `${item.domain ?? 'common'}|${item.matchType ?? 'exact'}|${item.source.toLowerCase()}|${item.target.toLowerCase()}`),
        )

        for (const moduleBundle of parsed.modules) {
          if (!moduleBundle || moduleBundle.schema !== DATA_EXCHANGE_SCHEMA) {
            continue
          }
          if (moduleBundle.module === 'sessions') {
            const incoming = normalizeSessionCatalogConfig(moduleBundle.payload)
            nextSessions = mergeSessionCatalogForImport(nextSessions, incoming)
            continue
          }
          if (moduleBundle.module === 'automation') {
            const incoming = normalizeAutomationStorage(moduleBundle.payload)
            nextAutomation = mergeAutomationConfigForImport(nextAutomation, incoming)
            continue
          }
          if (moduleBundle.module === 'command-catalog') {
            const incoming = normalizeCatalogConfig(moduleBundle.payload)
            nextCommandCatalog = mergeCommandCatalogForImport(nextCommandCatalog, incoming)
            continue
          }
          if (moduleBundle.module === 'command-explain') {
            const incoming = normalizeUserExplainRules(moduleBundle.payload)
            nextExplainRules = mergeExplainRulesForImport(nextExplainRules, incoming)
            continue
          }
          if (moduleBundle.module === 'glossary') {
            const incoming = normalizeGlossaryEntriesForImport(moduleBundle.payload)
            for (const entry of incoming) {
              const key = `${entry.domain ?? 'common'}|${entry.matchType ?? 'exact'}|${entry.source.toLowerCase()}|${entry.target.toLowerCase()}`
              if (glossaryKeySet.has(key)) {
                continue
              }
              try {
                glossaryPayload = await window.termbridge.upsertGlossaryEntry({
                  source: entry.source,
                  target: entry.target,
                  domain: entry.domain,
                  matchType: entry.matchType,
                  caseInsensitive: entry.caseInsensitive,
                  note: entry.note,
                  uiOnly: entry.uiOnly,
                  wholeWord: entry.wholeWord,
                })
                glossaryKeySet.add(key)
                glossaryImported += 1
              } catch {
                glossaryFailed += 1
              }
            }
          }
        }

        if (nextSessions !== sessionCatalogConfig) {
          persistSessionCatalog(nextSessions)
        }
        if (nextAutomation !== automationConfig) {
          persistAutomationConfig(nextAutomation)
        }
        if (nextCommandCatalog !== commandCatalogConfig) {
          persistCommandCatalog(nextCommandCatalog)
        }
        if (nextExplainRules !== userExplainRules) {
          setUserExplainRules(nextExplainRules)
        }
        if (glossaryPayload) {
          applyGlossaryPayload(glossaryPayload, 'imported')
        }

        window.alert(
          [
            '全部模块导入完成',
            `会话: ${nextSessions.sessions.length}`,
            `自动化: ${nextAutomation.scripts.length}`,
            `命令检索: ${nextCommandCatalog.entries.length}`,
            `配置解读: ${nextExplainRules.length}`,
            `词库新增: ${glossaryImported}${glossaryFailed > 0 ? `（失败 ${glossaryFailed}）` : ''}`,
          ].join('\n'),
        )
      } catch {
        window.alert('导入失败：JSON 格式无效')
      }
    })
  }, [
    applyGlossaryPayload,
    automationConfig,
    commandCatalogConfig,
    glossaryEntries,
    persistAutomationConfig,
    persistCommandCatalog,
    persistSessionCatalog,
    sessionCatalogConfig,
    userExplainRules,
  ])

  const importCommandExplainExchange = useCallback((): void => {
    void pickJsonFileText().then((raw) => {
      if (!raw) {
        return
      }
      try {
        const parsed = JSON.parse(raw) as DataExchangeBundle
        if (parsed.schema !== DATA_EXCHANGE_SCHEMA || parsed.module !== 'command-explain') {
          window.alert('导入失败：文件不是配置解读交换包')
          return
        }
        const incoming = normalizeUserExplainRules(parsed.payload)
        const merged = mergeExplainRulesForImport(userExplainRules, incoming)
        setUserExplainRules(merged)
        window.alert(`导入完成：规则总数 ${merged.length}`)
      } catch {
        window.alert('导入失败：JSON 格式无效')
      }
    })
  }, [userExplainRules])

  const handleAddAutomationGroup = useCallback(
    (label: string): void => {
      const normalizedLabel = label.trim()
      if (normalizedLabel.length === 0) {
        return
      }

      const baseId = normalizedLabel.toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, '-')
      const finalBase = baseId.length > 0 ? baseId : 'custom'
      const existingIds = new Set(automationConfig.groups.map((group) => group.id))
      let id = finalBase
      let suffix = 1
      while (existingIds.has(id)) {
        id = `${finalBase}-${suffix}`
        suffix += 1
      }

      persistAutomationConfig({
        ...automationConfig,
        groups: [...automationConfig.groups, { id, label: normalizedLabel, system: false }],
      })
    },
    [automationConfig, persistAutomationConfig],
  )

  const handleDeleteAutomationGroup = useCallback(
    (group: AutomationGroup): void => {
      if (group.system) {
        return
      }

      const confirmed = window.confirm(`确定删除自动化分组「${group.label}」？\n该分组下脚本会一起删除。`)
      if (!confirmed) {
        return
      }

      persistAutomationConfig({
        ...automationConfig,
        groups: automationConfig.groups.filter((item) => item.id !== group.id),
        scripts: automationConfig.scripts.filter((script) => script.groupId !== group.id),
      })
    },
    [automationConfig, persistAutomationConfig],
  )

  const handleReorderAutomationGroups = useCallback(
    (sourceGroupId: string, targetGroupId: string): void => {
      if (sourceGroupId === targetGroupId) {
        return
      }

      const groups = [...automationConfig.groups]
      const sourceIndex = groups.findIndex((group) => group.id === sourceGroupId)
      const targetIndex = groups.findIndex((group) => group.id === targetGroupId)
      if (sourceIndex < 0 || targetIndex < 0) {
        return
      }

      const [moved] = groups.splice(sourceIndex, 1)
      groups.splice(targetIndex, 0, moved)
      persistAutomationConfig({
        ...automationConfig,
        groups,
      })
    },
    [automationConfig, persistAutomationConfig],
  )

  const handleSaveAutomationScript = useCallback(
    (script: Omit<AutomationScript, 'updatedAt'>): void => {
      const nextScript: AutomationScript = {
        ...script,
        updatedAt: new Date().toISOString(),
      }

      const existingIndex = automationConfig.scripts.findIndex((item) => item.id === script.id)
      if (existingIndex >= 0) {
        const nextScripts = [...automationConfig.scripts]
        nextScripts[existingIndex] = nextScript
        persistAutomationConfig({
          ...automationConfig,
          scripts: nextScripts,
        })
        return
      }

      persistAutomationConfig({
        ...automationConfig,
        scripts: [nextScript, ...automationConfig.scripts],
      })
    },
    [automationConfig, persistAutomationConfig],
  )

  const handleDeleteAutomationScript = useCallback(
    (script: AutomationScript): void => {
      const confirmed = window.confirm(`确定删除脚本「${script.name}」？`)
      if (!confirmed) {
        return
      }

      persistAutomationConfig({
        ...automationConfig,
        scripts: automationConfig.scripts.filter((item) => item.id !== script.id),
      })
    },
    [automationConfig, persistAutomationConfig],
  )

  const handleBulkDeleteAutomationGroups = useCallback((groupIds: string[]): void => {
    const targets = new Set(
      groupIds.filter((id) => automationConfig.groups.some((group) => group.id === id && !group.system)),
    )
    if (targets.size === 0) {
      return
    }
    persistAutomationConfig({
      ...automationConfig,
      groups: automationConfig.groups.filter((group) => !targets.has(group.id)),
      scripts: automationConfig.scripts.filter((script) => !targets.has(script.groupId)),
    })
  }, [automationConfig, persistAutomationConfig])

  const handleBulkDeleteAutomationScripts = useCallback((scriptIds: string[]): void => {
    const targets = new Set(scriptIds)
    if (targets.size === 0) {
      return
    }
    persistAutomationConfig({
      ...automationConfig,
      scripts: automationConfig.scripts.filter((script) => !targets.has(script.id)),
    })
  }, [automationConfig, persistAutomationConfig])

  const handleReorderAutomationScripts = useCallback(
    (sourceScriptId: string, targetScriptId: string): void => {
      if (sourceScriptId === targetScriptId) {
        return
      }

      const scripts = [...automationConfig.scripts]
      const sourceIndex = scripts.findIndex((script) => script.id === sourceScriptId)
      const targetIndex = scripts.findIndex((script) => script.id === targetScriptId)
      if (sourceIndex < 0 || targetIndex < 0) {
        return
      }

      const [moved] = scripts.splice(sourceIndex, 1)
      scripts.splice(targetIndex, 0, moved)
      persistAutomationConfig({
        ...automationConfig,
        scripts,
      })
    },
    [automationConfig, persistAutomationConfig],
  )

  const clearVisibleTerminalForTab = useCallback((tabId: string): void => {
    terminalTabBuffersRef.current.set(tabId, '')
    terminalTabLogsRef.current.set(tabId, [])
    if (tabId === activeTerminalTabIdRef.current) {
      renderTerminalTabBuffer(tabId)
      runSnapshotNow()
    }
  }, [renderTerminalTabBuffer, runSnapshotNow])

  const exportVisibleTerminalForTab = useCallback(async (
    tabId: string,
    autoPathTemplate?: string,
  ): Promise<TermbridgeSessionLogExportResult> => {
    const tabTitle = terminalTabs.find((tab) => tab.id === tabId)?.title ?? tabId
    const sessionName = terminalTabSessionNameRef.current.get(tabId) ?? tabTitle
    const activeTerm = termRef.current
    const renderedText =
      activeTerm && tabId === activeTerminalTabIdRef.current
        ? readRenderedTerminalText(activeTerm)
        : ''
    const fullBuffer = terminalTabBuffersRef.current.get(tabId) ?? ''
    const cleanText =
      renderedText.length > 0
        ? renderedText
        : sanitizeTerminalExportText(stripAnsiSequences(fullBuffer))
    const jsonl = cleanText.length > 0
      ? JSON.stringify({
        ts: new Date().toISOString(),
        tabId,
        direction: 'output',
        data: cleanText,
        snapshot: true,
      })
      : ''

    const result = await window.termbridge.exportSessionLog({
      tabId,
      tabTitle,
      sessionName,
      cleanText,
      jsonl,
      autoPathTemplate,
    })
    if (!result) {
      setSessionExportStatus(autoPathTemplate ? '自动导出失败' : '导出已取消')
      return null
    }
    setSessionExportStatus(`${autoPathTemplate ? '已自动导出' : '已导出当前显示文本'}：${result.txtPath}`)
    return result
  }, [terminalTabs])

  const waitForOutputSettleBeforeExport = useCallback(async (tabId: string, timeoutMs = 90_000): Promise<boolean> => {
    const startedAt = Date.now()
    let seenPager = false
    while (Date.now() - startedAt <= timeoutMs) {
      const alive = terminalTabAliveRef.current.get(tabId) ?? false
      if (!alive) {
        return false
      }

      const activeTerm = termRef.current
      const recentLines = activeTerm && tabId === activeTerminalTabIdRef.current
        ? readVisibleTerminalTailLines(activeTerm, 3)
        : readTailLinesFromBuffer(terminalTabBuffersRef.current.get(tabId) ?? '', 3)
      const hasHuaweiReturnTail = recentLines.some((line) => line.toLocaleLowerCase().includes('return'))
      const hasPagerInRecentLines = recentLines.some((line) => isPagerPromptLine(line))
      if (hasHuaweiReturnTail || !hasPagerInRecentLines) {
        if (hasHuaweiReturnTail) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 500)
          })
          return true
        }
        if (seenPager) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 500)
          })
          return true
        }
      }
      if (hasPagerInRecentLines) {
        seenPager = true
      }
      // Active paging: send space until return appears or pager disappears after being seen.
      writeToTabImmediateWithLog(tabId, ' ')
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 800)
      })
    }
    return false
  }, [writeToTabImmediateWithLog])

  const waitForPromptReady = useCallback(async (tabId: string, timeoutMs: number): Promise<boolean> => {
    const settled = await waitForOutputSettleBeforeExport(tabId, timeoutMs)
    if (!settled) {
      return false
    }
    const activeTerm = termRef.current
    const recentLines = activeTerm && tabId === activeTerminalTabIdRef.current
      ? readVisibleTerminalTailLines(activeTerm, 3)
      : readTailLinesFromBuffer(terminalTabBuffersRef.current.get(tabId) ?? '', 3)
    const lastLine = recentLines[recentLines.length - 1] ?? ''
    if (isPromptLikeTailLine(lastLine)) {
      return true
    }
    return recentLines.some((line) => line.toLocaleLowerCase().includes('return'))
  }, [waitForOutputSettleBeforeExport])

  const handleRunAutomationScript = useCallback((script: AutomationScript): void => {
    const command = script.content.trim()
    if (command.length === 0) {
      return
    }

    if (script.risk === 'destructive') {
      const confirmed = window.confirm(`确认执行危险自动化脚本？\n\n${script.name}`)
      if (!confirmed) {
        return
      }
    }

    const tabId = activeTerminalTabIdRef.current
    if (!(terminalTabAliveRef.current.get(tabId) ?? false)) {
      setSessionExportStatus('当前标签会话已断开，请先重连或新建标签')
      return
    }
    if (automationRunningByTabRef.current.get(tabId)) {
      setSessionExportStatus('当前标签已有自动化任务在执行，请稍后再试')
      return
    }
    automationRunningByTabRef.current.set(tabId, true)

    void (async () => {
      try {
        const hasActionToken = /(?:^|\n)\s*(?:app\.(?:clear_view|clear|export_visible|export_text)|term\.(?:wait_prompt|send|send_all|send_tabs|mode)\b|session\.run_tag_group\b|time\.sleep\b)/m
          .test(script.content)
        if (!hasActionToken) {
          writeToTabImmediateWithLog(tabId, command.endsWith('\n') ? command : `${command}\n`)
          return
        }

        const steps = parseAutomationSteps(script.content)
        if (steps.length === 0) {
          return
        }

        const resolveTargetTabs = (selector: string): string[] => {
          const tabs = terminalTabsRef.current
          const tokens = selector
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
          if (tokens.length === 0) {
            return []
          }
          if (tokens.length === 1 && /^(?:all|\*)$/i.test(tokens[0])) {
            return tabs
              .map((tab) => tab.id)
              .filter((id) => terminalTabAliveRef.current.get(id) ?? false)
          }

          const byId = new Map(tabs.map((tab) => [tab.id.toLocaleLowerCase(), tab.id]))
          const byTitle = new Map(tabs.map((tab) => [tab.title.trim().toLocaleLowerCase(), tab.id]))
          const resolved: string[] = []
          const seen = new Set<string>()
          for (const token of tokens) {
            const lowered = token.toLocaleLowerCase()
            let resolvedId: string | undefined
            if (byId.has(lowered)) {
              resolvedId = byId.get(lowered)
            } else if (byTitle.has(lowered)) {
              resolvedId = byTitle.get(lowered)
            } else if (/^\d+$/.test(token)) {
              const index = Number.parseInt(token, 10) - 1
              const tab = tabs[index]
              if (tab) {
                resolvedId = tab.id
              }
            }
            if (!resolvedId) {
              continue
            }
            if (seen.has(resolvedId)) {
              continue
            }
            seen.add(resolvedId)
            if (terminalTabAliveRef.current.get(resolvedId) ?? false) {
              resolved.push(resolvedId)
            }
          }
          return resolved
        }

        const resolveTabsByRoutingMode = (): string[] => {
          if (routingMode === 'all') {
            return terminalTabsRef.current
              .map((tab) => tab.id)
              .filter((id) => terminalTabAliveRef.current.get(id) ?? false)
          }
          if (routingMode === 'tabs') {
            return resolveTargetTabs(routingSelector)
          }
          return [tabId].filter((id) => terminalTabAliveRef.current.get(id) ?? false)
        }

        const sendCommandToTargets = (targetTabIds: string[], commandText: string): number => {
          const payload = commandText.endsWith('\n') ? commandText : `${commandText}\n`
          let sent = 0
          for (const targetId of targetTabIds) {
            if (!(terminalTabAliveRef.current.get(targetId) ?? false)) {
              continue
            }
            writeToTabImmediateWithLog(targetId, payload)
            sent += 1
          }
          return sent
        }

        let routingMode: 'current' | 'all' | 'tabs' = 'current'
        let routingSelector = ''
        let autoExportCount = 0
        let autoExportDir = ''

        for (const step of steps) {
          if (!(terminalTabAliveRef.current.get(tabId) ?? false)) {
            setSessionExportStatus('自动化中断：连接已断开')
            return
          }

          if (step.kind === 'clearView') {
            const targetTabs = resolveTabsByRoutingMode()
            if (targetTabs.length === 0) {
              setSessionExportStatus(`自动化中断：清屏目标终端为空 (${script.name})`)
              return
            }
            for (const targetId of targetTabs) {
              clearVisibleTerminalForTab(targetId)
            }
            setSessionExportStatus(`自动化进行中：已清空 ${targetTabs.length} 个终端视图 (${script.name})`)
            continue
          }

          if (step.kind === 'exportVisible') {
            setSessionExportStatus(`自动化进行中：导出当前显示文本 (${script.name})`)
            const targetTabs = resolveTabsByRoutingMode()
            if (targetTabs.length === 0) {
              setSessionExportStatus(`自动化中断：导出目标终端为空 (${script.name})`)
              return
            }
            for (const targetId of targetTabs) {
              const settled = await waitForOutputSettleBeforeExport(targetId)
              if (!settled) {
                const targetTitle = terminalTabsRef.current.find((tab) => tab.id === targetId)?.title ?? targetId
                setSessionExportStatus(`自动化中断：等待输出完成超时/断开 (${targetTitle})`)
                return
              }
              const exported = await exportVisibleTerminalForTab(targetId)
              if (!exported) {
                setSessionExportStatus('自动化中断：导出被取消或失败')
                return
              }
            }
            continue
          }

          if (step.kind === 'exportVisibleTo') {
            setSessionExportStatus(`自动化进行中：自动落盘导出 (${script.name})`)
            const targetTabs = resolveTabsByRoutingMode()
            if (targetTabs.length === 0) {
              setSessionExportStatus(`自动化中断：导出目标终端为空 (${script.name})`)
              return
            }
            for (const targetId of targetTabs) {
              const settled = await waitForOutputSettleBeforeExport(targetId)
              if (!settled) {
                const targetTitle = terminalTabsRef.current.find((tab) => tab.id === targetId)?.title ?? targetId
                setSessionExportStatus(`自动化中断：等待输出完成超时/断开 (${targetTitle})`)
                return
              }
              const exported = await exportVisibleTerminalForTab(targetId, step.pathTemplate)
              if (!exported) {
                setSessionExportStatus('自动化中断：自动导出失败')
                return
              }
              autoExportCount += 1
              if (autoExportDir.length === 0) {
                autoExportDir = extractDirectoryPath(exported.txtPath)
              }
            }
            continue
          }

          if (step.kind === 'waitPrompt') {
            setSessionExportStatus(`自动化进行中：等待提示符 (${script.name})`)
            const targetTabs = resolveTabsByRoutingMode()
            if (targetTabs.length === 0) {
              setSessionExportStatus(`自动化中断：等待提示符失败，目标终端为空 (${script.name})`)
              return
            }
            for (const targetId of targetTabs) {
              const ready = await waitForPromptReady(targetId, step.timeoutMs)
              if (!ready) {
                const targetTitle = terminalTabsRef.current.find((tab) => tab.id === targetId)?.title ?? targetId
                setSessionExportStatus(`自动化中断：等待提示符超时/断开 (${targetTitle})`)
                return
              }
            }
            continue
          }

          if (step.kind === 'send') {
            const nextCommand = step.command.trim().length > 0 ? step.command : ''
            if (nextCommand.length === 0) {
              continue
            }
            if (routingMode === 'all') {
              const targetTabs = terminalTabsRef.current
                .map((tab) => tab.id)
                .filter((id) => terminalTabAliveRef.current.get(id) ?? false)
              if (targetTabs.length === 0) {
                setSessionExportStatus(`自动化中断：没有可用终端可广播 (${script.name})`)
                return
              }
              sendCommandToTargets(targetTabs, nextCommand)
              continue
            }
            if (routingMode === 'tabs') {
              const targetTabs = resolveTargetTabs(routingSelector)
              if (targetTabs.length === 0) {
                setSessionExportStatus(`自动化中断：广播目标为空 (${routingSelector})`)
                return
              }
              sendCommandToTargets(targetTabs, nextCommand)
              continue
            }
            writeToTabImmediateWithLog(tabId, nextCommand.endsWith('\n') ? nextCommand : `${nextCommand}\n`)
            continue
          }

          if (step.kind === 'sendAll') {
            const nextCommand = step.command.trim().length > 0 ? step.command : ''
            if (nextCommand.length === 0) {
              continue
            }
            const targetTabs = terminalTabsRef.current
              .map((tab) => tab.id)
              .filter((id) => terminalTabAliveRef.current.get(id) ?? false)
            if (targetTabs.length === 0) {
              setSessionExportStatus(`自动化中断：没有可用终端可广播 (${script.name})`)
              return
            }
            const sent = sendCommandToTargets(targetTabs, nextCommand)
            setSessionExportStatus(`自动化进行中：已广播到 ${sent} 个终端 (${script.name})`)
            continue
          }

          if (step.kind === 'sendTabs') {
            const nextCommand = step.command.trim().length > 0 ? step.command : ''
            if (nextCommand.length === 0) {
              continue
            }
            const targetTabs = resolveTargetTabs(step.selector)
            if (targetTabs.length === 0) {
              setSessionExportStatus(`自动化中断：未匹配到可用终端 (${step.selector})`)
              return
            }
            const sent = sendCommandToTargets(targetTabs, nextCommand)
            setSessionExportStatus(`自动化进行中：已发送到 ${sent} 个指定终端 (${script.name})`)
            continue
          }

          if (step.kind === 'setMode') {
            routingMode = step.mode
            routingSelector = step.selector?.trim() ?? ''
            if (routingMode === 'all') {
              setSessionExportStatus(`自动化进行中：已切换为广播模式 (${script.name})`)
            } else if (routingMode === 'tabs') {
              setSessionExportStatus(`自动化进行中：已切换为指定终端模式 (${routingSelector || '-'})`)
            } else {
              setSessionExportStatus(`自动化进行中：已恢复当前终端模式 (${script.name})`)
            }
            continue
          }

          if (step.kind === 'runTagGroup') {
            const targetTagGroup = sessionCatalogConfig.tagGroups.find((group) => group.label === step.label || group.id === step.label)
            if (!targetTagGroup) {
              setSessionExportStatus(`自动化中断：未找到标签分组 (${step.label})`)
              return
            }
            const launched = runSessionTagGroup(targetTagGroup.id, step.target)
            if (launched <= 0) {
              setSessionExportStatus(`自动化中断：标签分组无可用设备 (${step.label})`)
              return
            }
            continue
          }

          if (step.kind === 'sleep') {
            setSessionExportStatus(`自动化进行中：等待 ${step.timeoutMs}ms (${script.name})`)
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, step.timeoutMs)
            })
            continue
          }
        }

        routingMode = 'current'
        routingSelector = ''
        if (autoExportCount > 0) {
          const summaryDir = autoExportDir.length > 0 ? autoExportDir : '(目录未知)'
          window.alert(`自动导出完成\n导出终端数：${autoExportCount}\n目录：${summaryDir}`)
        }
        setSessionExportStatus(`自动化已完成：${script.name}（广播模式已自动关闭）`)
      } finally {
        automationRunningByTabRef.current.set(tabId, false)
      }
    })()
  }, [clearVisibleTerminalForTab, exportVisibleTerminalForTab, runSessionTagGroup, sessionCatalogConfig.tagGroups, waitForOutputSettleBeforeExport, waitForPromptReady, writeToTabImmediateWithLog])

  const updateAppSettings = useCallback((next: AppSettings): void => {
    const normalized = normalizeAppSettings(next)
    const normalizedSlots = normalizeDockSlots(commandDockSlots, normalized.dockSlots)
    setAppSettings(normalized)
    setCommandDockSlots(normalizedSlots)
    try {
      window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(normalized))
      window.localStorage.setItem(COMMAND_DOCK_SLOTS_STORAGE_KEY, JSON.stringify(normalizedSlots))
    } catch {
      // ignore localStorage write failures
    }
  }, [commandDockSlots])

  const updateTranslationPolicy = useCallback(
    async (nextPolicy: TranslationPolicy): Promise<void> => {
      const currentConfig = translationConfigRef.current
      if (!currentConfig) {
        return
      }

      const normalized = normalizeTranslationPolicy(nextPolicy)
      translationPolicyRef.current = normalized
      setTranslationPolicy(normalized)
      setTranslationPolicyStatus('saving')
      runSnapshotNow()

      try {
        const payload = await window.termbridge.saveTranslationConfig({
          ...currentConfig,
          mirror: normalized,
        })
        applyTranslationConfigPayload(payload, 'saved')
      } catch {
        setTranslationPolicyStatus('save_failed')
      }
    },
    [applyTranslationConfigPayload, runSnapshotNow],
  )

  const saveTranslationConfigFromSettings = useCallback(
    async (nextConfig: TermbridgeTranslationConfig): Promise<void> => {
      setTranslationConfigStatus('saving')
      try {
        const payload = await window.termbridge.saveTranslationConfig(nextConfig)
        applyTranslationConfigPayload(payload, 'saved')
      } catch {
        setTranslationConfigStatus('save_failed')
      }
    },
    [applyTranslationConfigPayload],
  )

  const deleteGlossaryEntry = useCallback(
    async (entry: GlossaryEntry): Promise<boolean> => {
      if (!entry.id) {
        return false
      }

      setGlossaryStatus('deleting')
      try {
        const payload = await window.termbridge.deleteGlossaryEntry({ id: entry.id })
        applyGlossaryPayload(payload, 'deleted')
        return true
      } catch {
        setGlossaryStatus('delete_failed')
        return false
      }
    },
    [applyGlossaryPayload],
  )

  const saveGlossaryEntry = useCallback(
    async (entry: GlossaryEntryUpsertInput, successStatus: string): Promise<GlossaryEntry | null> => {
      setGlossaryStatus('saving')

      try {
        const payload = await window.termbridge.upsertGlossaryEntry(entry)
        applyGlossaryPayload(payload, successStatus)
        if (entry.id) {
          return payload.entries.find((item) => item.id === entry.id) ?? findLocalGlossaryMatch(entry.source, payload.entries)
        }
        const domain = entry.domain ?? 'common'
        return (
          payload.entries.find(
            (item) => item.source === entry.source && item.target === entry.target && (item.domain ?? 'common') === domain,
          ) ?? findLocalGlossaryMatch(entry.source, payload.entries)
        )
      } catch {
        setGlossaryStatus('save_failed')
        return null
      }
    },
    [applyGlossaryPayload],
  )

  useEffect(() => {
    let active = true

    void window.termbridge
      .loadGlossary()
      .then((payload) => {
        if (!active) {
          return
        }

        glossaryEntriesRef.current = payload.entries
        setGlossaryPath(payload.path)
        setGlossaryEntryCount(payload.entries.length)
        setGlossaryStatus('loaded')
        runSnapshotRef.current?.()
      })
      .catch(() => {
        if (!active) {
          return
        }

        setGlossaryStatus('load_failed')
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    void window.termbridge
      .loadTranslationConfig()
      .then((payload) => {
        if (!active) {
          return
        }

        applyTranslationConfigPayload(payload, 'loaded')
      })
      .catch(() => {
        if (!active) {
          return
        }

        setTranslationConfig(null)
        setTranslationConfigStatus('load_failed')
        translationPolicyRef.current = DEFAULT_TRANSLATION_POLICY
        setTranslationPolicy(DEFAULT_TRANSLATION_POLICY)
        setTranslationPolicyStatus('load_failed')
      })

    return () => {
      active = false
    }
  }, [applyTranslationConfigPayload])

  useEffect(() => {
    let active = true

    void window.termbridge
      .loadContexts()
      .then((payload) => {
        if (!active) {
          return
        }

        applyCommandConfigPayload(payload)
      })
      .catch(() => {
        if (!active) {
          return
        }

        // keep defaults on load failure
      })

    return () => {
      active = false
    }
  }, [applyCommandConfigPayload])

  useEffect(() => {
    let active = true
    void loadBuiltinExplainers().then((loaded) => {
      if (!active) {
        return
      }
      setBuiltinExplainRules(loaded)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(COMMAND_EXPLAIN_RULES_STORAGE_KEY, JSON.stringify(userExplainRules))
    } catch {
      // ignore localStorage write failures
    }
  }, [userExplainRules])

  const mirrorScreenToRender = useMemo(() => {
    if (rightMirrorMode === 'source') {
      return baseScreen
    }

    return translatedScreen.rowCount > 0 ? translatedScreen : baseScreen
  }, [rightMirrorMode, translatedScreen, baseScreen])

  const closeSelectionFloatingUi = useCallback((): void => {
    selectionTranslateReqSeqRef.current += 1
    setSelectionMenu(null)
    setLeftContextMenu(null)
    setSelectionPopover(null)
    setSelectionPopoverStatus('')
    setSelectionOnlinePending(false)
    setCommandExplainPopover(null)
    setCommandExplainDraft(null)
    setCommandExplainStatus('')
    setParamContextMenu(null)
    paramContextMenuTargetRef.current = null
  }, [])

  const handleParamMenuCopy = useCallback((): void => {
    const target = paramContextMenuTargetRef.current
    if (!target) {
      return
    }
    const start = typeof target.selectionStart === 'number' ? target.selectionStart : 0
    const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : 0
    const copiedText =
      end > start ? target.value.slice(start, end) : target.value
    void copyTextToClipboard(copiedText)
    setParamContextMenu(null)
    paramContextMenuTargetRef.current = null
  }, [])

  const handleParamMenuPaste = useCallback((): void => {
    const target = paramContextMenuTargetRef.current
    if (!target || target.readOnly || target.disabled) {
      return
    }
    void navigator.clipboard.readText()
      .then((text) => {
        if (text.length === 0) {
          return
        }
        const start = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length
        const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : target.value.length
        target.setRangeText(text, start, end, 'end')
        target.dispatchEvent(new Event('input', { bubbles: true }))
      })
      .finally(() => {
        setParamContextMenu(null)
        paramContextMenuTargetRef.current = null
      })
  }, [])

  useEffect(() => {
    const onContextMenu = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        return
      }
      if (!target.closest('.command-search-panel, .session-panel, .automation-panel')) {
        return
      }

      event.preventDefault()
      const menuPosition = clampFloatingPosition(
        event.clientX,
        event.clientY,
        FLOATING_MENU_WIDTH_PX,
        140,
      )
      paramContextMenuTargetRef.current = target
      setParamContextMenu({
        x: menuPosition.x,
        y: menuPosition.y,
        hasSelection:
          typeof target.selectionStart === 'number' &&
          typeof target.selectionEnd === 'number' &&
          target.selectionEnd > target.selectionStart,
      })
    }

    window.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      window.removeEventListener('contextmenu', onContextMenu, true)
    }
  }, [])

  const readMirrorSelectionText = useCallback((): string => {
    const frame = mirrorFrameRef.current
    if (!frame) {
      return ''
    }

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      return ''
    }

    const range = selection.getRangeAt(0)
    if (!frame.contains(range.commonAncestorContainer)) {
      return ''
    }

    const fromGrid = normalizeMirrorSelectionText(readMirrorTextFromSelectionRange(range).replace(/\u00a0/g, ' '))
    if (fromGrid.trim().length > 0) {
      return fromGrid
    }

    return normalizeMirrorSelectionText(selection.toString())
  }, [])

  const openSelectionPopover = useCallback((state: SelectionPopoverState, status = ''): void => {
    const normalizedOriginal = normalizeMirrorSelectionText(state.originalText)
    const normalizedTranslated = normalizeMirrorSelectionText(state.translatedText)

    setSelectionPopover({
      ...state,
      originalText: normalizedOriginal,
      translatedText: normalizedTranslated,
    })
    setSelectionDraftTranslation(normalizedTranslated)
    setSelectionPopoverStatus(status)
  }, [])

  const translateSelectionWithOnline = useCallback(
    async (
      selectedText: string,
      provider: TermbridgeTranslationProvider,
    ): Promise<{
      translatedText: string
      protectedSegments: string[]
      provider: TermbridgeTranslationProvider
    }> => {
      const protectedRanges = findSelectionProtectedRanges(selectedText)
      const chunks = buildSelectionChunks(selectedText, protectedRanges)
      const protectedSegments = Array.from(
        new Set(
          protectedRanges
            .map((range) => selectedText.slice(range.start, range.end))
            .filter((segment) => segment.trim().length > 0),
        ),
      )

      let resolvedProvider: TermbridgeTranslationProvider = provider
      const translatedChunks: string[] = []

      for (const chunk of chunks) {
        if (chunk.protected || chunk.text.trim().length === 0) {
          translatedChunks.push(chunk.text)
          continue
        }

        const result = await window.termbridge.translateOnline({
          text: chunk.text,
          sourceLang: 'en',
          targetLang: 'zh-CN',
          provider,
        })
        resolvedProvider = result.provider
        translatedChunks.push(result.translatedText.length > 0 ? result.translatedText : chunk.text)
      }

      return {
        translatedText: translatedChunks.join(''),
        protectedSegments,
        provider: resolvedProvider,
      }
    },
    [],
  )

  const saveSelectionToGlossary = useCallback(
    async (sourceText: string, targetText: string, localEntry: GlossaryEntry | null): Promise<void> => {
      const source = sourceText.trim()
      const target = targetText.trim()
      if (source.length < 2 || target.length === 0) {
        setSelectionPopoverStatus('源文本或译文不能为空')
        return
      }

      setSelectionPopoverStatus('保存中...')
      const nextEntry: GlossaryEntryUpsertInput = {
        id: localEntry?.id,
        source,
        target,
        matchType: localEntry?.matchType ?? 'exact',
        caseInsensitive: localEntry?.caseInsensitive ?? false,
        note: localEntry?.note ?? '',
        domain: localEntry?.domain ?? getPreferredGlossaryDomain(activeNetworkHints),
        uiOnly: localEntry?.uiOnly,
        wholeWord: localEntry?.wholeWord,
      }

      const saved = await saveGlossaryEntry(nextEntry, localEntry ? 'updated' : 'saved')
      if (!saved) {
        setSelectionPopoverStatus('保存失败，请重试')
        return
      }

      setSelectionPopover((previous) => {
        if (!previous) {
          return previous
        }

        return {
          ...previous,
          source: 'local',
          onlineProvider: undefined,
          localEntry: saved,
          translatedText: target,
        }
      })
      setSelectionPopoverStatus(localEntry ? '本地翻译已更新' : '已保存到本地词库')
    },
    [activeNetworkHints, saveGlossaryEntry],
  )

  const onMirrorContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      const selectedText = readMirrorSelectionText()
      if (selectedText.length === 0) {
        setSelectionMenu(null)
        return
      }

      event.preventDefault()
      const position = clampFloatingPosition(event.clientX, event.clientY, FLOATING_MENU_WIDTH_PX, FLOATING_MENU_HEIGHT_PX)
      const localEntry = findLocalGlossaryMatch(selectedText, glossaryEntriesRef.current)

      setSelectionMenu({
        x: position.x,
        y: position.y,
        text: selectedText,
        localEntry,
      })
      setSelectionPopover(null)
      setSelectionPopoverStatus('')
      setCommandExplainPopover(null)
      setCommandExplainDraft(null)
      setCommandExplainStatus('')
    },
    [readMirrorSelectionText],
  )

  const onLeftTerminalContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const term = termRef.current
    const selectedText = term ? normalizeMirrorSelectionText(term.getSelection()) : ''
    const position = clampFloatingPosition(event.clientX, event.clientY, FLOATING_MENU_WIDTH_PX, FLOATING_MENU_HEIGHT_PX)
    setLeftContextMenu({
      x: position.x,
      y: position.y,
      selectedText,
    })
    setSelectionMenu(null)
    setSelectionPopover(null)
    setCommandExplainPopover(null)
  }, [])

  const onLeftMenuCopy = useCallback((): void => {
    if (!leftContextMenu || leftContextMenu.selectedText.length === 0) {
      return
    }
    void copyTextToClipboard(leftContextMenu.selectedText)
    setLeftContextMenu(null)
  }, [leftContextMenu])

  const onLeftMenuPaste = useCallback((): void => {
    const tabId = activeTerminalTabIdRef.current
    if (!(terminalTabAliveRef.current.get(tabId) ?? false)) {
      setSessionExportStatus('当前标签会话已断开，请先重连或新建标签')
      return
    }
    void navigator.clipboard.readText()
      .then((text) => {
        if (text.length === 0) {
          return
        }
        const normalized = normalizeTerminalInputData(text)
        appendTerminalTabLog(tabId, 'input', normalized)
        ptyClient.writePaste(tabId, normalized)
      })
      .catch(() => {
        setSessionExportStatus('读取剪贴板失败')
      })
      .finally(() => {
        setLeftContextMenu(null)
      })
  }, [appendTerminalTabLog])

  const onLeftMenuClear = useCallback((): void => {
    const tabId = activeTerminalTabIdRef.current
    clearVisibleTerminalForTab(tabId)
    setLeftContextMenu(null)
  }, [clearVisibleTerminalForTab])

  const onLeftMenuExport = useCallback((): void => {
    const tabId = activeTerminalTabIdRef.current
    void exportVisibleTerminalForTab(tabId)
    setLeftContextMenu(null)
  }, [exportVisibleTerminalForTab])

  const onApplySyntaxHighlightFromText = useCallback((rawText: string): void => {
    const normalized = normalizeMirrorSelectionText(rawText).replace(/\s+/g, ' ').trim()
    if (normalized.length === 0) {
      return
    }

    const activeTabId = activeTerminalTabIdRef.current
    const hints = networkHintsByTabRef.current.get(activeTabId) ?? defaultNetworkHints
    const scope = resolveHighlightScope(activeContextIdRef.current, hints)

    setAppSettings((previous) => {
      const exists = previous.syntaxHighlightRules.some(
        (rule) => rule.scope === scope && rule.matchType === 'contains' && rule.pattern.toLowerCase() === normalized.toLowerCase(),
      )

      const nextRules = exists
        ? previous.syntaxHighlightRules.map((rule) => {
          if (rule.scope === scope && rule.matchType === 'contains' && rule.pattern.toLowerCase() === normalized.toLowerCase()) {
            return {
              ...rule,
              enabled: true,
            }
          }
          return rule
        })
        : [
          ...previous.syntaxHighlightRules,
          {
            id: `hl-quick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            label: `高亮 ${normalized.slice(0, 16)}`,
            scope,
            matchType: 'contains',
            styleMode: 'background',
            pattern: normalized,
            color: '#22c55e',
            enabled: true,
          },
        ]

      const nextSettings = normalizeAppSettings({
        ...previous,
        syntaxHighlightRules: nextRules,
      })

      try {
        window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings))
      } catch {
        // ignore localStorage write failures
      }
      return nextSettings
    })
    setSessionExportStatus(`已添加语法高亮：${normalized}`)
  }, [])

  const onSelectionMenuSyntaxHighlight = useCallback((): void => {
    if (!selectionMenu) {
      return
    }
    onApplySyntaxHighlightFromText(selectionMenu.text)
    setSelectionMenu(null)
  }, [onApplySyntaxHighlightFromText, selectionMenu])

  const onLeftMenuSyntaxHighlight = useCallback((): void => {
    if (!leftContextMenu || leftContextMenu.selectedText.trim().length === 0) {
      return
    }
    onApplySyntaxHighlightFromText(leftContextMenu.selectedText)
    setLeftContextMenu(null)
  }, [leftContextMenu, onApplySyntaxHighlightFromText])

  const onSelectionMenuCopy = useCallback((): void => {
    if (!selectionMenu) {
      return
    }

    void copyTextToClipboard(selectionMenu.text)
    setSelectionMenu(null)
  }, [selectionMenu])

  const runOnlineSelectionTranslate = useCallback((
    selectedText: string,
    provider: TermbridgeTranslationProvider,
  ): void => {
    const requestSeq = selectionTranslateReqSeqRef.current + 1
    selectionTranslateReqSeqRef.current = requestSeq
    setSelectionOnlinePending(true)
    setSelectionPopoverStatus(`在线翻译中... (${translationProviderLabel(provider)})`)
    window.setTimeout(() => {
      if (selectionTranslateReqSeqRef.current !== requestSeq) {
        return
      }
      setSelectionPopoverStatus(`在线翻译较慢，可手动重试或切换翻译来源 (${translationProviderLabel(provider)})`)
    }, 3500)

    void translateSelectionWithOnline(selectedText, provider)
      .then((onlineResult) => {
        if (selectionTranslateReqSeqRef.current !== requestSeq) {
          return
        }
        const normalizedOnlineText = normalizeMirrorSelectionText(onlineResult.translatedText)
        setSelectionPopover((previous) => {
          if (!previous || previous.originalText !== selectedText) {
            return previous
          }

          return {
            ...previous,
            translatedText: normalizedOnlineText,
            source: 'online',
            onlineProvider: onlineResult.provider,
            localEntry: null,
            protectedSegments: onlineResult.protectedSegments,
          }
        })
        setSelectionDraftTranslation(normalizedOnlineText)
        setSelectionOnlinePending(false)
        setSelectionPopoverStatus(`在线翻译完成 (${translationProviderLabel(onlineResult.provider)})，可按需修正后添加到本地词库`)
      })
      .catch((error: unknown) => {
        if (selectionTranslateReqSeqRef.current !== requestSeq) {
          return
        }
        const fallback = translateSelectionText(selectedText, glossaryEntriesRef.current)
        const fallbackText = normalizeMirrorSelectionText(
          fallback.translated.trim().length > 0 ? fallback.translated : selectedText,
        )
        const errorMessage = shortenErrorMessage(readErrorMessage(error))

        setSelectionPopover((previous) => {
          if (!previous || previous.originalText !== selectedText) {
            return previous
          }

          return {
            ...previous,
            translatedText: fallbackText,
            source: fallback.source,
            onlineProvider: undefined,
            localEntry: fallback.localEntry,
            protectedSegments: fallback.protectedSegments,
          }
        })
        setSelectionDraftTranslation(fallbackText)
        setSelectionOnlinePending(false)
        setSelectionPopoverStatus(`在线翻译失败：${errorMessage}。可手动重试或切换翻译来源`)
      })
  }, [translateSelectionWithOnline])

  const onSelectionMenuTranslate = useCallback((): void => {
    if (!selectionMenu) {
      return
    }

    const selectedText = selectionMenu.text
    const localEntry = selectionMenu.localEntry
    const position = clampFloatingPosition(
      selectionMenu.x + 12,
      selectionMenu.y + 12,
      FLOATING_POPOVER_WIDTH_PX,
      FLOATING_POPOVER_HEIGHT_PX,
    )
    setSelectionMenu(null)

    if (localEntry) {
      selectionTranslateReqSeqRef.current += 1
      setSelectionOnlinePending(false)
      openSelectionPopover(
        {
          x: position.x,
          y: position.y,
          originalText: localEntry.source,
          translatedText: localEntry.target,
          source: 'local',
          onlineProvider: undefined,
          localEntry,
          protectedSegments: [],
        },
        '已命中本地词库，可继续修正后重新保存',
      )
      return
    }

    const localPreview = translateSelectionText(selectedText, glossaryEntriesRef.current)
    const initialTranslation =
      localPreview.translated.trim().length > 0 ? localPreview.translated : selectedText
    const provider = translationConfigRef.current?.defaultProvider ?? 'google-free'
    setSelectionOnlineProvider(provider)

    openSelectionPopover(
      {
        x: position.x,
        y: position.y,
        originalText: selectedText,
        translatedText: initialTranslation,
        source: 'online',
        onlineProvider: undefined,
        localEntry: null,
        protectedSegments: localPreview.protectedSegments,
      },
      `在线翻译中... (${translationProviderLabel(provider)})`,
    )

    runOnlineSelectionTranslate(selectedText, provider)
  }, [selectionMenu, openSelectionPopover, runOnlineSelectionTranslate])

  const onSelectionMenuSave = useCallback((): void => {
    if (!selectionMenu) {
      return
    }

    const translation = translateSelectionText(selectionMenu.text, glossaryEntriesRef.current)
    const targetText = normalizeMirrorSelectionText(
      translation.translated.trim().length > 0 ? translation.translated : selectionMenu.text,
    )
    const position = clampFloatingPosition(
      selectionMenu.x + 12,
      selectionMenu.y + 12,
      FLOATING_POPOVER_WIDTH_PX,
      FLOATING_POPOVER_HEIGHT_PX,
    )

    setSelectionPopover({
      x: position.x,
      y: position.y,
      originalText: selectionMenu.text,
      translatedText: targetText,
      source: translation.source,
      onlineProvider: undefined,
      localEntry: selectionMenu.localEntry ?? translation.localEntry,
      protectedSegments: translation.protectedSegments,
    })
    setSelectionDraftTranslation(targetText)
    selectionTranslateReqSeqRef.current += 1
    setSelectionPopoverStatus('请确认译文后点击“添加到本地词库”')
    setSelectionOnlinePending(false)
    setSelectionMenu(null)
  }, [selectionMenu])

  const onSelectionMenuEdit = useCallback((): void => {
    if (!selectionMenu || !selectionMenu.localEntry) {
      return
    }

    const position = clampFloatingPosition(
      selectionMenu.x + 12,
      selectionMenu.y + 12,
      FLOATING_POPOVER_WIDTH_PX,
      FLOATING_POPOVER_HEIGHT_PX,
    )

    setSelectionPopover({
      x: position.x,
      y: position.y,
      originalText: selectionMenu.localEntry.source,
      translatedText: selectionMenu.localEntry.target,
      source: 'local',
      onlineProvider: undefined,
      localEntry: selectionMenu.localEntry,
      protectedSegments: [],
    })
    setSelectionDraftTranslation(selectionMenu.localEntry.target)
    selectionTranslateReqSeqRef.current += 1
    setSelectionPopoverStatus('')
    setSelectionOnlinePending(false)
    setSelectionMenu(null)
  }, [selectionMenu])

  const onSelectionPopoverRetry = useCallback((): void => {
    if (!selectionPopover) {
      return
    }
    runOnlineSelectionTranslate(selectionPopover.originalText, selectionOnlineProvider)
  }, [runOnlineSelectionTranslate, selectionOnlineProvider, selectionPopover])

  const onSelectionPopoverUseLocal = useCallback((): void => {
    if (!selectionPopover) {
      return
    }
    const local = translateSelectionText(selectionPopover.originalText, glossaryEntriesRef.current)
    const translated = normalizeMirrorSelectionText(
      local.translated.trim().length > 0 ? local.translated : selectionPopover.originalText,
    )
    setSelectionPopover((previous) => {
      if (!previous) {
        return previous
      }
      return {
        ...previous,
        translatedText: translated,
        source: local.source,
        onlineProvider: undefined,
        localEntry: local.localEntry,
        protectedSegments: local.protectedSegments,
      }
    })
    setSelectionDraftTranslation(translated)
    setSelectionOnlinePending(false)
    setSelectionPopoverStatus('已切换到本地翻译来源')
  }, [selectionPopover])

  const openCommandExplainFromText = useCallback(
    (selectedText: string, x: number, y: number): void => {
      const normalized = normalizeMirrorSelectionText(selectedText)
      if (normalized.trim().length === 0) {
        return
      }

      const context = resolveExplainContext(activeContextIdRef.current, activeNetworkHints)
      const matched = explainCommandByRules(normalized, context, builtinExplainRules, userExplainRules)
      const position = clampFloatingPosition(
        x + 12,
        y + 12,
        FLOATING_POPOVER_WIDTH_PX,
        FLOATING_POPOVER_HEIGHT_PX,
      )

      const localRule = matched.matchedRuleId
        ? userExplainRules.find((rule) => rule.id === matched.matchedRuleId) ?? null
        : null

      setCommandExplainPopover({
        x: position.x,
        y: position.y,
        selectedText: normalized,
        normalizedCommand: matched.normalized,
        context,
        source: matched.source,
        title: matched.title,
        explanation: matched.explanation,
        risk: matched.risk,
        args: matched.args,
        examples: matched.examples,
        matchedRuleId: localRule?.id ?? null,
      })
      setCommandExplainDraft({
        id: localRule?.id,
        title: matched.title,
        explanation: matched.explanation,
        risk: matched.risk,
        matcherType: localRule?.matcherType ?? 'prefix',
        pattern: localRule?.pattern ?? matched.normalized,
        argsText: (matched.args ?? []).join('\n'),
        examplesText: (matched.examples ?? []).join('\n'),
      })
      setCommandExplainStatus(matched.source === 'none' ? '未命中本地规则，可保存为自定义解释' : '')
      setSelectionMenu(null)
      setSelectionPopover(null)
      setSelectionPopoverStatus('')
    },
    [activeNetworkHints, builtinExplainRules, userExplainRules],
  )

  const onSelectionMenuExplainCommand = useCallback((): void => {
    if (!selectionMenu) {
      return
    }
    openCommandExplainFromText(selectionMenu.text, selectionMenu.x, selectionMenu.y)
  }, [openCommandExplainFromText, selectionMenu])

  const onLeftMenuExplainCommand = useCallback((): void => {
    if (!leftContextMenu || leftContextMenu.selectedText.trim().length === 0) {
      return
    }
    openCommandExplainFromText(leftContextMenu.selectedText, leftContextMenu.x, leftContextMenu.y)
    setLeftContextMenu(null)
  }, [leftContextMenu, openCommandExplainFromText])

  const onCommandExplainCopy = useCallback((): void => {
    if (!commandExplainPopover) {
      return
    }
    const content = [
      `命令: ${commandExplainPopover.selectedText}`,
      `上下文: ${commandExplainPopover.context}`,
      `风险: ${commandExplainPopover.risk}`,
      `标题: ${commandExplainPopover.title}`,
      `说明: ${commandExplainPopover.explanation}`,
      commandExplainPopover.args.length > 0 ? `参数:\n${commandExplainPopover.args.join('\n')}` : '',
      commandExplainPopover.examples.length > 0 ? `示例:\n${commandExplainPopover.examples.join('\n')}` : '',
    ]
      .filter((line) => line.length > 0)
      .join('\n')
    void copyTextToClipboard(content).then((copied) => {
      setCommandExplainStatus(copied ? '解释已复制' : '复制失败')
    })
  }, [commandExplainPopover])

  const onCommandExplainSaveLocalRule = useCallback((): void => {
    if (!commandExplainPopover || !commandExplainDraft) {
      return
    }
    const title = commandExplainDraft.title.trim()
    const explanation = commandExplainDraft.explanation.trim()
    const pattern = commandExplainDraft.pattern.trim()
    if (title.length === 0 || explanation.length === 0 || pattern.length === 0) {
      setCommandExplainStatus('标题、说明、匹配模式不能为空')
      return
    }

    const isExisting = Boolean(
      commandExplainDraft.id && userExplainRules.some((rule) => rule.id === commandExplainDraft.id),
    )

    const nextRules = upsertUserExplainRule(userExplainRules, {
      id: isExisting ? commandExplainDraft.id : undefined,
      context: commandExplainPopover.context,
      matcherType: commandExplainDraft.matcherType,
      pattern,
      title,
      explanation,
      risk: commandExplainDraft.risk,
      args: commandExplainDraft.argsText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
      examples: commandExplainDraft.examplesText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    })
    setUserExplainRules(nextRules)

    const refreshed = explainCommandByRules(
      commandExplainPopover.selectedText,
      commandExplainPopover.context,
      builtinExplainRules,
      nextRules,
    )
    setCommandExplainPopover((previous) => {
      if (!previous) {
        return previous
      }
      const matchedRuleId =
        refreshed.matchedRuleId && nextRules.some((rule) => rule.id === refreshed.matchedRuleId)
          ? refreshed.matchedRuleId
          : null
      return {
        ...previous,
        source: refreshed.source,
        title: refreshed.title,
        explanation: refreshed.explanation,
        risk: refreshed.risk,
        args: refreshed.args,
        examples: refreshed.examples,
        matchedRuleId,
      }
    })
    setCommandExplainDraft((previous) => {
      if (!previous) {
        return previous
      }
      return {
        ...previous,
        id: refreshed.matchedRuleId ?? previous.id,
      }
    })
    setCommandExplainStatus(isExisting ? '本地解释规则已更新' : '已保存到本地解释规则')
  }, [builtinExplainRules, commandExplainDraft, commandExplainPopover, userExplainRules])

  const onCommandExplainEditExisting = useCallback((): void => {
    if (!commandExplainPopover) {
      return
    }
    const existing = commandExplainPopover.matchedRuleId
      ? userExplainRules.find((rule) => rule.id === commandExplainPopover.matchedRuleId) ?? null
      : null
    if (!existing) {
      setCommandExplainStatus('当前命令还没有本地解释规则')
      return
    }
    setCommandExplainDraft({
      id: existing.id,
      title: existing.title,
      explanation: existing.explanation,
      risk: existing.risk,
      matcherType: existing.matcherType,
      pattern: existing.pattern,
      argsText: (existing.args ?? []).join('\n'),
      examplesText: (existing.examples ?? []).join('\n'),
    })
    setCommandExplainStatus('已加载本地规则，可直接编辑后保存')
  }, [commandExplainPopover, userExplainRules])

  const onCommandExplainOnline = useCallback((): void => {
    setCommandExplainStatus('可选在线解释入口已预留，当前版本先使用本地规则')
  }, [])

  const onSelectionPopoverCopy = useCallback((): void => {
    if (!selectionPopover) {
      return
    }

    const value = selectionDraftTranslation.trim().length > 0 ? selectionDraftTranslation : selectionPopover.translatedText
    void copyTextToClipboard(value).then((copied) => {
      setSelectionPopoverStatus(copied ? '译文已复制' : '复制失败')
    })
  }, [selectionPopover, selectionDraftTranslation])

  const onSelectionPopoverSave = useCallback((): void => {
    if (!selectionPopover) {
      return
    }

    const sourceText = selectionPopover.localEntry?.source ?? selectionPopover.originalText
    void saveSelectionToGlossary(sourceText, selectionDraftTranslation, selectionPopover.localEntry)
  }, [selectionPopover, selectionDraftTranslation, saveSelectionToGlossary])

  useEffect(() => {
    if (!selectionMenu && !leftContextMenu && !selectionPopover && !commandExplainPopover && !paramContextMenu) {
      return
    }

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (selectionMenuRef.current?.contains(target)) {
        return
      }

      if (leftContextMenuRef.current?.contains(target)) {
        return
      }

      if (selectionPopoverRef.current?.contains(target)) {
        return
      }

      if (commandExplainPopoverRef.current?.contains(target)) {
        return
      }

      if (paramContextMenuRef.current?.contains(target)) {
        return
      }

      closeSelectionFloatingUi()
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeSelectionFloatingUi()
      }
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [commandExplainPopover, leftContextMenu, paramContextMenu, selectionMenu, selectionPopover, closeSelectionFloatingUi])

  const updateRightViewport = (nextViewportY: number): void => {
    const term = termRef.current
    if (!term) {
      return
    }

    const maxViewportY = term.buffer.active.baseY
    const clampedViewportY = clamp(nextViewportY, 0, maxViewportY)
    rightViewportYRef.current = clampedViewportY
    followRightBottomRef.current = clampedViewportY >= maxViewportY
    runSnapshotNow()
  }

  const onMirrorWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setSelectionMenu(null)

    const deltaLines = normalizeWheelLines(event.deltaY, event.deltaMode, cellMetrics.height)
    if (deltaLines === 0) {
      return
    }

    updateRightViewport(rightViewportYRef.current + deltaLines)
  }

  const onMirrorKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const term = termRef.current
    if (!term) {
      return
    }

    setSelectionMenu(null)

    if (event.key === 'Home') {
      event.preventDefault()
      updateRightViewport(0)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      updateRightViewport(term.buffer.active.baseY)
      return
    }

    let deltaLines = 0
    if (event.key === 'ArrowUp') {
      deltaLines = -1
    } else if (event.key === 'ArrowDown') {
      deltaLines = 1
    } else if (event.key === 'PageUp') {
      deltaLines = -Math.max(1, Math.floor(term.rows * 0.8))
    } else if (event.key === 'PageDown') {
      deltaLines = Math.max(1, Math.floor(term.rows * 0.8))
    }

    if (deltaLines === 0) {
      return
    }

    event.preventDefault()
    updateRightViewport(rightViewportYRef.current + deltaLines)
  }

  const onSplitterMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setIsDraggingSplitter(true)
  }

  useEffect(() => {
    if (!isDraggingSplitter) {
      return
    }

    const onMouseMove = (event: MouseEvent): void => {
      const paneWrap = paneWrapRef.current
      if (!paneWrap) {
        return
      }

      const bounds = paneWrap.getBoundingClientRect()
      const availableWidth = bounds.width - SPLITTER_WIDTH_PX
      if (availableWidth <= MIN_PANE_WIDTH_PX * 2) {
        return
      }

      const rawLeftWidth = event.clientX - bounds.left - SPLITTER_WIDTH_PX / 2
      const leftWidth = clamp(rawLeftWidth, MIN_PANE_WIDTH_PX, availableWidth - MIN_PANE_WIDTH_PX)
      const ratio = leftWidth / availableWidth
      setLeftPaneRatio((previous) => (Math.abs(previous - ratio) < 0.001 ? previous : ratio))
    }

    const onMouseUp = (): void => {
      setIsDraggingSplitter(false)
    }

    const previousCursor = document.body.style.cursor
    const previousSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelect
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDraggingSplitter])

  useEffect(() => {
    const fitAndResize = fitAndResizeRef.current
    if (!fitAndResize) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      fitAndResize()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [leftPaneRatio])

  useEffect(() => {
    const host = leftHostRef.current
    if (!host) {
      return
    }

    const { term, fitAddon } = createXterm(host)
    termRef.current = term

    let timer: ReturnType<typeof setTimeout> | null = null
    let idleHandle: number | null = null

    const idleWindow = window as WindowWithIdleCallback

    const cancelIdleSnapshot = (): void => {
      if (idleHandle === null) {
        return
      }

      if (typeof idleWindow.cancelIdleCallback === 'function') {
        idleWindow.cancelIdleCallback(idleHandle)
      }
      idleHandle = null
    }

    const updateCellMetrics = (): void => {
      const measured = readCellMetrics(term)
      setCellMetrics((previous) => {
        if (
          Math.abs(previous.width - measured.width) < 0.01 &&
          Math.abs(previous.height - measured.height) < 0.01
        ) {
          return previous
        }

        return measured
      })
    }

    const runSnapshot = (): void => {
      const currentTerm = termRef.current
      if (!currentTerm) {
        return
      }

      const maxViewportY = currentTerm.buffer.active.baseY
      if (followRightBottomRef.current) {
        rightViewportYRef.current = maxViewportY
      } else {
        rightViewportYRef.current = clamp(rightViewportYRef.current, 0, maxViewportY)
      }

      const snapshot = buildBufferSnapshot(currentTerm, rightViewportYRef.current)
      rightViewportYRef.current = snapshot.viewportY
      const translation = buildTranslationPatches(
        snapshot,
        scanRunsRef.current,
        glossaryEntriesRef.current,
        translationPolicyRef.current,
        {
          glossaryDomainOrder: getGlossaryDomainOrder(
            networkHintsByTabRef.current.get(activeTerminalTabIdRef.current) ?? defaultNetworkHints,
          ),
        },
      )
      scanRunsRef.current = translation.stats.scanRuns

      setBaseScreen(snapshot.screen)
      setTranslatedScreen(applyInlinePatches(snapshot.screen, translation.inlinePatches))
      setMarkers(translation.markers)
      setStats(translation.stats)

      if (autoDetectContextRef.current) {
        const detectedContextId = detectAutoContextId(
          snapshot.screen.rows.map((row) => row.text),
          commandConfigRef.current.contexts,
        )

        if (detectedContextId && detectedContextId !== activeContextIdRef.current) {
          activeContextIdRef.current = detectedContextId
          setActiveContextId(detectedContextId)
        }
      }
    }

    const scheduleSnapshot = (): void => {
      if (timer) {
        clearTimeout(timer)
      }

      timer = setTimeout(() => {
        timer = null

        if (scanRunsRef.current < FAST_BOOT_SNAPSHOT_RUNS) {
          cancelIdleSnapshot()
          runSnapshot()
          return
        }

        cancelIdleSnapshot()
        if (typeof idleWindow.requestIdleCallback === 'function') {
          idleHandle = idleWindow.requestIdleCallback(() => {
            idleHandle = null
            runSnapshot()
          }, { timeout: SNAPSHOT_IDLE_TIMEOUT_MS })
          return
        }

        runSnapshot()
      }, SNAPSHOT_DEBOUNCE_MS)
    }

    const fitAndResize = (): void => {
      fitAddon.fit()
      updateCellMetrics()
      for (const tabId of terminalTabOrderRef.current) {
        void ptyClient.resize(tabId, term.cols, term.rows)
      }
      scheduleSnapshot()
    }

    runSnapshotRef.current = runSnapshot
    fitAndResizeRef.current = fitAndResize

    const offPtyData = ptyClient.onData(({ tabId, data }) => {
      appendTerminalTabBuffer(tabId, data)
      appendTerminalTabLog(tabId, 'output', data)

      const tail = (terminalTabBuffersRef.current.get(tabId) ?? '').slice(-5000)
      const previousHints = networkHintsByTabRef.current.get(tabId) ?? defaultNetworkHints
      let nextHints = detectNetworkHints(tail, previousHints)

      if (nextHints.autoPager && nextHints.pagerDetected) {
        const previousRuns = autoPagerRunsByTabRef.current.get(tabId) ?? 0
        const shouldRunAutoPager =
          !previousHints.pagerDetected || previousHints.pagerToken !== nextHints.pagerToken
        if (shouldRunAutoPager && previousRuns < 30) {
          autoPagerRunsByTabRef.current.set(tabId, previousRuns + 1)
          writeToTabImmediateWithLog(tabId, ' ')
        }
        if (previousRuns >= 30) {
          nextHints = {
            ...nextHints,
            autoPager: false,
          }
        }
      }

      if (!nextHints.pagerDetected && nextHints.mode !== 'unknown') {
        autoPagerRunsByTabRef.current.set(tabId, 0)
      }

      updateNetworkHintsForTab(tabId, nextHints)

      if (tabId === activeTerminalTabIdRef.current) {
        term.write(data)
      }
      scheduleSnapshot()
    })

    const offPtyExit = ptyClient.onExit(({ tabId, exitCode, source }) => {
      const currentTransport = terminalTabTransportRef.current.get(tabId) ?? 'pty'
      const exitSource: TerminalTransport = source === 'local' ? 'local' : 'pty'
      if (currentTransport !== exitSource) {
        return
      }
      updateTabAliveState(tabId, false)
      const exitMessage = exitSource === 'local'
        ? '\r\n[local disconnected]\r\n'
        : `\r\n[pty exited: ${exitCode}]\r\n`
      appendTerminalTabBuffer(tabId, exitMessage)
      appendTerminalTabLog(tabId, 'output', exitMessage)
      if (tabId === activeTerminalTabIdRef.current) {
        term.write(exitMessage)
      }
      if (exitSource === 'local') {
        restoreTabToShell(tabId, '\r\n[returned to local shell]\r\n')
      }
      scheduleSnapshot()
    })

    term.onData((data) => {
      const activeTabId = activeTerminalTabIdRef.current
      if (!(terminalTabAliveRef.current.get(activeTabId) ?? false)) {
        return
      }
      const normalizedInput = normalizeTerminalInputData(data)
      appendTerminalTabLog(activeTabId, 'input', normalizedInput)
      if (isLikelyPasteInput(normalizedInput)) {
        ptyClient.writePaste(activeTabId, normalizedInput)
        return
      }

      ptyClient.write(activeTabId, normalizedInput)
    })

    term.onResize(({ cols, rows }) => {
      for (const tabId of terminalTabOrderRef.current) {
        void ptyClient.resize(tabId, cols, rows)
      }
      updateCellMetrics()
      scheduleSnapshot()
    })

    const onWindowResize = (): void => {
      fitAndResize()
    }

    window.addEventListener('resize', onWindowResize)

    fitAndResize()
    const initialTabId = activeTerminalTabIdRef.current
    void ptyClient.spawn(initialTabId, term.cols, term.rows).then((spawned) => {
      updateTabAliveState(initialTabId, spawned)
      if (spawned) {
        updateTabTransport(initialTabId, 'pty')
      }
      if (spawned) {
        const maxViewportY = term.buffer.active.baseY
        rightViewportYRef.current = maxViewportY
        followRightBottomRef.current = true
      }
      scheduleSnapshot()
    })

    return () => {
      if (timer) {
        clearTimeout(timer)
      }
      cancelIdleSnapshot()
      offPtyData()
      offPtyExit()
      window.removeEventListener('resize', onWindowResize)
      for (const tabId of terminalTabOrderRef.current) {
        void ptyClient.kill(tabId)
      }
      term.dispose()
      runSnapshotRef.current = null
      fitAndResizeRef.current = null
      termRef.current = null
    }
  }, [appendTerminalTabBuffer, appendTerminalTabLog, restoreTabToShell, updateNetworkHintsForTab, updateTabAliveState, updateTabTransport, writeToTabImmediateWithLog])

  useEffect(() => {
    const term = termRef.current
    if (!term) {
      return
    }

    term.options.theme = resolveXtermTheme(appSettings.theme, {
      background: appSettings.terminalBackground,
      foreground: appSettings.terminalForeground,
    })
  }, [appSettings.terminalBackground, appSettings.terminalForeground, appSettings.theme])

  const headerTitle = useMemo(
    () => (isDev ? 'TMT-Terminal-mirror-translation (dev)' : 'TMT-Terminal-mirror-translation'),
    [],
  )
  const activeHighlightScope = useMemo<SyntaxHighlightRule['scope']>(
    () => resolveHighlightScope(activeContextId, activeNetworkHints),
    [activeContextId, activeNetworkHints],
  )
  const selectionProviderOptions = useMemo(
    () => resolveSelectionProviderOptions(translationConfig),
    [translationConfig],
  )
  const shellStyle = useMemo(
    () =>
      ({
        '--term-font-family': TERMINAL_DISPLAY.fontFamily,
        '--term-font-size': `${TERMINAL_DISPLAY.fontSize * appSettings.fontScale}px`,
        '--term-line-height': `${TERMINAL_DISPLAY.lineHeight}`,
        '--term-letter-spacing': `${TERMINAL_DISPLAY.letterSpacing}px`,
        '--row-height': `${cellMetrics.height}px`,
        '--terminal-bg': appSettings.terminalBackground,
        '--terminal-fg': appSettings.terminalForeground,
      }) as CSSProperties,
    [appSettings.fontScale, appSettings.terminalBackground, appSettings.terminalForeground, cellMetrics.height],
  )

  useEffect(() => {
    const term = termRef.current
    if (!term) {
      return
    }

    term.options.fontSize = Math.max(10, Math.round(TERMINAL_DISPLAY.fontSize * appSettings.fontScale))
    fitAndResizeRef.current?.()
  }, [appSettings.fontScale])

  return (
    <div
      className={`app-shell app-shell-theme-${appSettings.theme}${appSettings.compactUi ? ' app-shell-compact' : ''}`}
      style={shellStyle}
    >
      <header className="app-header">
        <div className="app-header-main">
          <div className="app-header-title">{headerTitle}</div>
          <div className="app-header-actions">
            <button
              className={`app-header-button${sidePanelMode === 'sessions' ? ' app-header-button-active' : ''}`}
              onClick={openSessionManager}
              title="会话管理（SSH）"
            >
              会话管理
            </button>
          </div>
        </div>
      </header>
      <main className={`pane-wrap${isDraggingSplitter ? ' is-dragging' : ''}`} ref={paneWrapRef}>
        <section className="pane pane-left" style={{ flexBasis: `${leftPaneRatio * 100}%` }}>
          <div className="pane-head">
            <div className="terminal-tabs" role="tablist" aria-label="Terminal tabs">
              {terminalTabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`terminal-tab${tab.id === activeTerminalTabId ? ' terminal-tab-active' : ''}`}
                  role="tab"
                  aria-selected={tab.id === activeTerminalTabId}
                  onClick={() => handleSwitchTerminalTab(tab.id)}
                  draggable
                  onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => {
                    setDraggingTerminalTabId(tab.id)
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(event: ReactDragEvent<HTMLButtonElement>) => {
                    event.preventDefault()
                  }}
                  onDrop={(event: ReactDragEvent<HTMLButtonElement>) => {
                    event.preventDefault()
                    if (draggingTerminalTabId && draggingTerminalTabId !== tab.id) {
                      handleReorderTerminalTabs(draggingTerminalTabId, tab.id)
                    }
                    setDraggingTerminalTabId(null)
                  }}
                  onDragEnd={() => setDraggingTerminalTabId(null)}
                >
                  <span className="terminal-tab-label">{tab.title}</span>
                  {terminalTabs.length > 1 ? (
                    <span
                      className="terminal-tab-close"
                      role="button"
                      aria-label={`Close ${tab.title}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        handleCloseTerminalTab(tab.id)
                      }}
                    >
                      ×
                    </span>
                  ) : null}
                </button>
              ))}
              <button
                className="terminal-tab terminal-tab-add"
                aria-label="Create terminal tab"
                onClick={handleCreateTerminalTab}
              >
                +
              </button>
            </div>
          </div>
          <div className="terminal-host-wrap" onContextMenu={onLeftTerminalContextMenu}>
            <div ref={leftHostRef} className="terminal-host" />
            <LeftHighlightOverlay
              screen={baseScreen}
              cellWidth={cellMetrics.width}
              cellHeight={cellMetrics.height}
              rules={appSettings.syntaxHighlightRules}
              activeScope={activeHighlightScope}
              opacity={appSettings.leftHighlightOpacity}
            />
          </div>
        </section>

        <div
          className="pane-splitter"
          role="separator"
          aria-label="Resize panes"
          aria-orientation="vertical"
          aria-valuemin={20}
          aria-valuemax={80}
          aria-valuenow={Math.round(leftPaneRatio * 100)}
          onMouseDown={onSplitterMouseDown}
        />

        <section className="pane pane-right" style={{ flexBasis: `${(1 - leftPaneRatio) * 100}%` }}>
          <div className="pane-head">
            <div className="pane-title">
              {rightMirrorMode === 'translated' ? 'Translated Mirror' : 'Original Mirror'}
            </div>
            <div className="pane-head-actions">
              <button
                className={`debug-button${sidePanelMode === 'glossary' ? ' toolbar-button-active' : ''}`}
                onClick={openGlossaryManager}
                title="管理本地词库"
              >
                词库
              </button>
              <button
                className={`debug-button${sidePanelMode === 'automation' ? ' toolbar-button-active' : ''}`}
                onClick={() => toggleSidePanel('automation')}
                title="自动化脚本"
              >
                自动化
              </button>
              <button
                className={`debug-button${sidePanelMode === 'commandSearch' ? ' toolbar-button-active' : ''}`}
                onClick={() => toggleSidePanel('commandSearch')}
                title="命令检索与说明"
              >
                命令检索
              </button>
              <button
                className={`debug-button${sidePanelMode === 'commandExplain' ? ' toolbar-button-active' : ''}`}
                onClick={() => toggleSidePanel('commandExplain')}
                title="配置解读规则库"
              >
                配置解读
              </button>
              <button
                className={`debug-button${sidePanelMode === 'settings' ? ' toolbar-button-active' : ''}`}
                onClick={() => toggleSidePanel('settings')}
                title="系统与界面设置"
              >
                设置
              </button>
              <button
                className={`mirror-view-button${rightMirrorMode === 'source' ? ' mirror-view-button-active' : ''}`}
                onClick={toggleRightMirrorMode}
                title="切换右侧原文/翻译对照"
              >
                {rightMirrorMode === 'translated' ? '查看原文' : '查看翻译'}
              </button>
              {appSettings.showDebugButton && (
                <DebugToggle
                  stats={stats}
                  glossaryPath={glossaryPath}
                  glossaryEntryCount={glossaryEntryCount}
                  glossaryStatus={glossaryStatus}
                  onReloadGlossary={reloadGlossary}
                  onImportGlossary={importGlossary}
                  onExportGlossary={exportGlossary}
                />
              )}
            </div>
          </div>
          <div
            className="mirror-frame"
            role="region"
            ref={mirrorFrameRef}
            tabIndex={0}
            aria-label={rightMirrorMode === 'translated' ? 'Translated mirror terminal viewport' : 'Original mirror terminal viewport'}
            onWheel={onMirrorWheel}
            onKeyDown={onMirrorKeyDown}
            onContextMenu={onMirrorContextMenu}
          >
            <MirrorRenderer
              screen={mirrorScreenToRender}
              cellWidth={cellMetrics.width}
              cellHeight={cellMetrics.height}
              highlightRules={appSettings.syntaxHighlightRules}
              activeScope={activeHighlightScope}
            />
            {rightMirrorMode === 'translated' && <MarkerLayer markers={markers} />}
          </div>
          <GlossaryManagerModal
            isOpen={sidePanelMode === 'glossary'}
            entries={glossaryEntries}
            onDeleteEntry={deleteGlossaryEntry}
            onClose={closeSidePanel}
            onImportGlossary={importGlossary}
            onExportGlossary={exportGlossary}
            onOpenTranslationStrategy={openTranslationStrategy}
          />
          <TranslationStrategyPanel
            isOpen={sidePanelMode === 'strategy'}
            policy={translationPolicy}
            status={translationPolicyStatus}
            onClose={closeSidePanel}
            onChange={(nextPolicy) => {
              void updateTranslationPolicy(nextPolicy)
            }}
          />
          <CommandSearchPanel
            isOpen={sidePanelMode === 'commandSearch'}
            config={commandCatalogConfig}
            onClose={closeSidePanel}
            onRunCommand={handleRunCatalogCommand}
            onCopyCommand={handleCopyCatalogCommand}
            onAddGroup={handleAddCatalogGroup}
            onDeleteGroup={handleDeleteCatalogGroup}
            onReorderGroups={handleReorderCatalogGroups}
            onAddEntry={handleAddCatalogEntry}
            onDeleteEntry={handleDeleteCatalogEntry}
            onReorderEntries={handleReorderCatalogEntries}
            onResetSystemEntries={handleResetCatalogSystemEntries}
            onBulkDeleteGroups={handleBulkDeleteCatalogGroups}
            onBulkDeleteEntries={handleBulkDeleteCatalogEntries}
            onExportData={exportCommandCatalogExchange}
            onImportData={importCommandCatalogExchange}
          />
          <CommandExplainPanel
            isOpen={sidePanelMode === 'commandExplain'}
            onClose={closeSidePanel}
            builtinByContext={builtinExplainRules}
            userRules={userExplainRules}
            onUpsertUserRule={handleUpsertUserExplainRule}
            onDeleteUserRule={handleDeleteUserExplainRule}
            onBulkDeleteUserRules={handleBulkDeleteUserExplainRules}
            onBulkDeleteContexts={handleBulkDeleteExplainContexts}
            onExportData={exportCommandExplainExchange}
            onImportData={importCommandExplainExchange}
          />
          <AutomationPanel
            isOpen={sidePanelMode === 'automation'}
            config={automationConfig}
            onClose={closeSidePanel}
            onRunScript={handleRunAutomationScript}
            onSaveScript={handleSaveAutomationScript}
            onDeleteScript={handleDeleteAutomationScript}
            onAddGroup={handleAddAutomationGroup}
            onDeleteGroup={handleDeleteAutomationGroup}
            onReorderGroups={handleReorderAutomationGroups}
            onReorderScripts={handleReorderAutomationScripts}
            onBulkDeleteGroups={handleBulkDeleteAutomationGroups}
            onBulkDeleteScripts={handleBulkDeleteAutomationScripts}
            onExportData={exportAutomationExchange}
            onImportData={importAutomationExchange}
          />
          <SessionManagerPanel
            isOpen={sidePanelMode === 'sessions'}
            config={sessionCatalogConfig}
            onClose={closeSidePanel}
            onAddGroup={handleAddSessionGroup}
            onDeleteGroup={handleDeleteSessionGroup}
            onReorderGroups={handleReorderSessionGroups}
            onUpsertSession={handleUpsertSession}
            onBulkCreateSessions={handleBulkCreateSessions}
            onBulkDeleteGroups={handleBulkDeleteSessionGroups}
            onBulkDeleteSessions={handleBulkDeleteSessions}
            onDeleteSession={handleDeleteSession}
            onReorderSessions={handleReorderSessions}
            onConnectCurrentTab={handleConnectSessionCurrentTab}
            onConnectNewTab={handleConnectSessionNewTab}
            onUpsertTagGroup={handleUpsertSessionTagGroup}
            onDeleteTagGroup={handleDeleteSessionTagGroup}
            onConnectTagGroupCurrent={handleConnectSessionTagGroupCurrent}
            onConnectTagGroupNew={handleConnectSessionTagGroupNew}
            onUpsertLocalPortPack={handleUpsertLocalPortPack}
            onDeleteLocalPortPack={handleDeleteLocalPortPack}
            onExportCurrentTabLog={() => {
              void handleExportCurrentTabLog()
            }}
            onExportData={exportSessionExchange}
            onImportData={importSessionExchange}
            exportStatus={sessionExportStatus}
          />
          <SettingsPanel
            isOpen={sidePanelMode === 'settings'}
            settings={appSettings}
            activeHighlightScope={activeHighlightScope}
            translationConfig={translationConfig}
            translationStatus={translationConfigStatus}
            onClose={closeSidePanel}
            onChange={updateAppSettings}
            onSaveTranslationConfig={saveTranslationConfigFromSettings}
            onImportGlossary={importGlossary}
            onExportGlossary={exportGlossary}
            onImportSessions={importSessionExchange}
            onExportSessions={exportSessionExchange}
            onImportAutomation={importAutomationExchange}
            onExportAutomation={exportAutomationExchange}
            onImportCommandCatalog={importCommandCatalogExchange}
            onExportCommandCatalog={exportCommandCatalogExchange}
            onImportCommandExplain={importCommandExplainExchange}
            onExportCommandExplain={exportCommandExplainExchange}
            onExportAllData={exportAllDataExchange}
            onImportAllData={importAllDataExchange}
          />
        </section>
      </main>
      {selectionMenu && (
        <div
          className="selection-context-menu"
          style={{ left: `${selectionMenu.x}px`, top: `${selectionMenu.y}px` }}
          role="menu"
          aria-label="Mirror selection menu"
          ref={selectionMenuRef}
        >
          <button className="selection-context-item" role="menuitem" onClick={onSelectionMenuCopy}>
            复制
          </button>
          <button className="selection-context-item" role="menuitem" onClick={onSelectionMenuTranslate}>
            翻译
          </button>
          <button className="selection-context-item" role="menuitem" onClick={onSelectionMenuExplainCommand}>
            配置解读
          </button>
          <button className="selection-context-item" role="menuitem" onClick={onSelectionMenuSyntaxHighlight}>
            语法高亮
          </button>
          <button className="selection-context-item" role="menuitem" onClick={onSelectionMenuSave}>
            添加到本地词库
          </button>
          <button
            className="selection-context-item"
            role="menuitem"
            onClick={onSelectionMenuEdit}
            disabled={!selectionMenu.localEntry}
          >
            编辑本地翻译
          </button>
        </div>
      )}
      {leftContextMenu && (
        <div
          className="selection-context-menu"
          style={{ left: `${leftContextMenu.x}px`, top: `${leftContextMenu.y}px` }}
          role="menu"
          aria-label="Terminal context menu"
          ref={leftContextMenuRef}
        >
          <button
            className="selection-context-item"
            role="menuitem"
            onClick={onLeftMenuCopy}
            disabled={leftContextMenu.selectedText.length === 0}
          >
            复制
          </button>
          <button className="selection-context-item" role="menuitem" onClick={onLeftMenuPaste}>
            粘贴
          </button>
          <button className="selection-context-item" role="menuitem" onClick={onLeftMenuClear}>
            清空
          </button>
          <button className="selection-context-item" role="menuitem" onClick={onLeftMenuExport}>
            导出文本
          </button>
          <button
            className="selection-context-item"
            role="menuitem"
            onClick={onLeftMenuExplainCommand}
            disabled={leftContextMenu.selectedText.trim().length === 0}
          >
            配置解读
          </button>
          <button
            className="selection-context-item"
            role="menuitem"
            onClick={onLeftMenuSyntaxHighlight}
            disabled={leftContextMenu.selectedText.trim().length === 0}
          >
            语法高亮
          </button>
        </div>
      )}
      {paramContextMenu && (
        <div
          className="selection-context-menu"
          style={{ left: `${paramContextMenu.x}px`, top: `${paramContextMenu.y}px` }}
          role="menu"
          aria-label="Param input context menu"
          ref={paramContextMenuRef}
        >
          <button className="selection-context-item" role="menuitem" onClick={handleParamMenuCopy}>
            {paramContextMenu.hasSelection ? '复制选中' : '复制全部'}
          </button>
          <button className="selection-context-item" role="menuitem" onClick={handleParamMenuPaste}>
            粘贴
          </button>
        </div>
      )}
      {selectionPopover && (
        <div
          className="selection-translate-popover"
          style={{ left: `${selectionPopover.x}px`, top: `${selectionPopover.y}px` }}
          role="dialog"
          aria-label="Selection translation"
          ref={selectionPopoverRef}
        >
          <div className="selection-popover-title">选中文本翻译</div>
          <div className="selection-popover-source">
            来源：{translationSourceLabel(selectionPopover.source, selectionPopover.onlineProvider)}
          </div>
          <div className="selection-popover-controls">
            <label className="selection-popover-label">
              翻译来源
              <select
                className="selection-popover-select"
                value={selectionOnlineProvider}
                onChange={(event) => setSelectionOnlineProvider(event.target.value as TermbridgeTranslationProvider)}
              >
                {selectionProviderOptions.map((provider) => (
                  <option key={provider} value={provider}>
                    {translationProviderLabel(provider)}
                  </option>
                ))}
              </select>
            </label>
            <button className="selection-popover-action" onClick={onSelectionPopoverUseLocal}>
              使用本地翻译
            </button>
            <button
              className="selection-popover-action"
              onClick={onSelectionPopoverRetry}
              disabled={selectionOnlinePending}
            >
              {selectionOnlinePending ? '在线请求中...' : '重新请求在线翻译'}
            </button>
          </div>
          <div className="selection-popover-grid">
            <div className="selection-popover-panel">
              <label className="selection-popover-label">原文</label>
              <textarea className="selection-popover-text" readOnly value={selectionPopover.originalText} />
            </div>
            <div className="selection-popover-panel">
              <label className="selection-popover-label">译文（可编辑）</label>
              <textarea
                className="selection-popover-text selection-popover-edit"
                value={selectionDraftTranslation}
                onChange={(event) => {
                  setSelectionDraftTranslation(event.target.value)
                  setSelectionPopoverStatus('')
                }}
              />
            </div>
          </div>
          {selectionPopover.protectedSegments.length > 0 && (
            <div className="selection-popover-protected" title={selectionPopover.protectedSegments.join(' | ')}>
              受保护片段：{selectionPopover.protectedSegments.join(' | ')}
            </div>
          )}
          {selectionPopoverStatus.length > 0 && <div className="selection-popover-status">{selectionPopoverStatus}</div>}
          <div className="selection-popover-actions">
            <button className="selection-popover-action" onClick={onSelectionPopoverCopy}>
              复制译文
            </button>
            <button className="selection-popover-action selection-popover-action-primary" onClick={onSelectionPopoverSave}>
              添加到本地词库
            </button>
            <button className="selection-popover-action" onClick={closeSelectionFloatingUi}>
              关闭
            </button>
          </div>
        </div>
      )}
      {commandExplainPopover && commandExplainDraft && (
        <div
          className="selection-translate-popover"
          style={{ left: `${commandExplainPopover.x}px`, top: `${commandExplainPopover.y}px` }}
          role="dialog"
          aria-label="Command explanation"
          ref={commandExplainPopoverRef}
        >
          <div className="selection-popover-title">配置解读</div>
          <div className="selection-popover-source">
            上下文：{commandExplainPopover.context} · 来源：{explainSourceLabel(commandExplainPopover.source)}
          </div>
          <div className="selection-popover-grid">
            <div className="selection-popover-panel">
              <label className="selection-popover-label">选中命令（只读）</label>
              <textarea className="selection-popover-text" readOnly value={commandExplainPopover.selectedText} />
              <label className="selection-popover-label">归一化</label>
              <textarea className="selection-popover-text" readOnly value={commandExplainPopover.normalizedCommand} />
            </div>
            <div className="selection-popover-panel">
              <label className="selection-popover-label">标题</label>
              <input
                className="session-input"
                value={commandExplainDraft.title}
                onChange={(event) => {
                  setCommandExplainDraft((previous) => (previous ? { ...previous, title: event.target.value } : previous))
                  setCommandExplainStatus('')
                }}
              />
              <label className="selection-popover-label">解释（中文）</label>
              <textarea
                className="selection-popover-text selection-popover-edit"
                value={commandExplainDraft.explanation}
                onChange={(event) => {
                  setCommandExplainDraft((previous) => (previous ? { ...previous, explanation: event.target.value } : previous))
                  setCommandExplainStatus('')
                }}
              />
            </div>
          </div>
          <div className="selection-popover-grid command-explain-grid">
            <div className="selection-popover-panel">
              <label className="selection-popover-label">风险</label>
              <select
                className="session-input"
                value={commandExplainDraft.risk}
                onChange={(event) => {
                  const risk = event.target.value as ExplainRisk
                  setCommandExplainDraft((previous) => (previous ? { ...previous, risk } : previous))
                }}
              >
                <option value="safe">safe</option>
                <option value="caution">caution</option>
                <option value="danger">danger</option>
              </select>
            </div>
            <div className="selection-popover-panel">
              <label className="selection-popover-label">匹配类型</label>
              <select
                className="session-input"
                value={commandExplainDraft.matcherType}
                onChange={(event) => {
                  const matcherType = event.target.value as ExplainMatcherType
                  setCommandExplainDraft((previous) => (previous ? { ...previous, matcherType } : previous))
                }}
              >
                <option value="prefix">prefix</option>
                <option value="regex">regex</option>
              </select>
            </div>
          </div>
          <div className="selection-popover-grid command-explain-grid">
            <div className="selection-popover-panel">
              <label className="selection-popover-label">匹配模式</label>
              <input
                className="session-input"
                value={commandExplainDraft.pattern}
                onChange={(event) => {
                  setCommandExplainDraft((previous) => (previous ? { ...previous, pattern: event.target.value } : previous))
                  setCommandExplainStatus('')
                }}
              />
            </div>
            <div className={`command-explain-risk risk-${commandExplainDraft.risk}`}>
              风险级别：{explainRiskLabel(commandExplainDraft.risk)}
            </div>
          </div>
          <div className="selection-popover-grid command-explain-grid">
            <div className="selection-popover-panel">
              <label className="selection-popover-label">参数拆解（每行一条）</label>
              <textarea
                className="selection-popover-text command-explain-text-mini"
                value={commandExplainDraft.argsText}
                onChange={(event) => {
                  setCommandExplainDraft((previous) => (previous ? { ...previous, argsText: event.target.value } : previous))
                }}
              />
            </div>
            <div className="selection-popover-panel">
              <label className="selection-popover-label">示例（每行一条）</label>
              <textarea
                className="selection-popover-text command-explain-text-mini"
                value={commandExplainDraft.examplesText}
                onChange={(event) => {
                  setCommandExplainDraft((previous) => (previous ? { ...previous, examplesText: event.target.value } : previous))
                }}
              />
            </div>
          </div>
          {commandExplainStatus.length > 0 && <div className="selection-popover-status">{commandExplainStatus}</div>}
          <div className="selection-popover-actions">
            <button className="selection-popover-action" onClick={onCommandExplainCopy}>
              复制解读
            </button>
            <button className="selection-popover-action selection-popover-action-primary" onClick={onCommandExplainSaveLocalRule}>
              保存为本地规则
            </button>
            <button
              className="selection-popover-action"
              onClick={onCommandExplainEditExisting}
              disabled={!commandExplainPopover.matchedRuleId}
            >
              编辑本地规则
            </button>
            {commandExplainPopover.source === 'none' && (
              <button className="selection-popover-action" onClick={onCommandExplainOnline}>
                在线解释（可选）
              </button>
            )}
            <button className="selection-popover-action" onClick={closeSelectionFloatingUi}>
              关闭
            </button>
          </div>
        </div>
      )}
      <CommandToolbar
        contexts={commandConfig.contexts}
        activeContextId={activeContextId}
        autoDetectEnabled={autoDetectContext}
        slots={commandDockSlots}
        onContextChange={handleContextChange}
        onToggleAutoDetect={handleAutoDetectToggle}
        onAssignSlot={handleAssignDockSlot}
        onMoveSlot={handleMoveDockSlot}
        onRunSlot={handleRunDockSlot}
        onClearSlot={handleClearDockSlot}
      />
    </div>
  )
}
