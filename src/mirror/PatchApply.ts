import { cloneScreen, rowToString, type Patch, type Screen } from './GridModel'
import { charCellWidth } from './CellWidth'

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

export const applyInlinePatches = (base: Screen, patches: Patch[]): Screen => {
  const next = cloneScreen(base)
  const orderedPatches = [...patches].sort((a, b) => {
    if (a.row !== b.row) {
      return a.row - b.row
    }

    return a.colStart - b.colStart
  })
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

    clearSpan(next, patch.row, patch.colStart, patch.colEnd)
    writeIntoSpan(next, patch)
  }

  for (const row of next.rows) {
    row.text = rowToString(row)
  }

  return next
}
