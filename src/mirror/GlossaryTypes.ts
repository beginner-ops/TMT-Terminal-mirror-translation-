export type GlossaryMatchType = 'exact' | 'caseInsensitive' | 'pattern'
export type GlossaryDomain = 'common' | 'network-cisco' | 'network-huawei' | 'network-h3c' | 'network-ruijie'

export type GlossaryEntry = {
  id?: string
  source: string
  target: string
  matchType?: GlossaryMatchType
  caseInsensitive?: boolean
  note?: string
  domain?: GlossaryDomain
  createdAt?: string
  updatedAt?: string
  uiOnly?: boolean
  wholeWord?: boolean
}

export type GlossaryEntryUpsertInput = {
  id?: string
  source: string
  target: string
  matchType?: GlossaryMatchType
  caseInsensitive?: boolean
  note?: string
  domain?: GlossaryDomain
  uiOnly?: boolean
  wholeWord?: boolean
}

export type GlossaryPayload = {
  path: string
  entries: GlossaryEntry[]
}
