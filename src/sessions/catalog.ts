export type SshHostKeyMode = 'ask' | 'loose'
export type SessionProtocol = 'ssh' | 'telnet' | 'raw'
export type SshAuthMode = 'system'
export type LocalPackVendor = 'cisco' | 'huawei' | 'h3c' | 'ruijie'

export type SessionGroup = {
  id: string
  label: string
}

export type SessionTagGroup = {
  id: string
  label: string
  sessionIds: string[]
  updatedAt: string
}

export type LocalPortVendorPlan = Record<LocalPackVendor, number>

export type LocalPortPackConfig = {
  id: string
  host: string
  startPort: number
  count: number
  protocol: Extract<SessionProtocol, 'telnet' | 'raw' | 'ssh'>
  vendorPlan: LocalPortVendorPlan
  updatedAt: string
}

export type SessionEntry = {
  id: string
  name: string
  groupId: string
  protocol: SessionProtocol
  host: string
  port: number
  user?: string
  authMode?: SshAuthMode
  identityFile?: string
  hostKeyMode?: SshHostKeyMode
  packId?: string
  packVendor?: LocalPackVendor
  packIndex?: number
  updatedAt: string
}

export type SessionCatalogConfig = {
  version: number
  groups: SessionGroup[]
  sessions: SessionEntry[]
  localPortPacks: LocalPortPackConfig[]
  tagGroups: SessionTagGroup[]
}

const defaultGroups: SessionGroup[] = [
  { id: 'linux', label: 'Linux' },
  { id: 'network', label: 'Network' },
]

export const VENDOR_GROUP_DEFS: Array<{ vendor: LocalPackVendor; groupId: string; label: string }> = [
  { vendor: 'cisco', groupId: 'cisco', label: '思科' },
  { vendor: 'huawei', groupId: 'huawei', label: '华为' },
  { vendor: 'h3c', groupId: 'h3c', label: '华三' },
  { vendor: 'ruijie', groupId: 'ruijie', label: '锐捷' },
]

export const DEFAULT_LOCAL_VENDOR_PLAN: LocalPortVendorPlan = {
  cisco: 0,
  huawei: 20,
  h3c: 0,
  ruijie: 0,
}

export const DEFAULT_SESSION_CATALOG_CONFIG: SessionCatalogConfig = {
  version: 3,
  groups: defaultGroups,
  sessions: [],
  localPortPacks: [],
  tagGroups: [],
}

