export type AutomationRisk = 'safe' | 'caution' | 'destructive'

export type AutomationGroup = {
  id: string
  label: string
  system?: boolean
}

export type AutomationScript = {
  id: string
  groupId: string
  name: string
  description: string
  content: string
  tags: string[]
  risk: AutomationRisk
  updatedAt: string
}

export type AutomationConfig = {
  version: number
  groups: AutomationGroup[]
  scripts: AutomationScript[]
}

const normalizeGroupId = (value: string): string => {
  const normalized = value.trim().toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  return normalized.length > 0 ? normalized : 'custom'
}

export const DEFAULT_AUTOMATION_CONFIG: AutomationConfig = {
  version: 1,
  groups: [
    { id: 'shell-native', label: 'Shell 原生', system: true },
    { id: 'deploy', label: '部署发布', system: true },
    { id: 'maintenance', label: '巡检维护', system: true },
  ],
  scripts: [
    {
      id: 'auto-shell-cache',
      groupId: 'shell-native',
      name: '清理 npm 缓存',
      description: '排查依赖异常时执行，清理后重装',
      content: 'npm cache clean --force\nnpm install',
      tags: ['npm', 'cache', 'repair'],
      risk: 'caution',
      updatedAt: new Date(0).toISOString(),
    },
    {
      id: 'auto-maintenance-log-tail',
      groupId: 'maintenance',
      name: '日志快速定位',
      description: '查看最近错误并持续跟踪日志',
      content: 'tail -n 200 logs/app.log | rg -n "error|warn"\ntail -f logs/app.log',
      tags: ['logs', 'tail', 'debug'],
      risk: 'safe',
      updatedAt: new Date(0).toISOString(),
    },
    {
      id: 'auto-network-export-config',
      groupId: 'maintenance',
      name: '设备配置导出（模板）',
      description: '连接设备后，清空视图、执行查看配置、等待提示符并导出当前显示文本',
      content: [
        '# 厂商命令可改成 show running-config / display current-configuration',
        'app.clear_view',
        'term.send display current-configuration',
        'term.wait_prompt 90000',
        'app.export_visible',
      ].join('\n'),
      tags: ['network', 'backup', 'export', 'config'],
      risk: 'caution',
      updatedAt: new Date(0).toISOString(),
    },
  ],
}

export const createAutomationScriptId = (): string => `auto-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

const normalizeScriptRisk = (value: unknown): AutomationRisk => {
  if (value === 'caution' || value === 'destructive' || value === 'safe') {
    return value
  }
  return 'safe'
}

const normalizeScript = (item: unknown, validGroupIds: Set<string>): AutomationScript | null => {
  if (!item || typeof item !== 'object') {
    return null
  }

  const candidate = item as Partial<AutomationScript>
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  const groupIdRaw = typeof candidate.groupId === 'string' ? candidate.groupId : 'shell-native'
  const groupId = normalizeGroupId(groupIdRaw)
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  const content = typeof candidate.content === 'string' ? candidate.content : ''
  const description = typeof candidate.description === 'string' ? candidate.description : ''
  const tags =
    Array.isArray(candidate.tags) && candidate.tags.every((tag) => typeof tag === 'string')
      ? candidate.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)
      : []
  const updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date(0).toISOString()
  const risk = normalizeScriptRisk(candidate.risk)

  if (id.length === 0 || name.length === 0 || content.trim().length === 0) {
    return null
  }

  return {
    id,
    groupId: validGroupIds.has(groupId) ? groupId : DEFAULT_AUTOMATION_CONFIG.groups[0].id,
    name,
    description,
    content,
    tags,
    risk,
    updatedAt,
  }
}

export const normalizeAutomationConfig = (raw: unknown): AutomationConfig => {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_AUTOMATION_CONFIG
  }

  const source = raw as Partial<AutomationConfig>
  const groupsInput = Array.isArray(source.groups) ? source.groups : DEFAULT_AUTOMATION_CONFIG.groups
  const groupMap = new Map<string, AutomationGroup>()

  for (const item of groupsInput) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const candidate = item as Partial<AutomationGroup>
    if (typeof candidate.id !== 'string' || typeof candidate.label !== 'string') {
      continue
    }

    const id = normalizeGroupId(candidate.id)
    const label = candidate.label.trim()
    if (label.length === 0) {
      continue
    }

    groupMap.set(id, {
      id,
      label,
      system: candidate.system === true,
    })
  }

  for (const item of DEFAULT_AUTOMATION_CONFIG.groups) {
    if (!groupMap.has(item.id)) {
      groupMap.set(item.id, item)
    }
  }

  const groups = Array.from(groupMap.values())
  const validGroupIds = new Set(groups.map((group) => group.id))
  const scriptsInput = Array.isArray(source.scripts) ? source.scripts : DEFAULT_AUTOMATION_CONFIG.scripts
  const scripts: AutomationScript[] = []

  for (const item of scriptsInput) {
    const normalized = normalizeScript(item, validGroupIds)
    if (!normalized) {
      continue
    }
    scripts.push(normalized)
  }

  return {
    version: 1,
    groups,
    scripts,
  }
}

export const normalizeAutomationStorage = (raw: unknown): AutomationConfig => {
  if (Array.isArray(raw)) {
    const validGroupIds = new Set(DEFAULT_AUTOMATION_CONFIG.groups.map((group) => group.id))
    const migratedScripts = raw
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null
        }

        const candidate = item as Partial<AutomationScript>
        const migrated = {
          ...candidate,
          groupId: typeof candidate.groupId === 'string' ? candidate.groupId : 'shell-native',
          tags: Array.isArray(candidate.tags) ? candidate.tags : [],
        }
        return normalizeScript(migrated, validGroupIds)
      })
      .filter((item): item is AutomationScript => item !== null)

    return {
      version: 1,
      groups: DEFAULT_AUTOMATION_CONFIG.groups,
      scripts: migratedScripts,
    }
  }

  return normalizeAutomationConfig(raw)
}
