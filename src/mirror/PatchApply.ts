import { cloneScreen, rowToString, type Patch, type Screen } from './GridModel'
import { charCellWidth, stringCellWidth } from './CellWidth'

const clearSpan = (screen: Screen, row: number, start: number, end: number): void => {
  for (let col = start; col < end; col += 1) {
    screen.rows[row].cells[col] = {
      char: ' ',
      width: 1,
    }
  }
}

const writeIntoSpan = (screen: Screen, patch: Patch): void => {
  const rowCells = screen.rows[patch.row].cells
  const span = patch.colEnd - patch.colStart
  let col = patch.colStart

  for (const char of Array.from(patch.translatedInline)) {
    const width = Math.max(1, charCellWidth(char)) as 1 | 2
    if (col + width > patch.colStart + span) {
      break
    }

    rowCells[col] = {
      char,
      width: width as 1 | 2,
    }

    if (width === 2 && col + 1 < patch.colEnd) {
      rowCells[col + 1] = {
        char: '',
        width: 0,
      }
    }

    col += width
  }

  while (col < patch.colEnd) {
    rowCells[col] = {
      char: ' ',
      width: 1,
    }
    col += 1
  }
}

const shiftRowLeft = (screen: Screen, row: number, fromCol: number, delta: number): void => {
  if (delta <= 0) {
    return
  }
  const rowCells = screen.rows[row].cells
  const colCount = screen.colCount
  if (fromCol < 0 || fromCol >= colCount) {
    return
  }
  for (let col = fromCol; col < colCount; col += 1) {
    const target = col - delta
    if (target < 0) {
      continue
    }
    rowCells[target] = rowCells[col]
  }
  for (let col = Math.max(0, colCount - delta); col < colCount; col += 1) {
    rowCells[col] = {
      char: ' ',
      width: 1,
    }
  }
}

export const applyInlinePatches = (base: Screen, patches: Patch[]): Screen => {
  const next = cloneScreen(base)
  const orderedPatches = [...patches].sort((a, b) => {
    if (a.row !== b.row) {
      return a.row - b.row
    }

    return a.colStart - b.colStart
  })
  const rowGroups = new Map<number, Patch[]>()
  let previousRow = -1
  let consumedUntil = -1
  for (const patch of orderedPatches) {
    if (patch.row < 0 || patch.row >= next.rowCount) {
      continue
    }
    if (patch.colStart < 0 || patch.colEnd > next.colCount || patch.colEnd <= patch.colStart) {
      continue
    }
    if (patch.row !== previousRow) {
      previousRow = patch.row
      consumedUntil = -1
    }
    if (patch.colStart < consumedUntil) {
      continue
    }
    consumedUntil = patch.colEnd
    const list = rowGroups.get(patch.row) ?? []
    list.push(patch)
    rowGroups.set(patch.row, list)
  }

  for (const [row, rowPatches] of rowGroups) {
    const descPatches = [...rowPatches].sort((a, b) => b.colStart - a.colStart)
    for (const patch of descPatches) {
      clearSpan(next, row, patch.colStart, patch.colEnd)
      writeIntoSpan(next, patch)
      const span = patch.colEnd - patch.colStart
      const translatedWidth = stringCellWidth(patch.translatedInline)
      const trailingDelta = Math.max(0, span - translatedWidth)
      if (trailingDelta > 0) {
        shiftRowLeft(next, row, patch.colEnd, trailingDelta)
      }
    }
  }

  for (const row of next.rows) {
    row.text = rowToString(row)
  }

  return next
}