export const createSessionEntryId = (): string => {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export const createLocalPackId = (): string => {
  return `local-pack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export const createSessionTagGroupId = (): string => {
  return `tag-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const normalizeGroupId = (input: string): string => {
  const raw = input.trim().toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  return raw.length > 0 ? raw : 'custom'
}

export const createGroupId = (label: string, existingIds: Set<string>): string => {
  const base = normalizeGroupId(label)
  let candidate = base
  let suffix = 1
  while (existingIds.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

const normalizeGroup = (input: unknown, index: number): SessionGroup | null => {
  if (!input || typeof input !== 'object') {
    return null
  }

  const candidate = input as Partial<SessionGroup>
  const label = typeof candidate.label === 'string' ? candidate.label.trim() : ''
  if (label.length === 0) {
    return null
  }

  const id = typeof candidate.id === 'string' && candidate.id.trim().length > 0 ? candidate.id.trim() : `group-${index}`
  return { id, label }
}

const normalizeProtocol = (value: unknown): SessionProtocol => {
  if (value === 'telnet' || value === 'raw' || value === 'ssh') {
    return value
  }
  return 'ssh'
}

const normalizeVendor = (value: unknown): LocalPackVendor | null => {
  if (value === 'cisco' || value === 'huawei' || value === 'h3c' || value === 'ruijie') {
    return value
  }
  return null
}

const normalizeVendorPlan = (value: unknown, fallbackCount = 20): LocalPortVendorPlan => {
  const input = value && typeof value === 'object' ? (value as Partial<Record<LocalPackVendor, unknown>>) : {}
  const raw: LocalPortVendorPlan = {
    cisco: typeof input.cisco === 'number' && Number.isFinite(input.cisco) ? Math.max(0, Math.floor(input.cisco)) : 0,
    huawei: typeof input.huawei === 'number' && Number.isFinite(input.huawei) ? Math.max(0, Math.floor(input.huawei)) : 0,
    h3c: typeof input.h3c === 'number' && Number.isFinite(input.h3c) ? Math.max(0, Math.floor(input.h3c)) : 0,
    ruijie: typeof input.ruijie === 'number' && Number.isFinite(input.ruijie) ? Math.max(0, Math.floor(input.ruijie)) : 0,
  }
  const sum = raw.cisco + raw.huawei + raw.h3c + raw.ruijie
  if (sum > 0) {
    return raw
  }
  return {
    cisco: 0,
    huawei: Math.max(0, Math.floor(fallbackCount)),
    h3c: 0,
    ruijie: 0,
  }
}

const normalizeSession = (input: unknown, groups: SessionGroup[], index: number): SessionEntry | null => {
  if (!input || typeof input !== 'object') {
    return null
  }

  const candidate = input as Partial<SessionEntry>
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  const host = typeof candidate.host === 'string' ? candidate.host.trim() : ''
  if (name.length === 0 || host.length === 0) {
    return null
  }

  const protocol = normalizeProtocol(candidate.protocol)
  const user = typeof candidate.user === 'string' ? candidate.user.trim() : ''
  if (protocol === 'ssh' && user.length === 0) {
    return null
  }

  const port = typeof candidate.port === 'number' && Number.isFinite(candidate.port) ? Math.round(candidate.port) : 22
  const safePort = Math.max(1, Math.min(65535, port))
  const groupId = typeof candidate.groupId === 'string' ? candidate.groupId : groups[0]?.id ?? 'linux'
  const hasGroup = groups.some((group) => group.id === groupId)
  const safeGroupId = hasGroup ? groupId : groups[0]?.id ?? 'linux'
  const hostKeyMode: SshHostKeyMode = candidate.hostKeyMode === 'loose' ? 'loose' : 'ask'
  const identityFile =
    typeof candidate.identityFile === 'string' && candidate.identityFile.trim().length > 0
      ? candidate.identityFile.trim()
      : undefined
  const updatedAt =
    typeof candidate.updatedAt === 'string' && candidate.updatedAt.trim().length > 0
      ? candidate.updatedAt
      : new Date().toISOString()
  const id =
    typeof candidate.id === 'string' && candidate.id.trim().length > 0
      ? candidate.id.trim()
      : `session-${index}`
  const packVendor = normalizeVendor(candidate.packVendor)

  return {
    id,
    name,
    groupId: safeGroupId,
    protocol,
    host,
    port: safePort,
    user: protocol === 'ssh' ? user : undefined,
    authMode: protocol === 'ssh' ? 'system' : undefined,
    identityFile: protocol === 'ssh' ? identityFile : undefined,
    hostKeyMode: protocol === 'ssh' ? hostKeyMode : undefined,
    packId: typeof candidate.packId === 'string' && candidate.packId.trim().length > 0 ? candidate.packId.trim() : undefined,
    packVendor: packVendor ?? undefined,
    packIndex: typeof candidate.packIndex === 'number' && Number.isFinite(candidate.packIndex)
      ? Math.max(1, Math.floor(candidate.packIndex))
      : undefined,
    updatedAt,
  }
}

const normalizeLocalPack = (input: unknown, index: number): LocalPortPackConfig | null => {
  if (!input || typeof input !== 'object') {
    return null
  }
  const candidate = input as Partial<LocalPortPackConfig>
  const host = typeof candidate.host === 'string' ? candidate.host.trim() : ''
  if (host.length === 0) {
    return null
  }
  const startPort = typeof candidate.startPort === 'number' && Number.isFinite(candidate.startPort)
    ? Math.max(1, Math.min(65535, Math.floor(candidate.startPort)))
    : 2000
  const count = typeof candidate.count === 'number' && Number.isFinite(candidate.count)
    ? Math.max(1, Math.min(200, Math.floor(candidate.count)))
    : 20
  const protocol = normalizeProtocol(candidate.protocol)
  const id = typeof candidate.id === 'string' && candidate.id.trim().length > 0
    ? candidate.id.trim()
    : `local-pack-${index}`
  const vendorPlan = normalizeVendorPlan(candidate.vendorPlan, count)
  const sum = vendorPlan.cisco + vendorPlan.huawei + vendorPlan.h3c + vendorPlan.ruijie
  const updatedAt = typeof candidate.updatedAt === 'string' && candidate.updatedAt.trim().length > 0
    ? candidate.updatedAt
    : new Date().toISOString()
  return {
    id,
    host,
    startPort,
    count: sum > 0 ? sum : count,
    protocol: protocol === 'raw' || protocol === 'telnet' || protocol === 'ssh' ? protocol : 'telnet',
    vendorPlan: sum > 0 ? vendorPlan : normalizeVendorPlan(undefined, count),
    updatedAt,
  }
}

const normalizeTagGroup = (input: unknown, index: number, sessionIdSet: Set<string>): SessionTagGroup | null => {
  if (!input || typeof input !== 'object') {
    return null
  }
  const candidate = input as Partial<SessionTagGroup>
  const label = typeof candidate.label === 'string' ? candidate.label.trim() : ''
  if (label.length === 0) {
    return null
  }
  const id =
    typeof candidate.id === 'string' && candidate.id.trim().length > 0
      ? candidate.id.trim()
      : `tag-group-${index}`
  const updatedAt =
    typeof candidate.updatedAt === 'string' && candidate.updatedAt.trim().length > 0
      ? candidate.updatedAt
      : new Date().toISOString()
  const sessionIdsRaw = Array.isArray(candidate.sessionIds) ? candidate.sessionIds : []
  const sessionIds = Array.from(
    new Set(
      sessionIdsRaw
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0 && sessionIdSet.has(item)),
    ),
  )
  return {
    id,
    label,
    sessionIds,
    updatedAt,
  }
}

export const normalizeSessionCatalogConfig = (input: unknown): SessionCatalogConfig => {
  if (!input || typeof input !== 'object') {
    return DEFAULT_SESSION_CATALOG_CONFIG
  }

  const candidate = input as Partial<SessionCatalogConfig>
  const parsedGroups = Array.isArray(candidate.groups) ? candidate.groups : []
  const groups = parsedGroups
    .map((group, index) => normalizeGroup(group, index))
    .filter((group): group is SessionGroup => Boolean(group))

  const ensuredGroups = groups.length > 0 ? groups : defaultGroups
  const parsedSessions = Array.isArray(candidate.sessions) ? candidate.sessions : []
  const sessions = parsedSessions
    .map((session, index) => normalizeSession(session, ensuredGroups, index))
    .filter((session): session is SessionEntry => Boolean(session))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  const parsedPacks = Array.isArray(candidate.localPortPacks) ? candidate.localPortPacks : []
  const localPortPacks = parsedPacks
    .map((pack, index) => normalizeLocalPack(pack, index))
    .filter((pack): pack is LocalPortPackConfig => Boolean(pack))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  const sessionIdSet = new Set(sessions.map((session) => session.id))
  const parsedTagGroups = Array.isArray(candidate.tagGroups) ? candidate.tagGroups : []
  const tagGroups = parsedTagGroups
    .map((group, index) => normalizeTagGroup(group, index, sessionIdSet))
    .filter((group): group is SessionTagGroup => Boolean(group))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  return {
    version: 3,
    groups: ensuredGroups,
    sessions,
    localPortPacks,
    tagGroups,
  }
}

export type LocalPortPackGenerateInput = {
  id?: string
  host: string
  startPort: number
  count: number
  protocol: Extract<SessionProtocol, 'telnet' | 'raw' | 'ssh'>
  vendorPlan: LocalPortVendorPlan
}

export type LocalPortPackGenerateResult = {
  pack: LocalPortPackConfig
  groups: SessionGroup[]
  sessions: SessionEntry[]
}

export const generateLocalPortPackSessions = (
  input: LocalPortPackGenerateInput,
  existingGroupMap: Map<string, SessionGroup>,
): LocalPortPackGenerateResult => {
  const host = input.host.trim().length > 0 ? input.host.trim() : '127.0.0.1'
  const safeStartPort = Math.max(1, Math.min(65535, Math.floor(input.startPort || 2000)))
  const safeCount = Math.max(1, Math.min(200, Math.floor(input.count || 20)))
  const vendorPlan = normalizeVendorPlan(input.vendorPlan, safeCount)
  const total = vendorPlan.cisco + vendorPlan.huawei + vendorPlan.h3c + vendorPlan.ruijie
  const count = total > 0 ? total : safeCount
  const packId = input.id && input.id.trim().length > 0 ? input.id.trim() : createLocalPackId()
  const now = new Date().toISOString()

  const groups: SessionGroup[] = []
  const sessions: SessionEntry[] = []
  let portCursor = safeStartPort

  for (const def of VENDOR_GROUP_DEFS) {
    const countByVendor = vendorPlan[def.vendor]
    if (countByVendor <= 0) {
      continue
    }
    const ensuredGroup = existingGroupMap.get(def.groupId) ?? { id: def.groupId, label: def.label }
    groups.push(ensuredGroup)
    for (let index = 1; index <= countByVendor; index += 1) {
      const suffix = String(index).padStart(2, '0')
      const port = portCursor
      portCursor += 1
      sessions.push({
        id: createSessionEntryId(),
        name: `${def.label}-${suffix} (${port})`,
        groupId: ensuredGroup.id,
        protocol: input.protocol,
        host,
        port,
        user: input.protocol === 'ssh' ? 'admin' : undefined,
        authMode: input.protocol === 'ssh' ? 'system' : undefined,
        hostKeyMode: input.protocol === 'ssh' ? 'ask' : undefined,
        identityFile: undefined,
        packId,
        packVendor: def.vendor,
        packIndex: index,
        updatedAt: now,
      })
    }
  }

  return {
    pack: {
      id: packId,
      host,
      startPort: safeStartPort,
      count,
      protocol: input.protocol,
      vendorPlan,
      updatedAt: now,
    },
    groups,
    sessions,
  }
}
