export type CommandActionType = 'sendText' | 'sendKey' | 'sendAnsi'
export type CommandRisk = 'safe' | 'caution' | 'destructive'

export type CommandContext = {
  id: string
  label: string
  detectHints: string[]
}

export type CommandButton = {
  id: string
  labelZh: string
  actionType: CommandActionType
  payload: string
  contextId: string
  risk: CommandRisk
  order: number
}

export type CommandConfig = {
  version: number
  defaultContextId: string
  contexts: CommandContext[]
  buttons: CommandButton[]
}

export type CommandConfigPayload = {
  path: string
  config: CommandConfig
}
