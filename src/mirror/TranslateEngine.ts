import type { BufferSnapshot, ScanSnapshotRow } from './BufferSnapshot'
import { BUILTIN_PHRASES } from './BuiltinPhrases'
import { stringCellWidth } from './CellWidth'
import type { GlossaryDomain, GlossaryEntry } from './GlossaryTypes'
import type { DebugStats, Marker, Patch } from './GridModel'

export type ProtectedRange = {
  start: number
  end: number
}

type ActivePhrase = GlossaryEntry & {
  normalizedSource: string
  sourceLength: number
  matchType: 'exact' | 'caseInsensitive' | 'pattern'
  caseInsensitive: boolean
  compiledPattern: RegExp | null
  sourceType: 'rules' | 'glossary' | 'fallback'
  domain: GlossaryDomain
}

type CompiledPhraseSet = {
  ordered: ActivePhrase[]
  byInitial: Map<string, ActivePhrase[]>
  patternPhrases: ActivePhrase[]
  localExact: ActivePhrase[]
  localCaseInsensitive: ActivePhrase[]
  localPattern: ActivePhrase[]
  rulesExact: ActivePhrase[]
  rulesCaseInsensitive: ActivePhrase[]
  rulesPattern: ActivePhrase[]
}

let cachedGlossaryEntriesRef: GlossaryEntry[] | null = null
let cachedCompiledPhrases: CompiledPhraseSet = {
  ordered: [],
  byInitial: new Map(),
  patternPhrases: [],
  localExact: [],
  localCaseInsensitive: [],
  localPattern: [],
  rulesExact: [],
  rulesCaseInsensitive: [],
  rulesPattern: [],
}

type PhraseMatch = {
  start: number
  end: number
  phrase: ActivePhrase
}

type SkipReason =
  | 'blank'
  | 'stack_like'
  | 'symbol_only'
  | 'protected_only'
  | 'no_match'
  | 'overlap_filtered'
  | 'out_of_viewport'
  | 'invalid_span'

const PROTECTED_MASK = '\u0000'

export type MatchStrategy = 'exact' | 'caseInsensitive' | 'pattern'

export type TranslationPolicy = {
  skipRules: {
    stackLike: boolean
    symbolOnly: boolean
    protectedOnly: boolean
    outOfViewport: boolean
  }
  localMatchPriority: MatchStrategy[]
  fallbackUiOnly: boolean
}

const DEFAULT_LOCAL_MATCH_PRIORITY: MatchStrategy[] = ['exact', 'caseInsensitive', 'pattern']

export const DEFAULT_TRANSLATION_POLICY: TranslationPolicy = {
  skipRules: {
    stackLike: true,
    symbolOnly: true,
    protectedOnly: true,
    outOfViewport: true,
  },
  localMatchPriority: DEFAULT_LOCAL_MATCH_PRIORITY,
  fallbackUiOnly: true,
}

const normalizeLocalMatchPriority = (raw: unknown): MatchStrategy[] => {
  const queue = Array.isArray(raw) ? raw : []
  const deduped: MatchStrategy[] = []
  for (const item of queue) {
    if (item !== 'exact' && item !== 'caseInsensitive' && item !== 'pattern') {
      continue
    }

    if (!deduped.includes(item)) {
      deduped.push(item)
    }
  }

  for (const fallback of DEFAULT_LOCAL_MATCH_PRIORITY) {
    if (!deduped.includes(fallback)) {
      deduped.push(fallback)
    }
  }

  return deduped
}

export const normalizeTranslationPolicy = (raw: unknown): TranslationPolicy => {
  const asRecord = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const rawSkip = (typeof asRecord.skipRules === 'object' && asRecord.skipRules !== null
    ? asRecord.skipRules
    : {}) as Record<string, unknown>

  return {
    skipRules: {
      stackLike: typeof rawSkip.stackLike === 'boolean' ? rawSkip.stackLike : DEFAULT_TRANSLATION_POLICY.skipRules.stackLike,
      symbolOnly: typeof rawSkip.symbolOnly === 'boolean' ? rawSkip.symbolOnly : DEFAULT_TRANSLATION_POLICY.skipRules.symbolOnly,
      protectedOnly:
        typeof rawSkip.protectedOnly === 'boolean'
          ? rawSkip.protectedOnly
          : DEFAULT_TRANSLATION_POLICY.skipRules.protectedOnly,
      outOfViewport:
        typeof rawSkip.outOfViewport === 'boolean'
          ? rawSkip.outOfViewport
          : DEFAULT_TRANSLATION_POLICY.skipRules.outOfViewport,
    },
    localMatchPriority: normalizeLocalMatchPriority(asRecord.localMatchPriority),
    fallbackUiOnly:
      typeof asRecord.fallbackUiOnly === 'boolean' ? asRecord.fallbackUiOnly : DEFAULT_TRANSLATION_POLICY.fallbackUiOnly,
  }
}

const mergeRanges = (ranges: ProtectedRange[]): ProtectedRange[] => {
  if (ranges.length === 0) {
    return ranges
  }

  const sorted = [...ranges].sort((a, b) => (a.start === b.start ? a.end - b.end : a.start - b.start))
  const merged: ProtectedRange[] = [sorted[0]]

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index]
    const last = merged[merged.length - 1]
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end)
      continue
    }

    merged.push({ ...current })
  }

  return merged
}

const normalizePhrase = (text: string): string => text.trim().toLocaleLowerCase()

const normalizeMatchType = (
  value: GlossaryEntry['matchType'] | undefined,
  defaultMatchType: ActivePhrase['matchType'],
): ActivePhrase['matchType'] => {
  if (value === 'exact' || value === 'caseInsensitive' || value === 'pattern') {
    return value
  }

  return defaultMatchType
}

