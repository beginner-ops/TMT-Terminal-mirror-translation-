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
import { SettingsPanel, type AppSettings } from './SettingsPanel'
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
  createSessionEntryId,
  normalizeSessionCatalogConfig,
  VENDOR_GROUP_DEFS,
  type LocalPortPackConfig,
  type LocalPortVendorPlan,
  type SessionCatalogConfig,
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
const FLOATING_MENU_HEIGHT_PX = 216
const FLOATING_POPOVER_WIDTH_PX = 860
const FLOATING_POPOVER_HEIGHT_PX = 520
const FLOATING_OVERLAY_MARGIN_PX = 8

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
  if (lines.length < 8) {
    return text
  }

  const nonEmpty = lines.filter((line) => line.length > 0)
  if (nonEmpty.length < 6) {
    return text
  }

  const shortLineCount = nonEmpty.filter((line) => line.length <= 2).length
  const averageLength = nonEmpty.reduce((sum, line) => sum + line.length, 0) / nonEmpty.length
  const alphaNumericCount = (nonEmpty.join('').match(/[A-Za-z0-9\u4e00-\u9fff]/g) ?? []).length
  const likelyVerticalSelection =
    shortLineCount / nonEmpty.length >= 0.82 && averageLength <= 2.2 && alphaNumericCount >= Math.floor(nonEmpty.length * 0.6)

  if (!likelyVerticalSelection) {
    return text
  }

  return lines.join('')
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

const normalizeDockSlots = (slots: CommandDockSlot[], expected: number): CommandDockSlot[] => {
  const safeExpected = Math.max(1, expected)
  return [...slots.slice(0, safeExpected), ...Array.from({ length: Math.max(0, safeExpected - slots.length) }, () => null)]
}

