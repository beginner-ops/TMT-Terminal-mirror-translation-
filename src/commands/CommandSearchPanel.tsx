import { useMemo, useState, type DragEvent } from 'react'
import {
  type CommandCatalogConfig,
  type CommandCatalogEntry,
  type CommandCatalogGroup,
  type CommandCatalogRisk,
} from './catalog'

type CommandSearchPanelProps = {
  isOpen: boolean
  config: CommandCatalogConfig
  onClose: () => void
  onRunCommand: (command: string, risk: CommandCatalogEntry['risk']) => void
  onCopyCommand: (command: string) => void
  onAddGroup: (label: string) => void
  onDeleteGroup: (group: CommandCatalogGroup) => void
  onReorderGroups: (sourceGroupId: string, targetGroupId: string) => void
  onAddEntry: (input: {
    groupId: string
    title: string
    command: string
    summary: string
    usage: string
    example: string
    tags: string[]
    risk: CommandCatalogRisk
  }) => void
  onDeleteEntry: (entry: CommandCatalogEntry) => void
  onReorderEntries: (sourceEntryId: string, targetEntryId: string) => void
  onResetSystemEntries: () => void
  onBulkDeleteGroups: (groupIds: string[]) => void
  onBulkDeleteEntries: (entryIds: string[]) => void
  onExportData: () => void
  onImportData: () => void
}

type ManageView = 'groups' | 'entries' | 'create'

type RuntimeCommandState = {
  draft: string
  params: Record<string, string>
}

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

const riskLabel = (risk: CommandCatalogEntry['risk']): string => {
  if (risk === 'destructive') {
    return '危险'
  }

  if (risk === 'caution') {
    return '谨慎'
  }

  return '安全'
}

