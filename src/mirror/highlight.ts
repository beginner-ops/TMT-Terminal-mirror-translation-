import type { Row } from './GridModel'
import type { SyntaxHighlightRule } from '../app/SettingsPanel'

export type HighlightPaint = {
  color: string
  styleMode: SyntaxHighlightRule['styleMode']
}

const MAX_MATCHES_PER_RULE = 200

const findAllCaseInsensitive = (source: string, query: string): Array<{ start: number; end: number }> => {
  const result: Array<{ start: number; end: number }> = []
  if (query.length === 0) {
    return result
  }

  const text = source.toLowerCase()
  const needle = query.toLowerCase()
  let fromIndex = 0
  while (result.length < MAX_MATCHES_PER_RULE) {
    const matchIndex = text.indexOf(needle, fromIndex)
    if (matchIndex < 0) {
      break
    }
    result.push({
      start: matchIndex,
      end: matchIndex + needle.length,
    })
    fromIndex = matchIndex + Math.max(1, needle.length)
  }
  return result
}

const findMatchesForRule = (text: string, rule: SyntaxHighlightRule): Array<{ start: number; end: number }> => {
  const pattern = rule.pattern.trim()
  if (pattern.length === 0) {
    return []
  }

  if (rule.matchType === 'prefix') {
    const leftTrimmed = text.trimStart()
    const leftPadding = text.length - leftTrimmed.length
    if (leftTrimmed.toLowerCase().startsWith(pattern.toLowerCase())) {
      return [{ start: leftPadding, end: leftPadding + pattern.length }]
    }
    return []
  }

  if (rule.matchType === 'regex') {
    try {
      const regex = new RegExp(pattern, 'gi')
      const result: Array<{ start: number; end: number }> = []
      let match = regex.exec(text)
      while (match && result.length < MAX_MATCHES_PER_RULE) {
        const content = match[0] ?? ''
        if (content.length === 0) {
          regex.lastIndex += 1
        } else {
          result.push({
            start: match.index,
            end: match.index + content.length,
          })
        }
        match = regex.exec(text)
      }
      return result
    } catch {
      return []
    }
  }

  return findAllCaseInsensitive(text, pattern)
}

export const buildRowColorMap = (
  row: Row,
  colCount: number,
  rules: SyntaxHighlightRule[],
  activeScope: SyntaxHighlightRule['scope'],
): Array<HighlightPaint | null> => {
  const colorByCol: Array<HighlightPaint | null> = Array.from({ length: colCount }, () => null)
  const charStartCols: number[] = []
  const charEndCols: number[] = []
  let text = ''

  row.cells.forEach((cell, col) => {
    if (cell.width === 0) {
      return
    }

    const char = cell.char.length > 0 ? cell.char : ' '
    text += char
    const endCol = Math.min(colCount, col + Math.max(1, cell.width))
    for (let index = 0; index < char.length; index += 1) {
      charStartCols.push(col)
      charEndCols.push(endCol)
    }
  })

  rules.forEach((rule) => {
    if (!rule.enabled) {
      return
    }
    if (rule.scope !== 'all' && rule.scope !== activeScope) {
      return
    }

    findMatchesForRule(text, rule).forEach(({ start, end }) => {
      if (start < 0 || end <= start || end > charEndCols.length) {
        return
      }
      const colStart = charStartCols[start]
      const colEnd = charEndCols[end - 1]
      for (let col = colStart; col < colEnd; col += 1) {
        if (colorByCol[col] === null) {
          colorByCol[col] = {
            color: rule.color,
            styleMode: rule.styleMode,
          }
        }
      }
    })
  })

  return colorByCol
}
