import { useEffect, useMemo, useRef, useState } from 'react'

export type SyntaxHighlightRule = {
  id: string
  label: string
  scope: 'all' | 'linux_shell' | 'docker' | 'network_cisco' | 'network_huawei' | 'network_h3c' | 'network_ruijie'
  matchType: 'contains' | 'prefix' | 'regex'
  styleMode: 'background' | 'foreground'
  pattern: string
  color: string
  enabled: boolean
}

export type AppSettings = {
  compactUi: boolean
  showDebugButton: boolean
  fontScale: number
  theme: 'dark' | 'light'
  terminalBackground: string
  terminalForeground: string
  leftHighlightOpacity: number
  syntaxHighlightRules: SyntaxHighlightRule[]
  dockSlots: number
  shortcutNextTerminalTab: 'ctrl+tab' | 'ctrl+shift+tab'
  dockShortcutStart: 'f1' | 'f2' | 'f3' | 'f4'
}

type TranslationProviderOption = 'google-free' | 'openai-compatible' | 'tencent-tmt'

type SettingsPanelProps = {
  isOpen: boolean
  settings: AppSettings
  activeHighlightScope?: SyntaxHighlightRule['scope']
  translationConfig: TermbridgeTranslationConfig | null
  translationStatus: string
  onClose: () => void
  onChange: (next: AppSettings) => void
  onSaveTranslationConfig: (nextConfig: TermbridgeTranslationConfig) => Promise<void>
  onImportGlossary: () => void
  onExportGlossary: () => void
  onImportSessions: () => void
  onExportSessions: () => void
  onImportAutomation: () => void
  onExportAutomation: () => void
  onImportCommandCatalog: () => void
  onExportCommandCatalog: () => void
  onImportCommandExplain: () => void
  onExportCommandExplain: () => void
  onExportAllData: () => void
  onImportAllData: () => void
}

type HighlightPresetRule = Omit<SyntaxHighlightRule, 'id'> & { enabled?: boolean }

type HighlightPresetBundle = {
  id: string
  label: string
  description: string
  rules: HighlightPresetRule[]
}

const PROVIDER_LABELS: Record<TranslationProviderOption, string> = {
  'google-free': 'Google Free',
  'openai-compatible': 'OpenAI Compatible',
  'tencent-tmt': 'Tencent TMT',
}

const normalizeHexColor = (value: string, fallback: string): string => {
  const trimmed = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const chars = trimmed.slice(1).split('')
    return `#${chars.map((char) => `${char}${char}`).join('').toLowerCase()}`
  }
  return fallback
}

const HIGHLIGHT_PRESET_BUNDLES: HighlightPresetBundle[] = [
  {
    id: 'ops-core',
    label: '运维基础',
    description: '常见错误/告警/成功状态，适用于通用 shell。',
    rules: [
      { label: 'Error', scope: 'all', matchType: 'contains', styleMode: 'foreground', pattern: 'error', color: '#ef4444', enabled: true },
      { label: 'Warning', scope: 'all', matchType: 'contains', styleMode: 'background', pattern: 'warning', color: '#f59e0b', enabled: true },
      { label: 'Failed', scope: 'all', matchType: 'contains', styleMode: 'foreground', pattern: 'failed', color: '#ef4444', enabled: true },
      { label: 'Success', scope: 'all', matchType: 'contains', styleMode: 'foreground', pattern: 'success', color: '#22c55e', enabled: true },
    ],
  },
  {
    id: 'docker-kit',
    label: 'Docker 推荐',
    description: '容器日志与生命周期关键词。',
    rules: [
      { label: 'Docker Error', scope: 'docker', matchType: 'contains', styleMode: 'foreground', pattern: 'docker: Error', color: '#ef4444', enabled: true },
      { label: 'Container Exit', scope: 'docker', matchType: 'contains', styleMode: 'background', pattern: 'Exited', color: '#f59e0b', enabled: true },
      { label: 'Container Up', scope: 'docker', matchType: 'contains', styleMode: 'foreground', pattern: 'Up ', color: '#22c55e', enabled: true },
    ],
  },
  {
    id: 'network-kit',
    label: '网络设备推荐',
    description: 'Cisco/Huawei 常见报错与状态词。',
    rules: [
      { label: 'Invalid Input', scope: 'network_cisco', matchType: 'contains', styleMode: 'foreground', pattern: 'Invalid input', color: '#ef4444', enabled: true },
      { label: 'Ambiguous Command', scope: 'network_cisco', matchType: 'contains', styleMode: 'background', pattern: 'Ambiguous command', color: '#f59e0b', enabled: true },
      { label: 'Error HUAWEI', scope: 'network_huawei', matchType: 'contains', styleMode: 'foreground', pattern: 'Error:', color: '#ef4444', enabled: true },
      { label: 'Warning HUAWEI', scope: 'network_huawei', matchType: 'contains', styleMode: 'background', pattern: 'Warning:', color: '#f59e0b', enabled: true },
    ],
  },
]

const reorderRules = (
  rules: SyntaxHighlightRule[],
  sourceId: string,
  targetId: string,
): SyntaxHighlightRule[] => {
  if (sourceId === targetId) {
    return rules
  }
  const sourceIndex = rules.findIndex((rule) => rule.id === sourceId)
  const targetIndex = rules.findIndex((rule) => rule.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0) {
    return rules
  }
  const next = [...rules]
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
}