const resolveCaseInsensitive = (
  matchType: ActivePhrase['matchType'],
  explicit: boolean | undefined,
): boolean => {
  if (typeof explicit === 'boolean') {
    return explicit
  }

  return matchType === 'caseInsensitive'
}

const compilePattern = (source: string, caseInsensitive: boolean): RegExp | null => {
  try {
    return new RegExp(source, caseInsensitive ? 'gi' : 'g')
  } catch {
    return null
  }
}

const getSourcePriority = (sourceType: ActivePhrase['sourceType']): number => {
  if (sourceType === 'glossary') {
    return 3
  }

  if (sourceType === 'rules') {
    return 2
  }

  return 1
}

const isWordChar = (char: string): boolean => /^[A-Za-z0-9_]$/.test(char)

const hasWordBoundaries = (line: string, start: number, end: number): boolean => {
  const left = start > 0 ? line[start - 1] : ''
  const right = end < line.length ? line[end] : ''

  const leftOk = left.length === 0 || !isWordChar(left)
  const rightOk = right.length === 0 || !isWordChar(right)
  return leftOk && rightOk
}

const isUiLikeLine = (line: string): boolean => {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return false
  }

  if (/^(?:[>+*-]|\d+[.)]|\[[ xX]\]|\([ xX]\))\s+/.test(trimmed)) {
    return true
  }

  if (
    /\b(?:tip|press|enter|esc|ctrl|tab|help|settings|quit|cancel|continue|select|menu|status|mode|session|reload|import|export|chat|message|history|context|prompt|agent)\b/i.test(
      trimmed,
    )
  ) {
    return true
  }

  if (/\[[^\]]+\]/.test(trimmed)) {
    return true
  }

  if (/\([^)]*(?:enter|esc|tab|ctrl|shift|option|alt)[^)]*\)/i.test(trimmed)) {
    return true
  }

  return /(?:^|\s)(?:new|open|close|save|apply|discard|retry|approve|reject|allow|deny)(?:\s|$)/i.test(trimmed)
}

