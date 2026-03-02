import type { CommandActionType } from './types'

const KEY_PAYLOAD_MAP: Record<string, string> = {
  Enter: '\r',
  Esc: '\u001b',
  Escape: '\u001b',
  Tab: '\t',
  Backspace: '\u007f',
  Delete: '\u001b[3~',
  Up: '\u001b[A',
  Down: '\u001b[B',
  Left: '\u001b[D',
  Right: '\u001b[C',
  Home: '\u001b[H',
  End: '\u001b[F',
  PageUp: '\u001b[5~',
  PageDown: '\u001b[6~',
  'Ctrl+C': '\u0003',
  'Ctrl+D': '\u0004',
  'Ctrl+L': '\u000c',
  'Ctrl+Z': '\u001a',
}

const decodeEscapes = (payload: string): string => {
  return payload
    .replace(/\\x([0-9a-fA-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\e/g, '\u001b')
}

export const resolveActionPayload = (actionType: CommandActionType, payload: string): string => {
  if (actionType === 'sendKey') {
    const trimmed = payload.trim()
    return KEY_PAYLOAD_MAP[trimmed] ?? ''
  }

  return decodeEscapes(payload)
}
