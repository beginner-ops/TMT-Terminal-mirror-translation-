import { useMemo, useState } from 'react'
import type { ExplainContext, ExplainMatcherType, ExplainRisk, ExplainRule } from './engine'

type RuleOrigin = 'builtin' | 'user'

type ViewRule = ExplainRule & {
  origin: RuleOrigin
}

type CommandExplainPanelProps = {
  isOpen: boolean
  onClose: () => void
  builtinByContext: Record<ExplainContext, ExplainRule[]>
  userRules: ExplainRule[]
  onUpsertUserRule: (input: {
    id?: string
    context: ExplainContext
    matcherType: ExplainMatcherType
    pattern: string
    title: string
    explanation: string
    risk: ExplainRisk
    args: string[]
    examples: string[]
  }) => void
  onDeleteUserRule: (id: string) => void
}

const CONTEXT_OPTIONS: Array<{ id: ExplainContext | 'all'; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'linux_shell', label: 'Linux' },
  { id: 'docker', label: 'Docker' },
  { id: 'network_cisco', label: 'Cisco' },
  { id: 'network_huawei', label: 'Huawei' },
]

const riskTag = (risk: ExplainRisk): string => {
  if (risk === 'danger') {
    return '危险'
  }
  if (risk === 'caution') {
    return '谨慎'
  }
  return '安全'
}

