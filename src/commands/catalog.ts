export type CommandCatalogRisk = 'safe' | 'caution' | 'destructive'

export type CommandCatalogGroup = {
  id: string
  label: string
  system?: boolean
}

export type CommandCatalogEntry = {
  id: string
  groupId: string
  title: string
  command: string
  summary: string
  usage: string
  example: string
  tags: string[]
  risk: CommandCatalogRisk
}

export type CommandCatalogConfig = {
  version: number
  groups: CommandCatalogGroup[]
  entries: CommandCatalogEntry[]
}

export type CommandCatalogPayload = {
  path: string
  config: CommandCatalogConfig
}

const normalizeGroupId = (value: string): string => {
  const normalized = value.trim().toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  return normalized.length > 0 ? normalized : 'custom'
}

export const DEFAULT_COMMAND_CATALOG_CONFIG: CommandCatalogConfig = {
  version: 1,
  groups: [
    { id: 'shell', label: 'Shell 原生', system: true },
    { id: 'docker', label: 'Docker', system: true },
    { id: 'git', label: 'Git', system: true },
    { id: 'cisco', label: 'Cisco', system: true },
    { id: 'huawei', label: 'Huawei', system: true },
    { id: 'h3c', label: 'H3C', system: true },
    { id: 'ruijie', label: 'Ruijie', system: true },
    { id: 'opencode', label: 'OpenCode', system: true },
    { id: 'codex', label: 'Codex', system: true },
  ],
  entries: [
    {
      id: 'shell-ls-la',
      groupId: 'shell',
      title: '查看目录详情',
      command: 'ls -la',
      summary: '列出当前目录所有文件（含隐藏文件）及权限/大小/时间。',
      usage: 'ls -la [path]',
      example: 'ls -la /Users/baiyu/termbridge-v2',
      tags: ['list', '目录', '文件'],
      risk: 'safe',
    },
    {
      id: 'shell-find-name',
      groupId: 'shell',
      title: '按名称查找文件',
      command: 'find . -name "*.ts"',
      summary: '递归查找符合名称模式的文件。',
      usage: 'find <root> -name "<pattern>"',
      example: 'find src -name "*.tsx"',
      tags: ['查找', 'find', 'pattern'],
      risk: 'safe',
    },
    {
      id: 'shell-grep-rn',
      groupId: 'shell',
      title: '检索文本',
      command: 'grep -rn "keyword" .',
      summary: '递归搜索关键词并显示行号。',
      usage: 'grep -rn "<keyword>" <path>',
      example: 'grep -rn "buildTranslationPatches" src',
      tags: ['搜索', 'grep', '日志'],
      risk: 'safe',
    },
    {
      id: 'docker-ps-all',
      groupId: 'docker',
      title: '查看容器状态',
      command: 'docker ps -a',
      summary: '查看所有容器（运行中 + 已退出）。',
      usage: 'docker ps [-a]',
      example: 'docker ps -a',
      tags: ['container', '状态', '排错'],
      risk: 'safe',
    },
    {
      id: 'docker-logs-follow',
      groupId: 'docker',
      title: '实时查看容器日志',
      command: 'docker logs -f <container>',
      summary: '持续追踪容器输出，便于定位问题。',
      usage: 'docker logs -f <container_name_or_id>',
      example: 'docker logs -f termbridge-api',
      tags: ['日志', 'debug', 'container'],
      risk: 'safe',
    },
    {
      id: 'docker-prune-all',
      groupId: 'docker',
      title: '清理无用资源',
      command: 'docker system prune -a',
      summary: '清理未使用镜像/容器/网络，释放磁盘。',
      usage: 'docker system prune [-a] [--volumes]',
      example: 'docker system prune -a',
      tags: ['清理', '磁盘', 'danger'],
      risk: 'destructive',
    },
    {
      id: 'git-status-short',
      groupId: 'git',
      title: '查看工作区状态',
      command: 'git status -sb',
      summary: '简洁展示分支和文件改动。',
      usage: 'git status [-sb]',
      example: 'git status -sb',
      tags: ['状态', 'branch', 'diff'],
      risk: 'safe',
    },
    {
      id: 'git-log-graph',
      groupId: 'git',
      title: '查看提交图',
      command: 'git log --oneline --graph --decorate -20',
      summary: '快速了解最近提交拓扑。',
      usage: 'git log --oneline --graph --decorate [-n]',
      example: 'git log --oneline --graph --decorate -20',
      tags: ['history', 'commit', 'graph'],
      risk: 'safe',
    },
    {
      id: 'git-reset-hard',
      groupId: 'git',
      title: '强制回退（谨慎）',
      command: 'git reset --hard <commit>',
      summary: '重置工作区与索引到指定提交，会丢弃未保存改动。',
      usage: 'git reset --hard <commit_sha>',
      example: 'git reset --hard HEAD~1',
      tags: ['回退', '危险', 'history'],
      risk: 'destructive',
    },
    {
      id: 'cisco-terminal-length-0',
      groupId: 'cisco',
      title: '关闭分页',
      command: 'terminal length 0',
      summary: 'Cisco 设备关闭分页，show 输出不再停在 --More--。',
      usage: 'terminal length 0',
      example: 'terminal length 0',
      tags: ['cisco', '分页', 'show'],
      risk: 'safe',
    },
    {
      id: 'cisco-more-space',
      groupId: 'cisco',
      title: '分页继续（空格）',
      command: 'raw: ',
      summary: '在分页提示时发送空格继续下一页。',
      usage: 'raw: ',
      example: 'raw: ',
      tags: ['cisco', 'more', '分页'],
      risk: 'safe',
    },
    {
      id: 'cisco-more-quit',
      groupId: 'cisco',
      title: '分页退出（q）',
      command: 'raw:q',
      summary: '在分页提示时发送 q 退出分页。',
      usage: 'raw:q',
      example: 'raw:q',
      tags: ['cisco', 'more', '分页'],
      risk: 'safe',
    },
    {
      id: 'huawei-screen-length-0',
      groupId: 'huawei',
      title: '临时关闭分页',
      command: 'screen-length 0 temporary',
      summary: 'Huawei 设备临时关闭分页。',
      usage: 'screen-length 0 temporary',
      example: 'screen-length 0 temporary',
      tags: ['huawei', '分页', 'display'],
      risk: 'safe',
    },
    {
      id: 'huawei-more-space',
      groupId: 'huawei',
      title: '分页继续（空格）',
      command: 'raw: ',
      summary: '在分页提示时发送空格继续。',
      usage: 'raw: ',
      example: 'raw: ',
      tags: ['huawei', 'more', '分页'],
      risk: 'safe',
    },
    {
      id: 'huawei-more-quit',
      groupId: 'huawei',
      title: '分页退出（q）',
      command: 'raw:q',
      summary: '在分页提示时发送 q 退出。',
      usage: 'raw:q',
      example: 'raw:q',
      tags: ['huawei', 'more', '分页'],
      risk: 'safe',
    },
    {
      id: 'h3c-screen-length-disable',
      groupId: 'h3c',
      title: '关闭分页',
      command: 'screen-length disable',
      summary: 'H3C 常用关闭分页命令。',
      usage: 'screen-length disable',
      example: 'screen-length disable',
      tags: ['h3c', '分页'],
      risk: 'safe',
    },
    {
      id: 'h3c-more-space',
      groupId: 'h3c',
      title: '分页继续（空格）',
      command: 'raw: ',
      summary: '在分页提示时发送空格继续。',
      usage: 'raw: ',
      example: 'raw: ',
      tags: ['h3c', 'more', '分页'],
      risk: 'safe',
    },
    {
      id: 'ruijie-terminal-length-0',
      groupId: 'ruijie',
      title: '关闭分页',
      command: 'terminal length 0',
      summary: 'Ruijie 常见关闭分页命令。',
      usage: 'terminal length 0',
      example: 'terminal length 0',
      tags: ['ruijie', '分页'],
      risk: 'safe',
    },
    {
      id: 'ruijie-more-space',
      groupId: 'ruijie',
      title: '分页继续（空格）',
      command: 'raw: ',
      summary: '在分页提示时发送空格继续。',
      usage: 'raw: ',
      example: 'raw: ',
      tags: ['ruijie', 'more', '分页'],
      risk: 'safe',
    },
    {
      id: 'opencode-help',
      groupId: 'opencode',
      title: '查看 OpenCode 帮助',
      command: '/help',
      summary: '查看当前可用指令和快捷操作。',
      usage: '/help',
      example: '/help',
      tags: ['slash', '帮助', 'opencode'],
      risk: 'safe',
    },
    {
      id: 'opencode-plan',
      groupId: 'opencode',
      title: '进入计划模式',
      command: '/plan',
      summary: '把当前任务切换到计划/步骤化执行。',
      usage: '/plan',
      example: '/plan',
      tags: ['计划', 'workflow', 'slash'],
      risk: 'safe',
    },
    {
      id: 'opencode-task',
      groupId: 'opencode',
      title: '创建任务上下文',
      command: '/task',
      summary: '将当前需求整理为可执行任务。',
      usage: '/task',
      example: '/task',
      tags: ['task', '上下文', '执行'],
      risk: 'safe',
    },
    {
      id: 'codex-help',
      groupId: 'codex',
      title: '查看 Codex 帮助',
      command: '/help',
      summary: '列出当前环境支持的命令和工作模式。',
      usage: '/help',
      example: '/help',
      tags: ['codex', 'help', 'slash'],
      risk: 'safe',
    },
    {
      id: 'codex-check',
      groupId: 'codex',
      title: '触发检查流程',
      command: '/check',
      summary: '让代理执行检查、构建或质量验证流程。',
      usage: '/check',
      example: '/check',
      tags: ['check', 'quality', 'verify'],
      risk: 'safe',
    },
    {
      id: 'codex-apply-patch',
      groupId: 'codex',
      title: '补丁模式说明',
      command: 'apply_patch',
      summary: '用于以 patch 形式精确修改文件内容。',
      usage: 'apply_patch <<EOF ... EOF',
      example: 'apply_patch  # 在代理内部流程使用',
      tags: ['patch', 'edit', 'codex'],
      risk: 'caution',
    },
  ],
}

