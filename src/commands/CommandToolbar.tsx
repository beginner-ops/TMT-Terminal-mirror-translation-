import { memo, useState, type CSSProperties } from 'react'
import type { CommandContext } from './types'

type QuickSlot = {
  id: string
  label: string
  command: string
  risk: 'safe' | 'caution' | 'destructive'
} | null

type CommandToolbarProps = {
  contexts: CommandContext[]
  activeContextId: string
  autoDetectEnabled: boolean
  slots: QuickSlot[]
  onContextChange: (contextId: string) => void
  onToggleAutoDetect: (enabled: boolean) => void
  onAssignSlot: (slotIndex: number, payload: Exclude<QuickSlot, null>) => void
  onMoveSlot: (sourceIndex: number, targetIndex: number) => void
  onRunSlot: (slotIndex: number) => void
  onClearSlot: (slotIndex: number) => void
}

const DRAG_MIME = 'application/x-termbridge-command'
const SLOT_DRAG_MIME = 'application/x-termbridge-slot'

export const CommandToolbar = memo(
  ({
    contexts,
    activeContextId,
    autoDetectEnabled,
    slots,
    onContextChange,
    onToggleAutoDetect,
    onAssignSlot,
    onMoveSlot,
    onRunSlot,
    onClearSlot,
  }: CommandToolbarProps) => {
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
    const dockStyle = { '--dock-columns': `${Math.max(1, slots.length)}` } as CSSProperties

    return (
      <footer className="command-toolbar command-toolbar-dock" role="toolbar" aria-label="场景与快捷命令栏">
        <div className="command-toolbar-left">
          <label className="command-context-label" htmlFor="command-context-select">
            场景
          </label>
          <select
            id="command-context-select"
            className="command-context-select"
            value={activeContextId}
            onChange={(event) => onContextChange(event.target.value)}
          >
            {contexts.map((context) => (
              <option key={context.id} value={context.id}>
                {context.label}
              </option>
            ))}
          </select>
          <label className="command-auto-detect">
            <input
              type="checkbox"
              checked={autoDetectEnabled}
              onChange={(event) => onToggleAutoDetect(event.target.checked)}
            />
            自动识别
          </label>
        </div>

        <div className="command-toolbar-dock-grid" role="list" aria-label="快捷命令空位" style={dockStyle}>
          {slots.map((slot, index) => (
            <div
              key={`slot-${index}`}
              className={`command-dock-slot${dragOverIndex === index ? ' command-dock-slot-over' : ''}${
                slot ? ' command-dock-slot-filled' : ''
              }`}
              draggable={Boolean(slot)}
              onDragStart={(event) => {
                if (!slot) {
                  return
                }
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData(
                  SLOT_DRAG_MIME,
                  JSON.stringify({
                    sourceIndex: index,
                  }),
                )
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setDragOverIndex(index)
              }}
              onDragLeave={() => {
                setDragOverIndex((prev) => (prev === index ? null : prev))
              }}
              onDrop={(event) => {
                event.preventDefault()
                setDragOverIndex(null)

                const rawSlotDrag = event.dataTransfer.getData(SLOT_DRAG_MIME)
                if (rawSlotDrag) {
                  try {
                    const parsed = JSON.parse(rawSlotDrag) as { sourceIndex?: number }
                    if (typeof parsed.sourceIndex === 'number' && parsed.sourceIndex !== index) {
                      onMoveSlot(parsed.sourceIndex, index)
                    }
                  } catch {
                    // ignore invalid slot drag payload
                  }
                  return
                }

                const raw = event.dataTransfer.getData(DRAG_MIME)
                if (!raw) {
                  return
                }

                try {
                  const parsed = JSON.parse(raw) as {
                    label?: string
                    command?: string
                    risk?: 'safe' | 'caution' | 'destructive'
                  }

                  if (!parsed.command || !parsed.label) {
                    return
                  }

                  onAssignSlot(index, {
                    id: `slot-${index}-${Date.now()}`,
                    label: parsed.label,
                    command: parsed.command,
                    risk: parsed.risk ?? 'safe',
                  })
                } catch {
                  // ignore invalid drag payload
                }
              }}
            >
              <div className="command-dock-slot-index">{index + 1}</div>
              {slot ? (
                <div className="command-dock-run-wrap">
                  <button
                    className={`command-dock-run command-dock-run-${slot.risk}`}
                    onClick={() => {
                      onRunSlot(index)
                    }}
                    title={slot.command}
                  >
                    {slot.label}
                  </button>
                  <button
                    className="command-dock-clear"
                    onClick={(event) => {
                      event.stopPropagation()
                      onClearSlot(index)
                    }}
                    title="清空空位"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div className="command-dock-placeholder">从命令检索拖拽到此处</div>
              )}
            </div>
          ))}
        </div>
      </footer>
    )
  },
)
