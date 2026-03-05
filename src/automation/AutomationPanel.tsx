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
  onBulkDeleteGroups: (groupIds: string[]) => void
  onBulkDeleteScripts: (scriptIds: string[]) => void
  onExportData: () => void
  onImportData: () => void
}

type ManageView = 'groups' | 'scripts' | 'create' | 'actions'

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

const ACTION_TEMPLATE_HUAWEI_EXPORT = `app.clear_view
term.send display current-configuration
term.wait_prompt 90000
app.export_visible`

const ACTION_TEMPLATE_CISCO_EXPORT = `app.clear_view
term.send show running-config
term.wait_prompt 90000
app.export_visible`

const ACTION_TEMPLATE_BROADCAST_ALL = `term.send_all display version`

const ACTION_TEMPLATE_BROADCAST_SELECTED = `term.send_tabs Tab 1,Tab 2 :: display current-configuration`

const ACTION_TEMPLATE_BROADCAST_MODE = `term.mode broadcast_all
display version
display clock
display ip interface brief
# 无需手动关闭：脚本结束自动恢复当前终端模式`

const ACTION_TEMPLATE_RUN_TAG_GROUP = `session.run_tag_group 核心设备巡检组 :: new`

const ACTION_TEMPLATE_SLEEP = `term.send display version
time.sleep 1200
term.send display clock`

