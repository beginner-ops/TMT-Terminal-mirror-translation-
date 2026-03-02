import { useMemo, useState } from 'react'
import { createButtonId, moveButtonToOrder, sanitizeContextId } from './utils'
import type {
  CommandActionType,
  CommandButton,
  CommandConfig,
  CommandContext,
  CommandRisk,
} from './types'

type CommandManagerIntent = 'create' | 'edit'

type CommandManagerModalProps = {
  isOpen: boolean
  intent: CommandManagerIntent
  config: CommandConfig
  activeContextId: string
  searchText: string
  onSearchTextChange: (value: string) => void
  onSaveConfig: (nextConfig: CommandConfig) => Promise<void> | void
  onClose: () => void
}

type EditorState = {
  id: string | null
  labelZh: string
  actionType: CommandActionType
  payload: string
  contextId: string
  risk: CommandRisk
}

const createDefaultEditor = (contextId: string): EditorState => ({
  id: null,
  labelZh: '',
  actionType: 'sendText',
  payload: '',
  contextId,
  risk: 'safe',
})

const ACTION_LABELS: Record<CommandActionType, string> = {
  sendText: '发送文本',
  sendKey: '发送按键',
  sendAnsi: '发送 ANSI',
}

const RISK_LABELS: Record<CommandRisk, string> = {
  safe: '安全',
  caution: '谨慎',
  destructive: '危险',
}

