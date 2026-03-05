import { useMemo, useState } from 'react'
import type {
  LocalPortPackConfig,
  LocalPortVendorPlan,
  SessionCatalogConfig,
  SessionGroup,
  SessionProtocol,
  SessionEntry,
  SessionTagGroup,
} from './catalog'

type SessionFormState = {
  id?: string
  name: string
  groupId: string
  protocol: SessionProtocol
  host: string
  port: number
  user: string
  identityFile: string
  hostKeyMode: 'ask' | 'loose'
}

type BatchFormState = {
  groupId: string
  protocol: SessionProtocol
  count: number
  namePrefix: string
  nameStart: number
  namePadWidth: number
  incrementName: boolean
  host: string
  incrementIpTail: boolean
  startPort: number
  incrementPort: boolean
  user: string
  identityFile: string
  hostKeyMode: 'ask' | 'loose'
}

type LocalPackFormState = {
  id?: string
  host: string
  startPort: number
  count: number
  protocol: Extract<SessionProtocol, 'telnet' | 'raw' | 'ssh'>
  vendorPlan: LocalPortVendorPlan
}

type TagGroupFormState = {
  id?: string
  label: string
  sessionIds: string[]
}

type SessionManagerPanelProps = {
  isOpen: boolean
  config: SessionCatalogConfig
  onClose: () => void
  onAddGroup: (label: string) => void
  onDeleteGroup: (group: SessionGroup) => void
  onReorderGroups: (sourceGroupId: string, targetGroupId: string) => void
  onUpsertSession: (form: SessionFormState) => void
  onBulkCreateSessions: (forms: SessionFormState[]) => number
  onBulkDeleteGroups: (groupIds: string[]) => void
  onBulkDeleteSessions: (sessionIds: string[]) => void
  onDeleteSession: (session: SessionEntry) => void
  onReorderSessions: (sourceSessionId: string, targetSessionId: string | null, targetGroupId: string) => void
  onConnectCurrentTab: (session: SessionEntry) => void
  onConnectNewTab: (session: SessionEntry) => void
  onUpsertTagGroup: (input: TagGroupFormState) => void
  onDeleteTagGroup: (tagGroupId: string) => void
  onConnectTagGroupCurrent: (tagGroupId: string) => void
  onConnectTagGroupNew: (tagGroupId: string) => void
  onUpsertLocalPortPack: (form: LocalPackFormState) => void
  onDeleteLocalPortPack: (pack: LocalPortPackConfig) => void
  onExportCurrentTabLog: () => void
  onExportData: () => void
  onImportData: () => void
  exportStatus: string
}

type ManageMode =
  | 'groupCreate'
  | 'sessionCreate'
  | 'sessionEdit'
  | 'tagGroup'
  | 'batchCreate'
  | 'localPack'
  | 'bulkDeleteGroups'
  | 'bulkDeleteSessions'

const emptyForm = (groupId: string): SessionFormState => ({
  name: '',
  groupId,
  protocol: 'ssh',
  host: '',
  port: 22,
  user: '',
  identityFile: '',
  hostKeyMode: 'ask',
})

const emptyBatchForm = (groupId: string): BatchFormState => ({
  groupId,
  protocol: 'ssh',
  count: 10,
  namePrefix: 'device-',
  nameStart: 1,
  namePadWidth: 2,
  incrementName: true,
  host: '192.168.1.10',
  incrementIpTail: true,
  startPort: 22,
  incrementPort: false,
  user: 'admin',
  identityFile: '',
  hostKeyMode: 'ask',
})

const emptyPackForm = (): LocalPackFormState => ({
  host: '127.0.0.1',
  startPort: 2000,
  count: 20,
  protocol: 'telnet',
  vendorPlan: {
    cisco: 0,
    huawei: 20,
    h3c: 0,
    ruijie: 0,
  },
})

const emptyTagGroupForm = (): TagGroupFormState => ({
  label: '',
  sessionIds: [],
})

const formatUpdatedAt = (updatedAt: string): string => {
  const parsed = Date.parse(updatedAt)
  if (Number.isNaN(parsed)) {
    return '-'
  }
  return new Date(parsed).toLocaleString()
}

const parseIpv4 = (value: string): number[] | null => {
  const parts = value.trim().split('.')
  if (parts.length !== 4) {
    return null
  }
  const parsed = parts.map((part) => Number(part))
  if (parsed.some((num) => !Number.isInteger(num) || num < 0 || num > 255)) {
    return null
  }
  return parsed
}

const buildBatchHost = (baseHost: string, index: number, incrementIpTail: boolean): string | null => {
  if (!incrementIpTail) {
    return baseHost.trim().length > 0 ? baseHost.trim() : null
  }
  const ipv4 = parseIpv4(baseHost)
  if (!ipv4) {
    return null
  }
  const tail = ipv4[3] + index
  if (tail < 0 || tail > 255) {
    return null
  }
  return `${ipv4[0]}.${ipv4[1]}.${ipv4[2]}.${tail}`
}

