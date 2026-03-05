import { useMemo, useState } from 'react'
import type { GlossaryEntry } from '../mirror/GlossaryTypes'

type GlossaryManagerModalProps = {
  isOpen: boolean
  entries: GlossaryEntry[]
  onDeleteEntry: (entry: GlossaryEntry) => Promise<boolean> | boolean
  onClose: () => void
  onImportGlossary: () => void
  onExportGlossary: () => void
  onOpenTranslationStrategy: () => void
}

type ManageView = 'wordEntries' | 'sentenceEntries' | 'bulkDeleteCategories' | 'tools'
type GlossaryCategory = 'word' | 'sentence'

const formatTimestamp = (value: string | undefined): string => {
  if (!value) {
    return 'unknown'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'unknown'
  }
  return date.toLocaleString()
}

const matchTypeLabel = (entry: GlossaryEntry): string => {
  if (entry.matchType === 'pattern') {
    return 'pattern'
  }
  if (entry.matchType === 'caseInsensitive' || entry.caseInsensitive) {
    return 'case-insensitive'
  }
  return 'exact'
}

const toCategory = (entry: GlossaryEntry): GlossaryCategory => {
  const source = entry.source.trim()
  if (source.length === 0) {
    return 'word'
  }
  if (/\s/.test(source)) {
    return 'sentence'
  }
  if (source.length > 24) {
    return 'sentence'
  }
  if (/[:/\\()[\]{}]/.test(source)) {
    return 'sentence'
  }
  return 'word'
}