const normalizeImportedRules = (value: unknown): SyntaxHighlightRule[] => {
  const rawRules = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { rules?: unknown[] }).rules)
      ? (value as { rules: unknown[] }).rules
      : []

  const next: SyntaxHighlightRule[] = []
  rawRules.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      return
    }
    const candidate = item as Partial<SyntaxHighlightRule>
    const matchType =
      candidate.matchType === 'prefix' || candidate.matchType === 'regex' || candidate.matchType === 'contains'
        ? candidate.matchType
        : 'contains'
    const styleMode = candidate.styleMode === 'foreground' ? 'foreground' : 'background'
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
    const pattern = typeof candidate.pattern === 'string' ? candidate.pattern : ''
    const color = normalizeHexColor(typeof candidate.color === 'string' ? candidate.color : '', '#f59e0b')
    const label =
      typeof candidate.label === 'string' && candidate.label.trim().length > 0
        ? candidate.label.trim()
        : `导入规则 ${index + 1}`
    const id =
      typeof candidate.id === 'string' && candidate.id.trim().length > 0
        ? candidate.id.trim()
        : `import-${Date.now().toString(36)}-${index}`
    next.push({
      id,
      label,
      scope,
      matchType,
      styleMode,
      pattern,
      color,
      enabled: candidate.enabled !== false,
    })
  })
  return next
}

const previewFindMatches = (text: string, rule: SyntaxHighlightRule): Array<{ start: number; end: number }> => {
  const pattern = rule.pattern.trim()
  if (pattern.length === 0) {
    return []
  }
  if (rule.matchType === 'prefix') {
    const leftTrimmed = text.trimStart()
    const leftPadding = text.length - leftTrimmed.length
    return leftTrimmed.toLowerCase().startsWith(pattern.toLowerCase())
      ? [{ start: leftPadding, end: leftPadding + pattern.length }]
      : []
  }
  if (rule.matchType === 'regex') {
    try {
      const regex = new RegExp(pattern, 'gi')
      const hits: Array<{ start: number; end: number }> = []
      let match = regex.exec(text)
      while (match && hits.length < 200) {
        const value = match[0] ?? ''
        if (value.length === 0) {
          regex.lastIndex += 1
        } else {
          hits.push({ start: match.index, end: match.index + value.length })
        }
        match = regex.exec(text)
      }
      return hits
    } catch {
      return []
    }
  }
  const source = text.toLowerCase()
  const needle = pattern.toLowerCase()
  const hits: Array<{ start: number; end: number }> = []
  let from = 0
  while (hits.length < 200) {
    const index = source.indexOf(needle, from)
    if (index < 0) {
      break
    }
    hits.push({ start: index, end: index + needle.length })
    from = index + Math.max(1, needle.length)
  }
  return hits
}

const buildPreviewStyles = (
  text: string,
  rules: SyntaxHighlightRule[],
  scope: SyntaxHighlightRule['scope'],
): Array<{ color: string | null; background: string | null }> => {
  const result: Array<{ color: string | null; background: string | null }> = Array.from(
    { length: text.length },
    () => ({ color: null, background: null }),
  )

  rules.forEach((rule) => {
    if (!rule.enabled) {
      return
    }
    if (rule.scope !== 'all' && rule.scope !== scope) {
      return
    }
    previewFindMatches(text, rule).forEach(({ start, end }) => {
      const safeStart = Math.max(0, start)
      const safeEnd = Math.min(text.length, end)
      for (let index = safeStart; index < safeEnd; index += 1) {
        if (rule.styleMode === 'foreground') {
          if (result[index].color === null) {
            result[index].color = rule.color
          }
        } else if (result[index].background === null) {
          result[index].background = `${rule.color}33`
        }
      }
    })
  })

  return result
}

const normalizeFallbacks = (
  primary: TranslationProviderOption,
  first: TranslationProviderOption | '',
  second: TranslationProviderOption | '',
): TranslationProviderOption[] => {
  const result: TranslationProviderOption[] = []
  for (const candidate of [first, second]) {
    if (!candidate) {
      continue
    }
    if (candidate === primary) {
      continue
    }
    if (!result.includes(candidate)) {
      result.push(candidate)
    }
  }
  return result
}

