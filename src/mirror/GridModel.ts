export type Cell = {
  char: string
  width: 0 | 1 | 2
}

export type Row = {
  cells: Cell[]
  text: string
}

export type Screen = {
  rows: Row[]
  rowCount: number
  colCount: number
}

export type Marker = {
  row: number
  col: number
  fullText: string
  source: string
}

export type Patch = {
  row: number
  colStart: number
  colEnd: number
  translatedInline: string
  translatedFull: string
  source: string
}

export type DebugStats = {
  scanRuns: number
  candidatesFound: number
  matchedPhrasesCount: number
  glossaryHits: number
  rulesHits: number
  translatedCount: number
  markersRendered: number
  topSkipReasons: string[]
}

export const createEmptyScreen = (rows: number, cols: number): Screen => ({
  rowCount: rows,
  colCount: cols,
  rows: Array.from({ length: rows }, () => ({
    text: ''.padEnd(cols, ' '),
    cells: Array.from({ length: cols }, () => ({ char: ' ', width: 1 as const })),
  })),
})

export const cloneScreen = (screen: Screen): Screen => ({
  rowCount: screen.rowCount,
  colCount: screen.colCount,
  rows: screen.rows.map((row) => ({
    text: row.text,
    cells: row.cells.map((cell) => ({ ...cell })),
  })),
})

export const rowToString = (row: Row): string => {
  let output = ''
  for (const cell of row.cells) {
    if (cell.width === 0) {
      continue
    }

    output += cell.char.length > 0 ? cell.char : ' '
  }

  return output
}