export const GlossaryManagerModal = ({
  isOpen,
  entries,
  onDeleteEntry,
  onClose,
  onImportGlossary,
  onExportGlossary,
  onOpenTranslationStrategy,
}: GlossaryManagerModalProps) => {
  const [searchText, setSearchText] = useState('')
  const [statusText, setStatusText] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [manageView, setManageView] = useState<ManageView>('wordEntries')
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([])
  const [selectedCategories, setSelectedCategories] = useState<GlossaryCategory[]>([])

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0
      const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0
      if (aTime !== bTime) {
        return bTime - aTime
      }
      return a.source.localeCompare(b.source)
    })
  }, [entries])

  const filteredEntries = useMemo(() => {
    const normalized = searchText.trim().toLocaleLowerCase()
    if (normalized.length === 0) {
      return sortedEntries
    }
    return sortedEntries.filter((entry) => {
      const source = entry.source.toLocaleLowerCase()
      const target = entry.target.toLocaleLowerCase()
      const note = (entry.note ?? '').toLocaleLowerCase()
      return source.includes(normalized) || target.includes(normalized) || note.includes(normalized)
    })
  }, [searchText, sortedEntries])

  const wordEntries = useMemo(
    () => sortedEntries.filter((entry) => toCategory(entry) === 'word'),
    [sortedEntries],
  )
  const sentenceEntries = useMemo(
    () => sortedEntries.filter((entry) => toCategory(entry) === 'sentence'),
    [sortedEntries],
  )

  if (!isOpen) {
    return null
  }

  const toggleEntrySelection = (entryId: string): void => {
    setSelectedEntryIds((previous) =>
      previous.includes(entryId) ? previous.filter((id) => id !== entryId) : [...previous, entryId],
    )
  }

  const toggleCategorySelection = (category: GlossaryCategory): void => {
    setSelectedCategories((previous) =>
      previous.includes(category) ? previous.filter((id) => id !== category) : [...previous, category],
    )
  }

  const handleDelete = async (entry: GlossaryEntry): Promise<void> => {
    if (!entry.id) {
      setStatusText('词条缺少 ID，无法删除')
      return
    }

    const confirmed = window.confirm(`确定删除词条？\n\n${entry.source}\n->\n${entry.target}`)
    if (!confirmed) {
      return
    }

    setDeletingId(entry.id)
    setStatusText('删除中...')
    try {
      const ok = await onDeleteEntry(entry)
      setStatusText(ok ? '词条已删除' : '删除失败，请稍后重试')
    } catch {
      setStatusText('删除失败，请稍后重试')
    } finally {
      setDeletingId(null)
    }
  }

  const handleBatchDeleteEntries = async (): Promise<void> => {
    const targetEntries = sortedEntries.filter((entry) => entry.id && selectedEntryIds.includes(entry.id))
    if (targetEntries.length === 0) {
      return
    }
    const confirmed = window.confirm(`确定批量删除 ${targetEntries.length} 条词条？`)
    if (!confirmed) {
      return
    }
    setStatusText('批量删除中...')
    for (const entry of targetEntries) {
      await onDeleteEntry(entry)
    }
    setSelectedEntryIds([])
    setStatusText(`已删除 ${targetEntries.length} 条词条`)
  }

  const handleBatchDeleteCategories = async (): Promise<void> => {
    if (selectedCategories.length === 0) {
      return
    }
    const targetEntries = sortedEntries.filter((entry) => selectedCategories.includes(toCategory(entry)))
    if (targetEntries.length === 0) {
      return
    }
    const confirmed = window.confirm(`确定删除选中类目下全部词条？\n\n共 ${targetEntries.length} 条`)
    if (!confirmed) {
      return
    }
    setStatusText('按类目批量删除中...')
    for (const entry of targetEntries) {
      await onDeleteEntry(entry)
    }
    setSelectedCategories([])
    setSelectedEntryIds([])
    setStatusText(`已按类目删除 ${targetEntries.length} 条词条`)
  }

  const renderEntryList = (list: GlossaryEntry[]) => (
    <div className="command-modal-list-scroll">
      {list.length === 0 && <div className="glossary-panel-empty">没有可管理词条</div>}
      {list.map((entry) => (
        <article className="glossary-card" key={entry.id ?? `${entry.source}-${entry.target}`} role="listitem">
          <div className="glossary-card-source" title={entry.source}>
            {entry.source}
          </div>
          <div className="glossary-card-target" title={entry.target}>
            {entry.target}
          </div>
          <div className="glossary-card-meta">
            <span>match: {matchTypeLabel(entry)}</span>
            <span>domain: {entry.domain ?? 'common'}</span>
            <span>updated: {formatTimestamp(entry.updatedAt)}</span>
          </div>
          {entry.note && (
            <div className="glossary-card-note" title={entry.note}>
              note: {entry.note}
            </div>
          )}
          <div className="glossary-card-actions">
            <label className="command-runtime-param">
              <span>
                <input
                  type="checkbox"
                  checked={entry.id ? selectedEntryIds.includes(entry.id) : false}
                  disabled={!entry.id}
                  onChange={() => {
                    if (!entry.id) {
                      return
                    }
                    toggleEntrySelection(entry.id)
                  }}
                />
                {' '}
                批量删除选择
              </span>
            </label>
            <button
              className="glossary-card-delete"
              disabled={!entry.id || deletingId === entry.id}
              onClick={() => {
                void handleDelete(entry)
              }}
            >
              {deletingId === entry.id ? '删除中...' : '删除'}
            </button>
          </div>
        </article>
      ))}
    </div>
  )

  return (
    <aside className="glossary-panel" role="dialog" aria-label="Glossary manager">
      <div className="glossary-panel-header">
        <div className="glossary-panel-title-wrap">
          <div className="glossary-panel-title">本地词库</div>
          <div className="glossary-panel-subtitle">单词 / 长句分开管理，支持批量删除与导入导出</div>
        </div>
        <div className="session-panel-header-actions">
          <button
            className={`glossary-panel-close${editorOpen ? ' toolbar-button-active' : ''}`}
            onClick={() => setEditorOpen((previous) => !previous)}
          >
            {editorOpen ? '退出管理' : '管理+'}
          </button>
          <button className="glossary-panel-close" onClick={onClose}>
            收起
          </button>
        </div>
      </div>

      {!editorOpen && (
        <>
          <div className="glossary-panel-toolbar">
            <input
              className="glossary-panel-search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="搜索原文 / 译文 / 备注"
            />
            <div className="glossary-panel-summary">
              共 {entries.length} 条，当前显示 {filteredEntries.length} 条
            </div>
            <button className="glossary-panel-strategy-button" onClick={onOpenTranslationStrategy}>
              翻译策略
            </button>
          </div>

          <div className="glossary-panel-list" role="list">
            {filteredEntries.length === 0 && <div className="glossary-panel-empty">没有匹配词条</div>}
            {filteredEntries.map((entry) => (
              <article className="glossary-card" key={entry.id ?? `${entry.source}-${entry.target}`} role="listitem">
                <div className="glossary-card-source" title={entry.source}>
                  {entry.source}
                </div>
                <div className="glossary-card-target" title={entry.target}>
                  {entry.target}
                </div>
                <div className="glossary-card-meta">
                  <span>match: {matchTypeLabel(entry)}</span>
                  <span>domain: {entry.domain ?? 'common'}</span>
                  <span>updated: {formatTimestamp(entry.updatedAt)}</span>
                </div>
                {entry.note && (
                  <div className="glossary-card-note" title={entry.note}>
                    note: {entry.note}
                  </div>
                )}
                <div className="glossary-card-actions">
                  <button
                    className="glossary-card-delete"
                    disabled={!entry.id || deletingId === entry.id}
                    onClick={() => {
                      void handleDelete(entry)
                    }}
                  >
                    {deletingId === entry.id ? '删除中...' : '删除'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {editorOpen && (
        <div className="command-editor-panel">
          <div className="session-editor-row session-manage-tabs">
            <button
              className={`session-action${manageView === 'wordEntries' ? ' session-action-primary' : ''}`}
              onClick={() => setManageView('wordEntries')}
            >
              单词管理
            </button>
            <button
              className={`session-action${manageView === 'sentenceEntries' ? ' session-action-primary' : ''}`}
              onClick={() => setManageView('sentenceEntries')}
            >
              长句管理
            </button>
            <button
              className={`session-action${manageView === 'bulkDeleteCategories' ? ' session-action-primary' : ''}`}
              onClick={() => setManageView('bulkDeleteCategories')}
            >
              批量删类目
            </button>
            <button
              className={`session-action${manageView === 'tools' ? ' session-action-primary' : ''}`}
              onClick={() => setManageView('tools')}
            >
              导入导出/规则
            </button>
          </div>

          {manageView === 'wordEntries' && (
            <>
              <div className="command-editor-title">单词词条管理（{wordEntries.length}）</div>
              {renderEntryList(wordEntries)}
              <div className="session-editor-row">
                <button className="session-action session-action-danger" onClick={() => void handleBatchDeleteEntries()}>
                  批量删除已选词条
                </button>
              </div>
            </>
          )}

          {manageView === 'sentenceEntries' && (
            <>
              <div className="command-editor-title">长句词条管理（{sentenceEntries.length}）</div>
              {renderEntryList(sentenceEntries)}
              <div className="session-editor-row">
                <button className="session-action session-action-danger" onClick={() => void handleBatchDeleteEntries()}>
                  批量删除已选词条
                </button>
              </div>
            </>
          )}

          {manageView === 'bulkDeleteCategories' && (
            <>
              <div className="command-editor-title">批量删除类目</div>
              <div className="command-modal-list-scroll">
                <label className="command-runtime-param">
                  <span>
                    <input
                      type="checkbox"
                      checked={selectedCategories.includes('word')}
                      onChange={() => toggleCategorySelection('word')}
                    />
                    {' '}
                    单词词条（{wordEntries.length}）
                  </span>
                </label>
                <label className="command-runtime-param">
                  <span>
                    <input
                      type="checkbox"
                      checked={selectedCategories.includes('sentence')}
                      onChange={() => toggleCategorySelection('sentence')}
                    />
                    {' '}
                    长句词条（{sentenceEntries.length}）
                  </span>
                </label>
              </div>
              <div className="session-editor-row">
                <button className="session-action session-action-danger" onClick={() => void handleBatchDeleteCategories()}>
                  删除选中类目下全部词条
                </button>
              </div>
            </>
          )}

          {manageView === 'tools' && (
            <>
              <div className="command-editor-title">批量导入导出与规则管理</div>
              <div className="session-editor-row">
                <button
                  className="session-action"
                  onClick={() => {
                    onImportGlossary()
                    setStatusText('已触发词库导入')
                  }}
                >
                  批量导入词库
                </button>
                <button
                  className="session-action"
                  onClick={() => {
                    onExportGlossary()
                    setStatusText('已触发词库导出')
                  }}
                >
                  批量导出词库
                </button>
                <button className="session-action session-action-primary" onClick={onOpenTranslationStrategy}>
                  翻译策略
                </button>
              </div>
              <div className="session-card-detail-line">
                说明：匹配规则将统一在“翻译策略”中持续扩展，后续可增加专用规则管理器。
              </div>
            </>
          )}

          <div className="session-editor-status">{statusText || ' '}</div>
        </div>
      )}

      {!editorOpen && <div className="glossary-panel-status">{statusText || ' '}</div>}
    </aside>
  )
}
