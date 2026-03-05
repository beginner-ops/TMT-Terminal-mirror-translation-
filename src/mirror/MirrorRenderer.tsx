import type { Screen } from './GridModel'
import type { SyntaxHighlightRule } from '../app/SettingsPanel'
import { buildRowColorMap } from './highlight'

type MirrorRendererProps = {
  screen: Screen
  cellWidth: number
  cellHeight: number
  highlightRules: SyntaxHighlightRule[]
  activeScope: SyntaxHighlightRule['scope']
}

export const MirrorRenderer = ({ screen, cellWidth, cellHeight, highlightRules, activeScope }: MirrorRendererProps) => (
  <div
    className="mirror-grid"
    role="img"
    aria-label="Translated mirror terminal"
    style={{ width: `${screen.colCount * cellWidth}px` }}
  >
    {screen.rows.map((row, rowIndex) => {
      const colorByCol = buildRowColorMap(row, screen.colCount, highlightRules, activeScope)
      return (
        <div
          key={rowIndex}
          className="mirror-row"
          data-row={rowIndex}
          style={{
            gridTemplateColumns: `repeat(${screen.colCount}, ${cellWidth}px)`,
            height: `${cellHeight}px`,
            minHeight: `${cellHeight}px`,
            lineHeight: `${cellHeight}px`,
          }}
        >
          {row.cells.map((cell, colIndex) => {
            if (cell.width === 0) {
              return null
            }

            return (
              <span
                key={colIndex}
                className="mirror-cell"
                style={{
                  gridColumn: `${colIndex + 1} / span ${cell.width}`,
                  height: `${cellHeight}px`,
                  minHeight: `${cellHeight}px`,
                  lineHeight: `${cellHeight}px`,
                  color: colorByCol[colIndex]?.styleMode === 'foreground' ? colorByCol[colIndex]?.color : undefined,
                  backgroundColor: colorByCol[colIndex]?.styleMode === 'background' ? `${colorByCol[colIndex]?.color}33` : undefined,
                }}
              >
                {cell.char.length > 0 ? cell.char : ' '}
              </span>
            )
          })}
        </div>
      )
    })}
  </div>
)
