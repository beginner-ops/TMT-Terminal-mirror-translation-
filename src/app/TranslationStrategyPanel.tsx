import { useMemo } from 'react'

const STRATEGY_OPTIONS: Array<{ value: TermbridgeMatchStrategy; label: string }> = [
  { value: 'exact', label: 'Exact (严格全等)' },
  { value: 'caseInsensitive', label: 'Case Insensitive (忽略大小写)' },
  { value: 'pattern', label: 'Pattern (正则/模式)' },
]

type TranslationStrategyPanelProps = {
  isOpen: boolean
  policy: TermbridgeTranslationMirrorPolicy
  status: string
  onClose: () => void
  onChange: (next: TermbridgeTranslationMirrorPolicy) => void
}

const dedupePriority = (items: TermbridgeMatchStrategy[]): TermbridgeMatchStrategy[] => {
  const list: TermbridgeMatchStrategy[] = []
  for (const item of items) {
    if (!list.includes(item)) {
      list.push(item)
    }
  }

  for (const fallback of ['exact', 'caseInsensitive', 'pattern'] as TermbridgeMatchStrategy[]) {
    if (!list.includes(fallback)) {
      list.push(fallback)
    }
  }

  return list
}

export const TranslationStrategyPanel = ({ isOpen, policy, status, onClose, onChange }: TranslationStrategyPanelProps) => {
  const priority = useMemo(() => dedupePriority(policy.localMatchPriority), [policy.localMatchPriority])

  if (!isOpen) {
    return null
  }

  const setSkipRule = (name: keyof TermbridgeTranslationMirrorPolicy['skipRules'], enabled: boolean): void => {
    onChange({
      ...policy,
      skipRules: {
        ...policy.skipRules,
        [name]: enabled,
      },
    })
  }

  const setPriorityAt = (index: number, value: TermbridgeMatchStrategy): void => {
    const next = [...priority]
    next[index] = value
    onChange({
      ...policy,
      localMatchPriority: dedupePriority(next),
    })
  }

  return (
    <aside className="strategy-panel" role="dialog" aria-label="Translation strategy">
      <div className="strategy-panel-header">
        <div>
          <div className="strategy-panel-title">翻译策略</div>
          <div className="strategy-panel-subtitle">更宽松可调，手动控制不翻译规则与本地命中优先级</div>
        </div>
        <button className="strategy-panel-close" onClick={onClose}>
          收起
        </button>
      </div>

      <div className="strategy-group">
        <div className="strategy-group-title">不翻译规则（可开关）</div>
        <label className="strategy-row">
          <input
            type="checkbox"
            checked={policy.skipRules.stackLike}
            onChange={(event) => {
              setSkipRule('stackLike', event.target.checked)
            }}
          />
          <span>stack_like：栈追踪 / 代码栅栏</span>
        </label>
        <label className="strategy-row">
          <input
            type="checkbox"
            checked={policy.skipRules.symbolOnly}
            onChange={(event) => {
              setSkipRule('symbolOnly', event.target.checked)
            }}
          />
          <span>symbol_only：纯符号/框线行</span>
        </label>
        <label className="strategy-row">
          <input
            type="checkbox"
            checked={policy.skipRules.protectedOnly}
            onChange={(event) => {
              setSkipRule('protectedOnly', event.target.checked)
            }}
          />
          <span>protected_only：保护内容占满整行</span>
        </label>
        <label className="strategy-row">
          <input
            type="checkbox"
            checked={policy.skipRules.outOfViewport}
            onChange={(event) => {
              setSkipRule('outOfViewport', event.target.checked)
            }}
          />
          <span>out_of_viewport：不可视区域跳过</span>
        </label>
      </div>

      <div className="strategy-group">
        <div className="strategy-group-title">手动命中优先级（本地词库）</div>
        <div className="strategy-priority-grid">
          {[0, 1, 2].map((index) => (
            <label key={index} className="strategy-priority-item">
              <span>优先级 {index + 1}</span>
              <select
                value={priority[index]}
                onChange={(event) => {
                  setPriorityAt(index, event.target.value as TermbridgeMatchStrategy)
                }}
              >
                {STRATEGY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="strategy-group">
        <div className="strategy-group-title">Fallback 限制</div>
        <label className="strategy-row">
          <input
            type="checkbox"
            checked={policy.fallbackUiOnly}
            onChange={(event) => {
              onChange({
                ...policy,
                fallbackUiOnly: event.target.checked,
              })
            }}
          />
          <span>仅 UI/自然语言行允许 fallback 翻译</span>
        </label>
      </div>

      <div className="strategy-status">{status || ' '}</div>
    </aside>
  )
}