const buildBatchName = (
  prefix: string,
  start: number,
  index: number,
  padWidth: number,
  incrementName: boolean,
): string => {
  const safePrefix = prefix.trim()
  if (!incrementName) {
    return safePrefix.length > 0 ? safePrefix : 'session'
  }
  const value = Math.max(0, Math.floor(start + index))
  const width = Math.max(1, Math.min(6, Math.floor(padWidth)))
  return `${safePrefix}${String(value).padStart(width, '0')}`
}

export const SessionManagerPanel = ({
  isOpen,
  config,
  onClose,
  onAddGroup,
  onDeleteGroup,
  onReorderGroups,
  onUpsertSession,
  onBulkCreateSessions,
  onBulkDeleteGroups,
  onBulkDeleteSessions,
  onDeleteSession,
  onReorderSessions,
  onConnectCurrentTab,
  onConnectNewTab,
  onUpsertTagGroup,
  onDeleteTagGroup,
  onConnectTagGroupCurrent,
  onConnectTagGroupNew,
  onUpsertLocalPortPack,
  onDeleteLocalPortPack,
  onExportCurrentTabLog,
  onExportData,
  onImportData,
  exportStatus,
}: SessionManagerPanelProps) => {
  const initialGroupId = config.groups[0]?.id ?? 'linux'
  const [searchText, setSearchText] = useState('')
  const [groupFilter, setGroupFilter] = useState('all')
  const [editorOpen, setEditorOpen] = useState(false)
  const [manageMode, setManageMode] = useState<ManageMode>('sessionCreate')
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null)
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null)
  const [newGroupLabel, setNewGroupLabel] = useState('')
  const [groupDeleteId, setGroupDeleteId] = useState(initialGroupId)
  const [statusText, setStatusText] = useState('')
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({})
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([])
  const [form, setForm] = useState<SessionFormState>(() => emptyForm(initialGroupId))
  const [tagGroupForm, setTagGroupForm] = useState<TagGroupFormState>(() => emptyTagGroupForm())
  const [batchForm, setBatchForm] = useState<BatchFormState>(() => emptyBatchForm(initialGroupId))
  const [packForm, setPackForm] = useState<LocalPackFormState>(() => emptyPackForm())

  const filtered = useMemo(() => {
    const keyword = searchText.trim().toLocaleLowerCase()
    if (groupFilter === 'tag-groups') {
      return []
    }
    return config.sessions.filter((session) => {
      if (groupFilter !== 'all' && session.groupId !== groupFilter) {
        return false
      }
      if (keyword.length === 0) {
        return true
      }
      return [session.name, session.host, session.user ?? '', session.identityFile ?? '', String(session.port)]
        .some((item) => item.toLocaleLowerCase().includes(keyword))
    })
  }, [config.sessions, groupFilter, searchText])

  const groupedFiltered = useMemo(() => {
    return config.groups
      .map((group) => ({
        group,
        sessions: filtered.filter((session) => session.groupId === group.id),
      }))
      .filter((item) => item.sessions.length > 0)
  }, [config.groups, filtered])

  const filteredTagGroups = useMemo(() => {
    const keyword = searchText.trim().toLocaleLowerCase()
    return config.tagGroups.filter((group) => {
      if (keyword.length === 0) {
        return true
      }
      const sessionNames = group.sessionIds
        .map((id) => config.sessions.find((item) => item.id === id)?.name ?? '')
        .filter((name) => name.length > 0)
      return [group.label, ...sessionNames].some((item) => item.toLocaleLowerCase().includes(keyword))
    })
  }, [config.sessions, config.tagGroups, searchText])

  const totalPackVendorCount =
    packForm.vendorPlan.cisco + packForm.vendorPlan.huawei + packForm.vendorPlan.h3c + packForm.vendorPlan.ruijie

  if (!isOpen) {
    return null
  }

  const toggleGroupSelection = (groupId: string): void => {
    setSelectedGroupIds((previous) =>
      previous.includes(groupId) ? previous.filter((id) => id !== groupId) : [...previous, groupId],
    )
  }

  const toggleSessionSelection = (sessionId: string): void => {
    setSelectedSessionIds((previous) =>
      previous.includes(sessionId) ? previous.filter((id) => id !== sessionId) : [...previous, sessionId],
    )
  }

  const openSessionEditor = (session: SessionEntry): void => {
    setEditorOpen(true)
    setManageMode('sessionEdit')
    setForm({
      id: session.id,
      name: session.name,
      groupId: session.groupId,
      protocol: session.protocol,
      host: session.host,
      port: session.port,
      user: session.user ?? '',
      identityFile: session.identityFile ?? '',
      hostKeyMode: session.hostKeyMode ?? 'ask',
    })
    setStatusText(`正在更改参数：${session.name}`)
  }

  const openTagGroupEditor = (group: SessionTagGroup): void => {
    setEditorOpen(true)
    setManageMode('tagGroup')
    setTagGroupForm({
      id: group.id,
      label: group.label,
      sessionIds: group.sessionIds,
    })
    setStatusText(`正在编辑标签分组：${group.label}`)
  }

  const renderTagGroupCard = (group: SessionTagGroup) => {
    const sessionMap = new Map(config.sessions.map((item) => [item.id, item]))
    const members = group.sessionIds
      .map((id) => sessionMap.get(id))
      .filter((item): item is SessionEntry => Boolean(item))
    const preview = members.slice(0, 4).map((item) => item.name)
    return (
      <article className="session-card" key={group.id} role="listitem">
        <div className="session-card-head">
          <div className="session-card-title-wrap">
            <div className="session-card-title">{group.label}</div>
            <div className="session-group-badge">标签分组</div>
          </div>
          <div className="session-card-meta">设备 {members.length} 台</div>
        </div>
        <div className="session-card-sub">
          {preview.length > 0 ? preview.join('、') : '暂无设备'}
          {members.length > preview.length ? ` 等 ${members.length} 台` : ''}
        </div>
        <div className="session-card-actions session-card-actions-quick">
          <button className="session-action session-action-primary" onClick={() => onConnectTagGroupNew(group.id)}>
            一键登录(新标签)
          </button>
          <button className="session-action" onClick={() => onConnectTagGroupCurrent(group.id)}>
            当前标签优先
          </button>
          <button className="session-action" onClick={() => openTagGroupEditor(group)}>
            更改参数
          </button>
          <button className="session-action session-action-danger" onClick={() => onDeleteTagGroup(group.id)}>
            删除
          </button>
        </div>
      </article>
    )
  }

  const renderSessionCard = (session: SessionEntry, groupLabel: string) => {
    const expanded = Boolean(expandedById[session.id])
    return (
      <article
        key={session.id}
        className="session-card"
        role="listitem"
        draggable
        onDragStart={() => setDraggingSessionId(session.id)}
        onDragEnd={() => setDraggingSessionId(null)}
        onDragOver={(event) => {
          event.preventDefault()
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (draggingSessionId && draggingSessionId !== session.id) {
            onReorderSessions(draggingSessionId, session.id, session.groupId)
          }
          setDraggingSessionId(null)
        }}
      >
        <div className="session-card-head">
          <div className="session-card-title-wrap">
            <div className="session-card-title">{session.name}</div>
            <div className="session-group-badge">{groupLabel}</div>
          </div>
          <div className="session-card-meta">
            {session.protocol === 'ssh'
              ? `${session.user ?? '-'}@${session.host}:${session.port}`
              : `${session.host}:${session.port} (${session.protocol})`}
          </div>
        </div>
        <div className="session-card-sub">
          协议：{session.protocol}
          {' · '}
          更新：{formatUpdatedAt(session.updatedAt)}
        </div>
        <div className="session-card-actions session-card-actions-quick">
          <button className="session-action session-action-primary" onClick={() => onConnectCurrentTab(session)}>
            一键连接
          </button>
          <button className="session-action" onClick={() => onConnectNewTab(session)}>
            新标签连接
          </button>
          <button className="session-action" onClick={() => openSessionEditor(session)}>
            更改参数
          </button>
          <button
            className="session-action session-action-danger"
            onClick={() => {
              const confirmed = window.confirm(`确定删除会话？\n\n${session.name}`)
              if (!confirmed) {
                return
              }
              onDeleteSession(session)
              setStatusText(`会话已删除：${session.name}`)
            }}
          >
            删除
          </button>
          <button
            className="session-action"
            onClick={() => {
              setExpandedById((previous) => ({
                ...previous,
                [session.id]: !previous[session.id],
              }))
            }}
          >
            {expanded ? '收起详情' : '查看详情'}
          </button>
        </div>
        {expanded && (
          <div className="session-card-details">
            <div className="session-card-detail-line">Identity：{session.identityFile || '-'}</div>
            <div className="session-card-detail-line">
              认证：{session.protocol === 'ssh' ? '系统 SSH Key / ssh-agent' : '本地协议直连'}
            </div>
            {session.packId && <div className="session-card-detail-line">端口包：{session.packId}</div>}
          </div>
        )}
      </article>
    )
  }

  return (
    <aside className="session-panel" role="dialog" aria-label="Session manager">
      <div className="session-panel-header">
        <div>
          <div className="session-panel-title">会话管理</div>
          <div className="session-panel-subtitle">设备列表优先，支持一键 SSH 连接</div>
        </div>
        <div className="session-panel-header-actions">
          <button
            className={`session-panel-close${editorOpen ? ' toolbar-button-active' : ''}`}
            onClick={() => setEditorOpen((prev) => !prev)}
          >
            {editorOpen ? '退出管理' : '管理+'}
          </button>
          <button className="session-panel-close" onClick={onExportCurrentTabLog}>
            导出当前日志
          </button>
          <button className="session-panel-close" onClick={onClose}>
            收起
          </button>
        </div>
      </div>

      {!editorOpen && (
      <div className="session-panel-toolbar">
        <input
          className="session-panel-search"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="搜索会话名称 / 主机 / 用户 / 端口"
        />
        <div className="session-panel-groups">
          <button
            className={`session-group-chip${groupFilter === 'all' ? ' session-group-chip-active' : ''}`}
            onClick={() => setGroupFilter('all')}
          >
            全部
          </button>
          {config.groups.map((group) => (
            <div
              key={group.id}
              className="session-group-chip-wrap"
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
                className={`session-group-chip${groupFilter === group.id ? ' session-group-chip-active' : ''}`}
                onClick={() => setGroupFilter(group.id)}
                draggable
                onDragStart={() => setDraggingGroupId(group.id)}
                onDragEnd={() => setDraggingGroupId(null)}
                title={`${group.label}（可拖拽排序）`}
              >
                {group.label}
              </button>
            </div>
          ))}
          <button
            className={`session-group-chip${groupFilter === 'tag-groups' ? ' session-group-chip-active' : ''}`}
            onClick={() => setGroupFilter('tag-groups')}
          >
            标签分组
          </button>
        </div>
        <div className="session-panel-summary">命中 {groupFilter === 'tag-groups' ? filteredTagGroups.length : filtered.length} 条</div>
      </div>
      )}

      {editorOpen && (
        <div className="session-editor">
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
              className={`session-action${manageMode === 'groupCreate' ? ' session-action-primary' : ''}`}
              onClick={() => setManageMode('groupCreate')}
            >
              创建分组
            </button>
            <button
              className={`session-action${manageMode === 'sessionCreate' ? ' session-action-primary' : ''}`}
              onClick={() => {
                setManageMode('sessionCreate')
                setForm(emptyForm(config.groups[0]?.id ?? 'linux'))
              }}
            >
              新建会话
            </button>
            <button
              className={`session-action${manageMode === 'tagGroup' ? ' session-action-primary' : ''}`}
              onClick={() => {
                setManageMode('tagGroup')
                setTagGroupForm(emptyTagGroupForm())
              }}
            >
              标签分组
            </button>
            <button
              className={`session-action${manageMode === 'batchCreate' ? ' session-action-primary' : ''}`}
              onClick={() => setManageMode('batchCreate')}
            >
              批量创建会话
            </button>
            <button
              className={`session-action${manageMode === 'localPack' ? ' session-action-primary' : ''}`}
              onClick={() => setManageMode('localPack')}
            >
              Add Local Port Pack
            </button>
            <button
              className={`session-action${manageMode === 'bulkDeleteGroups' ? ' session-action-primary' : ''}`}
              onClick={() => setManageMode('bulkDeleteGroups')}
            >
              批量删类目
            </button>
            <button
              className={`session-action${manageMode === 'bulkDeleteSessions' ? ' session-action-primary' : ''}`}
              onClick={() => setManageMode('bulkDeleteSessions')}
            >
              批量删会话
            </button>
            {manageMode === 'sessionEdit' && (
              <button className="session-action session-action-primary" onClick={() => setManageMode('sessionEdit')}>
                编辑当前会话
              </button>
            )}
          </div>

          {manageMode === 'groupCreate' && (
            <>
              <div className="session-editor-row">
                <input
                  className="session-input"
                  value={newGroupLabel}
                  onChange={(event) => setNewGroupLabel(event.target.value)}
                  placeholder="新建分组，例如：lab / prod"
                />
                <button
                  className="session-action"
                  onClick={() => {
                    const label = newGroupLabel.trim()
                    if (label.length === 0) {
                      return
                    }
                    onAddGroup(label)
                    setNewGroupLabel('')
                    setStatusText(`分组已创建：${label}`)
                  }}
                >
                  创建分组
                </button>
              </div>
              <div className="session-editor-row">
                <select
                  className="session-input"
                  value={groupDeleteId}
                  onChange={(event) => setGroupDeleteId(event.target.value)}
                >
                  {config.groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.label}
                    </option>
                  ))}
                </select>
                <button
                  className="session-action session-action-danger"
                  disabled={config.groups.length <= 1}
                  onClick={() => {
                    const group = config.groups.find((item) => item.id === groupDeleteId)
                    if (!group || config.groups.length <= 1) {
                      return
                    }
                    const confirmed = window.confirm(`确定删除分组「${group.label}」？该分组会话会移动到首个分组。`)
                    if (!confirmed) {
                      return
                    }
                    onDeleteGroup(group)
                    setStatusText(`分组已删除：${group.label}`)
                    setGroupDeleteId(config.groups[0]?.id ?? 'linux')
                  }}
                >
                  删除分组
                </button>
              </div>
            </>
          )}

          {(manageMode === 'sessionCreate' || manageMode === 'sessionEdit') && (
            <>
              <div className="session-form-grid">
                <label className="session-form-label">
                  <span>会话名</span>
                  <input
                    className="session-input"
                    value={form.name}
                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="例如：prod-gateway"
                  />
                </label>
                <label className="session-form-label">
                  <span>分组</span>
                  <select
                    className="session-input"
                    value={form.groupId}
                    onChange={(event) => setForm((prev) => ({ ...prev, groupId: event.target.value }))}
                  >
                    {config.groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="session-form-label">
                  <span>主机</span>
                  <input
                    className="session-input"
                    value={form.host}
                    onChange={(event) => setForm((prev) => ({ ...prev, host: event.target.value }))}
                    placeholder="10.0.0.12 / host.example.com"
                  />
                </label>
                <label className="session-form-label">
                  <span>端口</span>
                  <input
                    className="session-input"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        port: Math.max(1, Math.min(65535, Number(event.target.value) || 22)),
                      }))
                    }
                  />
                </label>
                <label className="session-form-label">
                  <span>协议</span>
                  <select
                    className="session-input"
                    value={form.protocol}
                    onChange={(event) => setForm((prev) => ({ ...prev, protocol: event.target.value as SessionProtocol }))}
                  >
                    <option value="ssh">ssh</option>
                    <option value="telnet">telnet</option>
                    <option value="raw">raw</option>
                  </select>
                </label>
                <label className="session-form-label">
                  <span>用户</span>
                  <input
                    className="session-input"
                    disabled={form.protocol !== 'ssh'}
                    value={form.user}
                    onChange={(event) => setForm((prev) => ({ ...prev, user: event.target.value }))}
                    placeholder="root / admin / ops"
                  />
                </label>
                <label className="session-form-label">
                  <span>Identity 文件（可选）</span>
                  <input
                    className="session-input"
                    disabled={form.protocol !== 'ssh'}
                    value={form.identityFile}
                    onChange={(event) => setForm((prev) => ({ ...prev, identityFile: event.target.value }))}
                    placeholder="~/.ssh/id_rsa"
                  />
                </label>
                <label className="session-form-label">
                  <span>HostKey 检查</span>
                  <select
                    className="session-input"
                    disabled={form.protocol !== 'ssh'}
                    value={form.hostKeyMode}
                    onChange={(event) => setForm((prev) => ({ ...prev, hostKeyMode: event.target.value as 'ask' | 'loose' }))}
                  >
                    <option value="ask">默认(ask)</option>
                    <option value="loose">宽松(危险)</option>
                  </select>
                </label>
              </div>

              <div className="session-editor-row">
                <button
                  className="session-action session-action-primary"
                  onClick={() => {
                    onUpsertSession(form)
                    setStatusText(form.id ? '会话已更新' : '会话已创建')
                    if (!form.id) {
                      setForm(emptyForm(form.groupId))
                    }
                  }}
                >
                  {form.id ? '保存会话修改' : '新增会话'}
                </button>
                <button
                  className="session-action"
                  onClick={() => {
                    setManageMode('sessionCreate')
                    setForm(emptyForm(config.groups[0]?.id ?? 'linux'))
                    setStatusText('已清空会话表单')
                  }}
                >
                  清空
                </button>
              </div>
            </>
          )}

          {manageMode === 'tagGroup' && (
            <>
              <div className="command-editor-title">系统分组：标签分组（引用已有设备）</div>
              <div className="session-editor-row">
                <input
                  className="session-input"
                  value={tagGroupForm.label}
                  onChange={(event) => setTagGroupForm((prev) => ({ ...prev, label: event.target.value }))}
                  placeholder="标签名，例如：核心设备 / 华为巡检组"
                />
                <button
                  className="session-action session-action-primary"
                  onClick={() => {
                    const label = tagGroupForm.label.trim()
                    if (label.length === 0) {
                      setStatusText('标签分组名称不能为空')
                      return
                    }
                    onUpsertTagGroup({
                      id: tagGroupForm.id,
                      label,
                      sessionIds: tagGroupForm.sessionIds,
                    })
                    setStatusText(tagGroupForm.id ? '标签分组已更新' : '标签分组已创建')
                    setTagGroupForm(emptyTagGroupForm())
                  }}
                >
                  {tagGroupForm.id ? '保存标签分组' : '新建标签分组'}
                </button>
                <button
                  className="session-action"
                  onClick={() => {
                    setTagGroupForm(emptyTagGroupForm())
                    setStatusText('已重置标签分组编辑器')
                  }}
                >
                  重置
                </button>
              </div>
              <div className="command-editor-title">选择设备成员（{tagGroupForm.sessionIds.length}）</div>
              <div className="command-modal-list-scroll">
                {config.sessions.map((session) => (
                  <label key={session.id} className="command-runtime-param">
                    <span>
                      <input
                        type="checkbox"
                        checked={tagGroupForm.sessionIds.includes(session.id)}
                        onChange={() =>
                          setTagGroupForm((prev) => ({
                            ...prev,
                            sessionIds: prev.sessionIds.includes(session.id)
                              ? prev.sessionIds.filter((id) => id !== session.id)
                              : [...prev.sessionIds, session.id],
                          }))
                        }
                      />
                      {' '}
                      {session.name}
                    </span>
                  </label>
                ))}
              </div>
              {config.tagGroups.length > 0 && (
                <>
                  <div className="command-editor-title">已有标签分组</div>
                  <div className="command-modal-list-scroll" role="list">
                    {config.tagGroups.map((group) => renderTagGroupCard(group))}
                  </div>
                </>
              )}
            </>
          )}

          {manageMode === 'batchCreate' && (
            <>
              <div className="session-form-grid">
                <label className="session-form-label">
                  <span>数量</span>
                  <input
                    className="session-input"
                    type="number"
                    min={1}
                    max={300}
                    value={batchForm.count}
                    onChange={(event) => setBatchForm((prev) => ({ ...prev, count: Math.max(1, Math.min(300, Number(event.target.value) || 1)) }))}
                  />
                </label>
                <label className="session-form-label">
                  <span>分组</span>
                  <select
                    className="session-input"
                    value={batchForm.groupId}
                    onChange={(event) => setBatchForm((prev) => ({ ...prev, groupId: event.target.value }))}
                  >
                    {config.groups.map((group) => (
                      <option key={group.id} value={group.id}>{group.label}</option>
                    ))}
                  </select>
                </label>
                <label className="session-form-label">
                  <span>协议</span>
                  <select
                    className="session-input"
                    value={batchForm.protocol}
                    onChange={(event) => setBatchForm((prev) => ({ ...prev, protocol: event.target.value as SessionProtocol }))}
                  >
                    <option value="ssh">ssh</option>
                    <option value="telnet">telnet</option>
                    <option value="raw">raw</option>
                  </select>
                </label>
                <label className="session-form-label">
                  <span>基础主机/IP</span>
                  <input
                    className="session-input"
                    value={batchForm.host}
                    onChange={(event) => setBatchForm((prev) => ({ ...prev, host: event.target.value }))}
                    placeholder="192.168.1.10"
                  />
                </label>
                <label className="session-form-label">
                  <span>起始端口</span>
                  <input
                    className="session-input"
                    type="number"
                    min={1}
                    max={65535}
                    value={batchForm.startPort}
                    onChange={(event) => setBatchForm((prev) => ({ ...prev, startPort: Math.max(1, Math.min(65535, Number(event.target.value) || 22)) }))}
                  />
                </label>
                <label className="session-form-label">
                  <span>会话名前缀</span>
                  <input
                    className="session-input"
                    value={batchForm.namePrefix}
                    onChange={(event) => setBatchForm((prev) => ({ ...prev, namePrefix: event.target.value }))}
                    placeholder="huawei-"
                  />
                </label>
                <label className="session-form-label">
                  <span>序号起始</span>
                  <input
                    className="session-input"
                    type="number"
                    min={0}
                    value={batchForm.nameStart}
                    onChange={(event) => setBatchForm((prev) => ({ ...prev, nameStart: Math.max(0, Math.floor(Number(event.target.value) || 0)) }))}
                  />
                </label>
                <label className="session-form-label">
                  <span>序号位数</span>
                  <input
                    className="session-input"
                    type="number"
                    min={1}
                    max={6}
                    value={batchForm.namePadWidth}
                    onChange={(event) =>
                      setBatchForm((prev) => ({
                        ...prev,
                        namePadWidth: Math.max(1, Math.min(6, Math.floor(Number(event.target.value) || 2))),
                      }))
                    }
                  />
                </label>
                <label className="session-form-label">
                  <span>用户</span>
                  <input
                    className="session-input"
                    disabled={batchForm.protocol !== 'ssh'}
                    value={batchForm.user}
                    onChange={(event) => setBatchForm((prev) => ({ ...prev, user: event.target.value }))}
                    placeholder="admin"
                  />
                </label>
                <label className="session-form-label">
                  <span>Identity 文件</span>
                  <input
                    className="session-input"
                    disabled={batchForm.protocol !== 'ssh'}
                    value={batchForm.identityFile}
                    onChange={(event) => setBatchForm((prev) => ({ ...prev, identityFile: event.target.value }))}
                    placeholder="~/.ssh/id_rsa"
                  />
                </label>
                <label className="session-form-label">
                  <span>HostKey 检查</span>
                  <select
                    className="session-input"
                    disabled={batchForm.protocol !== 'ssh'}
                    value={batchForm.hostKeyMode}
                    onChange={(event) => setBatchForm((prev) => ({ ...prev, hostKeyMode: event.target.value as 'ask' | 'loose' }))}
                  >
                    <option value="ask">默认(ask)</option>
                    <option value="loose">宽松(危险)</option>
                  </select>
                </label>
              </div>

              <div className="session-editor-row">
                <label className="session-form-inline-check">
                  <input
                    type="checkbox"
                    checked={batchForm.incrementIpTail}
                    onChange={(event) => setBatchForm((prev) => ({ ...prev, incrementIpTail: event.target.checked }))}
                  />
                  <span>IP 地址尾数递加</span>
                </label>
                <label className="session-form-inline-check">
                  <input
                    type="checkbox"
                    checked={batchForm.incrementPort}
                    onChange={(event) => setBatchForm((prev) => ({ ...prev, incrementPort: event.target.checked }))}
                  />
                  <span>端口递加</span>
                </label>
                <label className="session-form-inline-check">
                  <input
                    type="checkbox"
                    checked={batchForm.incrementName}
                    onChange={(event) => setBatchForm((prev) => ({ ...prev, incrementName: event.target.checked }))}
                  />
                  <span>会话名序号递加</span>
                </label>
              </div>

              <div className="session-editor-row">
                <button
                  className="session-action session-action-primary"
                  onClick={() => {
                    const count = Math.max(1, Math.min(300, Math.floor(batchForm.count)))
                    const nextForms: SessionFormState[] = []
                    for (let index = 0; index < count; index += 1) {
                      const host = buildBatchHost(batchForm.host, index, batchForm.incrementIpTail)
                      if (!host) {
                        setStatusText('批量创建失败：IP 模式开启时，请输入合法 IPv4 且尾号不可越界')
                        return
                      }
                      const port = batchForm.incrementPort ? batchForm.startPort + index : batchForm.startPort
                      if (port < 1 || port > 65535) {
                        setStatusText('批量创建失败：端口越界（1-65535）')
                        return
                      }
                      nextForms.push({
                        name: buildBatchName(batchForm.namePrefix, batchForm.nameStart, index, batchForm.namePadWidth, batchForm.incrementName),
                        groupId: batchForm.groupId,
                        protocol: batchForm.protocol,
                        host,
                        port,
                        user: batchForm.protocol === 'ssh' ? batchForm.user : '',
                        identityFile: batchForm.protocol === 'ssh' ? batchForm.identityFile : '',
                        hostKeyMode: batchForm.hostKeyMode,
                      })
                    }
                    const created = onBulkCreateSessions(nextForms)
                    setStatusText(`批量创建完成：${created} 条`)
                  }}
                >
                  执行批量创建
                </button>
                <button
                  className="session-action"
                  onClick={() => {
                    setBatchForm(emptyBatchForm(config.groups[0]?.id ?? 'linux'))
                    setStatusText('已重置批量创建参数')
                  }}
                >
                  重置参数
                </button>
              </div>
            </>
          )}

          {manageMode === 'localPack' && (
            <>
              <div className="session-editor-row">
                <input
                  className="session-input"
                  value={packForm.host}
                  onChange={(event) => setPackForm((previous) => ({ ...previous, host: event.target.value }))}
                  placeholder="本地端口包 host（默认 127.0.0.1）"
                />
                <button
                  className="session-action"
                  onClick={() => {
                    onUpsertLocalPortPack(packForm)
                    setStatusText(packForm.id ? '本地端口包已更新并重建会话' : '本地端口包已生成')
                    if (!packForm.id) {
                      setPackForm(emptyPackForm())
                    }
                  }}
                >
                  {packForm.id ? 'Regenerate 端口包' : 'Add Local Port Pack'}
                </button>
              </div>

              <div className="session-form-grid">
                <label className="session-form-label">
                  <span>startPort</span>
                  <input
                    className="session-input"
                    type="number"
                    min={1}
                    max={65535}
                    value={packForm.startPort}
                    onChange={(event) =>
                      setPackForm((previous) => ({
                        ...previous,
                        startPort: Math.max(1, Math.min(65535, Number(event.target.value) || 2000)),
                      }))
                    }
                  />
                </label>
                <label className="session-form-label">
                  <span>count</span>
                  <input
                    className="session-input"
                    type="number"
                    min={1}
                    max={200}
                    value={packForm.count}
                    onChange={(event) =>
                      setPackForm((previous) => ({
                        ...previous,
                        count: Math.max(1, Math.min(200, Number(event.target.value) || 20)),
                      }))
                    }
                  />
                </label>
                <label className="session-form-label">
                  <span>协议</span>
                  <select
                    className="session-input"
                    value={packForm.protocol}
                    onChange={(event) =>
                      setPackForm((previous) => ({
                        ...previous,
                        protocol: event.target.value as Extract<SessionProtocol, 'telnet' | 'raw' | 'ssh'>,
                      }))
                    }
                  >
                    <option value="telnet">telnet</option>
                    <option value="raw">raw</option>
                    <option value="ssh">ssh</option>
                  </select>
                </label>
                <label className="session-form-label">
                  <span>思科</span>
                  <input
                    className="session-input"
                    type="number"
                    min={0}
                    value={packForm.vendorPlan.cisco}
                    onChange={(event) =>
                      setPackForm((previous) => ({
                        ...previous,
                        vendorPlan: {
                          ...previous.vendorPlan,
                          cisco: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                        },
                      }))
                    }
                  />
                </label>
                <label className="session-form-label">
                  <span>华为</span>
                  <input
                    className="session-input"
                    type="number"
                    min={0}
                    value={packForm.vendorPlan.huawei}
                    onChange={(event) =>
                      setPackForm((previous) => ({
                        ...previous,
                        vendorPlan: {
                          ...previous.vendorPlan,
                          huawei: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                        },
                      }))
                    }
                  />
                </label>
                <label className="session-form-label">
                  <span>华三</span>
                  <input
                    className="session-input"
                    type="number"
                    min={0}
                    value={packForm.vendorPlan.h3c}
                    onChange={(event) =>
                      setPackForm((previous) => ({
                        ...previous,
                        vendorPlan: {
                          ...previous.vendorPlan,
                          h3c: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                        },
                      }))
                    }
                  />
                </label>
                <label className="session-form-label">
                  <span>锐捷</span>
                  <input
                    className="session-input"
                    type="number"
                    min={0}
                    value={packForm.vendorPlan.ruijie}
                    onChange={(event) =>
                      setPackForm((previous) => ({
                        ...previous,
                        vendorPlan: {
                          ...previous.vendorPlan,
                          ruijie: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                        },
                      }))
                    }
                  />
                </label>
              </div>
              <div className="session-card-detail-line">vendorPlan 合计：{totalPackVendorCount}（将按此数量生成会话）</div>

              {config.localPortPacks.length > 0 && (
                <div className="session-editor-row">
                  <select
                    className="session-input"
                    value={packForm.id ?? ''}
                    onChange={(event) => {
                      const selected = config.localPortPacks.find((item) => item.id === event.target.value)
                      if (!selected) {
                        setPackForm(emptyPackForm())
                        return
                      }
                      setPackForm({
                        id: selected.id,
                        host: selected.host,
                        startPort: selected.startPort,
                        count: selected.count,
                        protocol: selected.protocol,
                        vendorPlan: selected.vendorPlan,
                      })
                    }}
                  >
                    <option value="">选择已有端口包（可编辑/删除）</option>
                    {config.localPortPacks.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.host}:{item.startPort}+{item.count}
                      </option>
                    ))}
                  </select>
                  <button
                    className="session-action session-action-danger"
                    onClick={() => {
                      if (!packForm.id) {
                        return
                      }
                      const pack = config.localPortPacks.find((item) => item.id === packForm.id)
                      if (!pack) {
                        return
                      }
                      const confirmed = window.confirm(`确定删除本地端口包？\n\n${pack.host}:${pack.startPort} (+${pack.count})`)
                      if (!confirmed) {
                        return
                      }
                      onDeleteLocalPortPack(pack)
                      setPackForm(emptyPackForm())
                      setStatusText('本地端口包已删除')
                    }}
                  >
                    删除端口包
                  </button>
                </div>
              )}
            </>
          )}

          {manageMode === 'bulkDeleteGroups' && (
            <>
              <div className="command-editor-title">批量删除类目</div>
              <div className="command-modal-list-scroll">
                {config.groups.map((group) => (
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
              <div className="session-editor-row">
                <button
                  className="session-action session-action-danger"
                  onClick={() => {
                    if (selectedGroupIds.length === 0) {
                      return
                    }
                    const remaining = config.groups.length - selectedGroupIds.length
                    if (remaining <= 0) {
                      setStatusText('至少保留一个分组')
                      return
                    }
                    const confirmed = window.confirm(`确定批量删除 ${selectedGroupIds.length} 个分组？其下会话会一起删除。`)
                    if (!confirmed) {
                      return
                    }
                    onBulkDeleteGroups(selectedGroupIds)
                    setSelectedGroupIds([])
                    setStatusText('已批量删除分组')
                  }}
                >
                  批量删除分组
                </button>
              </div>
            </>
          )}

          {manageMode === 'bulkDeleteSessions' && (
            <>
              <div className="command-editor-title">批量删除会话</div>
              <div className="command-modal-list-scroll">
                {config.sessions.map((session) => (
                  <label key={session.id} className="command-runtime-param">
                    <span>
                      <input
                        type="checkbox"
                        checked={selectedSessionIds.includes(session.id)}
                        onChange={() => toggleSessionSelection(session.id)}
                      />
                      {' '}
                      {session.name}
                    </span>
                  </label>
                ))}
              </div>
              <div className="session-editor-row">
                <button
                  className="session-action session-action-danger"
                  onClick={() => {
                    if (selectedSessionIds.length === 0) {
                      return
                    }
                    const confirmed = window.confirm(`确定批量删除 ${selectedSessionIds.length} 个会话？`)
                    if (!confirmed) {
                      return
                    }
                    onBulkDeleteSessions(selectedSessionIds)
                    setSelectedSessionIds([])
                    setStatusText('已批量删除会话')
                  }}
                >
                  批量删除会话
                </button>
              </div>
            </>
          )}

          <div className="session-editor-status">{statusText || exportStatus || '—'}</div>
        </div>
      )}

      {!editorOpen && (
      <div className="session-list" role="list">
        {groupFilter !== 'tag-groups' && filtered.length === 0 && <div className="session-empty">暂无会话</div>}
        {(groupFilter === 'all' || groupFilter === 'tag-groups') && (
          <div className="session-group-section">
            <div className="session-group-title">标签分组</div>
            {filteredTagGroups.length === 0 && <div className="session-empty">暂无标签分组</div>}
            {filteredTagGroups.map((group) => renderTagGroupCard(group))}
          </div>
        )}
        {groupFilter !== 'tag-groups' && groupedFiltered.map(({ group, sessions }) => (
          <div
            key={group.id}
            className="session-group-section"
            onDragOver={(event) => {
              event.preventDefault()
            }}
            onDrop={(event) => {
              event.preventDefault()
              if (draggingSessionId) {
                onReorderSessions(draggingSessionId, null, group.id)
              }
              setDraggingSessionId(null)
            }}
          >
            <div className="session-group-title">{group.label}</div>
            {sessions.map((session) => renderSessionCard(session, group.label))}
          </div>
        ))}
      </div>
      )}
    </aside>
  )
}
