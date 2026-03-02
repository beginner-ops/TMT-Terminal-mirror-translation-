import type { CommandButton, CommandConfig, CommandContext } from './types'

export const sanitizeContextId = (value: string): string => {
  const normalized = value.trim().toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  return normalized.length > 0 ? normalized : 'shell'
}

const normalizeDetectHints = (hints: string[]): string[] => {
  const deduped = new Set<string>()
  for (const hint of hints) {
    const normalized = hint.trim().toLocaleLowerCase()
    if (normalized.length < 2) {
      continue
    }

    deduped.add(normalized)
  }

  return Array.from(deduped)
}

const defaultDetectHintsByContextId = (contextId: string): string[] => {
  if (contextId === 'shell') {
    return ['zsh', 'bash', 'shell', '$ ', '% ', '# ', 'pwd', 'ls -']
  }

  if (contextId === 'opencode') {
    return ['opencode', 'ask anything', 'tip press', '/plan', '/task', '/help']
  }

  if (contextId === 'codex') {
    return ['codex', 'gpt-5.3-codex', '/apply_patch', '/check', '/help']
  }

  return []
}

const normalizeContexts = (contexts: CommandContext[]): CommandContext[] => {
  const deduped = new Map<string, CommandContext>()

  for (const context of contexts) {
    const id = sanitizeContextId(context.id)
    const label = context.label.trim()
    if (label.length === 0) {
      continue
    }

    const detectHints = normalizeDetectHints([
      ...defaultDetectHintsByContextId(id),
      ...(Array.isArray(context.detectHints) ? context.detectHints : []),
    ])

    deduped.set(id, { id, label, detectHints })
  }

  if (!deduped.has('shell')) {
    deduped.set('shell', {
      id: 'shell',
      label: 'Shell',
      detectHints: defaultDetectHintsByContextId('shell'),
    })
  }

  return Array.from(deduped.values())
}

const sortButtons = (buttons: CommandButton[]): CommandButton[] => {
  return [...buttons].sort((a, b) => {
    if (a.contextId !== b.contextId) {
      return a.contextId.localeCompare(b.contextId)
    }

    if (a.order !== b.order) {
      return a.order - b.order
    }

    return a.labelZh.localeCompare(b.labelZh)
  })
}

const normalizeButtons = (buttons: CommandButton[], contexts: CommandContext[]): CommandButton[] => {
  const contextIds = new Set(contexts.map((context) => context.id))
  const dedupedIds = new Set<string>()
  const grouped = new Map<string, CommandButton[]>()

  for (const button of buttons) {
    const contextId = sanitizeContextId(button.contextId)
    if (!contextIds.has(contextId)) {
      continue
    }

    const labelZh = button.labelZh.trim()
    if (labelZh.length === 0 || button.payload.length === 0) {
      continue
    }

    const idBase = button.id.trim().length > 0 ? button.id.trim() : `${contextId}-${Date.now()}`
    let id = idBase
    let suffix = 1
    while (dedupedIds.has(id)) {
      id = `${idBase}-${suffix}`
      suffix += 1
    }
    dedupedIds.add(id)

    const nextButton: CommandButton = {
      id,
      labelZh,
      actionType: button.actionType,
      payload: button.payload,
      contextId,
      risk: button.risk,
      order: Number.isFinite(button.order) ? Math.max(1, Math.floor(button.order)) : 1,
    }

    const bucket = grouped.get(contextId)
    if (bucket) {
      bucket.push(nextButton)
      continue
    }

    grouped.set(contextId, [nextButton])
  }

  const normalized: CommandButton[] = []
  for (const context of contexts) {
    const bucket = grouped.get(context.id)
    if (!bucket || bucket.length === 0) {
      continue
    }

    bucket
      .sort((a, b) => {
        if (a.order !== b.order) {
          return a.order - b.order
        }

        return a.labelZh.localeCompare(b.labelZh)
      })
      .forEach((button, index) => {
        normalized.push({
          ...button,
          contextId: context.id,
          order: index + 1,
        })
      })
  }

  return normalized
}

export const normalizeCommandConfig = (
  raw: Pick<CommandConfig, 'version' | 'defaultContextId' | 'contexts' | 'buttons'>,
): CommandConfig => {
  const contexts = normalizeContexts(raw.contexts)
  const buttons = normalizeButtons(raw.buttons, contexts)
  const defaultContextCandidate = sanitizeContextId(raw.defaultContextId)
  const defaultContextId = contexts.some((context) => context.id === defaultContextCandidate)
    ? defaultContextCandidate
    : 'shell'

  return {
    version: 1,
    defaultContextId,
    contexts,
    buttons,
  }
}

export const sortButtonsByContext = (buttons: CommandButton[]): CommandButton[] => sortButtons(buttons)

export const orderedButtonsForContext = (
  buttons: CommandButton[],
  contextId: string,
  searchText: string,
): CommandButton[] => {
  const normalizedSearch = searchText.trim()
  return buttons
    .filter((button) => button.contextId === contextId)
    .filter((button) => (normalizedSearch.length === 0 ? true : button.labelZh.includes(normalizedSearch)))
    .sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order
      }

      return a.labelZh.localeCompare(b.labelZh)
    })
}

export const moveButtonToOrder = (
  buttons: CommandButton[],
  buttonId: string,
  contextId: string,
  targetOrder: number,
): CommandButton[] => {
  const contextButtons = buttons
    .filter((button) => button.contextId === contextId)
    .sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order
      }

      return a.labelZh.localeCompare(b.labelZh)
    })

  const currentIndex = contextButtons.findIndex((button) => button.id === buttonId)
  if (currentIndex < 0) {
    return buttons
  }

  const movedButton = contextButtons[currentIndex]
  const rest = contextButtons.filter((button) => button.id !== buttonId)
  const nextIndex = Math.max(0, Math.min(rest.length, targetOrder - 1))
  rest.splice(nextIndex, 0, movedButton)

  const remapped = new Map<string, CommandButton>()
  rest.forEach((button, index) => {
    remapped.set(button.id, {
      ...button,
      order: index + 1,
    })
  })

  return buttons.map((button) => remapped.get(button.id) ?? button)
}

export const createButtonId = (contextId: string): string => {
  return `${contextId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}