export const createCatalogEntryId = (): string => `catalog-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

export const normalizeCatalogConfig = (raw: unknown): CommandCatalogConfig => {
  if (typeof raw !== 'object' || raw === null) {
    return DEFAULT_COMMAND_CATALOG_CONFIG
  }

  const source = raw as Partial<CommandCatalogConfig>
  const groupsInput = Array.isArray(source.groups) ? source.groups : DEFAULT_COMMAND_CATALOG_CONFIG.groups
  const groupMap = new Map<string, CommandCatalogGroup>()

  for (const item of groupsInput) {
    if (typeof item !== 'object' || item === null) {
      continue
    }

    const candidate = item as Partial<CommandCatalogGroup>
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

  for (const group of DEFAULT_COMMAND_CATALOG_CONFIG.groups) {
    if (!groupMap.has(group.id)) {
      groupMap.set(group.id, group)
    }
  }

  const groups = Array.from(groupMap.values())
  const validGroupIds = new Set(groups.map((group) => group.id))
  const entriesInput = Array.isArray(source.entries) ? source.entries : DEFAULT_COMMAND_CATALOG_CONFIG.entries
  const entries: CommandCatalogEntry[] = []
  const entryIdSet = new Set<string>()

  for (const item of entriesInput) {
    if (typeof item !== 'object' || item === null) {
      continue
    }

    const candidate = item as Partial<CommandCatalogEntry>
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.groupId !== 'string' ||
      typeof candidate.title !== 'string' ||
      typeof candidate.command !== 'string'
    ) {
      continue
    }

    const groupId = normalizeGroupId(candidate.groupId)
    if (!validGroupIds.has(groupId)) {
      continue
    }

    const title = candidate.title.trim()
    const command = candidate.command.trim()
    if (title.length === 0 || command.length === 0) {
      continue
    }

    const risk: CommandCatalogRisk =
      candidate.risk === 'caution' || candidate.risk === 'destructive' || candidate.risk === 'safe'
        ? candidate.risk
        : 'safe'

    const id = candidate.id.trim().length > 0 ? candidate.id.trim() : createCatalogEntryId()
    if (entryIdSet.has(id)) {
      continue
    }
    entryIdSet.add(id)
    entries.push({
      id,
      groupId,
      title,
      command,
      summary: typeof candidate.summary === 'string' ? candidate.summary.trim() : '',
      usage: typeof candidate.usage === 'string' ? candidate.usage.trim() : '',
      example: typeof candidate.example === 'string' ? candidate.example.trim() : '',
      tags: Array.isArray(candidate.tags) ? candidate.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      risk,
    })
  }

  // Migration: always append missing built-in system entries so new versions
  // can expose newly added vendor commands even if user has old local config.
  for (const defaultEntry of DEFAULT_COMMAND_CATALOG_CONFIG.entries) {
    if (entryIdSet.has(defaultEntry.id)) {
      continue
    }
    if (!validGroupIds.has(defaultEntry.groupId)) {
      continue
    }
    entries.push(defaultEntry)
    entryIdSet.add(defaultEntry.id)
  }

  return {
    version: 1,
    groups,
    entries,
  }
}
