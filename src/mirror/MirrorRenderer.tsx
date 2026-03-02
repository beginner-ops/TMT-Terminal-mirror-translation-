import type { Screen } from './GridModel'

type MirrorRendererProps = {
  screen: Screen
  cellWidth: number
  cellHeight: number
}

export const MirrorRenderer = ({ screen, cellWidth, cellHeight }: MirrorRendererProps) => (
  <div
    className="mirror-grid"
    role="img"
    aria-label="Translated mirror terminal"
    style={{ width: `${screen.colCount * cellWidth}px` }}
  >
    {screen.rows.map((row, rowIndex) => (
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
              }}
            >
              {cell.char.length > 0 ? cell.char : ' '}
            </span>
          )
        })}
      </div>
    ))}
  </div>
)
