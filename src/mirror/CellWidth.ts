const isControlCodePoint = (codePoint: number): boolean => {
  if (codePoint === 0) {
    return true
  }

  if (codePoint < 32) {
    return true
  }

  return codePoint >= 0x7f && codePoint <= 0x9f
}

const isCombiningCodePoint = (codePoint: number): boolean => {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  )
}

const isWideCodePoint = (codePoint: number): boolean => {
  if (codePoint < 0x1100) {
    return false
  }

  return (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )
}

export const charCellWidth = (char: string): 0 | 1 | 2 => {
  const codePoint = char.codePointAt(0)
  if (codePoint === undefined) {
    return 1
  }

  if (isControlCodePoint(codePoint) || isCombiningCodePoint(codePoint)) {
    return 0
  }

  if (isWideCodePoint(codePoint)) {
    return 2
  }

  return 1
}

export const stringCellWidth = (text: string): number => {
  let width = 0

  for (const char of Array.from(text)) {
    width += charCellWidth(char)
  }

  return width
}
