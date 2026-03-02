import { useMemo, useState, type DragEvent } from 'react'
import {
  createAutomationScriptId,
  type AutomationConfig,
  type AutomationGroup,
  type AutomationRisk,
  type AutomationScript,
} from './catalog'

const DRAG_MIME = 'application/x-termbridge-command'

const setCompactDragPreview = (event: DragEvent<HTMLElement>, label: string): void => {
  const ghost = document.createElement('div')
  ghost.textContent = label
  ghost.style.position = 'fixed'
  ghost.style.top = '-1000px'
  ghost.style.left = '-1000px'
  ghost.style.padding = '4px 8px'
  ghost.style.border = '1px solid #60a5fa'
  ghost.style.borderRadius = '8px'
  ghost.style.background = 'rgba(15, 23, 42, 0.92)'
  ghost.style.color = '#e2e8f0'
  ghost.style.fontSize = '11px'
  ghost.style.maxWidth = '220px'
  ghost.style.whiteSpace = 'nowrap'
  ghost.style.overflow = 'hidden'
  ghost.style.textOverflow = 'ellipsis'
  ghost.style.opacity = '0.82'
  document.body.appendChild(ghost)
  event.dataTransfer.setDragImage(ghost, 12, 10)
  window.setTimeout(() => {
    document.body.removeChild(ghost)
  }, 0)
}

type AutomationPanelProps = {
  isOpen: boolean
  config: AutomationConfig
  onClose: () => void
  onRunScript: (script: AutomationScript) => void
  onSaveScript: (script: Omit<AutomationScript, 'updatedAt'>) => void
  onDeleteScript: (script: AutomationScript) => void
  onAddGroup: (label: string) => void
  onDeleteGroup: (group: AutomationGroup) => void
  onReorderGroups: (sourceGroupId: string, targetGroupId: string) => void
  onReorderScripts: (sourceScriptId: string, targetScriptId: string) => void
}

type RuntimeScriptState = {
  draft: string
  params: Record<string, string>
}

const riskLabel = (risk: AutomationRisk): string => {
  if (risk === 'destructive') {
    return '危险'
  }

  if (risk === 'caution') {
    return '谨慎'
  }

  return '安全'
}

const extractTemplateParams = (value: string): string[] => {
  const names = new Set<string>()
  const reg1 = /\$\{([A-Za-z_][\w-]*)\}/g
  const reg2 = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g

  let match: RegExpExecArray | null = reg1.exec(value)
  while (match) {
    names.add(match[1])
    match = reg1.exec(value)
  }

  match = reg2.exec(value)
  while (match) {
    names.add(match[1])
    match = reg2.exec(value)
  }

  return Array.from(names)
}

const applyTemplateParams = (template: string, params: Record<string, string>): string => {
  const replaceValue = (_full: string, key: string): string => {
    const value = params[key]
    return typeof value === 'string' ? value : ''
  }

  return template
    .replace(/\$\{([A-Za-z_][\w-]*)\}/g, replaceValue)
    .replace(/\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g, replaceValue)
}

const resolveRuntimeScript = (script: AutomationScript, runtime: RuntimeScriptState | undefined): string => {
  if (!runtime) {
    return script.content
  }

  const source = runtime.draft.length > 0 ? runtime.draft : script.content
  return applyTemplateParams(source, runtime.params)
}