export const CommandExplainPanel = ({
  isOpen,
  onClose,
  builtinByContext,
  userRules,
  onUpsertUserRule,
  onDeleteUserRule,
}: CommandExplainPanelProps) => {
  const [searchText, setSearchText] = useState('')
  const [contextFilter, setContextFilter] = useState<ExplainContext | 'all'>('all')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [context, setContext] = useState<ExplainContext>('linux_shell')
  const [matcherType, setMatcherType] = useState<ExplainMatcherType>('prefix')
  const [pattern, setPattern] = useState('')
  const [title, setTitle] = useState('')
  const [explanation, setExplanation] = useState('')
  const [risk, setRisk] = useState<ExplainRisk>('safe')
  const [argsText, setArgsText] = useState('')
  const [examplesText, setExamplesText] = useState('')
  const [statusText, setStatusText] = useState('')
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({})

  const allRules = useMemo(() => {
    const builtin: ViewRule[] = []
    for (const key of Object.keys(builtinByContext) as ExplainContext[]) {
      for (const rule of builtinByContext[key]) {
        builtin.push({
          ...rule,
          origin: 'builtin',
        })
      }
    }

    const user: ViewRule[] = userRules.map((rule) => ({
      ...rule,
      origin: 'user',
    }))

    const merged = [...user, ...builtin]
    return merged.sort((a, b) => {
      if (a.origin !== b.origin) {
        return a.origin === 'user' ? -1 : 1
      }
      return a.title.localeCompare(b.title)
    })
  }, [builtinByContext, userRules])

  const filtered = useMemo(() => {
    const keyword = searchText.trim().toLocaleLowerCase()
    return allRules.filter((rule) => {
      if (contextFilter !== 'all' && rule.context !== contextFilter) {
        return false
      }
      if (keyword.length === 0) {
        return true
      }
      const haystack = [rule.title, rule.pattern, rule.explanation, ...(rule.args ?? []), ...(rule.examples ?? [])]
      return haystack.some((item) => item.toLocaleLowerCase().includes(keyword))
    })
  }, [allRules, contextFilter, searchText])

  if (!isOpen) {
    return null
  }

  const resetEditor = (): void => {
    setEditingId(null)
    setContext('linux_shell')
    setMatcherType('prefix')
    setPattern('')
    setTitle('')
    setExplanation('')
    setRisk('safe')
    setArgsText('')
    setExamplesText('')
  }

  return (
    <aside className="command-search-panel" role="dialog" aria-label="Command explain library">
      <div className="command-search-header">
        <div>
          <div className="command-search-title">命令解释</div>
          <div className="command-search-subtitle">解释规则库（本地优先 + 按上下文）</div>
        </div>
        <button className="command-search-close" onClick={onClose}>
          收起
        </button>
      </div>

      <div className="command-search-toolbar">
        <input
          className="command-search-input-lg"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="搜索标题 / pattern / 解释 / 参数"
        />
        <div className="command-search-categories">
          {CONTEXT_OPTIONS.map((item) => (
            <button
              key={item.id}
              className={`command-search-category${contextFilter === item.id ? ' command-search-category-active' : ''}`}
              onClick={() => setContextFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
          <button
            className={`command-search-manage-toggle${editorOpen ? ' command-search-manage-toggle-active' : ''}`}
            onClick={() => setEditorOpen((previous) => !previous)}
          >
            {editorOpen ? '收起管理' : '管理+'}
          </button>
        </div>
        <div className="command-search-summary">命中 {filtered.length} 条</div>
      </div>

      {editorOpen && (
        <div className="command-editor-panel">
          <div className="command-editor-title">{editingId ? '编辑本地解释规则' : '新增本地解释规则'}</div>
          <div className="command-editor-grid">
            <select className="command-editor-select" value={context} onChange={(event) => setContext(event.target.value as ExplainContext)}>
              <option value="linux_shell">linux_shell</option>
              <option value="docker">docker</option>
              <option value="network_cisco">network_cisco</option>
              <option value="network_huawei">network_huawei</option>
            </select>
            <select
              className="command-editor-select"
              value={matcherType}
              onChange={(event) => setMatcherType(event.target.value as ExplainMatcherType)}
            >
              <option value="prefix">prefix</option>
              <option value="regex">regex</option>
            </select>
            <input
              className="command-editor-input"
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              placeholder="匹配模式：docker logs -f <id> / ^show\\s+run"
            />
            <input
              className="command-editor-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="标题"
            />
            <textarea
              className="command-editor-textarea"
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
              placeholder="中文解释"
            />
            <select className="command-editor-select" value={risk} onChange={(event) => setRisk(event.target.value as ExplainRisk)}>
              <option value="safe">safe</option>
              <option value="caution">caution</option>
              <option value="danger">danger</option>
            </select>
            <textarea
              className="command-editor-textarea"
              value={argsText}
              onChange={(event) => setArgsText(event.target.value)}
              placeholder="参数拆解（每行一条）"
            />
            <textarea
              className="command-editor-textarea"
              value={examplesText}
              onChange={(event) => setExamplesText(event.target.value)}
              placeholder="示例（每行一条）"
            />
          </div>
          <div className="command-editor-actions">
            <button
              className="command-editor-button command-editor-button-primary"
              onClick={() => {
                const nextPattern = pattern.trim()
                const nextTitle = title.trim()
                const nextExplanation = explanation.trim()
                if (nextPattern.length === 0 || nextTitle.length === 0 || nextExplanation.length === 0) {
                  setStatusText('pattern、标题、解释不能为空')
                  return
                }
                onUpsertUserRule({
                  id: editingId ?? undefined,
                  context,
                  matcherType,
                  pattern: nextPattern,
                  title: nextTitle,
                  explanation: nextExplanation,
                  risk,
                  args: argsText
                    .split('\n')
                    .map((item) => item.trim())
                    .filter((item) => item.length > 0),
                  examples: examplesText
                    .split('\n')
                    .map((item) => item.trim())
                    .filter((item) => item.length > 0),
                })
                setStatusText(editingId ? '规则已更新' : '规则已创建')
                resetEditor()
              }}
            >
              {editingId ? '更新规则' : '添加规则'}
            </button>
            <button
              className="command-editor-button"
              onClick={() => {
                resetEditor()
                setStatusText('已清空编辑器')
              }}
            >
              清空
            </button>
          </div>
        </div>
      )}

      <div className="command-search-list" role="list">
        {filtered.length === 0 && <div className="command-search-empty">没有匹配解释规则</div>}
        {filtered.map((rule) => {
          const expanded = Boolean(expandedById[rule.id])
          return (
            <article className="command-search-card" key={`${rule.origin}:${rule.id}`} role="listitem">
              <div className="command-search-card-head">
                <div className="command-search-card-title">{rule.title}</div>
                <div className={`command-search-risk command-search-risk-${rule.risk === 'danger' ? 'destructive' : rule.risk}`}>
                  {riskTag(rule.risk)}
                </div>
              </div>
              <pre className="command-search-command">{rule.pattern}</pre>
              <div className="command-search-group-line">
                上下文：{rule.context} · 来源：{rule.origin === 'user' ? '本地' : '内置'} · 匹配：{rule.matcherType}
              </div>
              <div className="command-search-actions">
                <button
                  className="command-search-action"
                  onClick={() => {
                    setExpandedById((previous) => ({
                      ...previous,
                      [rule.id]: !previous[rule.id],
                    }))
                  }}
                >
                  {expanded ? '收起详情' : '展开详情'}
                </button>
                {rule.origin === 'user' && (
                  <button
                    className="command-search-action"
                    onClick={() => {
                      setEditorOpen(true)
                      setEditingId(rule.id)
                      setContext(rule.context)
                      setMatcherType(rule.matcherType)
                      setPattern(rule.pattern)
                      setTitle(rule.title)
                      setExplanation(rule.explanation)
                      setRisk(rule.risk)
                      setArgsText((rule.args ?? []).join('\n'))
                      setExamplesText((rule.examples ?? []).join('\n'))
                      setStatusText(`正在编辑：${rule.title}`)
                    }}
                  >
                    编辑
                  </button>
                )}
                {rule.origin === 'user' && (
                  <button
                    className="command-search-action command-search-action-danger"
                    onClick={() => {
                      const confirmed = window.confirm(`确定删除解释规则？\n\n${rule.title}`)
                      if (!confirmed) {
                        return
                      }
                      onDeleteUserRule(rule.id)
                      setStatusText(`已删除：${rule.title}`)
                    }}
                  >
                    删除
                  </button>
                )}
              </div>
              {expanded && (
                <div className="command-search-details">
                  <div className="command-search-summary-text">{rule.explanation}</div>
                  <div className="command-search-usage">
                    参数：{rule.args && rule.args.length > 0 ? rule.args.join(' | ') : '-'}
                  </div>
                  <div className="command-search-example">
                    示例：{rule.examples && rule.examples.length > 0 ? rule.examples.join(' | ') : '-'}
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>
      <div className="session-status">{statusText || ' '}</div>
    </aside>
  )
}

