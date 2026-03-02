export type ExplainContext = 'linux_shell' | 'docker' | 'network_cisco' | 'network_huawei'
export type ExplainRisk = 'safe' | 'caution' | 'danger'
export type ExplainMatcherType = 'prefix' | 'regex'

export type ExplainRule = {
  id: string
  context: ExplainContext
  matcherType: ExplainMatcherType
  pattern: string
  title: string
  explanation: string
  risk: ExplainRisk
  args?: string[]
  examples?: string[]
  updatedAt?: string
}

export type ExplainMatchSource = 'user' | 'builtin' | 'none'

export type ExplainMatch = {
  source: ExplainMatchSource
  selected: string
  normalized: string
  context: ExplainContext
  title: string
  explanation: string
  risk: ExplainRisk
  args: string[]
  examples: string[]
  matchedRuleId: string | null
}

type MatchCandidate = {
  rule: ExplainRule
  start: number
  end: number
  priority: number
}

const CONTEXTS: ExplainContext[] = ['linux_shell', 'docker', 'network_cisco', 'network_huawei']

const EXPLAINER_URLS: Record<ExplainContext, string> = {
  linux_shell: '/explainers/linux_shell.json',
  docker: '/explainers/docker.json',
  network_cisco: '/explainers/network_cisco.json',
  network_huawei: '/explainers/network_huawei.json',
}

const normalizeRisk = (value: unknown): ExplainRisk => {
  if (value === 'safe' || value === 'caution' || value === 'danger') {
    return value
  }
  if (value === 'destructive') {
    return 'danger'
  }
  return 'caution'
}

const normalizeMatcherType = (value: unknown): ExplainMatcherType => {
  return value === 'regex' ? 'regex' : 'prefix'
}

const cleanArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

const normalizeRule = (value: unknown, fallbackContext: ExplainContext): ExplainRule | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Partial<ExplainRule>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const pattern = typeof raw.pattern === 'string' ? raw.pattern.trim() : ''
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  const explanation = typeof raw.explanation === 'string' ? raw.explanation.trim() : ''
  if (id.length === 0 || pattern.length === 0 || title.length === 0 || explanation.length === 0) {
    return null
  }
  const context = raw.context && CONTEXTS.includes(raw.context) ? raw.context : fallbackContext
  return {
    id,
    context,
    matcherType: normalizeMatcherType(raw.matcherType),
    pattern,
    title,
    explanation,
    risk: normalizeRisk(raw.risk),
    args: cleanArray(raw.args),
    examples: cleanArray(raw.examples),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  }
}

const byLongestMatch = (a: MatchCandidate, b: MatchCandidate): number => {
  const lenDelta = (b.end - b.start) - (a.end - a.start)
  if (lenDelta !== 0) {
    return lenDelta
  }
  const startDelta = a.start - b.start
  if (startDelta !== 0) {
    return startDelta
  }
  return b.priority - a.priority
}

const toNonOverlapping = (candidates: MatchCandidate[]): MatchCandidate[] => {
  const sorted = [...candidates].sort(byLongestMatch)
  const accepted: MatchCandidate[] = []
  for (const current of sorted) {
    const overlaps = accepted.some((picked) => !(current.end <= picked.start || current.start >= picked.end))
    if (!overlaps) {
      accepted.push(current)
    }
  }
  return accepted.sort((a, b) => a.start - b.start)
}

const buildCandidate = (rule: ExplainRule, normalized: string, priority: number): MatchCandidate | null => {
  if (rule.matcherType === 'prefix') {
    if (normalized.startsWith(rule.pattern)) {
      return {
        rule,
        start: 0,
        end: rule.pattern.length,
        priority,
      }
    }
    return null
  }

  try {
    const matcher = new RegExp(rule.pattern, 'i')
    const matched = matcher.exec(normalized)
    if (!matched || typeof matched.index !== 'number') {
      return null
    }
    const text = matched[0] ?? ''
    if (text.length === 0) {
      return null
    }
    return {
      rule,
      start: matched.index,
      end: matched.index + text.length,
      priority,
    }
  } catch {
    return null
  }
}

