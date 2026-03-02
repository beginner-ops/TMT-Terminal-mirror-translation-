import { useMemo, useState } from 'react'
import type {
  LocalPortPackConfig,
  LocalPortVendorPlan,
  SessionCatalogConfig,
  SessionGroup,
  SessionProtocol,
  SessionEntry,
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

type LocalPackFormState = {
  id?: string
  host: string
  startPort: number
  count: number
  protocol: Extract<SessionProtocol, 'telnet' | 'raw' | 'ssh'>
  vendorPlan: LocalPortVendorPlan
}

type SessionManagerPanelProps = {
  isOpen: boolean
  config: SessionCatalogConfig
  onClose: () => void
  onAddGroup: (label: string) => void
  onDeleteGroup: (group: SessionGroup) => void
  onReorderGroups: (sourceGroupId: string, targetGroupId: string) => void
  onUpsertSession: (form: SessionFormState) => void
  onDeleteSession: (session: SessionEntry) => void
  onReorderSessions: (sourceSessionId: string, targetSessionId: string | null, targetGroupId: string) => void
  onConnectCurrentTab: (session: SessionEntry) => void
  onConnectNewTab: (session: SessionEntry) => void
  onUpsertLocalPortPack: (form: LocalPackFormState) => void
  onDeleteLocalPortPack: (pack: LocalPortPackConfig) => void
  onExportCurrentTabLog: () => void
  exportStatus: string
}

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

const formatUpdatedAt = (updatedAt: string): string => {
  const parsed = Date.parse(updatedAt)
  if (Number.isNaN(parsed)) {
    return '-'
  }
  return new Date(parsed).toLocaleString()
}

export const SessionManagerPanel = ({
  isOpen,
  config,
  onClose,
  onAddGroup,
  onDeleteGroup,
  onReorderGroups,
  onUpsertSession,
  onDeleteSession,
  onReorderSessions,
  onConnectCurrentTab,
  onConnectNewTab,
  onUpsertLocalPortPack,
  onDeleteLocalPortPack,
  onExportCurrentTabLog,
  exportStatus,
}: SessionManagerPanelProps) => {
  const [searchText, setSearchText] = useState('')
  const [groupFilter, setGroupFilter] = useState('all')
  const [editorOpen, setEditorOpen] = useState(false)
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null)
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null)
  const [newGroupLabel, setNewGroupLabel] = useState('')
  const [statusText, setStatusText] = useState('')
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({})
  const [form, setForm] = useState<SessionFormState>(() => emptyForm(config.groups[0]?.id ?? 'linux'))
  const [packForm, setPackForm] = useState<LocalPackFormState>(() => emptyPackForm())

  const filtered = useMemo(() => {
    const keyword = searchText.trim().toLocaleLowerCase()
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

  const totalPackVendorCount =
    packForm.vendorPlan.cisco + packForm.vendorPlan.huawei + packForm.vendorPlan.h3c + packForm.vendorPlan.ruijie

  if (!isOpen) {
    return null
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
            {editorOpen && (
              <div className="session-card-actions">
                <button
                  className="session-action"
                  onClick={() => {
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
                    setStatusText(`正在编辑：${session.name}`)
                  }}
                >
                  编辑
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
              </div>
            )}
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
          <button className="session-panel-close" onClick={onExportCurrentTabLog}>
            导出当前日志
          </button>
          <button className="session-panel-close" onClick={onClose}>
            收起
          </button>
        </div>
      </div>

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
            className={`session-manage-toggle${editorOpen ? ' session-manage-toggle-active' : ''}`}
            onClick={() => setEditorOpen((prev) => !prev)}
            title="新增会话 / 分组管理"
          >
            {editorOpen ? '收起管理' : '管理+'}
          </button>
        </div>
        <div className="session-panel-summary">命中 {filtered.length} 条</div>
      </div>

      {editorOpen && (
        <div className="session-editor">
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
            {config.groups.length > 1 && (
              <button
                className="session-action session-action-danger"
                onClick={() => {
                  const group = config.groups.find((item) => item.id === form.groupId)
                  if (!group) {
                    return
                  }
                  const confirmed = window.confirm(`确定删除分组「${group.label}」？该分组会话会移动到首个分组。`)
                  if (!confirmed) {
                    return
                  }
                  onDeleteGroup(group)
                  setStatusText(`分组已删除：${group.label}`)
                }}
              >
                删除当前分组
              </button>
            )}
          </div>

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
            <label className="session-form-label">
              <span>认证方式</span>
              <input
                className="session-input"
                value={form.protocol === 'ssh' ? '系统 SSH Key / ssh-agent' : '本地协议直连'}
                readOnly
              />
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
              {form.id ? '更新会话' : '新增会话'}
            </button>
            <button
              className="session-action"
              onClick={() => {
                setForm(emptyForm(config.groups[0]?.id ?? 'linux'))
                setStatusText('已清空编辑器')
              }}
            >
              清空
            </button>
          </div>

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

          {config.localPortPacks.length > 0 && (
            <div className="session-pack-list">
              <div className="session-pack-list-title">本地端口包列表</div>
              {config.localPortPacks.map((pack) => {
                const countByPack = config.sessions.filter((session) => session.packId === pack.id).length
                return (
                  <article className="session-pack-card" key={pack.id}>
                    <div className="session-pack-card-head">
                      <div className="session-pack-card-title">
                        {pack.host}:{pack.startPort} (+{pack.count})
                      </div>
                      <div className="session-pack-card-meta">{pack.protocol}</div>
                    </div>
                    <div className="session-pack-card-sub">
                      思科 {pack.vendorPlan.cisco} · 华为 {pack.vendorPlan.huawei} · 华三 {pack.vendorPlan.h3c} · 锐捷 {pack.vendorPlan.ruijie}
                    </div>
                    <div className="session-pack-card-sub">当前会话数：{countByPack}</div>
                    <div className="session-card-actions">
                      <button
                        className="session-action"
                        onClick={() => {
                          setPackForm({
                            id: pack.id,
                            host: pack.host,
                            startPort: pack.startPort,
                            count: pack.count,
                            protocol: pack.protocol,
                            vendorPlan: pack.vendorPlan,
                          })
                          setStatusText(`已载入端口包：${pack.host}:${pack.startPort}`)
                        }}
                      >
                        载入编辑
                      </button>
                      <button
                        className="session-action"
                        onClick={() => {
                          onUpsertLocalPortPack({
                            id: pack.id,
                            host: pack.host,
                            startPort: pack.startPort,
                            count: pack.count,
                            protocol: pack.protocol,
                            vendorPlan: pack.vendorPlan,
                          })
                          setStatusText('端口包已按原参数重建')
                        }}
                      >
                        一键重建
                      </button>
                      <button
                        className="session-action session-action-danger"
                        onClick={() => {
                          const confirmed = window.confirm(`确定删除本地端口包？\n\n${pack.host}:${pack.startPort} (+${pack.count})`)
                          if (!confirmed) {
                            return
                          }
                          onDeleteLocalPortPack(pack)
                          if (packForm.id === pack.id) {
                            setPackForm(emptyPackForm())
                          }
                          setStatusText('本地端口包已删除')
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="session-list" role="list">
        {filtered.length === 0 && <div className="session-empty">暂无会话</div>}
        {groupFilter === 'all'
          ? groupedFiltered.map(({ group, sessions }) => (
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
            ))
          : filtered.map((session) => {
              const group = config.groups.find((item) => item.id === session.groupId)
              return renderSessionCard(session, group?.label ?? session.groupId)
            })}
      </div>

      <div className="session-status">{statusText || exportStatus || ' '}</div>
    </aside>
  )
}
