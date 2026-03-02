import { useMemo, useState } from 'react'
import type { GlossaryEntry } from '../mirror/GlossaryTypes'

type GlossaryManagerModalProps = {
  isOpen: boolean
  entries: GlossaryEntry[]
  onDeleteEntry: (entry: GlossaryEntry) => Promise<boolean> | boolean
  onClose: () => void
  onOpenTranslationStrategy: () => void
}

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

export const GlossaryManagerModal = ({
  isOpen,
  entries,
  onDeleteEntry,
  onClose,
  onOpenTranslationStrategy,
}: GlossaryManagerModalProps) => {
  const [searchText, setSearchText] = useState('')
  const [statusText, setStatusText] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const filteredEntries = useMemo(() => {
    const normalized = searchText.trim().toLocaleLowerCase()
    const sorted = [...entries].sort((a, b) => {
      const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0
      const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0
      if (aTime !== bTime) {
        return bTime - aTime
      }

      return a.source.localeCompare(b.source)
    })

    if (normalized.length === 0) {
      return sorted
    }

    return sorted.filter((entry) => {
      const source = entry.source.toLocaleLowerCase()
      const target = entry.target.toLocaleLowerCase()
      const note = (entry.note ?? '').toLocaleLowerCase()
      return source.includes(normalized) || target.includes(normalized) || note.includes(normalized)
    })
  }, [entries, searchText])

  if (!isOpen) {
    return null
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

  return (
    <aside className="glossary-panel" role="dialog" aria-label="Glossary manager">
      <div className="glossary-panel-header">
        <div className="glossary-panel-title-wrap">
          <div className="glossary-panel-title">本地词库</div>
          <div className="glossary-panel-subtitle">右侧窗口内管理，不遮挡主布局</div>
        </div>
        <button className="glossary-panel-close" onClick={onClose}>
          收起
        </button>
      </div>

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

      <div className="glossary-panel-status">{statusText || ' '}</div>
    </aside>
  )
}
