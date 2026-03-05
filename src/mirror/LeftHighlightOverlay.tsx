import type { SyntaxHighlightRule } from '../app/SettingsPanel'
import type { Screen } from './GridModel'
import { buildRowColorMap } from './highlight'

type LeftHighlightOverlayProps = {
  screen: Screen
  cellWidth: number
  cellHeight: number
  rules: SyntaxHighlightRule[]
  activeScope: SyntaxHighlightRule['scope']
  opacity: number
}

const hexToRgba = (hex: string, alpha: number): string => {
  const normalized = hex.trim()
  const parsed = normalized.length === 4
    ? normalized
      .slice(1)
      .split('')
      .map((char) => `${char}${char}`)
      .join('')
    : normalized.slice(1)
  if (!/^[0-9a-fA-F]{6}$/.test(parsed)) {
    return `rgba(245, 158, 11, ${alpha})`
  }
  const r = Number.parseInt(parsed.slice(0, 2), 16)
  const g = Number.parseInt(parsed.slice(2, 4), 16)
  const b = Number.parseInt(parsed.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const LeftHighlightOverlay = ({
  screen,
  cellWidth,
  cellHeight,
  rules,
  activeScope,
  opacity,
}: LeftHighlightOverlayProps) => {
  const hasEnabledRules = rules.some((rule) => rule.enabled && (rule.scope === 'all' || rule.scope === activeScope))
  if (!hasEnabledRules) {
    return null
  }

  return (
    <div className="left-highlight-overlay" aria-hidden="true">
      <div className="left-highlight-grid" style={{ width: `${screen.colCount * cellWidth}px` }}>
        {screen.rows.map((row, rowIndex) => {
          const colorByCol = buildRowColorMap(row, screen.colCount, rules, activeScope)
          return (
            <div
              key={rowIndex}
              className="left-highlight-row"
              style={{
                gridTemplateColumns: `repeat(${screen.colCount}, ${cellWidth}px)`,
                height: `${cellHeight}px`,
                minHeight: `${cellHeight}px`,
              }}
            >
              {row.cells.map((cell, colIndex) => {
                if (cell.width === 0) {
                  return null
                }
                const paint = colorByCol[colIndex]
                return (
                  <span
                    key={colIndex}
                    className="left-highlight-cell"
                    style={{
                      gridColumn: `${colIndex + 1} / span ${cell.width}`,
                      height: `${cellHeight}px`,
                      minHeight: `${cellHeight}px`,
                      background: paint && paint.styleMode === 'background' ? hexToRgba(paint.color, opacity) : 'transparent',
                      boxShadow: paint && paint.styleMode === 'foreground' ? `inset 0 -2px 0 0 ${hexToRgba(paint.color, Math.min(0.9, opacity + 0.22))}` : 'none',
                    }}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