export const CommandManagerModal = ({
  isOpen,
  intent,
  config,
  activeContextId,
  searchText,
  onSearchTextChange,
  onSaveConfig,
  onClose,
}: CommandManagerModalProps) => {
  const contexts = config.contexts
  const buttons = config.buttons

  const getInitialEditor = (): EditorState => {
    if (intent === 'create') {
      return createDefaultEditor(activeContextId)
    }

    const firstButton = buttons.find((button) => button.contextId === activeContextId) ?? buttons[0]
    if (!firstButton) {
      return createDefaultEditor(activeContextId)
    }

    return {
      id: firstButton.id,
      labelZh: firstButton.labelZh,
      actionType: firstButton.actionType,
      payload: firstButton.payload,
      contextId: firstButton.contextId,
      risk: firstButton.risk,
    }
  }

  const [editor, setEditor] = useState<EditorState>(() => getInitialEditor())
  const [contextIdDraft, setContextIdDraft] = useState('')
  const [contextLabelDraft, setContextLabelDraft] = useState('')
  const [contextHintsDraft, setContextHintsDraft] = useState('')
  const [editingContextId, setEditingContextId] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('')

  const sortedButtons = useMemo(() => {
    return [...buttons].sort((a, b) => {
      if (a.contextId !== b.contextId) {
        return a.contextId.localeCompare(b.contextId)
      }

      if (a.order !== b.order) {
        return a.order - b.order
      }

      return a.labelZh.localeCompare(b.labelZh)
    })
  }, [buttons])

  const filteredButtons = useMemo(() => {
    const normalized = searchText.trim()
    if (normalized.length === 0) {
      return sortedButtons
    }

    return sortedButtons.filter((button) => button.labelZh.includes(normalized))
  }, [searchText, sortedButtons])

  if (!isOpen) {
    return null
  }

  const loadButtonIntoEditor = (button: CommandButton): void => {
    setEditor({
      id: button.id,
      labelZh: button.labelZh,
      actionType: button.actionType,
      payload: button.payload,
      contextId: button.contextId,
      risk: button.risk,
    })
    setStatusText(`已载入：${button.labelZh}`)
  }

  const persistConfig = async (nextConfig: CommandConfig, status: string): Promise<void> => {
    await onSaveConfig(nextConfig)
    setStatusText(status)
  }

  const persistButtons = async (nextButtons: CommandButton[], status: string): Promise<void> => {
    await persistConfig(
      {
        ...config,
        buttons: nextButtons,
      },
      status,
    )
  }

  const onMoveButton = async (button: CommandButton, offset: number): Promise<void> => {
    const targetOrder = button.order + offset
    const nextButtons = moveButtonToOrder(buttons, button.id, button.contextId, targetOrder)
    await persistButtons(nextButtons, '顺序已更新')
  }

  const onChangeOrder = async (button: CommandButton, rawOrder: string): Promise<void> => {
    const parsed = Number.parseInt(rawOrder, 10)
    if (!Number.isFinite(parsed)) {
      return
    }

    const nextButtons = moveButtonToOrder(buttons, button.id, button.contextId, parsed)
    await persistButtons(nextButtons, '顺序已更新')
  }

  const onDeleteButton = async (button: CommandButton): Promise<void> => {
    const confirmed = window.confirm(`确定删除按钮「${button.labelZh}」吗？`)
    if (!confirmed) {
      return
    }

    const nextButtons = buttons.filter((item) => item.id !== button.id)
    await persistButtons(nextButtons, '按钮已删除')
    if (editor.id === button.id) {
      setEditor(createDefaultEditor(activeContextId))
    }
  }

  const parseHints = (raw: string): string[] => {
    const deduped = new Set<string>()
    raw
      .split(',')
      .map((hint) => hint.trim().toLocaleLowerCase())
      .filter((hint) => hint.length > 1)
      .forEach((hint) => deduped.add(hint))

    return Array.from(deduped)
  }

  const resetContextEditor = (): void => {
    setEditingContextId(null)
    setContextIdDraft('')
    setContextLabelDraft('')
    setContextHintsDraft('')
  }

  const loadContextEditor = (context: CommandContext): void => {
    setEditingContextId(context.id)
    setContextIdDraft(context.id)
    setContextLabelDraft(context.label)
    setContextHintsDraft(context.detectHints.join(', '))
    setStatusText(`已载入场景：${context.label}`)
  }

  const onSubmitContext = async (): Promise<void> => {
    const nextLabel = contextLabelDraft.trim()
    if (nextLabel.length === 0) {
      setStatusText('场景名称不能为空')
      return
    }

    const idSource = contextIdDraft.trim().length > 0 ? contextIdDraft : nextLabel
    const nextId = sanitizeContextId(idSource)

    const nextHints = parseHints(contextHintsDraft)
    const isEditing = editingContextId !== null
    if (!isEditing && contexts.some((context) => context.id === nextId)) {
      setStatusText('场景 ID 已存在')
      return
    }

    if (isEditing && editingContextId !== nextId && contexts.some((context) => context.id === nextId)) {
      setStatusText('目标场景 ID 已存在')
      return
    }

    let nextContexts: CommandContext[]
    let nextButtons: CommandButton[]
    if (!isEditing) {
      nextContexts = [...contexts, { id: nextId, label: nextLabel, detectHints: nextHints }]
      nextButtons = buttons
      await persistConfig(
        {
          ...config,
          contexts: nextContexts,
          buttons: nextButtons,
        },
        '场景已新增',
      )
      resetContextEditor()
      return
    }

    nextContexts = contexts.map((context) =>
      context.id === editingContextId
        ? {
            id: nextId,
            label: nextLabel,
            detectHints: nextHints,
          }
        : context,
    )
    nextButtons = buttons.map((button) =>
      button.contextId === editingContextId
        ? {
            ...button,
            contextId: nextId,
          }
        : button,
    )

    const nextDefaultContextId = config.defaultContextId === editingContextId ? nextId : config.defaultContextId
    await persistConfig(
      {
        ...config,
        defaultContextId: nextDefaultContextId,
        contexts: nextContexts,
        buttons: nextButtons,
      },
      '场景已更新',
    )
    resetContextEditor()
  }

  const onDeleteContext = async (context: CommandContext): Promise<void> => {
    if (context.id === 'shell') {
      setStatusText('Shell 场景不可删除')
      return
    }

    const confirmed = window.confirm(`确定删除场景「${context.label}」吗？其按钮将迁移到 Shell。`)
    if (!confirmed) {
      return
    }

    const nextContexts = contexts.filter((item) => item.id !== context.id)
    const shellButtons = buttons.filter((button) => button.contextId === 'shell')
    let nextOrder = shellButtons.length
    const migratedButtons = buttons.map((button) => {
      if (button.contextId !== context.id) {
        return button
      }

      nextOrder += 1
      return {
        ...button,
        contextId: 'shell',
        order: nextOrder,
      }
    })

    await persistConfig(
      {
        ...config,
        contexts: nextContexts,
        defaultContextId: config.defaultContextId === context.id ? 'shell' : config.defaultContextId,
        buttons: migratedButtons,
      },
      '场景已删除并迁移按钮',
    )

    if (editingContextId === context.id) {
      resetContextEditor()
    }
  }

  const onSubmitEditor = async (): Promise<void> => {
    const labelZh = editor.labelZh.trim()
    if (labelZh.length === 0) {
      setStatusText('中文按钮名称不能为空')
      return
    }

    if (editor.payload.length === 0) {
      setStatusText('Payload 不能为空')
      return
    }

    const contextId = editor.contextId
    if (!contexts.some((context) => context.id === contextId)) {
      setStatusText('请选择有效场景')
      return
    }

    const existing = editor.id ? buttons.find((button) => button.id === editor.id) : null
    const currentContextButtons = buttons.filter((button) => button.contextId === contextId)
    const nextOrder = existing
      ? existing.contextId === contextId
        ? existing.order
        : currentContextButtons.length + 1
      : currentContextButtons.length + 1

    const nextButton: CommandButton = {
      id: existing?.id ?? createButtonId(contextId),
      labelZh,
      actionType: editor.actionType,
      payload: editor.payload,
      contextId,
      risk: editor.risk,
      order: nextOrder,
    }

    let nextButtons: CommandButton[]
    if (existing) {
      nextButtons = buttons.map((button) => (button.id === existing.id ? nextButton : button))
      await persistButtons(nextButtons, '按钮已更新')
      return
    }

    nextButtons = [...buttons, nextButton]
    await persistButtons(nextButtons, '按钮已创建')
    setEditor((previous) => ({
      ...previous,
      id: nextButton.id,
    }))
  }

  return (
    <div className="command-modal-backdrop" role="dialog" aria-label="按钮管理">
      <div className="command-modal">
        <div className="command-modal-header">
          <div className="command-modal-title">按钮管理</div>
          <button className="command-modal-close" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="command-modal-body">
          <section className="command-modal-list">
            <div className="command-modal-section-title">现有按钮</div>
            <input
              className="command-modal-search"
              placeholder="按中文名称搜索"
              value={searchText}
              onChange={(event) => onSearchTextChange(event.target.value)}
            />
            <div className="command-modal-list-scroll">
              {filteredButtons.map((button) => (
                <div key={button.id} className="command-list-item">
                  <button className="command-list-edit" onClick={() => loadButtonIntoEditor(button)}>
                    {button.labelZh}
                  </button>
                  <div className="command-list-meta">{button.contextId}</div>
                  <input
                    className="command-order-input"
                    type="number"
                    min={1}
                    value={button.order}
                    onChange={(event) => {
                      void onChangeOrder(button, event.target.value)
                    }}
                  />
                  <button className="command-inline-button" onClick={() => void onMoveButton(button, -1)}>
                    上移
                  </button>
                  <button className="command-inline-button" onClick={() => void onMoveButton(button, 1)}>
                    下移
                  </button>
                  <button className="command-inline-button command-inline-danger" onClick={() => void onDeleteButton(button)}>
                    删除
                  </button>
                </div>
              ))}
              {filteredButtons.length === 0 && <div className="command-list-empty">没有匹配的按钮</div>}
            </div>
          </section>

          <section className="command-modal-editor">
            <div className="command-modal-section-title">按钮编辑器</div>
            <label className="command-field-label">中文按钮名称</label>
            <input
              className="command-field-input"
              value={editor.labelZh}
              onChange={(event) => setEditor((previous) => ({ ...previous, labelZh: event.target.value }))}
              placeholder="例如：查看日志"
            />

            <label className="command-field-label">Action type</label>
            <select
              className="command-field-input"
              value={editor.actionType}
              onChange={(event) =>
                setEditor((previous) => ({ ...previous, actionType: event.target.value as CommandActionType }))
              }
            >
              {(Object.keys(ACTION_LABELS) as CommandActionType[]).map((actionType) => (
                <option key={actionType} value={actionType}>
                  {ACTION_LABELS[actionType]}
                </option>
              ))}
            </select>

            <label className="command-field-label">Payload</label>
            <textarea
              className="command-field-textarea"
              value={editor.payload}
              onChange={(event) => setEditor((previous) => ({ ...previous, payload: event.target.value }))}
              placeholder="例如：ls -la\n 或 Ctrl+C"
            />

            <label className="command-field-label">Context</label>
            <select
              className="command-field-input"
              value={editor.contextId}
              onChange={(event) => setEditor((previous) => ({ ...previous, contextId: event.target.value }))}
            >
              {contexts.map((context) => (
                <option key={context.id} value={context.id}>
                  {context.label}
                </option>
              ))}
            </select>

            <label className="command-field-label">风险级别</label>
            <select
              className="command-field-input"
              value={editor.risk}
              onChange={(event) => setEditor((previous) => ({ ...previous, risk: event.target.value as CommandRisk }))}
            >
              {(Object.keys(RISK_LABELS) as CommandRisk[]).map((risk) => (
                <option key={risk} value={risk}>
                  {RISK_LABELS[risk]}
                </option>
              ))}
            </select>

            <div className="command-editor-actions">
              <button className="command-editor-action" onClick={() => setEditor(createDefaultEditor(activeContextId))}>
                清空
              </button>
              <button className="command-editor-action command-editor-primary" onClick={() => void onSubmitEditor()}>
                保存按钮
              </button>
            </div>

            <div className="command-status-text">{statusText}</div>

            <div className="command-context-divider" />
            <div className="command-modal-section-title">场景管理（可新增）</div>
            <div className="command-context-list">
              {contexts.map((context) => (
                <div key={context.id} className="command-context-item">
                  <button className="command-context-edit" onClick={() => loadContextEditor(context)}>
                    {context.label}
                  </button>
                  <div className="command-context-id">{context.id}</div>
                  <button
                    className="command-inline-button command-inline-danger"
                    onClick={() => void onDeleteContext(context)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>

            <label className="command-field-label">场景 ID</label>
            <input
              className="command-field-input"
              value={contextIdDraft}
              onChange={(event) => setContextIdDraft(event.target.value)}
              placeholder="例如：my-context"
            />

            <label className="command-field-label">场景名称</label>
            <input
              className="command-field-input"
              value={contextLabelDraft}
              onChange={(event) => setContextLabelDraft(event.target.value)}
              placeholder="例如：我的场景"
            />

            <label className="command-field-label">检测关键词（逗号分隔）</label>
            <input
              className="command-field-input"
              value={contextHintsDraft}
              onChange={(event) => setContextHintsDraft(event.target.value)}
              placeholder="例如：my-agent, ask anything"
            />

            <div className="command-editor-actions">
              <button className="command-editor-action" onClick={resetContextEditor}>
                清空场景编辑
              </button>
              <button className="command-editor-action command-editor-primary" onClick={() => void onSubmitContext()}>
                {editingContextId ? '更新场景' : '新增场景'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
