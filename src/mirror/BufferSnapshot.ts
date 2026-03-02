import { type Terminal } from '@xterm/xterm'
import { createEmptyScreen, type Screen } from './GridModel'

type BufferCellLike = {
  getChars: () => string
  getWidth: () => number
}

type BufferLineLike = {
  getCell: (column: number) => BufferCellLike | undefined
  translateToString: (trimRight?: boolean, startColumn?: number, endColumn?: number) => string
}

export type SnapshotMeta = {
  scanText: string
  charStartCols: number[]
  charEndCols: number[]
}

export type ScanSnapshotRow = SnapshotMeta & {
  absoluteRow: number
  visibleRow: number | null
}

export type BufferSnapshot = {
  screen: Screen
  metaByRow: SnapshotMeta[]
  scanRows: ScanSnapshotRow[]
  viewportY: number
  maxViewportY: number
}

const SCAN_CONTEXT_ROWS = 20

type ActiveBufferLike = {
  baseY: number
  length?: number
  getLine: (lineIndex: number) => BufferLineLike | undefined
}

const emptySnapshotMeta = (): SnapshotMeta => ({
  scanText: '',
  charStartCols: [],
  charEndCols: [],
})

const mapCodeUnitColumns = (
  line: BufferLineLike,
  cols: number,
  sourceText: string,
): { charStartCols: number[]; charEndCols: number[] } => {
  const charStartCols: number[] = []
  const charEndCols: number[] = []

  if (sourceText.length === 0) {
    return {
      charStartCols,
      charEndCols,
    }
  }

  let emittedCodeUnits = 0
  for (let col = 0; col < cols; col += 1) {
    if (emittedCodeUnits >= sourceText.length) {
      break
    }

    const cell = line.getCell(col)
    if (!cell) {
      continue
    }

    const width = cell.getWidth()
    if (width === 0) {
      continue
    }

    const chars = cell.getChars()
    const visible = chars.length > 0 ? chars : ' '
    const endCol = Math.min(cols, col + Math.max(1, width))

    for (const visibleChar of Array.from(visible)) {
      if (emittedCodeUnits >= sourceText.length) {
        break
      }

      const codeUnitLength = visibleChar.length
      for (let index = 0; index < codeUnitLength; index += 1) {
        const targetIndex = emittedCodeUnits + index
        if (targetIndex >= sourceText.length) {
          break
        }

        charStartCols[targetIndex] = col
        charEndCols[targetIndex] = endCol
      }
      emittedCodeUnits += codeUnitLength
    }
  }

  return {
    charStartCols,
    charEndCols,
  }
}

const snapshotLine = (
  line: BufferLineLike | undefined,
  cols: number,
): { displayText: string; meta: SnapshotMeta } => {
  if (!line) {
    return {
      displayText: ''.padEnd(cols, ' '),
      meta: {
        scanText: '',
        charStartCols: [],
        charEndCols: [],
      },
    }
  }

  const displayText = line.translateToString(false).padEnd(cols, ' ').slice(0, cols)
  const scanText = line.translateToString(true)
  const { charStartCols, charEndCols } = mapCodeUnitColumns(line, cols, scanText)

  return {
    displayText,
    meta: {
      scanText,
      charStartCols,
      charEndCols,
    },
  }
}

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min
  }

  if (value > max) {
    return max
  }

  return value
}

export const buildBufferSnapshot = (term: Terminal, requestedViewportY?: number): BufferSnapshot => {
  const rows = term.rows
  const cols = term.cols
  const activeBuffer = term.buffer.active as ActiveBufferLike
  const maxViewportY = activeBuffer.baseY
  const maxLineIndexFromLength =
    typeof activeBuffer.length === 'number' && activeBuffer.length > 0
      ? activeBuffer.length - 1
      : maxViewportY + rows - 1
  const maxLineIndex = Math.max(maxViewportY + rows - 1, maxLineIndexFromLength)
  const viewportY = clamp(
    Math.round(requestedViewportY ?? term.buffer.active.viewportY),
    0,
    maxViewportY,
  )
  const screen = createEmptyScreen(rows, cols)
  const metaByRow: SnapshotMeta[] = Array.from({ length: rows }, () => emptySnapshotMeta())
  const scanRows: ScanSnapshotRow[] = []
  const visibleStart = viewportY
  const visibleEnd = viewportY + rows - 1
  const scanStart = Math.max(0, visibleStart - SCAN_CONTEXT_ROWS)
  const scanEnd = Math.min(maxLineIndex, visibleEnd + SCAN_CONTEXT_ROWS)

  for (let lineIndex = scanStart; lineIndex <= scanEnd; lineIndex += 1) {
    const line = activeBuffer.getLine(lineIndex) as BufferLineLike | undefined
    const { displayText, meta } = snapshotLine(line, cols)
    const visibleRow = lineIndex >= visibleStart && lineIndex <= visibleEnd ? lineIndex - visibleStart : null

    scanRows.push({
      absoluteRow: lineIndex,
      visibleRow,
      ...meta,
    })

    if (visibleRow === null) {
      continue
    }

    metaByRow[visibleRow] = meta
    const nextCells = screen.rows[visibleRow].cells
    screen.rows[visibleRow].text = displayText

    if (!line) {
      continue
    }

    for (let col = 0; col < cols; col += 1) {
      const cell = line.getCell(col)
      if (!cell) {
        continue
      }

      const width = cell.getWidth()
      const chars = cell.getChars()
      const normalizedWidth: 0 | 1 | 2 = width === 2 ? 2 : width === 0 ? 0 : 1
      nextCells[col] = {
        char: normalizedWidth === 0 ? '' : chars.length > 0 ? chars : ' ',
        width: normalizedWidth,
      }
    }
  }

  return {
    screen,
    metaByRow,
    scanRows,
    viewportY,
    maxViewportY,
  }
}