export const normalizeCommandForExplain = (input: string): string => {
  let text = input.replace(/\r/g, ' ').replace(/\n+/g, ' ').trim()
  if (text.length === 0) {
    return ''
  }
  text = text.replace(/^\s*[\w.-]+@[\w.-]+(?::[^\s$#%>]*)?\s*[$#%>]\s*/, '')
  text = text.replace(/^.*?(?:[$#%>])\s+/, '')
  text = text.replace(/\bhttps?:\/\/[^\s"']+/gi, '<url>')
  text = text.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g, '<host>')
  text = text.replace(/\b[a-f0-9]{12,64}\b/gi, '<id>')
  text = text.replace(/\b[0-9]{5,}\b/g, '<id>')
  text = text.replace(/[A-Za-z]:\\[^\s"']+/g, '<path>')
  text = text.replace(/(?:^|\s)\/[^\s"']+/g, (segment) => segment.replace(/\/[^\s"']+/, '<path>'))
  text = text.replace(/\s+/g, ' ').trim()
  return text
}

export const loadBuiltinExplainers = async (): Promise<Record<ExplainContext, ExplainRule[]>> => {
  const result: Record<ExplainContext, ExplainRule[]> = {
    linux_shell: [],
    docker: [],
    network_cisco: [],
    network_huawei: [],
  }

  await Promise.all(
    CONTEXTS.map(async (context) => {
      try {
        const response = await fetch(EXPLAINER_URLS[context], { cache: 'no-cache' })
        if (!response.ok) {
          return
        }
        const payload = (await response.json()) as unknown
        const rows = Array.isArray(payload) ? payload : []
        const rules = rows
          .map((item) => normalizeRule(item, context))
          .filter((item): item is ExplainRule => Boolean(item))
        result[context] = rules
      } catch {
        result[context] = []
      }
    }),
  )
  return result
}

export const normalizeUserExplainRules = (raw: unknown): ExplainRule[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .map((item) => {
      const context = item && typeof item === 'object' && 'context' in item
        ? (item as Partial<ExplainRule>).context
        : 'linux_shell'
      const fallback = context && CONTEXTS.includes(context) ? context : 'linux_shell'
      return normalizeRule(item, fallback)
    })
    .filter((item): item is ExplainRule => Boolean(item))
}

export const upsertUserExplainRule = (rules: ExplainRule[], input: Omit<ExplainRule, 'id' | 'updatedAt'> & { id?: string }): ExplainRule[] => {
  const id = input.id && input.id.trim().length > 0
    ? input.id.trim()
    : `rule-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const now = new Date().toISOString()
  const normalized: ExplainRule = {
    id,
    context: input.context,
    matcherType: input.matcherType,
    pattern: input.pattern.trim(),
    title: input.title.trim(),
    explanation: input.explanation.trim(),
    risk: normalizeRisk(input.risk),
    args: cleanArray(input.args),
    examples: cleanArray(input.examples),
    updatedAt: now,
  }
  const index = rules.findIndex((rule) => rule.id === id)
  if (index >= 0) {
    const next = [...rules]
    next[index] = normalized
    return next
  }
  return [normalized, ...rules]
}

export const explainCommandByRules = (
  selected: string,
  context: ExplainContext,
  builtinByContext: Record<ExplainContext, ExplainRule[]>,
  userRules: ExplainRule[],
): ExplainMatch => {
  const normalized = normalizeCommandForExplain(selected)
  if (normalized.length === 0) {
    return {
      source: 'none',
      selected,
      normalized,
      context,
      title: '无可解释命令',
      explanation: '当前选中文本为空或不包含可解释命令。',
      risk: 'safe',
      args: [],
      examples: [],
      matchedRuleId: null,
    }
  }

  const contextUserRules = userRules.filter((rule) => rule.context === context)
  const contextBuiltinRules = builtinByContext[context] ?? []

  const pick = (rules: ExplainRule[], priorityBase: number): MatchCandidate | null => {
    const candidates = rules
      .map((rule, index) => buildCandidate(rule, normalized, priorityBase - index))
      .filter((item): item is MatchCandidate => Boolean(item))
    if (candidates.length === 0) {
      return null
    }
    return toNonOverlapping(candidates)[0] ?? null
  }

  const userHit = pick(contextUserRules, 2000)
  if (userHit) {
    return {
      source: 'user',
      selected,
      normalized,
      context,
      title: userHit.rule.title,
      explanation: userHit.rule.explanation,
      risk: userHit.rule.risk,
      args: userHit.rule.args ?? [],
      examples: userHit.rule.examples ?? [],
      matchedRuleId: userHit.rule.id,
    }
  }

  const builtinHit = pick(contextBuiltinRules, 1000)
  if (builtinHit) {
    return {
      source: 'builtin',
      selected,
      normalized,
      context,
      title: builtinHit.rule.title,
      explanation: builtinHit.rule.explanation,
      risk: builtinHit.rule.risk,
      args: builtinHit.rule.args ?? [],
      examples: builtinHit.rule.examples ?? [],
      matchedRuleId: builtinHit.rule.id,
    }
  }

  return {
    source: 'none',
    selected,
    normalized,
    context,
    title: '未命中本地规则',
    explanation: '当前上下文下没有命中本地解释规则，可添加为本地规则，或后续接入在线解释。',
    risk: 'caution',
    args: [],
    examples: [],
    matchedRuleId: null,
  }
}