const ACTION_TEMPLATE_EXPORT_AUTO = `app.clear_view
term.send display current-configuration
term.wait_prompt 90000
app.export_visible_to exports/{date}/{sessionSlug}-{tabId}-{ts}`

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
  onBulkDeleteGroups,
  onBulkDeleteScripts,
  onExportData,
  onImportData,
}: AutomationPanelProps) => {
  const [searchText, setSearchText] = useState('')
  const [groupIdFilter, setGroupIdFilter] = useState('all')
  const [editorOpen, setEditorOpen] = useState(false)
  const [manageView, setManageView] = useState<ManageView>('create')
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
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [selectedScriptIds, setSelectedScriptIds] = useState<string[]>([])

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

  const toggleGroupSelection = (groupId: string): void => {
    setSelectedGroupIds((previous) =>
      previous.includes(groupId) ? previous.filter((id) => id !== groupId) : [...previous, groupId],
    )
  }

  const toggleScriptSelection = (scriptId: string): void => {
    setSelectedScriptIds((previous) =>
      previous.includes(scriptId) ? previous.filter((id) => id !== scriptId) : [...previous, scriptId],
    )
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
          <div className="command-search-subtitle">脚本检索、分组归档、一键发送（支持 clear/wait/export 动作）</div>
        </div>
        <div className="session-panel-header-actions">
          <button
            className={`command-search-close${editorOpen ? ' toolbar-button-active' : ''}`}
            onClick={() => setEditorOpen((previous) => !previous)}
          >
            {editorOpen ? '退出管理' : '管理+'}
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
            </div>
          ))}
        </div>
        <div className="command-search-summary">命中 {filteredScripts.length} 条</div>
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
              className={`session-action${manageView === 'scripts' ? ' session-action-primary' : ''}`}
              onClick={() => setManageView('scripts')}
            >
              批量删条目
            </button>
            <button
              className={`session-action${manageView === 'actions' ? ' session-action-primary' : ''}`}
              onClick={() => setManageView('actions')}
            >
              应用动作模板
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
            placeholder={
              '脚本正文（支持模板变量、app.clear_view / term.send / term.send_all / term.send_tabs / term.mode / session.run_tag_group / time.sleep / term.wait_prompt / app.export_visible / app.export_visible_to）'
            }
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
                      {group.label}
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
                    const confirmed = window.confirm(`确定批量删除 ${selectedGroupIds.length} 个类目？其下脚本会一起删除。`)
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
          {manageView === 'scripts' && (
            <>
              <div className="command-editor-title">批量删除条目</div>
              <div className="command-modal-list-scroll">
                {config.scripts.map((script) => (
                  <label key={script.id} className="command-runtime-param">
                    <span>
                      <input
                        type="checkbox"
                        checked={selectedScriptIds.includes(script.id)}
                        onChange={() => toggleScriptSelection(script.id)}
                      />
                      {' '}
                      {script.name}
                    </span>
                  </label>
                ))}
              </div>
              <div className="command-editor-actions">
                <button
                  className="command-editor-button command-search-action-danger"
                  onClick={() => {
                    if (selectedScriptIds.length === 0) {
                      return
                    }
                    const confirmed = window.confirm(`确定批量删除 ${selectedScriptIds.length} 个条目？`)
                    if (!confirmed) {
                      return
                    }
                    onBulkDeleteScripts(selectedScriptIds)
                    setSelectedScriptIds([])
                  }}
                >
                  批量删除条目
                </button>
              </div>
            </>
          )}
          {manageView === 'actions' && (
            <>
              <div className="command-editor-title">应用内动作（自动化可调用）</div>
              <div className="automation-action-guide">
                <div className="automation-action-guide-list">
                  <code>app.clear_view</code>
                  <span>清空当前标签显示（作为导出起点）</span>
                  <code>term.send &lt;命令&gt;</code>
                  <span>发送命令并回车</span>
                  <code>term.send_all &lt;命令&gt;</code>
                  <span>广播命令到全部已打开且在线的终端标签</span>
                  <code>term.send_tabs &lt;目标&gt; :: &lt;命令&gt;</code>
                  <span>仅发到指定终端；目标支持 Tab 标题/ID/序号（逗号分隔），如 Tab 1,Tab 2 或 1,2</span>
                  <code>term.mode broadcast_all</code>
                  <span>开启脚本广播模式：后续普通命令默认广播到全部终端</span>
                  <code>term.mode tabs &lt;目标&gt;</code>
                  <span>开启指定终端模式：后续普通命令默认发送到指定终端集合</span>
                  <code>term.mode current</code>
                  <span>恢复到当前终端模式（可选；脚本结束会自动恢复）</span>
                  <code>session.run_tag_group &lt;标签组名&gt; :: new|current</code>
                  <span>按会话管理“标签分组”批量连接设备；默认 current（第一个当前，其余新标签），写 :: new 则全部新标签</span>
                  <code>time.sleep [毫秒]</code>
                  <span>主动等待一段时间（默认 1000ms），用于设备响应慢或防止命令过快</span>
                  <code>term.wait_prompt [毫秒]</code>
                  <span>等待输出完成（默认 60000）</span>
                  <code>app.export_visible</code>
                  <span>导出清屏后的累计输出</span>
                  <code>app.export_visible_to &lt;路径模板&gt;</code>
                  <span>无弹窗自动落盘导出（相对路径基于项目根目录；会按 current/tabs/broadcast 路由对目标终端逐个导出）</span>
                </div>
                <div className="automation-action-guide-list">
                  <span>路径变量：</span>
                  <code>{'{date}'}</code>
                  <span>日期，如 2026-03-04</span>
                  <code>{'{ts}'}</code>
                  <span>时间戳，如 2026-03-04T16-22-11-123Z</span>
                  <code>{'{sessionSlug}'}</code>
                  <span>会话安全名（推荐用于文件名）</span>
                  <code>{'{tabSlug}'}</code>
                  <span>标签安全名</span>
                  <code>{'{sessionName}'}</code>
                  <span>会话名（原文）</span>
                  <code>{'{tabTitle}'}</code>
                  <span>标签标题（原文）</span>
                  <code>{'{tabId}'}</code>
                  <span>标签 ID</span>
                </div>
                <div className="automation-action-guide-list">
                  <span>路径样式示例：</span>
                  <code>exports/{'{date}'}/{'{sessionSlug}'}-{'{ts}'}</code>
                  <span>落盘到项目目录：`termbridge-v2/exports/...`（自动补 `.txt`，并生成同名 `.jsonl`）</span>
                  <code>exports/{'{date}'}/{'{sessionSlug}'}-{'{tabId}'}-{'{ts}'}</code>
                  <span>批量导出推荐，避免多终端同名覆盖</span>
                  <code>~/Desktop/tb-exports/{'{sessionSlug}'}-{'{ts}'}.txt</code>
                  <span>落盘到桌面目录（支持 `~/`）</span>
                </div>
              </div>
              <div className="command-editor-title">模板：脚本广播模式（推荐）</div>
              <pre className="automation-action-guide-example">{ACTION_TEMPLATE_BROADCAST_MODE}</pre>
              <div className="command-editor-actions">
                <button className="command-editor-button" onClick={() => setContent(ACTION_TEMPLATE_BROADCAST_MODE)}>
                  填入编辑器
                </button>
              </div>
              <div className="command-editor-title">模板：广播到全部终端</div>
              <pre className="automation-action-guide-example">{ACTION_TEMPLATE_BROADCAST_ALL}</pre>
              <div className="command-editor-actions">
                <button className="command-editor-button" onClick={() => setContent(ACTION_TEMPLATE_BROADCAST_ALL)}>
                  填入编辑器
                </button>
              </div>
              <div className="command-editor-title">模板：发送到指定终端</div>
              <pre className="automation-action-guide-example">{ACTION_TEMPLATE_BROADCAST_SELECTED}</pre>
              <div className="command-editor-actions">
                <button className="command-editor-button" onClick={() => setContent(ACTION_TEMPLATE_BROADCAST_SELECTED)}>
                  填入编辑器
                </button>
              </div>
              <div className="command-editor-title">模板：运行标签分组连接</div>
              <pre className="automation-action-guide-example">{ACTION_TEMPLATE_RUN_TAG_GROUP}</pre>
              <div className="command-editor-actions">
                <button className="command-editor-button" onClick={() => setContent(ACTION_TEMPLATE_RUN_TAG_GROUP)}>
                  填入编辑器
                </button>
              </div>
              <div className="command-editor-title">模板：命令间延迟</div>
              <pre className="automation-action-guide-example">{ACTION_TEMPLATE_SLEEP}</pre>
              <div className="command-editor-actions">
                <button className="command-editor-button" onClick={() => setContent(ACTION_TEMPLATE_SLEEP)}>
                  填入编辑器
                </button>
              </div>
              <div className="command-editor-title">模板：华为配置导出</div>
              <pre className="automation-action-guide-example">{ACTION_TEMPLATE_HUAWEI_EXPORT}</pre>
              <div className="command-editor-actions">
                <button className="command-editor-button" onClick={() => setContent(ACTION_TEMPLATE_HUAWEI_EXPORT)}>
                  填入编辑器
                </button>
              </div>
              <div className="command-editor-title">模板：Cisco 配置导出</div>
              <pre className="automation-action-guide-example">{ACTION_TEMPLATE_CISCO_EXPORT}</pre>
              <div className="command-editor-actions">
                <button className="command-editor-button" onClick={() => setContent(ACTION_TEMPLATE_CISCO_EXPORT)}>
                  填入编辑器
                </button>
              </div>
              <div className="command-editor-title">模板：自动落盘导出（无弹窗）</div>
              <pre className="automation-action-guide-example">{ACTION_TEMPLATE_EXPORT_AUTO}</pre>
              <div className="command-editor-actions">
                <button className="command-editor-button" onClick={() => setContent(ACTION_TEMPLATE_EXPORT_AUTO)}>
                  填入编辑器
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!editorOpen && (
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
              <pre className="command-search-command automation-script-command-preview">{script.content}</pre>
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
      )}
    </aside>
  )
}