const isNaturalLanguageLine = (line: string): boolean => {
  const trimmed = line.trim()
  if (trimmed.length < 4 || trimmed.length > 220) {
    return false
  }

  const wordMatches = trimmed.match(/[A-Za-z][A-Za-z'-]*/g) ?? []
  if (wordMatches.length < 2) {
    return false
  }

  const commandLike = /^[~$%#>]\s|\b(?:sudo|npm|pnpm|yarn|python|node|git|ls|cat|grep|awk|sed|chmod|chown|docker|kubectl)\b/i.test(
    trimmed,
  )
  if (commandLike) {
    return false
  }

  const symbolCount = (trimmed.match(/[{}<>|=*_`~\\/]/g) ?? []).length
  return symbolCount / trimmed.length < 0.25
}

const isSymbolOnlyLine = (line: string): boolean => {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return false
  }

  if (/^[\s┌┐└┘├┤┬┴┼─━│┃┄┅┆┇╭╮╯╰═╞╡╟╢╤╧╪╠╣╔╗╚╝█▓▒░•·▪▫◆◇▲▼▶◀★☆]+$/.test(trimmed)) {
    return true
  }

  const alphaNumericCount = (trimmed.match(/[A-Za-z0-9\u4e00-\u9fff]/g) ?? []).length
  return alphaNumericCount === 0 && /\S/.test(trimmed)
}

const isStackLike = (line: string): boolean => {
  const trimmed = line.trimStart()
  return (
    /^at\s+\S+/.test(trimmed) ||
    /^File\s+"[^"]+", line\s+\d+/.test(trimmed) ||
    /\.[cm]?[tj]sx?:\d+:\d+/.test(trimmed) ||
    /Traceback \(most recent call last\)/.test(trimmed) ||
    /^\s*```/.test(trimmed)
  )
}

export const findProtectedRanges = (line: string): ProtectedRange[] => {
  const ranges: ProtectedRange[] = []

  const addRanges = (regex: RegExp): void => {
    for (const match of line.matchAll(regex)) {
      const start = match.index ?? -1
      if (start < 0) {
        continue
      }

      ranges.push({ start, end: start + match[0].length })
    }
  }

  addRanges(/https?:\/\/[^\s]+/g)
  addRanges(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g)
  addRanges(/(?:\/[^\s]+)+/g)
  addRanges(/[A-Za-z]:\\[^\s]+/g)
  addRanges(/(?:^|\s)--?[A-Za-z][\w-]*/g)
  addRanges(/\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|py|go|rs|java|md|txt|yaml|yml|toml|log|lock|sh|zsh)\b/g)
  addRanges(/`[^`]+`/g)

  const promptMatch = line.match(/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+(?:\s+[^\s]+)*\s+[%$#]\s+/)
  if (promptMatch && promptMatch.index !== undefined) {
    ranges.push({ start: promptMatch.index, end: promptMatch.index + promptMatch[0].length })
  }

  return mergeRanges(ranges)
}

const maskProtectedRanges = (line: string, protectedRanges: ProtectedRange[]): string => {
  if (protectedRanges.length === 0) {
    return line
  }

  const chars = line.split('')
  for (const range of protectedRanges) {
    for (let index = range.start; index < range.end && index < chars.length; index += 1) {
      chars[index] = PROTECTED_MASK
    }
  }

  return chars.join('')
}

const containsProtectedMask = (maskedLine: string, start: number, end: number): boolean => {
  for (let index = start; index < end; index += 1) {
    if (maskedLine[index] === PROTECTED_MASK) {
      return true
    }
  }

  return false
}

const hasNonProtectedText = (maskedLine: string): boolean => {
  for (const char of maskedLine) {
    if (char === PROTECTED_MASK) {
      continue
    }

    if (char.trim().length > 0) {
      return true
    }
  }

  return false
}

const FALLBACK_WORD_MAP: Record<string, string> = {
  ask: '提问',
  anything: '任意内容',
  tip: '提示',
  press: '按下',
  enter: '回车',
  continue: '继续',
  back: '返回',
  cancel: '取消',
  help: '帮助',
  settings: '设置',
  quit: '退出',
  loading: '加载中',
  processing: '处理中',
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重连中',
  failed: '失败',
  error: '错误',
  warning: '警告',
  status: '状态',
  menu: '菜单',
  select: '选择',
  option: '选项',
  options: '选项',
  search: '搜索',
  filter: '筛选',
  clear: '清除',
  refresh: '刷新',
  open: '打开',
  close: '关闭',
  save: '保存',
  discard: '放弃',
  apply: '应用',
  retry: '重试',
  retrying: '重试中',
  done: '完成',
  success: '成功',
  completed: '已完成',
  complete: '完成',
  waiting: '等待中',
  input: '输入',
  output: '输出',
  command: '命令',
  commands: '命令',
  shell: '终端',
  session: '会话',
  sessions: '会话',
  context: '上下文',
  model: '模型',
  provider: '提供方',
  project: '项目',
  workspace: '工作区',
  file: '文件',
  files: '文件',
  directory: '目录',
  history: '历史',
  message: '消息',
  messages: '消息',
  user: '用户',
  assistant: '助手',
  system: '系统',
  prompt: '提示词',
  translate: '翻译',
  translation: '翻译',
  marker: '标记',
  full: '完整',
  view: '查看',
  details: '详情',
  logs: '日志',
  approve: '批准',
  approved: '已批准',
  reject: '拒绝',
  rejected: '已拒绝',
  allow: '允许',
  denied: '已拒绝',
  permission: '权限',
  required: '需要',
  available: '可用',
  unavailable: '不可用',
  update: '更新',
  updated: '已更新',
  check: '检查',
  checking: '检查中',
  please: '请',
  wait: '稍候',
  now: '现在',
  later: '稍后',
  more: '更多',
  less: '更少',
  next: '下一步',
  previous: '上一步',
  start: '开始',
  stop: '停止',
  run: '运行',
  running: '运行中',
  debug: '调试',
  reload: '重载',
  import: '导入',
  export: '导出',
  glossary: '术语表',
  no: '无',
  not: '未',
  found: '找到',
}

const buildFallbackPhraseMatch = (
  line: string,
  maskedLine: string,
  uiOnlyAllowed: boolean,
  fallbackUiOnly: boolean,
): PhraseMatch | null => {
  if (fallbackUiOnly && !uiOnlyAllowed) {
    return null
  }

  const wordPattern = /[A-Za-z][A-Za-z'-]*/g
  let translatedWords = 0
  let seenWords = 0
  let cursor = 0
  let translatedLine = ''
  let wordMatch = wordPattern.exec(line)

  while (wordMatch) {
    const word = wordMatch[0]
    const start = wordMatch.index
    const end = start + word.length
    translatedLine += line.slice(cursor, start)

    if (containsProtectedMask(maskedLine, start, end)) {
      translatedLine += word
      cursor = end
      wordMatch = wordPattern.exec(line)
      continue
    }

    seenWords += 1
    const normalized = word.toLocaleLowerCase()
    const replacement = FALLBACK_WORD_MAP[normalized]
    if (replacement) {
      translatedLine += replacement
      translatedWords += 1
    } else {
      translatedLine += word
    }

    cursor = end
    wordMatch = wordPattern.exec(line)
  }

  translatedLine += line.slice(cursor)

  if (seenWords < 3 || translatedWords < 2) {
    return null
  }

  const ratio = translatedWords / Math.max(1, seenWords)
  if (ratio < 0.45) {
    return null
  }

  const start = line.search(/\S/)
  if (start < 0) {
    return null
  }

  let end = line.length
  while (end > start && line[end - 1] === ' ') {
    end -= 1
  }

  const sourceSegment = line.slice(start, end)
  const translatedSegment = translatedLine.slice(start, end)
  if (sourceSegment === translatedSegment) {
    return null
  }

  return {
    start,
    end,
    phrase: {
      source: sourceSegment,
      target: translatedSegment,
      uiOnly: false,
      wholeWord: false,
      normalizedSource: normalizePhrase(sourceSegment),
      sourceLength: sourceSegment.length,
      matchType: 'exact',
      caseInsensitive: false,
      compiledPattern: null,
      sourceType: 'fallback',
      domain: 'common',
    },
  }
}

const buildPhraseKey = (phrase: {
  source: string
  matchType: ActivePhrase['matchType']
  caseInsensitive: boolean
  domain: GlossaryDomain
}): string => {
  const comparableSource = phrase.caseInsensitive ? phrase.source.toLocaleLowerCase() : phrase.source
  return `${phrase.domain}:${phrase.matchType}:${phrase.caseInsensitive ? 'i' : 's'}:${comparableSource}`
}

const normalizeGlossaryEntries = (entries: GlossaryEntry[]): GlossaryEntry[] => {
  const map = new Map<string, GlossaryEntry>()

  for (const entry of entries) {
    const source = entry.source.trim()
    const target = entry.target.trim()
    if (source.length < 2 || target.length === 0) {
      continue
    }

    const matchType = normalizeMatchType(entry.matchType, 'caseInsensitive')
    const caseInsensitive = resolveCaseInsensitive(matchType, entry.caseInsensitive)
    const normalizedEntry: GlossaryEntry = {
      id: entry.id,
      source,
      target,
      matchType,
      caseInsensitive,
      note: entry.note,
      domain: normalizeGlossaryDomain(entry.domain),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      uiOnly: entry.uiOnly,
      wholeWord: entry.wholeWord,
    }

    map.set(buildPhraseKey({ source, matchType, caseInsensitive, domain: normalizeGlossaryDomain(normalizedEntry.domain) }), normalizedEntry)
  }

  return Array.from(map.values())
}

const buildActivePhrases = (glossaryEntries: GlossaryEntry[]): CompiledPhraseSet => {
  if (cachedGlossaryEntriesRef === glossaryEntries && cachedCompiledPhrases.ordered.length > 0) {
    return cachedCompiledPhrases
  }

  const merged = new Map<string, ActivePhrase>()

  const registerPhrase = (
    entry: GlossaryEntry,
    sourceType: ActivePhrase['sourceType'],
    defaultMatchType: ActivePhrase['matchType'],
  ): void => {
    const source = entry.source.trim()
    const target = entry.target.trim()
    if (source.length < 2 || target.length === 0) {
      return
    }

    const matchType = normalizeMatchType(entry.matchType, defaultMatchType)
    const caseInsensitive = resolveCaseInsensitive(matchType, entry.caseInsensitive)
    const domain = normalizeGlossaryDomain(entry.domain)
    const key = buildPhraseKey({ source, matchType, caseInsensitive, domain })
    const existing = merged.get(key)

    merged.set(key, {
      id: entry.id,
      source,
      target,
      matchType,
      caseInsensitive,
      note: entry.note,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      uiOnly: entry.uiOnly ?? existing?.uiOnly,
      wholeWord: entry.wholeWord ?? existing?.wholeWord,
      normalizedSource: normalizePhrase(source),
      sourceLength: source.length,
      compiledPattern: matchType === 'pattern' ? compilePattern(source, caseInsensitive) : null,
      sourceType,
      domain,
    })
  }

  for (const phrase of BUILTIN_PHRASES) {
    registerPhrase(phrase, 'rules', 'caseInsensitive')
  }

  for (const phrase of normalizeGlossaryEntries(glossaryEntries)) {
    registerPhrase(phrase, 'glossary', 'caseInsensitive')
  }

  const nextActivePhrases = Array.from(merged.values()).sort((a, b) => {
    if (a.sourceLength !== b.sourceLength) {
      return b.sourceLength - a.sourceLength
    }

    const sourcePriorityDelta = getSourcePriority(b.sourceType) - getSourcePriority(a.sourceType)
    if (sourcePriorityDelta !== 0) {
      return sourcePriorityDelta
    }

    return a.normalizedSource.localeCompare(b.normalizedSource)
  })

  const byInitial = new Map<string, ActivePhrase[]>()
  const patternPhrases: ActivePhrase[] = []
  const localExact: ActivePhrase[] = []
  const localCaseInsensitive: ActivePhrase[] = []
  const localPattern: ActivePhrase[] = []
  const rulesExact: ActivePhrase[] = []
  const rulesCaseInsensitive: ActivePhrase[] = []
  const rulesPattern: ActivePhrase[] = []

  for (const phrase of nextActivePhrases) {
    if (phrase.sourceType === 'glossary') {
      if (phrase.matchType === 'pattern') {
        localPattern.push(phrase)
      } else if (phrase.caseInsensitive) {
        localCaseInsensitive.push(phrase)
      } else {
        localExact.push(phrase)
      }
    } else if (phrase.matchType === 'pattern') {
      rulesPattern.push(phrase)
    } else if (phrase.caseInsensitive) {
      rulesCaseInsensitive.push(phrase)
    } else {
      rulesExact.push(phrase)
    }

    if (phrase.matchType === 'pattern') {
      if (phrase.compiledPattern) {
        patternPhrases.push(phrase)
      }
      continue
    }

    const initial = phrase.normalizedSource[0]
    if (!initial) {
      continue
    }

    const bucket = byInitial.get(initial)
    if (bucket) {
      bucket.push(phrase)
      continue
    }

    byInitial.set(initial, [phrase])
  }

  for (const bucket of byInitial.values()) {
    bucket.sort((a, b) => {
      if (a.sourceLength !== b.sourceLength) {
        return b.sourceLength - a.sourceLength
      }

      const sourcePriorityDelta = getSourcePriority(b.sourceType) - getSourcePriority(a.sourceType)
      if (sourcePriorityDelta !== 0) {
        return sourcePriorityDelta
      }

      return a.normalizedSource.localeCompare(b.normalizedSource)
    })
  }

  const compiled: CompiledPhraseSet = {
    ordered: nextActivePhrases,
    byInitial,
    patternPhrases,
    localExact,
    localCaseInsensitive,
    localPattern,
    rulesExact,
    rulesCaseInsensitive,
    rulesPattern,
  }

  cachedGlossaryEntriesRef = glossaryEntries
  cachedCompiledPhrases = compiled

  return compiled
}

const collectPhraseMatches = (
  line: string,
  maskedLine: string,
  uiOnlyAllowed: boolean,
  phraseSet: CompiledPhraseSet,
): PhraseMatch[] => {
  const matches: PhraseMatch[] = []
  const lowerMasked = maskedLine.toLocaleLowerCase()

  for (let foundAt = 0; foundAt < lowerMasked.length; foundAt += 1) {
    const initial = lowerMasked[foundAt]
    if (!initial || initial === PROTECTED_MASK) {
      continue
    }

    const bucket = phraseSet.byInitial.get(initial)
    if (!bucket || bucket.length === 0) {
      continue
    }

    for (const phrase of bucket) {
      if (phrase.uiOnly && !uiOnlyAllowed) {
        continue
      }

      const end = foundAt + phrase.sourceLength
      if (end > lowerMasked.length) {
        continue
      }

      const isMatch = phrase.caseInsensitive
        ? lowerMasked.startsWith(phrase.normalizedSource, foundAt)
        : maskedLine.startsWith(phrase.source, foundAt)
      if (!isMatch) {
        continue
      }

      if (containsProtectedMask(maskedLine, foundAt, end)) {
        continue
      }

      if (phrase.wholeWord === true && !hasWordBoundaries(line, foundAt, end)) {
        continue
      }

      matches.push({
        start: foundAt,
        end,
        phrase,
      })
    }
  }

  for (const phrase of phraseSet.patternPhrases) {
    if (phrase.uiOnly && !uiOnlyAllowed) {
      continue
    }

    const pattern = phrase.compiledPattern
    if (!pattern) {
      continue
    }

    pattern.lastIndex = 0
    let matched = pattern.exec(line)
    while (matched) {
      const segment = matched[0]
      const start = matched.index
      if (segment.length > 0 && start >= 0) {
        const end = start + segment.length
        if (!containsProtectedMask(maskedLine, start, end)) {
          if (phrase.wholeWord !== true || hasWordBoundaries(line, start, end)) {
            matches.push({
              start,
              end,
              phrase,
            })
          }
        }
      }

      if (segment.length === 0) {
        pattern.lastIndex += 1
      }
      matched = pattern.exec(line)
    }
  }

  return matches
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean => {
  return aStart < bEnd && bStart < aEnd
}

const selectNonOverlappingMatches = (
  matches: PhraseMatch[],
  onOverlapFiltered: () => void,
  domainOrder: GlossaryDomain[],
): PhraseMatch[] => {
  const selected: PhraseMatch[] = []
  const sorted = [...matches].sort((a, b) => {
    const aLength = a.end - a.start
    const bLength = b.end - b.start
    if (aLength !== bLength) {
      return bLength - aLength
    }

    const sourcePriorityDelta = getSourcePriority(b.phrase.sourceType) - getSourcePriority(a.phrase.sourceType)
    if (sourcePriorityDelta !== 0) {
      return sourcePriorityDelta
    }

    const domainPriorityDelta = getDomainPriority(b.phrase, domainOrder) - getDomainPriority(a.phrase, domainOrder)
    if (domainPriorityDelta !== 0) {
      return domainPriorityDelta
    }

    return a.start - b.start
  })

  for (const candidate of sorted) {
    if (selected.some((item) => overlaps(item.start, item.end, candidate.start, candidate.end))) {
      onOverlapFiltered()
      continue
    }

    selected.push(candidate)
  }

  return selected.sort((a, b) => a.start - b.start)
}

const appendMarker = (
  markerByRow: Map<number, Marker>,
  row: number,
  col: number,
  translatedFull: string,
  source: string,
): void => {
  const existing = markerByRow.get(row)
  if (!existing) {
    markerByRow.set(row, {
      row,
      col,
      fullText: translatedFull,
      source,
    })
    return
  }

  existing.fullText = `${existing.fullText}\n${translatedFull}`
  existing.source = `${existing.source}\n${source}`
}

const pushSkipReason = (skipReasons: Map<SkipReason, number>, reason: SkipReason): void => {
  skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1)
}

const formatTopSkipReasons = (skipReasons: Map<SkipReason, number>): string[] => {
  return Array.from(skipReasons.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => `${reason}:${count}`)
}

const getSpan = (meta: ScanSnapshotRow, startIdx: number, endIdx: number, colCount: number): [number, number] => {
  const colStart = meta.charStartCols[startIdx] ?? Math.min(colCount, startIdx)
  const colEnd =
    meta.charEndCols[endIdx - 1] ?? Math.min(colCount, colStart + Math.max(1, endIdx - startIdx))

  return [colStart, colEnd]
}

const toGlossaryEntry = (phrase: ActivePhrase): GlossaryEntry => ({
  id: phrase.id,
  source: phrase.source,
  target: phrase.target,
  matchType: phrase.matchType,
  caseInsensitive: phrase.caseInsensitive,
  note: phrase.note,
  domain: phrase.domain,
  createdAt: phrase.createdAt,
  updatedAt: phrase.updatedAt,
  uiOnly: phrase.uiOnly,
  wholeWord: phrase.wholeWord,
})

const findExactPhraseMatch = (text: string, phrases: ActivePhrase[]): ActivePhrase | null => {
  for (const phrase of phrases) {
    if (text === phrase.source) {
      return phrase
    }
  }

  return null
}

const findCaseInsensitivePhraseMatch = (text: string, phrases: ActivePhrase[]): ActivePhrase | null => {
  const normalized = text.toLocaleLowerCase()
  for (const phrase of phrases) {
    if (normalized === phrase.normalizedSource) {
      return phrase
    }
  }

  return null
}

type PatternPhraseMatch = {
  phrase: ActivePhrase
  translated: string
}

const findPatternPhraseMatch = (text: string, phrases: ActivePhrase[]): PatternPhraseMatch | null => {
  for (const phrase of phrases) {
    const pattern = phrase.compiledPattern
    if (!pattern) {
      continue
    }

    pattern.lastIndex = 0
    const matched = pattern.exec(text)
    if (!matched || matched[0].length === 0 || matched.index < 0) {
      continue
    }

    const translated = `${text.slice(0, matched.index)}${phrase.target}${text.slice(matched.index + matched[0].length)}`
    return {
      phrase,
      translated,
    }
  }

  return null
}

const findLocalPhraseByPriority = (
  text: string,
  phraseSet: CompiledPhraseSet,
  localMatchPriority: MatchStrategy[],
  domainOrder: GlossaryDomain[],
): ActivePhrase | null => {
  const sortByDomain = (phrases: ActivePhrase[]): ActivePhrase[] =>
    [...phrases].sort((a, b) => getDomainPriority(b, domainOrder) - getDomainPriority(a, domainOrder))

  for (const strategy of localMatchPriority) {
    if (strategy === 'exact') {
      const exact = findExactPhraseMatch(text, sortByDomain(phraseSet.localExact))
      if (exact) {
        return exact
      }
      continue
    }

    if (strategy === 'caseInsensitive') {
      const caseInsensitive = findCaseInsensitivePhraseMatch(text, sortByDomain(phraseSet.localCaseInsensitive))
      if (caseInsensitive) {
        return caseInsensitive
      }
      continue
    }

    const pattern = findPatternPhraseMatch(text, sortByDomain(phraseSet.localPattern))
    if (pattern) {
      return pattern.phrase
    }
  }

  return null
}

type LocalLineOverride = {
  start: number
  end: number
  phrase: ActivePhrase
  translated: string
}

const findLocalLineOverride = (
  line: string,
  phraseSet: CompiledPhraseSet,
  localMatchPriority: MatchStrategy[],
  domainOrder: GlossaryDomain[],
): LocalLineOverride | null => {
  const start = line.search(/\S/)
  if (start < 0) {
    return null
  }

  let end = line.length
  while (end > start && line[end - 1] === ' ') {
    end -= 1
  }

  const core = line.slice(start, end)
  if (core.length < 2) {
    return null
  }

  for (const strategy of localMatchPriority) {
    if (strategy === 'exact') {
      const exact = findExactPhraseMatch(
        core,
        [...phraseSet.localExact].sort((a, b) => getDomainPriority(b, domainOrder) - getDomainPriority(a, domainOrder)),
      )
      if (exact) {
        return {
          start,
          end,
          phrase: exact,
          translated: exact.target,
        }
      }
      continue
    }

    if (strategy === 'caseInsensitive') {
      const caseInsensitive = findCaseInsensitivePhraseMatch(
        core,
        [...phraseSet.localCaseInsensitive].sort(
          (a, b) => getDomainPriority(b, domainOrder) - getDomainPriority(a, domainOrder),
        ),
      )
      if (caseInsensitive) {
        return {
          start,
          end,
          phrase: caseInsensitive,
          translated: caseInsensitive.target,
        }
      }
      continue
    }

    const pattern = findPatternPhraseMatch(
      core,
      [...phraseSet.localPattern].sort((a, b) => getDomainPriority(b, domainOrder) - getDomainPriority(a, domainOrder)),
    )
    if (pattern) {
      return {
        start,
        end,
        phrase: pattern.phrase,
        translated: pattern.translated,
      }
    }
  }

  return null
}

const translateWithFallbackWords = (text: string): string => {
  const wordPattern = /[A-Za-z][A-Za-z'-]*/g
  let translatedWords = 0
  let cursor = 0
  let translatedText = ''
  let match = wordPattern.exec(text)

  while (match) {
    const word = match[0]
    const start = match.index
    const end = start + word.length
    translatedText += text.slice(cursor, start)

    const mapped = FALLBACK_WORD_MAP[word.toLocaleLowerCase()]
    if (mapped) {
      translatedText += mapped
      translatedWords += 1
    } else {
      translatedText += word
    }

    cursor = end
    match = wordPattern.exec(text)
  }

  translatedText += text.slice(cursor)
  if (translatedWords === 0) {
    return text
  }

  return translatedText
}

const sourceRank: Record<SelectionTranslationSource, number> = {
  none: 0,
  fallback: 1,
  rules: 2,
  local: 3,
}

const pickHigherSource = (
  current: SelectionTranslationSource,
  candidate: SelectionTranslationSource,
): SelectionTranslationSource => {
  if (sourceRank[candidate] > sourceRank[current]) {
    return candidate
  }

  return current
}

export const findSelectionProtectedRanges = (text: string): ProtectedRange[] => {
  if (text.length === 0) {
    return []
  }

  const ranges: ProtectedRange[] = []
  const lines = text.split('\n')
  let offset = 0
  let inCodeFence = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const lineStart = offset
    const lineEnd = lineStart + line.length
    const trimmed = line.trimStart()

    if (/^```/.test(trimmed)) {
      inCodeFence = !inCodeFence
      ranges.push({ start: lineStart, end: lineEnd })
    } else if (inCodeFence || isStackLike(line)) {
      ranges.push({ start: lineStart, end: lineEnd })
    } else {
      const lineRanges = findProtectedRanges(line)
      for (const range of lineRanges) {
        ranges.push({
          start: lineStart + range.start,
          end: lineStart + range.end,
        })
      }
    }

    offset = lineEnd
    if (index < lines.length - 1) {
      offset += 1
    }
  }

  return mergeRanges(ranges)
}

type SegmentTranslationResult = {
  translated: string
  source: SelectionTranslationSource
}

const translateUnprotectedSegment = (
  segment: string,
  phraseSet: CompiledPhraseSet,
): SegmentTranslationResult => {
  if (segment.trim().length === 0) {
    return {
      translated: segment,
      source: 'none',
    }
  }

  const leadingWhitespace = segment.match(/^\s*/)?.[0] ?? ''
  const trailingWhitespace = segment.match(/\s*$/)?.[0] ?? ''
  const coreStart = leadingWhitespace.length
  const coreEnd = segment.length - trailingWhitespace.length
  const core = segment.slice(coreStart, coreEnd)
  if (core.length === 0) {
    return {
      translated: segment,
      source: 'none',
    }
  }

  const localExact = findExactPhraseMatch(core, phraseSet.localExact)
  if (localExact) {
    return {
      translated: `${leadingWhitespace}${localExact.target}${trailingWhitespace}`,
      source: 'local',
    }
  }

  const localCaseInsensitive = findCaseInsensitivePhraseMatch(core, phraseSet.localCaseInsensitive)
  if (localCaseInsensitive) {
    return {
      translated: `${leadingWhitespace}${localCaseInsensitive.target}${trailingWhitespace}`,
      source: 'local',
    }
  }

  const localPattern = findPatternPhraseMatch(core, phraseSet.localPattern)
  if (localPattern) {
    return {
      translated: `${leadingWhitespace}${localPattern.translated}${trailingWhitespace}`,
      source: 'local',
    }
  }

  const ruleExact = findExactPhraseMatch(core, phraseSet.rulesExact)
  if (ruleExact) {
    return {
      translated: `${leadingWhitespace}${ruleExact.target}${trailingWhitespace}`,
      source: 'rules',
    }
  }

  const ruleCaseInsensitive = findCaseInsensitivePhraseMatch(core, phraseSet.rulesCaseInsensitive)
  if (ruleCaseInsensitive) {
    return {
      translated: `${leadingWhitespace}${ruleCaseInsensitive.target}${trailingWhitespace}`,
      source: 'rules',
    }
  }

  const rulePattern = findPatternPhraseMatch(core, phraseSet.rulesPattern)
  if (rulePattern) {
    return {
      translated: `${leadingWhitespace}${rulePattern.translated}${trailingWhitespace}`,
      source: 'rules',
    }
  }

  const fallbackTranslated = translateWithFallbackWords(core)
  if (fallbackTranslated !== core) {
    return {
      translated: `${leadingWhitespace}${fallbackTranslated}${trailingWhitespace}`,
      source: 'fallback',
    }
  }

  return {
    translated: segment,
    source: 'none',
  }
}

export type SelectionTranslationSource = 'local' | 'rules' | 'fallback' | 'none'

export type SelectionTranslationResult = {
  original: string
  translated: string
  source: SelectionTranslationSource
  protectedSegments: string[]
  localEntry: GlossaryEntry | null
}

export const findLocalGlossaryMatch = (text: string, glossaryEntries: GlossaryEntry[]): GlossaryEntry | null => {
  const source = text.trim()
  if (source.length === 0) {
    return null
  }

  const activePhrases = buildActivePhrases(glossaryEntries)
  const localMatch = findLocalPhraseByPriority(
    source,
    activePhrases,
    DEFAULT_TRANSLATION_POLICY.localMatchPriority,
    DEFAULT_GLOSSARY_DOMAIN_ORDER,
  )
  if (!localMatch) {
    return null
  }

  return toGlossaryEntry(localMatch)
}

export const translateSelectionText = (
  text: string,
  glossaryEntries: GlossaryEntry[],
): SelectionTranslationResult => {
  const activePhrases = buildActivePhrases(glossaryEntries)
  const original = text
  const protectedRanges = findSelectionProtectedRanges(original)
  const translatedParts: string[] = []
  let source: SelectionTranslationSource = 'none'
  let cursor = 0

  for (const range of protectedRanges) {
    const segment = original.slice(cursor, range.start)
    if (segment.length > 0) {
      const translatedSegment = translateUnprotectedSegment(segment, activePhrases)
      translatedParts.push(translatedSegment.translated)
      source = pickHigherSource(source, translatedSegment.source)
    }

    translatedParts.push(original.slice(range.start, range.end))
    cursor = range.end
  }

  if (cursor < original.length) {
    const segment = original.slice(cursor)
    const translatedSegment = translateUnprotectedSegment(segment, activePhrases)
    translatedParts.push(translatedSegment.translated)
    source = pickHigherSource(source, translatedSegment.source)
  }

  const translated = translatedParts.length > 0 ? translatedParts.join('') : original
  const uniqueProtected = Array.from(
    new Set(
      protectedRanges
        .map((range) => original.slice(range.start, range.end))
        .filter((segment) => segment.trim().length > 0),
    ),
  )

  return {
    original,
    translated,
    source,
    protectedSegments: uniqueProtected,
    localEntry: findLocalGlossaryMatch(original, glossaryEntries),
  }
}

export type TranslationResult = {
  inlinePatches: Patch[]
  markers: Marker[]
  stats: DebugStats
}

export type TranslationContext = {
  glossaryDomainOrder?: GlossaryDomain[]
}

const DEFAULT_GLOSSARY_DOMAIN_ORDER: GlossaryDomain[] = [
  'common',
  'network-cisco',
  'network-huawei',
  'network-h3c',
  'network-ruijie',
]

const normalizeGlossaryDomain = (domain: unknown): GlossaryDomain => {
  if (
    domain === 'network-cisco' ||
    domain === 'network-huawei' ||
    domain === 'network-h3c' ||
    domain === 'network-ruijie' ||
    domain === 'common'
  ) {
    return domain
  }
  return 'common'
}

const normalizeDomainOrder = (input: GlossaryDomain[] | undefined): GlossaryDomain[] => {
  const seen = new Set<GlossaryDomain>()
  const ordered: GlossaryDomain[] = []
  for (const domain of input ?? []) {
    const normalized = normalizeGlossaryDomain(domain)
    if (seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    ordered.push(normalized)
  }
  for (const fallback of DEFAULT_GLOSSARY_DOMAIN_ORDER) {
    if (!seen.has(fallback)) {
      ordered.push(fallback)
    }
  }
  return ordered
}

const getDomainPriority = (phrase: ActivePhrase, domainOrder: GlossaryDomain[]): number => {
  if (phrase.sourceType !== 'glossary') {
    return 0
  }
  const index = domainOrder.indexOf(phrase.domain)
  if (index < 0) {
    return 1
  }
  return domainOrder.length - index + 1
}

export const buildTranslationPatches = (
  snapshot: BufferSnapshot,
  previousRuns: number,
  glossaryEntries: GlossaryEntry[],
  policyInput?: TranslationPolicy,
  contextInput?: TranslationContext,
): TranslationResult => {
  const policy = normalizeTranslationPolicy(policyInput)
  const context = contextInput ?? {}
  const glossaryDomainOrder = normalizeDomainOrder(context.glossaryDomainOrder)
  const activePhrases = buildActivePhrases(glossaryEntries)
  const inlinePatches: Patch[] = []
  const markerByRow = new Map<number, Marker>()
  const markerCol = Math.max(0, snapshot.screen.colCount - 1)
  const skipReasons = new Map<SkipReason, number>()
  let candidatesFound = 0
  let matchedPhrasesCount = 0
  let glossaryHits = 0
  let rulesHits = 0

  for (const scanRow of snapshot.scanRows) {
    const line = scanRow.scanText
    if (line.trim().length === 0) {
      pushSkipReason(skipReasons, 'blank')
      continue
    }

    const localOverride = findLocalLineOverride(line, activePhrases, policy.localMatchPriority, glossaryDomainOrder)
    if (localOverride) {
      matchedPhrasesCount += 1
      glossaryHits += 1

      if (scanRow.visibleRow === null) {
        pushSkipReason(skipReasons, 'out_of_viewport')
        continue
      }

      const [colStart, colEnd] = getSpan(scanRow, localOverride.start, localOverride.end, snapshot.screen.colCount)
      const span = Math.max(0, colEnd - colStart)
      if (span === 0) {
        pushSkipReason(skipReasons, 'invalid_span')
        continue
      }

      candidatesFound += 1
      const translatedFull = localOverride.translated
      const translatedWidth = stringCellWidth(translatedFull)
      const source = line.slice(localOverride.start, localOverride.end)

      if (translatedWidth <= span) {
        inlinePatches.push({
          row: scanRow.visibleRow,
          colStart,
          colEnd,
          translatedInline: translatedFull,
          translatedFull,
          source,
        })
      } else {
        appendMarker(markerByRow, scanRow.visibleRow, markerCol, translatedFull, source)
      }

      continue
    }

    if (policy.skipRules.stackLike && isStackLike(line)) {
      pushSkipReason(skipReasons, 'stack_like')
      continue
    }

    if (policy.skipRules.symbolOnly && isSymbolOnlyLine(line)) {
      pushSkipReason(skipReasons, 'symbol_only')
      continue
    }

    const uiLike = isUiLikeLine(line)
    const uiOnlyAllowed = uiLike || isNaturalLanguageLine(line)

    if (policy.skipRules.outOfViewport && scanRow.visibleRow === null && !uiOnlyAllowed) {
      pushSkipReason(skipReasons, 'out_of_viewport')
      continue
    }

    const protectedRanges = findProtectedRanges(line)
    const maskedLine = maskProtectedRanges(line, protectedRanges)

    if (policy.skipRules.protectedOnly && !hasNonProtectedText(maskedLine)) {
      pushSkipReason(skipReasons, 'protected_only')
      continue
    }

    const matches = collectPhraseMatches(line, maskedLine, uiOnlyAllowed, activePhrases)
    if (matches.length === 0) {
      const fallbackMatch = buildFallbackPhraseMatch(line, maskedLine, uiOnlyAllowed, policy.fallbackUiOnly)
      if (fallbackMatch) {
        matches.push(fallbackMatch)
      }
    }

    if (matches.length === 0) {
      pushSkipReason(skipReasons, 'no_match')
      continue
    }

    const selected = selectNonOverlappingMatches(matches, () => {
      pushSkipReason(skipReasons, 'overlap_filtered')
    }, glossaryDomainOrder)

    for (const match of selected) {
      matchedPhrasesCount += 1
      if (match.phrase.sourceType === 'glossary') {
        glossaryHits += 1
      } else if (match.phrase.sourceType === 'rules') {
        rulesHits += 1
      }

      if (scanRow.visibleRow === null) {
        pushSkipReason(skipReasons, 'out_of_viewport')
        continue
      }

      const [colStart, colEnd] = getSpan(scanRow, match.start, match.end, snapshot.screen.colCount)
      const span = Math.max(0, colEnd - colStart)
      if (span === 0) {
        pushSkipReason(skipReasons, 'invalid_span')
        continue
      }

      candidatesFound += 1

      const translatedFull = match.phrase.target
      const translatedWidth = stringCellWidth(translatedFull)
      const source = line.slice(match.start, match.end)

      if (translatedWidth <= span) {
        inlinePatches.push({
          row: scanRow.visibleRow,
          colStart,
          colEnd,
          translatedInline: translatedFull,
          translatedFull,
          source,
        })
      } else {
        appendMarker(markerByRow, scanRow.visibleRow, markerCol, translatedFull, source)
      }
    }
  }

  const markers = Array.from(markerByRow.values()).sort((a, b) => a.row - b.row)

  return {
    inlinePatches,
    markers,
    stats: {
      scanRuns: previousRuns + 1,
      candidatesFound,
      matchedPhrasesCount,
      glossaryHits,
      rulesHits,
      translatedCount: inlinePatches.length,
      markersRendered: markers.length,
      topSkipReasons: formatTopSkipReasons(skipReasons),
    },
  }
}