const formatCommandForDisplay = (command: string): string => {
  if (!command.startsWith('raw:')) {
    return command
  }
  const payload = command.slice(4)
  if (payload === ' ') {
    return '发送按键: 空格'
  }
  if (payload === 'q') {
    return '发送按键: q'
  }
  if (payload.length === 0) {
    return '发送按键: (空)'
  }
  return `发送原始输入: ${payload}`
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

const resolveRuntimeCommand = (entry: CommandCatalogEntry, runtime: RuntimeCommandState | undefined): string => {
  if (!runtime) {
    return entry.command
  }

  const source = runtime.draft.length > 0 ? runtime.draft : entry.command
  return applyTemplateParams(source, runtime.params)
}

export const CommandSearchPanel = ({
  isOpen,
  config,
  onClose,
  onRunCommand,
  onCopyCommand,
  onAddGroup,
  onDeleteGroup,
  onReorderGroups,
  onAddEntry,
  onDeleteEntry,
  onReorderEntries,
  onResetSystemEntries,
  onBulkDeleteGroups,
  onBulkDeleteEntries,
  onExportData,
  onImportData,
}: CommandSearchPanelProps) => {
  const [searchText, setSearchText] = useState('')
  const [groupIdFilter, setGroupIdFilter] = useState<string>('all')
  const [editorOpen, setEditorOpen] = useState(false)
  const [manageView, setManageView] = useState<ManageView>('create')
  const [newGroupLabel, setNewGroupLabel] = useState('')
  const [title, setTitle] = useState('')
  const [command, setCommand] = useState('')
  const [summary, setSummary] = useState('')
  const [usage, setUsage] = useState('')
  const [example, setExample] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [risk, setRisk] = useState<CommandCatalogRisk>('safe')
  const [groupId, setGroupId] = useState<string>(config.groups[0]?.id ?? 'shell')
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null)
  const [draggingEntryId, setDraggingEntryId] = useState<string | null>(null)
  const [runtimeById, setRuntimeById] = useState<Record<string, RuntimeCommandState>>({})
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({})
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([])

  const filtered = useMemo(() => {
    const keyword = searchText.trim().toLocaleLowerCase()

    return config.entries.filter((entry) => {
      if (groupIdFilter !== 'all' && entry.groupId !== groupIdFilter) {
        return false
      }

      if (keyword.length === 0) {
        return true
      }

      const haystacks = [entry.title, entry.command, entry.summary, entry.usage, entry.example, ...entry.tags]

      return haystacks.some((item) => item.toLocaleLowerCase().includes(keyword))
    })
  }, [config.entries, groupIdFilter, searchText])

  if (!isOpen) {
    return null
  }

  const toggleGroupSelection = (groupId: string): void => {
    setSelectedGroupIds((previous) =>
      previous.includes(groupId) ? previous.filter((id) => id !== groupId) : [...previous, groupId],
    )
  }

  const toggleEntrySelection = (entryId: string): void => {
    setSelectedEntryIds((previous) =>
      previous.includes(entryId) ? previous.filter((id) => id !== entryId) : [...previous, entryId],
    )
  }

  return (
    <aside className="command-search-panel" role="dialog" aria-label="Command search">
      <div className="command-search-header">
        <div>
          <div className="command-search-title">命令检索</div>
          <div className="command-search-subtitle">支持自定义命令与自定义分组</div>
        </div>
        <div className="session-panel-header-actions">
          <button
            className={`command-search-close${editorOpen ? ' toolbar-button-active' : ''}`}
            onClick={() => setEditorOpen((prev) => !prev)}
          >
            {editorOpen ? '退出管理' : '管理+'}
          </button>
          <button className="command-search-close" onClick={onResetSystemEntries}>
            重置系统项
          </button>
          <button className="command-search-close" onClick={onClose}>
            收起
          </button>
        </div>
      </div>

      {!editorOpen && (
      <div className="command-search-toolbar">
        <input
          className="command-search-input-lg"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="搜索命令、参数、中文解释，例如：docker logs / 回滚 / --help"
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
            </div>
          ))}
        </div>
        <div className="command-search-summary">命中 {filtered.length} 条</div>
      </div>
      )}

      {editorOpen && (
        <div className="command-editor-panel">
          <div className="session-editor-row">
            <button className="session-action session-action-primary" onClick={onExportData}>
              数据交换：导出
            </button>
            <button className="session-action" onClick={onImportData}>
              数据交换：导入
            </button>
          </div>
          <div className="session-editor-row session-manage-tabs">
            <button
              className={`session-action${manageView === 'create' ? ' session-action-primary' : ''}`}
              onClick={() => setManageView('create')}
            >
              新增
            </button>
            <button
              className={`session-action${manageView === 'groups' ? ' session-action-primary' : ''}`}
              onClick={() => setManageView('groups')}
            >
              批量删类目
            </button>
            <button
              className={`session-action${manageView === 'entries' ? ' session-action-primary' : ''}`}
              onClick={() => setManageView('entries')}
            >
              批量删条目
            </button>
          </div>
          {manageView === 'create' && (
          <>
          <div className="command-editor-title">新增分组</div>
          <div className="command-editor-row">
            <input
              className="command-editor-input"
              value={newGroupLabel}
              onChange={(event) => setNewGroupLabel(event.target.value)}
              placeholder="例如：K8s / Node / 数据库"
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

          <div className="command-editor-title">新增命令</div>
          <div className="command-editor-grid">
            <input
              className="command-editor-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="标题（例如：查看 Pod 日志）"
            />
            <select
              className="command-editor-select"
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
            >
              {config.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}
                </option>
              ))}
            </select>
            <input
              className="command-editor-input"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="命令（支持模板：docker logs -f ${container}）"
            />
            <select
              className="command-editor-select"
              value={risk}
              onChange={(event) => setRisk(event.target.value as CommandCatalogRisk)}
            >
              <option value="safe">safe</option>
              <option value="caution">caution</option>
              <option value="destructive">destructive</option>
            </select>
            <input
              className="command-editor-input"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="简要说明"
            />
            <input
              className="command-editor-input"
              value={usage}
              onChange={(event) => setUsage(event.target.value)}
              placeholder="用法"
            />
            <input
              className="command-editor-input"
              value={example}
              onChange={(event) => setExample(event.target.value)}
              placeholder="示例"
            />
            <input
              className="command-editor-input"
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder="标签（逗号分隔）"
            />
          </div>
          <div className="command-editor-actions">
            <button
              className="command-editor-button command-editor-button-primary"
              onClick={() => {
                const nextTitle = title.trim()
                const nextCommand = command.trim()
                if (nextTitle.length === 0 || nextCommand.length === 0) {
                  return
                }

                onAddEntry({
                  groupId,
                  title: nextTitle,
                  command: nextCommand,
                  summary: summary.trim(),
                  usage: usage.trim(),
                  example: example.trim(),
                  tags: tagsText
                    .split(',')
                    .map((item) => item.trim())
                    .filter((item) => item.length > 0),
                  risk,
                })

                setTitle('')
                setCommand('')
                setSummary('')
                setUsage('')
                setExample('')
                setTagsText('')
                setRisk('safe')
              }}
            >
              添加命令
            </button>
          </div>
          </>
          )}
          {manageView === 'groups' && (
            <>
              <div className="command-editor-title">批量删除类目</div>
              <div className="command-modal-list-scroll">
                {config.groups.filter((group) => !group.system).map((group) => (
                  <label key={group.id} className="command-runtime-param">
                    <span>
                      <input
                        type="checkbox"
                        checked={selectedGroupIds.includes(group.id)}
                        onChange={() => toggleGroupSelection(group.id)}
                      />
                      {' '}
                      {group.label} ({group.id})
                    </span>
                  </label>
                ))}
              </div>
              <div className="command-editor-actions">
                <button
                  className="command-editor-button command-search-action-danger"
                  onClick={() => {
                    if (selectedGroupIds.length === 0) {
                      return
                    }
                    const confirmed = window.confirm(`确定批量删除 ${selectedGroupIds.length} 个类目？其下条目会一起删除。`)
                    if (!confirmed) {
                      return
                    }
                    onBulkDeleteGroups(selectedGroupIds)
                    setSelectedGroupIds([])
                  }}
                >
                  批量删除类目
                </button>
              </div>
            </>
          )}
          {manageView === 'entries' && (
            <>
              <div className="command-editor-title">批量删除条目</div>
              <div className="command-modal-list-scroll">
                {config.entries.map((entry) => (
                  <label key={entry.id} className="command-runtime-param">
                    <span>
                      <input
                        type="checkbox"
                        checked={selectedEntryIds.includes(entry.id)}
                        onChange={() => toggleEntrySelection(entry.id)}
                      />
                      {' '}
                      {entry.title}
                    </span>
                  </label>
                ))}
              </div>
              <div className="command-editor-actions">
                <button
                  className="command-editor-button command-search-action-danger"
                  onClick={() => {
                    if (selectedEntryIds.length === 0) {
                      return
                    }
                    const confirmed = window.confirm(`确定批量删除 ${selectedEntryIds.length} 个条目？`)
                    if (!confirmed) {
                      return
                    }
                    onBulkDeleteEntries(selectedEntryIds)
                    setSelectedEntryIds([])
                  }}
                >
                  批量删除条目
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!editorOpen && (
      <div className="command-search-list" role="list">
        {filtered.length === 0 && <div className="command-search-empty">没有找到匹配命令</div>}
        {filtered.map((entry) => {
          const group = config.groups.find((item) => item.id === entry.groupId)
          const runtime = runtimeById[entry.id]
          const templateParams = extractTemplateParams(runtime?.draft ?? entry.command)
          const resolvedCommand = resolveRuntimeCommand(entry, runtime)
          const expanded = expandedById[entry.id] === true

          return (
            <article
              key={entry.id}
              className="command-search-card"
              role="listitem"
              draggable
              onDragStart={(event) => {
                setDraggingEntryId(entry.id)
                event.dataTransfer.effectAllowed = 'copyMove'
                event.dataTransfer.setData(
                  DRAG_MIME,
                  JSON.stringify({
                    label: entry.title,
                    command: resolvedCommand,
                    risk: entry.risk,
                  }),
                )
                setCompactDragPreview(event, entry.title)
              }}
              onDragOver={(event) => {
                event.preventDefault()
              }}
              onDrop={() => {
                if (draggingEntryId && draggingEntryId !== entry.id) {
                  onReorderEntries(draggingEntryId, entry.id)
                }
                setDraggingEntryId(null)
              }}
              onDragEnd={() => setDraggingEntryId(null)}
              title="拖拽可调整条目顺序"
            >
              <div className="command-search-card-head">
                <div className="command-search-card-title">{entry.title}</div>
                <div className={`command-search-risk command-search-risk-${entry.risk}`}>{riskLabel(entry.risk)}</div>
              </div>
              <pre className="command-search-command">{formatCommandForDisplay(entry.command)}</pre>
              <div className="command-search-actions">
                <button
                  className="command-search-action"
                  onClick={() => {
                    onCopyCommand(resolvedCommand)
                  }}
                >
                  复制命令
                </button>
                <button
                  className="command-search-action command-search-action-primary"
                  onClick={() => {
                    onRunCommand(resolvedCommand, entry.risk)
                  }}
                >
                  发送到终端
                </button>
                <button
                  className="command-search-action"
                  onClick={() => {
                    setExpandedById((previous) => ({
                      ...previous,
                      [entry.id]: !expanded,
                    }))
                  }}
                >
                  {expanded ? '收起详情' : '展开详情'}
                </button>
                <button
                  className="command-search-action command-search-action-danger"
                  onClick={() => {
                    onDeleteEntry(entry)
                  }}
                >
                  删除
                </button>
              </div>
              {expanded && (
                <div className="command-search-details">
                  <div className="command-search-group-line">
                    分组：{group?.label ?? entry.groupId}
                    {group && !group.system && (
                      <button
                        className="command-search-inline-delete"
                        onClick={() => {
                          onDeleteGroup(group)
                        }}
                      >
                        删除分组
                      </button>
                    )}
                  </div>
                  <div className="command-runtime-editor">
                    <div className="command-runtime-title">执行参数（仅本次，不改词库）</div>
                    <textarea
                      className="command-runtime-textarea"
                      value={runtime?.draft ?? entry.command}
                      onChange={(event) => {
                        const nextDraft = event.target.value
                        setRuntimeById((previous) => ({
                          ...previous,
                          [entry.id]: {
                            draft: nextDraft,
                            params: previous[entry.id]?.params ?? {},
                          },
                        }))
                      }}
                    />
                    <div className="command-runtime-preview">显示：{formatCommandForDisplay(runtime?.draft ?? entry.command)}</div>
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
                                  [entry.id]: {
                                    draft: previous[entry.id]?.draft ?? entry.command,
                                    params: {
                                      ...(previous[entry.id]?.params ?? {}),
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
                    <div className="command-runtime-preview">预览：{resolvedCommand}</div>
                    <div className="command-runtime-actions">
                      <button
                        className="command-search-action"
                        onClick={() => {
                          setRuntimeById((previous) => {
                            const next = { ...previous }
                            delete next[entry.id]
                            return next
                          })
                        }}
                      >
                        恢复原命令
                      </button>
                    </div>
                  </div>
                  <div className="command-search-summary-text">{entry.summary}</div>
                  <div className="command-search-usage">用法：{entry.usage || '-'}</div>
                  <div className="command-search-example">示例：{entry.example || '-'}</div>
                  <div className="command-search-tags">
                    {entry.tags.map((tag) => (
                      <span key={tag} className="command-search-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>
      )}
    </aside>
  )
}