export const AutomationPanel = ({
  isOpen,
  config,
  onClose,
  onRunScript,
  onSaveScript,
  onDeleteScript,
  onAddGroup,
  onDeleteGroup,
  onReorderGroups,
  onReorderScripts,
}: AutomationPanelProps) => {
  const [searchText, setSearchText] = useState('')
  const [groupIdFilter, setGroupIdFilter] = useState('all')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [newGroupLabel, setNewGroupLabel] = useState('')
  const [groupId, setGroupId] = useState<string>(config.groups[0]?.id ?? 'shell-native')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [risk, setRisk] = useState<AutomationRisk>('safe')
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null)
  const [draggingScriptId, setDraggingScriptId] = useState<string | null>(null)
  const [runtimeById, setRuntimeById] = useState<Record<string, RuntimeScriptState>>({})
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({})

  const filteredScripts = useMemo(() => {
    const keyword = searchText.trim().toLocaleLowerCase()

    return config.scripts
      .filter((script) => {
        if (groupIdFilter !== 'all' && script.groupId !== groupIdFilter) {
          return false
        }

        if (keyword.length === 0) {
          return true
        }

        const haystacks = [script.name, script.description, script.content, ...script.tags]
        return haystacks.some((item) => item.toLocaleLowerCase().includes(keyword))
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }, [config.scripts, groupIdFilter, searchText])

  if (!isOpen) {
    return null
  }

  const clearEditor = (): void => {
    setEditingId('')
    setName('')
    setDescription('')
    setContent('')
    setTagsText('')
    setRisk('safe')
  }

  return (
    <aside className="command-search-panel automation-search-panel" role="dialog" aria-label="Automation scripts">
      <div className="command-search-header">
        <div>
          <div className="command-search-title">自动化脚本</div>
          <div className="command-search-subtitle">脚本检索、分组归档、一键发送</div>
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
          placeholder="搜索脚本名称 / 内容 / 标签，例如：deploy / backup / docker"
        />
        <div className="command-search-categories">
          <button
            className={`command-search-category${groupIdFilter === 'all' ? ' command-search-category-active' : ''}`}
            onClick={() => setGroupIdFilter('all')}
          >
            全部
          </button>
          {config.groups.map((group) => (
            <div
              key={group.id}
              className="command-search-category-group"
              onDragOver={(event) => {
                event.preventDefault()
              }}
              onDrop={() => {
                if (draggingGroupId && draggingGroupId !== group.id) {
                  onReorderGroups(draggingGroupId, group.id)
                }
                setDraggingGroupId(null)
              }}
              onDragEnd={() => setDraggingGroupId(null)}
            >
              <button
                className={`command-search-category${groupIdFilter === group.id ? ' command-search-category-active' : ''}`}
                onClick={() => setGroupIdFilter(group.id)}
                draggable
                onDragStart={() => setDraggingGroupId(group.id)}
                onDragEnd={() => setDraggingGroupId(null)}
                title={`${group.label}（可拖拽排序）`}
              >
                {group.label}
              </button>
              {group.id === 'shell-native' && (
                <button
                  className={`command-search-manage-toggle${editorOpen ? ' command-search-manage-toggle-active' : ''}`}
                  onClick={() => setEditorOpen((previous) => !previous)}
                  draggable
                  onDragStart={() => setDraggingGroupId(group.id)}
                  onDragEnd={() => setDraggingGroupId(null)}
                  title="创建分组与脚本"
                >
                  {editorOpen ? '收起管理' : '管理+'}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="command-search-summary">命中 {filteredScripts.length} 条</div>
      </div>

      {editorOpen && (
        <div className="command-editor-panel">
          <div className="command-editor-title">新增分组</div>
          <div className="command-editor-row">
            <input
              className="command-editor-input"
              value={newGroupLabel}
              onChange={(event) => setNewGroupLabel(event.target.value)}
              placeholder="例如：数据库维护 / CI 发布"
            />
            <button
              className="command-editor-button"
              onClick={() => {
                const label = newGroupLabel.trim()
                if (label.length === 0) {
                  return
                }
                onAddGroup(label)
                setNewGroupLabel('')
              }}
            >
              创建分组
            </button>
          </div>

          <div className="command-editor-title">{editingId ? '修改脚本' : '新增脚本'}</div>
          <div className="command-editor-grid">
            <input
              className="command-editor-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="脚本名称"
            />
            <select className="command-editor-select" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
              {config.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}
                </option>
              ))}
            </select>
            <input
              className="command-editor-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="脚本说明"
            />
            <select className="command-editor-select" value={risk} onChange={(event) => setRisk(event.target.value as AutomationRisk)}>
              <option value="safe">safe</option>
              <option value="caution">caution</option>
              <option value="destructive">destructive</option>
            </select>
            <input
              className="command-editor-input"
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder="标签（逗号分隔）"
            />
            <div />
          </div>
          <textarea
            className="command-field-textarea"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="脚本正文（支持模板：docker logs -f ${container}）"
          />
          <div className="command-editor-actions">
            <button
              className="command-editor-button command-editor-button-primary"
              onClick={() => {
                const nextName = name.trim()
                const nextContent = content.trim()
                if (nextName.length === 0 || nextContent.length === 0) {
                  return
                }

                onSaveScript({
                  id: editingId || createAutomationScriptId(),
                  groupId,
                  name: nextName,
                  description: description.trim(),
                  content,
                  tags: tagsText
                    .split(',')
                    .map((item) => item.trim())
                    .filter((item) => item.length > 0),
                  risk,
                })
                clearEditor()
              }}
            >
              {editingId ? '更新脚本' : '添加脚本'}
            </button>
            <button className="command-editor-button" onClick={clearEditor}>
              清空
            </button>
          </div>
        </div>
      )}

      <div className="command-search-list" role="list">
        {filteredScripts.length === 0 && <div className="command-search-empty">没有找到匹配脚本</div>}
        {filteredScripts.map((script) => {
          const group = config.groups.find((item) => item.id === script.groupId)
          const runtime = runtimeById[script.id]
          const templateParams = extractTemplateParams(runtime?.draft ?? script.content)
          const resolvedContent = resolveRuntimeScript(script, runtime)
          const expanded = expandedById[script.id] === true

          return (
            <article
              key={script.id}
              className="command-search-card"
              role="listitem"
              draggable
              onDragStart={(event) => {
                setDraggingScriptId(script.id)
                event.dataTransfer.effectAllowed = 'copyMove'
                event.dataTransfer.setData(
                  DRAG_MIME,
                  JSON.stringify({
                    label: script.name,
                    command: resolvedContent,
                    risk: script.risk,
                  }),
                )
                setCompactDragPreview(event, script.name)
              }}
              onDragOver={(event) => {
                event.preventDefault()
              }}
              onDrop={() => {
                if (draggingScriptId && draggingScriptId !== script.id) {
                  onReorderScripts(draggingScriptId, script.id)
                }
                setDraggingScriptId(null)
              }}
              onDragEnd={() => setDraggingScriptId(null)}
              title="拖拽可调整条目顺序"
            >
              <div className="command-search-card-head">
                <div className="command-search-card-title">{script.name}</div>
                <div className={`command-search-risk command-search-risk-${script.risk}`}>{riskLabel(script.risk)}</div>
              </div>
              <pre className="command-search-command">{script.content}</pre>
              <div className="command-search-actions">
                <button
                  className="command-search-action command-search-action-primary"
                  onClick={() => onRunScript({ ...script, content: resolvedContent })}
                >
                  一键发送
                </button>
                <button
                  className="command-search-action"
                  onClick={() => {
                    setExpandedById((previous) => ({
                      ...previous,
                      [script.id]: !expanded,
                    }))
                  }}
                >
                  {expanded ? '收起详情' : '展开详情'}
                </button>
                <button
                  className="command-search-action"
                  onClick={() => {
                    setEditorOpen(true)
                    setEditingId(script.id)
                    setGroupId(script.groupId)
                    setName(script.name)
                    setDescription(script.description)
                    setContent(script.content)
                    setTagsText(script.tags.join(', '))
                    setRisk(script.risk)
                  }}
                >
                  修改
                </button>
                <button className="command-search-action command-search-action-danger" onClick={() => onDeleteScript(script)}>
                  删除
                </button>
              </div>
              {expanded && (
                <div className="command-search-details">
                  <div className="command-search-group-line">
                    分组：{group?.label ?? script.groupId}
                    {group && !group.system && (
                      <button className="command-search-inline-delete" onClick={() => onDeleteGroup(group)}>
                        删除分组
                      </button>
                    )}
                  </div>
                  <div className="command-search-summary-text">{script.description || '无说明'}</div>
                  <div className="command-runtime-editor">
                    <div className="command-runtime-title">执行参数（仅本次，不改脚本库）</div>
                    <textarea
                      className="command-runtime-textarea"
                      value={runtime?.draft ?? script.content}
                      onChange={(event) => {
                        const nextDraft = event.target.value
                        setRuntimeById((previous) => ({
                          ...previous,
                          [script.id]: {
                            draft: nextDraft,
                            params: previous[script.id]?.params ?? {},
                          },
                        }))
                      }}
                    />
                    {templateParams.length > 0 && (
                      <div className="command-runtime-params">
                        {templateParams.map((name) => (
                          <label key={name} className="command-runtime-param">
                            <span>{name}</span>
                            <input
                              className="command-runtime-input"
                              value={runtime?.params?.[name] ?? ''}
                              onChange={(event) => {
                                const nextValue = event.target.value
                                setRuntimeById((previous) => ({
                                  ...previous,
                                  [script.id]: {
                                    draft: previous[script.id]?.draft ?? script.content,
                                    params: {
                                      ...(previous[script.id]?.params ?? {}),
                                      [name]: nextValue,
                                    },
                                  },
                                }))
                              }}
                              placeholder={`填写 ${name}`}
                            />
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="command-runtime-preview">预览：{resolvedContent}</div>
                    <div className="command-runtime-actions">
                      <button
                        className="command-search-action"
                        onClick={() => {
                          setRuntimeById((previous) => {
                            const next = { ...previous }
                            delete next[script.id]
                            return next
                          })
                        }}
                      >
                        恢复原脚本
                      </button>
                    </div>
                  </div>
                  <div className="command-search-tags">
                    {script.tags.map((tag) => (
                      <span key={tag} className="command-search-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="automation-script-updated">更新：{new Date(script.updatedAt).toLocaleString()}</div>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </aside>
  )
}
