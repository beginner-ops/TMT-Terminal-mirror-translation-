import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { TERMINAL_DISPLAY } from './displayConfig'

export type XtermBundle = {
  term: Terminal
  fitAddon: FitAddon
}

type ThemeOverrides = {
  background?: string
  foreground?: string
}

const isHexColor = (value: string): boolean => /^#[0-9a-fA-F]{6}$/.test(value) || /^#[0-9a-fA-F]{3}$/.test(value)

const normalizeThemeColor = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined
  }
  const trimmed = value.trim()
  if (!isHexColor(trimmed)) {
    return undefined
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const chars = trimmed.slice(1).split('')
    return `#${chars.map((char) => `${char}${char}`).join('').toLowerCase()}`
  }
  return trimmed.toLowerCase()
}

export const resolveXtermTheme = (mode: 'dark' | 'light', overrides?: ThemeOverrides): ITheme => {
  const baseTheme: ITheme = mode === 'light'
    ? {
      background: '#ffffff',
      foreground: '#0f172a',
      cursor: '#2563eb',
      selectionBackground: '#bfdbfe',
      black: '#1e293b',
      red: '#b91c1c',
      green: '#15803d',
      yellow: '#a16207',
      blue: '#1d4ed8',
      magenta: '#7e22ce',
      cyan: '#0f766e',
      white: '#334155',
    }
    : {
    background: '#111827',
    foreground: '#e5e7eb',
    cursor: '#22c55e',
    selectionBackground: '#334155',
    black: '#111827',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#f59e0b',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#e5e7eb',
  }

  const background = normalizeThemeColor(overrides?.background)
  const foreground = normalizeThemeColor(overrides?.foreground)
  if (background) {
    baseTheme.background = background
  }
  if (foreground) {
    baseTheme.foreground = foreground
  }
  return baseTheme
}

export const createXterm = (
  container: HTMLDivElement,
  mode: 'dark' | 'light' = 'dark',
  overrides?: ThemeOverrides,
): XtermBundle => {
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: TERMINAL_DISPLAY.fontFamily,
    fontSize: TERMINAL_DISPLAY.fontSize,
    lineHeight: TERMINAL_DISPLAY.lineHeight,
    letterSpacing: TERMINAL_DISPLAY.letterSpacing,
    convertEol: false,
    scrollback: 2000,
    allowTransparency: false,
    theme: resolveXtermTheme(mode, overrides),
  })

  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(container)
  fitAddon.fit()

  return { term, fitAddon }
}