const defaultAppSettings: AppSettings = {
  compactUi: false,
  showDebugButton: true,
  fontScale: 1,
  theme: 'dark',
  dockSlots: 6,
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
  const rawDockSlots = typeof candidate.dockSlots === 'number' ? candidate.dockSlots : defaultAppSettings.dockSlots
  const dockSlots = Math.max(4, Math.min(12, Math.round(rawDockSlots)))

  return {
    compactUi,
    showDebugButton,
    fontScale,
    theme,
    dockSlots,
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
  const selectionPopoverRef = useRef<HTMLDivElement | null>(null)
  const commandExplainPopoverRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const activeTerminalTabIdRef = useRef('term-tab-1')
  const terminalTabOrderRef = useRef<string[]>(['term-tab-1'])
  const terminalTabBuffersRef = useRef<Map<string, string>>(new Map([['term-tab-1', '']]))
  const terminalTabLogsRef = useRef<Map<string, SessionLogEvent[]>>(new Map([['term-tab-1', []]]))
  const terminalTabAliveRef = useRef<Map<string, boolean>>(new Map([['term-tab-1', true]]))
  const terminalTabSessionNameRef = useRef<Map<string, string>>(new Map())
  const networkHintsByTabRef = useRef<Map<string, NetworkHints>>(new Map([['term-tab-1', defaultNetworkHints]]))
  const autoPagerRunsByTabRef = useRef<Map<string, number>>(new Map())
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
  const [selectionPopover, setSelectionPopover] = useState<SelectionPopoverState | null>(null)
  const [selectionDraftTranslation, setSelectionDraftTranslation] = useState('')
  const [selectionPopoverStatus, setSelectionPopoverStatus] = useState('')
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

  const runSnapshotNow = useCallback((): void => {
    runSnapshotRef.current?.()
  }, [])

  useEffect(() => {
    activeTerminalTabIdRef.current = activeTerminalTabId
  }, [activeTerminalTabId])

  useEffect(() => {
    terminalTabOrderRef.current = terminalTabs.map((tab) => tab.id)
  }, [terminalTabs])

  const updateTabAliveState = useCallback((tabId: string, alive: boolean): void => {
    terminalTabAliveRef.current.set(tabId, alive)
  }, [])

  const appendTerminalTabBuffer = useCallback((tabId: string, chunk: string): void => {
    const previous = terminalTabBuffersRef.current.get(tabId) ?? ''
    const maxBufferLength = 240_000
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
          if (!spawned) {
            appendTerminalTabBuffer(tabId, '\r\n[pty spawn failed]\r\n')
          }
        })
    }
    return tabId
  }, [appendTerminalTabBuffer, renderTerminalTabBuffer, updateTabAliveState])

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

  const handleDeleteSession = useCallback((session: SessionEntry): void => {
    persistSessionCatalog({
      ...sessionCatalogConfig,
      sessions: sessionCatalogConfig.sessions.filter((item) => item.id !== session.id),
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
    persistSessionCatalog({
      ...sessionCatalogConfig,
      sessions: sessionCatalogConfig.sessions.filter((session) => session.packId !== pack.id),
      localPortPacks: sessionCatalogConfig.localPortPacks.filter((item) => item.id !== pack.id),
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
        void ptyClient.connectLocal(tabId, session.host, session.port, session.protocol)
          .then((connected) => {
            updateTabAliveState(tabId, connected)
            if (!connected) {
              setSessionExportStatus(`连接失败：无法连接 ${session.host}:${session.port}`)
              return
            }
            setSidePanelMode('none')
          })
        return
      }

      const command = buildSshCommand(session)
      if (command.length === 0) {
        setSessionExportStatus('SSH 会话缺少用户信息，无法连接')
        return
      }
      writeToTabImmediateWithLog(tabId, command)
      setSidePanelMode('none')
    }

    if (terminalTabAliveRef.current.get(tabId) ?? false) {
      connectWithProtocol()
      return
    }

    const term = termRef.current
    if (!term) {
      return
    }

    void ptyClient.spawn(tabId, term.cols, term.rows).then((spawned) => {
      updateTabAliveState(tabId, spawned)
      if (!spawned) {
        setSessionExportStatus('当前标签重连失败，请新建标签后重试')
        return
      }
      connectWithProtocol()
    })
  }, [updateTabAliveState, updateTerminalTabTitle, writeToTabImmediateWithLog])

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

    writeToTabImmediateWithLog(activeTerminalTabIdRef.current, command.endsWith('\n') ? command : `${command}\n`)
  }, [writeToTabImmediateWithLog])

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
    setSelectionMenu(null)
    setSelectionPopover(null)
    setSelectionPopoverStatus('')
    setCommandExplainPopover(null)
    setCommandExplainDraft(null)
    setCommandExplainStatus('')
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

    const text = selection.toString()
    const normalizedText = normalizeMirrorSelectionText(text)
    if (normalizedText.trim().length === 0) {
      return ''
    }

    const range = selection.getRangeAt(0)
    if (!frame.contains(range.commonAncestorContainer)) {
      return ''
    }

    return normalizedText
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

      let provider: TermbridgeTranslationProvider = 'google-free'
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
        })
        provider = result.provider
        translatedChunks.push(result.translatedText.length > 0 ? result.translatedText : chunk.text)
      }

      return {
        translatedText: translatedChunks.join(''),
        protectedSegments,
        provider,
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

  const onSelectionMenuCopy = useCallback((): void => {
    if (!selectionMenu) {
      return
    }

    void copyTextToClipboard(selectionMenu.text)
    setSelectionMenu(null)
  }, [selectionMenu])

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
      '在线翻译中...',
    )

    void translateSelectionWithOnline(selectedText)
      .then((onlineResult) => {
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
        setSelectionPopoverStatus('在线翻译完成，可按需修正后添加到本地词库')
      })
      .catch((error: unknown) => {
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
        setSelectionPopoverStatus(`在线翻译失败：${errorMessage}。已回退到本地规则翻译`)
      })
  }, [selectionMenu, openSelectionPopover, translateSelectionWithOnline])

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
    setSelectionPopoverStatus('请确认译文后点击“添加到本地词库”')
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
    setSelectionPopoverStatus('')
    setSelectionMenu(null)
  }, [selectionMenu])

  const onSelectionMenuExplainCommand = useCallback((): void => {
    if (!selectionMenu) {
      return
    }

    const context = resolveExplainContext(activeContextIdRef.current, activeNetworkHints)
    const matched = explainCommandByRules(selectionMenu.text, context, builtinExplainRules, userExplainRules)
    const position = clampFloatingPosition(
      selectionMenu.x + 12,
      selectionMenu.y + 12,
      FLOATING_POPOVER_WIDTH_PX,
      FLOATING_POPOVER_HEIGHT_PX,
    )

    const localRule = matched.matchedRuleId
      ? userExplainRules.find((rule) => rule.id === matched.matchedRuleId) ?? null
      : null

    setCommandExplainPopover({
      x: position.x,
      y: position.y,
      selectedText: selectionMenu.text,
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
  }, [activeNetworkHints, builtinExplainRules, selectionMenu, userExplainRules])

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
    if (!selectionMenu && !selectionPopover && !commandExplainPopover) {
      return
    }

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (selectionMenuRef.current?.contains(target)) {
        return
      }

      if (selectionPopoverRef.current?.contains(target)) {
        return
      }

      if (commandExplainPopoverRef.current?.contains(target)) {
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
  }, [commandExplainPopover, selectionMenu, selectionPopover, closeSelectionFloatingUi])

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

    const offPtyExit = ptyClient.onExit(({ tabId, exitCode }) => {
      updateTabAliveState(tabId, false)
      const exitMessage = `\r\n[pty exited: ${exitCode}]\r\n`
      appendTerminalTabBuffer(tabId, exitMessage)
      appendTerminalTabLog(tabId, 'output', exitMessage)
      if (tabId === activeTerminalTabIdRef.current) {
        term.write(exitMessage)
      }
      scheduleSnapshot()
    })

    term.onData((data) => {
      const activeTabId = activeTerminalTabIdRef.current
      if (!(terminalTabAliveRef.current.get(activeTabId) ?? false)) {
        return
      }
      appendTerminalTabLog(activeTabId, 'input', data)
      if (isLikelyPasteInput(data)) {
        ptyClient.writePaste(activeTabId, data)
        return
      }

      ptyClient.write(activeTabId, data)
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
  }, [appendTerminalTabBuffer, appendTerminalTabLog, updateNetworkHintsForTab, updateTabAliveState, writeToTabImmediateWithLog])

  useEffect(() => {
    const term = termRef.current
    if (!term) {
      return
    }

    term.options.theme = resolveXtermTheme(appSettings.theme)
  }, [appSettings.theme])

  const headerTitle = useMemo(() => (isDev ? 'termbridge-v2 (dev)' : 'termbridge-v2'), [])
  const shellStyle = useMemo(
    () =>
      ({
        '--term-font-family': TERMINAL_DISPLAY.fontFamily,
        '--term-font-size': `${TERMINAL_DISPLAY.fontSize * appSettings.fontScale}px`,
        '--term-line-height': `${TERMINAL_DISPLAY.lineHeight}`,
        '--term-letter-spacing': `${TERMINAL_DISPLAY.letterSpacing}px`,
        '--row-height': `${cellMetrics.height}px`,
      }) as CSSProperties,
    [appSettings.fontScale, cellMetrics.height],
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
          <div ref={leftHostRef} className="terminal-host" />
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
                title="命令解释规则库"
              >
                命令解释
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
            />
            {rightMirrorMode === 'translated' && <MarkerLayer markers={markers} />}
          </div>
          <GlossaryManagerModal
            isOpen={sidePanelMode === 'glossary'}
            entries={glossaryEntries}
            onDeleteEntry={deleteGlossaryEntry}
            onClose={closeSidePanel}
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
          />
          <CommandExplainPanel
            isOpen={sidePanelMode === 'commandExplain'}
            onClose={closeSidePanel}
            builtinByContext={builtinExplainRules}
            userRules={userExplainRules}
            onUpsertUserRule={handleUpsertUserExplainRule}
            onDeleteUserRule={handleDeleteUserExplainRule}
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
          />
          <SessionManagerPanel
            isOpen={sidePanelMode === 'sessions'}
            config={sessionCatalogConfig}
            onClose={closeSidePanel}
            onAddGroup={handleAddSessionGroup}
            onDeleteGroup={handleDeleteSessionGroup}
            onReorderGroups={handleReorderSessionGroups}
            onUpsertSession={handleUpsertSession}
            onDeleteSession={handleDeleteSession}
            onReorderSessions={handleReorderSessions}
            onConnectCurrentTab={handleConnectSessionCurrentTab}
            onConnectNewTab={handleConnectSessionNewTab}
            onUpsertLocalPortPack={handleUpsertLocalPortPack}
            onDeleteLocalPortPack={handleDeleteLocalPortPack}
            onExportCurrentTabLog={() => {
              void handleExportCurrentTabLog()
            }}
            exportStatus={sessionExportStatus}
          />
          <SettingsPanel
            isOpen={sidePanelMode === 'settings'}
            settings={appSettings}
            translationConfig={translationConfig}
            translationStatus={translationConfigStatus}
            onClose={closeSidePanel}
            onChange={updateAppSettings}
            onSaveTranslationConfig={saveTranslationConfigFromSettings}
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
            解释命令
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
          <div className="selection-popover-title">命令解释</div>
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
              复制解释
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