export const SettingsPanel = ({
  isOpen,
  settings,
  activeHighlightScope,
  translationConfig,
  translationStatus,
  onClose,
  onChange,
  onSaveTranslationConfig,
  onImportGlossary,
  onExportGlossary,
  onImportSessions,
  onExportSessions,
  onImportAutomation,
  onExportAutomation,
  onImportCommandCatalog,
  onExportCommandCatalog,
  onImportCommandExplain,
  onExportCommandExplain,
  onExportAllData,
  onImportAllData,
}: SettingsPanelProps) => {
  const [draftTranslationConfig, setDraftTranslationConfig] = useState<TermbridgeTranslationConfig | null>(translationConfig)
  const [settingsTab, setSettingsTab] = useState<'ui' | 'appearance' | 'shortcuts' | 'exchange' | 'translation' | 'about'>('ui')
  const [dragRuleId, setDragRuleId] = useState<string | null>(null)
  const [dragOverRuleId, setDragOverRuleId] = useState<string | null>(null)
  const [scopeFilter, setScopeFilter] = useState<SyntaxHighlightRule['scope'] | 'all-scopes'>('all-scopes')
  const [previewText, setPreviewText] = useState('docker logs -f <id> | show running-config | error | warning')
  const [batchColorDraft, setBatchColorDraft] = useState('#22c55e')
  const [selectedPresetId, setSelectedPresetId] = useState(HIGHLIGHT_PRESET_BUNDLES[0]?.id ?? 'ops-core')
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const previewStyles = useMemo(
    () => buildPreviewStyles(previewText, settings.syntaxHighlightRules, activeHighlightScope ?? 'linux_shell'),
    [activeHighlightScope, previewText, settings.syntaxHighlightRules],
  )
  const selectedPreset = useMemo(
    () => HIGHLIGHT_PRESET_BUNDLES.find((item) => item.id === selectedPresetId) ?? HIGHLIGHT_PRESET_BUNDLES[0],
    [selectedPresetId],
  )

  useEffect(() => {
    setDraftTranslationConfig(translationConfig)
  }, [translationConfig])

  if (!isOpen) {
    return null
  }

  const primaryProvider = (draftTranslationConfig?.defaultProvider ?? 'google-free') as TranslationProviderOption
  const fallbackFirst = (draftTranslationConfig?.fallbackProviders?.[0] ?? '') as TranslationProviderOption | ''
  const fallbackSecond = (draftTranslationConfig?.fallbackProviders?.[1] ?? '') as TranslationProviderOption | ''

  return (
    <aside className="settings-panel" role="dialog" aria-label="System settings">
      <div className="settings-panel-header">
        <div>
          <div className="settings-panel-title">设置</div>
          <div className="settings-panel-subtitle">系统与界面行为调节</div>
        </div>
        <button className="settings-panel-close" onClick={onClose}>
          收起
        </button>
      </div>

      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        <button
          className={`settings-tab${settingsTab === 'ui' ? ' settings-tab-active' : ''}`}
          onClick={() => setSettingsTab('ui')}
        >
          界面
        </button>
        <button
          className={`settings-tab${settingsTab === 'appearance' ? ' settings-tab-active' : ''}`}
          onClick={() => setSettingsTab('appearance')}
        >
          外观与高亮
        </button>
        <button
          className={`settings-tab${settingsTab === 'shortcuts' ? ' settings-tab-active' : ''}`}
          onClick={() => setSettingsTab('shortcuts')}
        >
          快捷键
        </button>
        <button
          className={`settings-tab${settingsTab === 'exchange' ? ' settings-tab-active' : ''}`}
          onClick={() => setSettingsTab('exchange')}
        >
          数据交换
        </button>
        <button
          className={`settings-tab${settingsTab === 'translation' ? ' settings-tab-active' : ''}`}
          onClick={() => setSettingsTab('translation')}
        >
          翻译设置
        </button>
        <button
          className={`settings-tab${settingsTab === 'about' ? ' settings-tab-active' : ''}`}
          onClick={() => setSettingsTab('about')}
        >
          关于项目
        </button>
      </div>

      {settingsTab === 'ui' && (
      <div className="settings-section">
        <div className="settings-about-title">界面</div>
        <label className="settings-row">
          <input
            type="checkbox"
            checked={settings.compactUi}
            onChange={(event) => {
              onChange({ ...settings, compactUi: event.target.checked })
            }}
          />
          <span>紧凑模式（减小面板间距）</span>
        </label>

        <label className="settings-row">
          <input
            type="checkbox"
            checked={settings.showDebugButton}
            onChange={(event) => {
              onChange({ ...settings, showDebugButton: event.target.checked })
            }}
          />
          <span>显示 Debug 按钮</span>
        </label>

        <label className="settings-range-label">
          <span>字体缩放：{settings.fontScale.toFixed(2)}x</span>
          <input
            className="settings-range"
            type="range"
            min="0.85"
            max="1.25"
            step="0.05"
            value={settings.fontScale}
            onChange={(event) => {
              onChange({ ...settings, fontScale: Number(event.target.value) })
            }}
          />
        </label>

        <label className="settings-range-label">
          <span>主题</span>
          <select
            className="settings-select"
            value={settings.theme}
            onChange={(event) => {
              onChange({
                ...settings,
                theme: event.target.value as AppSettings['theme'],
              })
            }}
          >
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
        </label>

        <label className="settings-range-label">
          <span>底部空位数量：{settings.dockSlots}</span>
          <input
            className="settings-range"
            type="range"
            min="4"
            max="12"
            step="1"
            value={settings.dockSlots}
            onChange={(event) => {
              onChange({
                ...settings,
                dockSlots: Number(event.target.value),
              })
            }}
          />
        </label>
      </div>
      )}

      {settingsTab === 'appearance' && (
      <div className="settings-section settings-appearance">
        <div className="settings-about-title">终端主题颜色</div>
        <div className="settings-about-item">背景和前景颜色会同时作用到左侧终端与右侧镜像区域。</div>

        <label className="settings-range-label">
          <span>终端背景色</span>
          <div className="settings-color-row">
            <input
              className="settings-color-picker"
              type="color"
              value={settings.terminalBackground}
              onChange={(event) => {
                onChange({ ...settings, terminalBackground: normalizeHexColor(event.target.value, settings.terminalBackground) })
              }}
            />
            <input
              className="settings-select"
              value={settings.terminalBackground}
              onChange={(event) => {
                onChange({
                  ...settings,
                  terminalBackground: normalizeHexColor(event.target.value, settings.terminalBackground),
                })
              }}
            />
          </div>
        </label>

        <label className="settings-range-label">
          <span>终端前景色</span>
          <div className="settings-color-row">
            <input
              className="settings-color-picker"
              type="color"
              value={settings.terminalForeground}
              onChange={(event) => {
                onChange({ ...settings, terminalForeground: normalizeHexColor(event.target.value, settings.terminalForeground) })
              }}
            />
            <input
              className="settings-select"
              value={settings.terminalForeground}
              onChange={(event) => {
                onChange({
                  ...settings,
                  terminalForeground: normalizeHexColor(event.target.value, settings.terminalForeground),
                })
              }}
            />
          </div>
        </label>

        <div className="settings-about-title">语法高亮规则</div>
        <div className="settings-about-item">
          当前版本高亮作用于右侧镜像文本，不改变终端原始布局。当前会话作用域：
          <b> {activeHighlightScope ?? 'linux_shell'}</b>
        </div>
        <div className="settings-preview">
          <div className="settings-preview-title">系统推荐合集</div>
          <label className="settings-range-label">
            <span>推荐集合</span>
            <select
              className="settings-select"
              value={selectedPresetId}
              onChange={(event) => setSelectedPresetId(event.target.value)}
            >
              {HIGHLIGHT_PRESET_BUNDLES.map((bundle) => (
                <option key={bundle.id} value={bundle.id}>
                  {bundle.label}
                </option>
              ))}
            </select>
          </label>
          <div className="settings-preview-muted">{selectedPreset?.description}</div>
          <div className="settings-appearance-actions">
            <button
              className="settings-translation-save"
              onClick={() => {
                const bundle = selectedPreset
                if (!bundle) {
                  return
                }
                const nextRules: SyntaxHighlightRule[] = bundle.rules.map((rule, index) => ({
                  ...rule,
                  id: `preset-${bundle.id}-${Date.now().toString(36)}-${index}`,
                  enabled: rule.enabled !== false,
                }))
                onChange({
                  ...settings,
                  syntaxHighlightRules: nextRules,
                })
              }}
            >
              覆盖应用
            </button>
            <button
              className="settings-translation-save"
              onClick={() => {
                const bundle = selectedPreset
                if (!bundle) {
                  return
                }
                const next = [...settings.syntaxHighlightRules]
                bundle.rules.forEach((rule, index) => {
                  const duplicate = next.some(
                    (item) =>
                      item.scope === rule.scope &&
                      item.matchType === rule.matchType &&
                      item.styleMode === rule.styleMode &&
                      item.pattern.toLowerCase() === rule.pattern.toLowerCase(),
                  )
                  if (!duplicate) {
                    next.push({
                      ...rule,
                      id: `preset-${bundle.id}-${Date.now().toString(36)}-${index}`,
                      enabled: rule.enabled !== false,
                    })
                  }
                })
                onChange({
                  ...settings,
                  syntaxHighlightRules: next,
                })
              }}
            >
              追加应用
            </button>
          </div>
        </div>
        <label className="settings-range-label">
          <span>规则筛选</span>
          <select
            className="settings-select"
            value={scopeFilter}
            onChange={(event) => setScopeFilter(event.target.value as SyntaxHighlightRule['scope'] | 'all-scopes')}
          >
            <option value="all-scopes">全部作用域</option>
            <option value="all">全局</option>
            <option value="linux_shell">Linux</option>
            <option value="docker">Docker</option>
            <option value="network_cisco">Cisco</option>
            <option value="network_huawei">Huawei</option>
            <option value="network_h3c">H3C</option>
            <option value="network_ruijie">Ruijie</option>
          </select>
        </label>
        <label className="settings-range-label">
          <span>左侧高亮强度：{settings.leftHighlightOpacity.toFixed(2)}</span>
          <input
            className="settings-range"
            type="range"
            min="0.08"
            max="0.50"
            step="0.02"
            value={settings.leftHighlightOpacity}
            onChange={(event) => {
              onChange({
                ...settings,
                leftHighlightOpacity: Number(event.target.value),
              })
            }}
          />
        </label>
        <div className="settings-appearance-actions">
          <button
            className="settings-translation-save"
            onClick={() => {
              const newRule: SyntaxHighlightRule = {
                id: `hl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                label: '新规则',
                scope: 'all',
                matchType: 'contains',
                styleMode: 'background',
                pattern: '',
                color: '#f59e0b',
                enabled: true,
              }
              const nextRules = [
                ...settings.syntaxHighlightRules,
                newRule,
              ]
              onChange({
                ...settings,
                syntaxHighlightRules: nextRules,
              })
            }}
          >
            新增规则
          </button>
          <button
            className="settings-translation-save"
            onClick={() => {
              const payload = {
                schema: 'termbridge.highlight.rules',
                version: 1,
                exportedAt: new Date().toISOString(),
                rules: settings.syntaxHighlightRules,
              }
              const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = `termbridge-highlight-rules-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
              link.click()
              URL.revokeObjectURL(url)
            }}
          >
            导出 JSON
          </button>
          <button
            className="settings-translation-save"
            onClick={() => {
              importInputRef.current?.click()
            }}
          >
            导入 JSON
          </button>
          <button
            className="settings-translation-save"
            onClick={() => {
              const nextRules = settings.syntaxHighlightRules.map((item) => {
                if (scopeFilter === 'all-scopes' || item.scope === scopeFilter) {
                  return { ...item, enabled: true }
                }
                return item
              })
              onChange({ ...settings, syntaxHighlightRules: nextRules })
            }}
          >
            批量启用
          </button>
          <button
            className="settings-translation-save"
            onClick={() => {
              const nextRules = settings.syntaxHighlightRules.map((item) => {
                if (scopeFilter === 'all-scopes' || item.scope === scopeFilter) {
                  return { ...item, enabled: false }
                }
                return item
              })
              onChange({ ...settings, syntaxHighlightRules: nextRules })
            }}
          >
            批量停用
          </button>
          <button
            className="settings-translation-save"
            onClick={() => {
              const nextRules = settings.syntaxHighlightRules.map((item) => {
                if (scopeFilter === 'all-scopes' || item.scope === scopeFilter) {
                  return { ...item, styleMode: 'background' as const }
                }
                return item
              })
              onChange({ ...settings, syntaxHighlightRules: nextRules })
            }}
          >
            批量设背景
          </button>
          <button
            className="settings-translation-save"
            onClick={() => {
              const nextRules = settings.syntaxHighlightRules.map((item) => {
                if (scopeFilter === 'all-scopes' || item.scope === scopeFilter) {
                  return { ...item, styleMode: 'foreground' as const }
                }
                return item
              })
              onChange({ ...settings, syntaxHighlightRules: nextRules })
            }}
          >
            批量设前景
          </button>
        </div>
        <div className="settings-color-row settings-color-row-batch">
          <input
            className="settings-color-picker"
            type="color"
            value={batchColorDraft}
            onChange={(event) => setBatchColorDraft(normalizeHexColor(event.target.value, batchColorDraft))}
          />
          <input
            className="settings-select"
            value={batchColorDraft}
            onChange={(event) => setBatchColorDraft(normalizeHexColor(event.target.value, batchColorDraft))}
          />
          <button
            className="settings-translation-save"
            onClick={() => {
              const nextRules = settings.syntaxHighlightRules.map((item) => {
                if (scopeFilter === 'all-scopes' || item.scope === scopeFilter) {
                  return { ...item, color: batchColorDraft }
                }
                return item
              })
              onChange({ ...settings, syntaxHighlightRules: nextRules })
            }}
          >
            批量改色
          </button>
        </div>
        <div className="settings-preview">
          <div className="settings-preview-title">命中预览</div>
          <input
            className="settings-select"
            value={previewText}
            onChange={(event) => setPreviewText(event.target.value)}
            placeholder="输入命令文本预览高亮命中"
          />
          <div className="settings-preview-render">
            {previewText.length === 0 ? (
              <span className="settings-preview-muted">输入内容后可查看规则命中效果</span>
            ) : (
              Array.from(previewText).map((char, index) => {
                const styleMap = previewStyles[index]
                return (
                  <span
                    key={`${char}-${index}`}
                    style={{
                      color: styleMap?.color ?? undefined,
                      backgroundColor: styleMap?.background ?? undefined,
                    }}
                  >
                    {char}
                  </span>
                )
              })
            )}
          </div>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) {
              return
            }
            const reader = new FileReader()
            reader.onload = () => {
              try {
                const parsed = JSON.parse(String(reader.result ?? '{}')) as unknown
                const imported = normalizeImportedRules(parsed)
                if (imported.length === 0) {
                  window.alert('导入失败：未找到有效规则')
                  return
                }
                onChange({
                  ...settings,
                  syntaxHighlightRules: imported,
                })
                window.alert(`导入完成：${imported.length} 条规则`)
              } catch {
                window.alert('导入失败：JSON 格式无效')
              } finally {
                event.target.value = ''
              }
            }
            reader.readAsText(file)
          }}
        />
        <div className="settings-highlight-list">
          {settings.syntaxHighlightRules.filter((item) => scopeFilter === 'all-scopes' || item.scope === scopeFilter).length === 0 ? (
            <div className="settings-about-item">暂无规则，点击“新增规则”创建。</div>
          ) : (
            settings.syntaxHighlightRules
              .filter((item) => scopeFilter === 'all-scopes' || item.scope === scopeFilter)
              .map((rule, index) => (
              <div
                key={rule.id}
                className={`settings-highlight-row${dragOverRuleId === rule.id ? ' settings-highlight-row-over' : ''}`}
                draggable
                onDragStart={(event) => {
                  setDragRuleId(rule.id)
                  event.dataTransfer.setData('text/plain', rule.id)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragOverRuleId(rule.id)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const sourceId = event.dataTransfer.getData('text/plain') || dragRuleId
                  if (!sourceId) {
                    return
                  }
                  onChange({
                    ...settings,
                    syntaxHighlightRules: reorderRules(settings.syntaxHighlightRules, sourceId, rule.id),
                  })
                  setDragRuleId(null)
                  setDragOverRuleId(null)
                }}
                onDragEnd={() => {
                  setDragRuleId(null)
                  setDragOverRuleId(null)
                }}
              >
                <div className="settings-highlight-order">#{index + 1}</div>
                <label className="settings-row">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(event) => {
                      onChange({
                        ...settings,
                        syntaxHighlightRules: settings.syntaxHighlightRules.map((item) =>
                          item.id === rule.id ? { ...item, enabled: event.target.checked } : item,
                        ),
                      })
                    }}
                  />
                  <span>启用</span>
                </label>
                <input
                  className="settings-select"
                  value={rule.label}
                  placeholder="规则名"
                  onChange={(event) => {
                    onChange({
                      ...settings,
                      syntaxHighlightRules: settings.syntaxHighlightRules.map((item) =>
                        item.id === rule.id ? { ...item, label: event.target.value } : item,
                      ),
                    })
                  }}
                />
                <select
                  className="settings-select"
                  value={rule.scope}
                  onChange={(event) => {
                    onChange({
                      ...settings,
                      syntaxHighlightRules: settings.syntaxHighlightRules.map((item) =>
                        item.id === rule.id
                          ? { ...item, scope: event.target.value as SyntaxHighlightRule['scope'] }
                          : item,
                      ),
                    })
                  }}
                >
                  <option value="all">全局</option>
                  <option value="linux_shell">Linux</option>
                  <option value="docker">Docker</option>
                  <option value="network_cisco">Cisco</option>
                  <option value="network_huawei">Huawei</option>
                  <option value="network_h3c">H3C</option>
                  <option value="network_ruijie">Ruijie</option>
                </select>
                <select
                  className="settings-select"
                  value={rule.matchType}
                  onChange={(event) => {
                    onChange({
                      ...settings,
                      syntaxHighlightRules: settings.syntaxHighlightRules.map((item) =>
                        item.id === rule.id
                          ? { ...item, matchType: event.target.value as SyntaxHighlightRule['matchType'] }
                          : item,
                      ),
                    })
                  }}
                >
                  <option value="contains">包含</option>
                  <option value="prefix">前缀</option>
                  <option value="regex">正则</option>
                </select>
                <select
                  className="settings-select"
                  value={rule.styleMode}
                  onChange={(event) => {
                    onChange({
                      ...settings,
                      syntaxHighlightRules: settings.syntaxHighlightRules.map((item) =>
                        item.id === rule.id
                          ? { ...item, styleMode: event.target.value as SyntaxHighlightRule['styleMode'] }
                          : item,
                      ),
                    })
                  }}
                >
                  <option value="background">背景高亮</option>
                  <option value="foreground">前景高亮</option>
                </select>
                <input
                  className="settings-select"
                  value={rule.pattern}
                  placeholder="匹配内容"
                  onChange={(event) => {
                    onChange({
                      ...settings,
                      syntaxHighlightRules: settings.syntaxHighlightRules.map((item) =>
                        item.id === rule.id ? { ...item, pattern: event.target.value } : item,
                      ),
                    })
                  }}
                />
                <div className="settings-color-row">
                  <input
                    className="settings-color-picker"
                    type="color"
                    value={rule.color}
                    onChange={(event) => {
                      onChange({
                        ...settings,
                        syntaxHighlightRules: settings.syntaxHighlightRules.map((item) =>
                          item.id === rule.id ? { ...item, color: normalizeHexColor(event.target.value, item.color) } : item,
                        ),
                      })
                    }}
                  />
                  <input
                    className="settings-select"
                    value={rule.color}
                    onChange={(event) => {
                      onChange({
                        ...settings,
                        syntaxHighlightRules: settings.syntaxHighlightRules.map((item) =>
                          item.id === rule.id ? { ...item, color: normalizeHexColor(event.target.value, item.color) } : item,
                        ),
                      })
                    }}
                  />
                </div>
                <button
                  className="command-search-close"
                  onClick={() => {
                    onChange({
                      ...settings,
                      syntaxHighlightRules: settings.syntaxHighlightRules.filter((item) => item.id !== rule.id),
                    })
                  }}
                >
                  删除
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      )}

      {settingsTab === 'shortcuts' && (
      <div className="settings-section">
        <div className="settings-about-title">快捷键</div>
        <div className="settings-about-item">支持自定义标签切换与底部快捷位触发键。</div>

        <label className="settings-range-label">
          <span>终端标签切换</span>
          <select
            className="settings-select"
            value={settings.shortcutNextTerminalTab}
            onChange={(event) => {
              onChange({
                ...settings,
                shortcutNextTerminalTab: event.target.value as AppSettings['shortcutNextTerminalTab'],
              })
            }}
          >
            <option value="ctrl+tab">Ctrl+Tab</option>
            <option value="ctrl+shift+tab">Ctrl+Shift+Tab</option>
          </select>
        </label>

        <label className="settings-range-label">
          <span>底部快捷位起始键</span>
          <select
            className="settings-select"
            value={settings.dockShortcutStart}
            onChange={(event) => {
              onChange({
                ...settings,
                dockShortcutStart: event.target.value as AppSettings['dockShortcutStart'],
              })
            }}
          >
            <option value="f1">F1</option>
            <option value="f2">F2</option>
            <option value="f3">F3</option>
            <option value="f4">F4</option>
          </select>
        </label>
        <div className="settings-about-item">
          当前规则：从 {settings.dockShortcutStart.toUpperCase()} 开始依次触发底部快捷位（例如 F1/F2/F3...）。
        </div>
      </div>
      )}

      {settingsTab === 'exchange' && (
      <div className="settings-section settings-appearance">
        <div className="settings-about-title">数据交换中心</div>
        <div className="settings-about-item">统一管理导入/导出，默认规则为“追加去重”。</div>
        <div className="settings-appearance-actions">
          <button className="settings-translation-save" onClick={onExportAllData}>
            一键导出全部模块
          </button>
          <button className="settings-translation-save" onClick={onImportAllData}>
            一键导入全部模块
          </button>
        </div>

        <div className="settings-preview">
          <div className="settings-preview-title">词库</div>
          <div className="settings-appearance-actions">
            <button className="settings-translation-save" onClick={onExportGlossary}>导出词库</button>
            <button className="settings-translation-save" onClick={onImportGlossary}>导入词库</button>
          </div>
        </div>

        <div className="settings-preview">
          <div className="settings-preview-title">会话管理</div>
          <div className="settings-appearance-actions">
            <button className="settings-translation-save" onClick={onExportSessions}>导出会话</button>
            <button className="settings-translation-save" onClick={onImportSessions}>导入会话</button>
          </div>
        </div>

        <div className="settings-preview">
          <div className="settings-preview-title">自动化</div>
          <div className="settings-appearance-actions">
            <button className="settings-translation-save" onClick={onExportAutomation}>导出自动化</button>
            <button className="settings-translation-save" onClick={onImportAutomation}>导入自动化</button>
          </div>
        </div>

        <div className="settings-preview">
          <div className="settings-preview-title">命令检索</div>
          <div className="settings-appearance-actions">
            <button className="settings-translation-save" onClick={onExportCommandCatalog}>导出命令检索</button>
            <button className="settings-translation-save" onClick={onImportCommandCatalog}>导入命令检索</button>
          </div>
        </div>

        <div className="settings-preview">
          <div className="settings-preview-title">配置解读</div>
          <div className="settings-appearance-actions">
            <button className="settings-translation-save" onClick={onExportCommandExplain}>导出配置解读</button>
            <button className="settings-translation-save" onClick={onImportCommandExplain}>导入配置解读</button>
          </div>
        </div>
      </div>
      )}

      {settingsTab === 'translation' && (
      <div className="settings-translation">
        <div className="settings-about-title">翻译设置</div>
        <div className="settings-about-item">在线翻译优先级与 API 参数。保存后会写入 translation config 并立即生效。</div>

        {draftTranslationConfig ? (
          <>
            <div className="settings-translation-block">
              <div className="settings-translation-block-title">1) 提供方优先级</div>
              <div className="settings-about-item">主提供方失败后会按 Fallback 1 然后 Fallback 2 依次尝试。</div>
            </div>
            <div className="settings-translation-grid">
              <label className="settings-range-label">
                <span>主提供方</span>
                <select
                  className="settings-select"
                  value={primaryProvider}
                  onChange={(event) => {
                    const nextPrimary = event.target.value as TranslationProviderOption
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      defaultProvider: nextPrimary,
                      fallbackProviders: normalizeFallbacks(nextPrimary, fallbackFirst, fallbackSecond),
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                >
                  {(Object.keys(PROVIDER_LABELS) as TranslationProviderOption[]).map((provider) => (
                    <option key={provider} value={provider}>
                      {PROVIDER_LABELS[provider]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="settings-range-label">
                <span>Fallback 1</span>
                <select
                  className="settings-select"
                  value={fallbackFirst}
                  onChange={(event) => {
                    const nextFallback = event.target.value as TranslationProviderOption | ''
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      fallbackProviders: normalizeFallbacks(primaryProvider, nextFallback, fallbackSecond),
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                >
                  <option value="">none</option>
                  {(Object.keys(PROVIDER_LABELS) as TranslationProviderOption[]).map((provider) => (
                    <option key={provider} value={provider}>
                      {PROVIDER_LABELS[provider]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="settings-range-label">
                <span>Fallback 2</span>
                <select
                  className="settings-select"
                  value={fallbackSecond}
                  onChange={(event) => {
                    const nextFallback = event.target.value as TranslationProviderOption | ''
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      fallbackProviders: normalizeFallbacks(primaryProvider, fallbackFirst, nextFallback),
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                >
                  <option value="">none</option>
                  {(Object.keys(PROVIDER_LABELS) as TranslationProviderOption[]).map((provider) => (
                    <option key={provider} value={provider}>
                      {PROVIDER_LABELS[provider]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="settings-translation-block">
              <div className="settings-translation-block-title">2) OpenAI Compatible API</div>
              <div className="settings-about-item">可直接填写 API Key，或仅填写 API Key 环境变量名。</div>
            </div>
            <div className="settings-translation-grid">
              <label className="settings-range-label">
                <span>OpenAI Base URL</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.openaiCompatible.baseUrl}
                  onChange={(event) => {
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        openaiCompatible: {
                          ...draftTranslationConfig.providers.openaiCompatible,
                          baseUrl: event.target.value,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>OpenAI Model</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.openaiCompatible.model}
                  onChange={(event) => {
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        openaiCompatible: {
                          ...draftTranslationConfig.providers.openaiCompatible,
                          model: event.target.value,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>OpenAI API Key Env</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.openaiCompatible.apiKeyEnv}
                  onChange={(event) => {
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        openaiCompatible: {
                          ...draftTranslationConfig.providers.openaiCompatible,
                          apiKeyEnv: event.target.value,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>OpenAI API Key（可选直填）</span>
                <input
                  className="settings-select"
                  type="password"
                  value={draftTranslationConfig.providers.openaiCompatible.apiKey ?? ''}
                  placeholder="sk-... (留空则走环境变量)"
                  onChange={(event) => {
                    const raw = event.target.value.trim()
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        openaiCompatible: {
                          ...draftTranslationConfig.providers.openaiCompatible,
                          apiKey: raw.length > 0 ? raw : undefined,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
            </div>

            <div className="settings-translation-block">
              <div className="settings-translation-block-title">3) Tencent TMT API</div>
              <div className="settings-about-item">支持直填密钥，也支持通过环境变量读取。</div>
            </div>
            <div className="settings-translation-grid">
              <label className="settings-range-label">
                <span>Tencent Region</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.tencentTmt.region}
                  onChange={(event) => {
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        tencentTmt: {
                          ...draftTranslationConfig.providers.tencentTmt,
                          region: event.target.value,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>Tencent Source</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.tencentTmt.source}
                  onChange={(event) => {
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        tencentTmt: {
                          ...draftTranslationConfig.providers.tencentTmt,
                          source: event.target.value,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>Tencent Target</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.tencentTmt.target}
                  onChange={(event) => {
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        tencentTmt: {
                          ...draftTranslationConfig.providers.tencentTmt,
                          target: event.target.value,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>Tencent Project ID</span>
                <input
                  className="settings-select"
                  type="number"
                  value={String(draftTranslationConfig.providers.tencentTmt.projectId)}
                  onChange={(event) => {
                    const projectId = Number.parseInt(event.target.value || '0', 10)
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        tencentTmt: {
                          ...draftTranslationConfig.providers.tencentTmt,
                          projectId: Number.isFinite(projectId) ? projectId : 0,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>Tencent Secret ID Env</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.tencentTmt.secretIdEnv}
                  onChange={(event) => {
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        tencentTmt: {
                          ...draftTranslationConfig.providers.tencentTmt,
                          secretIdEnv: event.target.value,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>Tencent Secret Key Env</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.tencentTmt.secretKeyEnv}
                  onChange={(event) => {
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        tencentTmt: {
                          ...draftTranslationConfig.providers.tencentTmt,
                          secretKeyEnv: event.target.value,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>Tencent Secret ID（可选直填）</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.tencentTmt.secretId ?? ''}
                  onChange={(event) => {
                    const raw = event.target.value.trim()
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        tencentTmt: {
                          ...draftTranslationConfig.providers.tencentTmt,
                          secretId: raw.length > 0 ? raw : undefined,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>Tencent Secret Key（可选直填）</span>
                <input
                  className="settings-select"
                  type="password"
                  value={draftTranslationConfig.providers.tencentTmt.secretKey ?? ''}
                  onChange={(event) => {
                    const raw = event.target.value.trim()
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        tencentTmt: {
                          ...draftTranslationConfig.providers.tencentTmt,
                          secretKey: raw.length > 0 ? raw : undefined,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
            </div>
            <div className="settings-translation-actions">
              <button
                className="settings-translation-save"
                onClick={() => {
                  if (!draftTranslationConfig) {
                    return
                  }
                  void onSaveTranslationConfig(draftTranslationConfig)
                }}
              >
                保存翻译设置
              </button>
            </div>
            <div className="settings-translation-status">{translationStatus || ' '}</div>
          </>
        ) : (
          <div className="settings-translation-status">翻译配置加载中...</div>
        )}
      </div>
      )}

      {settingsTab === 'about' && (
      <div className="settings-about">
        <div className="settings-about-title">关于项目</div>
        <div className="settings-about-item"><b>TMT-Terminal-mirror-translation</b> 是面向运维与网络工程场景的桌面双窗终端系统：左侧保留原生交互，右侧提供结构一致的镜像翻译与解释能力。</div>
        <div className="settings-about-item">核心原则：严格遵循终端 cell 网格，不使用像素猜测。所有翻译替换都基于行列坐标，确保表格、缩进、对齐和换行行为可预测。</div>
        <div className="settings-about-item">翻译机制：优先命中本地词库与本地策略，再按在线提供方优先级回退。不可安全内联的翻译内容使用 marker 标记，点击查看完整说明。</div>
        <div className="settings-about-item">上下文能力：系统可结合会话上下文（Linux/Docker/Cisco/Huawei 等）与设备提示符状态，驱动翻译、配置解读、语法高亮和命令推荐。</div>
        <div className="settings-about-item">会话能力：支持多标签并行连接、会话分组、标签分组一键连接、本地端口包批量生成、会话日志导出，适合实验室与生产巡检并行作业。</div>
        <div className="settings-about-item">自动化能力：支持脚本模板、参数替换、广播执行、等待提示符、导出终端内容等应用动作，用于批量巡检、配置抓取和标准化变更流程。</div>
        <div className="settings-about-item">知识管理：内置词库、命令检索、配置解读三类本地知识库，支持管理、批量删除、数据交换（导入/导出）和系统推荐合集快速落地。</div>
        <div className="settings-about-item">数据交换：可在模块内或设置中心导入导出，会话/自动化/命令检索/配置解读/词库均可迁移；并支持一键打包导入导出全部模块。</div>
        <div className="settings-about-item">工程架构：Electron 主进程负责 PTY 与本地连接，Renderer 负责 xterm 显示与 Mirror 网格渲染；模块化设计便于后续扩展 Telnet/串口/更多翻译引擎。</div>
        <div className="settings-about-item">定位：帮助团队在跨语言终端协作中减少误解、提升排障效率，并沉淀可复用的命令与解释体系。</div>
      </div>
      )}
    </aside>
  )
}
