import { useEffect, useState } from 'react'

export type AppSettings = {
  compactUi: boolean
  showDebugButton: boolean
  fontScale: number
  theme: 'dark' | 'light'
  dockSlots: number
}

type TranslationProviderOption = 'google-free' | 'openai-compatible' | 'tencent-tmt'

type SettingsPanelProps = {
  isOpen: boolean
  settings: AppSettings
  translationConfig: TermbridgeTranslationConfig | null
  translationStatus: string
  onClose: () => void
  onChange: (next: AppSettings) => void
  onSaveTranslationConfig: (nextConfig: TermbridgeTranslationConfig) => Promise<void>
}

const PROVIDER_LABELS: Record<TranslationProviderOption, string> = {
  'google-free': 'Google Free',
  'openai-compatible': 'OpenAI Compatible',
  'tencent-tmt': 'Tencent TMT',
}

const normalizeFallbacks = (
  primary: TranslationProviderOption,
  first: TranslationProviderOption | '',
  second: TranslationProviderOption | '',
): TranslationProviderOption[] => {
  const result: TranslationProviderOption[] = []
  for (const candidate of [first, second]) {
    if (!candidate) {
      continue
    }
    if (candidate === primary) {
      continue
    }
    if (!result.includes(candidate)) {
      result.push(candidate)
    }
  }
  return result
}

export const SettingsPanel = ({
  isOpen,
  settings,
  translationConfig,
  translationStatus,
  onClose,
  onChange,
  onSaveTranslationConfig,
}: SettingsPanelProps) => {
  const [draftTranslationConfig, setDraftTranslationConfig] = useState<TermbridgeTranslationConfig | null>(translationConfig)

  useEffect(() => {
    setDraftTranslationConfig(translationConfig)
  }, [translationConfig])

  if (!isOpen) {
    return null
  }

  const primaryProvider = (draftTranslationConfig?.defaultProvider ?? 'google-free') as TranslationProviderOption
  const fallbackFirst = (draftTranslationConfig?.fallbackProviders?.[0] ?? '') as TranslationProviderOption | ''
  const fallbackSecond = (draftTranslationConfig?.fallbackProviders?.[1] ?? '') as TranslationProviderOption | ''

  return (
    <aside className="settings-panel" role="dialog" aria-label="System settings">
      <div className="settings-panel-header">
        <div>
          <div className="settings-panel-title">设置</div>
          <div className="settings-panel-subtitle">系统与界面行为调节</div>
        </div>
        <button className="settings-panel-close" onClick={onClose}>
          收起
        </button>
      </div>

      <div className="settings-section">
        <label className="settings-row">
          <input
            type="checkbox"
            checked={settings.compactUi}
            onChange={(event) => {
              onChange({ ...settings, compactUi: event.target.checked })
            }}
          />
          <span>紧凑模式（减小面板间距）</span>
        </label>

        <label className="settings-row">
          <input
            type="checkbox"
            checked={settings.showDebugButton}
            onChange={(event) => {
              onChange({ ...settings, showDebugButton: event.target.checked })
            }}
          />
          <span>显示 Debug 按钮</span>
        </label>

        <label className="settings-range-label">
          <span>字体缩放：{settings.fontScale.toFixed(2)}x</span>
          <input
            className="settings-range"
            type="range"
            min="0.85"
            max="1.25"
            step="0.05"
            value={settings.fontScale}
            onChange={(event) => {
              onChange({ ...settings, fontScale: Number(event.target.value) })
            }}
          />
        </label>

        <label className="settings-range-label">
          <span>主题</span>
          <select
            className="settings-select"
            value={settings.theme}
            onChange={(event) => {
              onChange({
                ...settings,
                theme: event.target.value as AppSettings['theme'],
              })
            }}
          >
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
        </label>

        <label className="settings-range-label">
          <span>底部空位数量：{settings.dockSlots}</span>
          <input
            className="settings-range"
            type="range"
            min="4"
            max="12"
            step="1"
            value={settings.dockSlots}
            onChange={(event) => {
              onChange({
                ...settings,
                dockSlots: Number(event.target.value),
              })
            }}
          />
        </label>
      </div>

      <div className="settings-translation">
        <div className="settings-about-title">翻译设置</div>
        <div className="settings-about-item">在线翻译优先级与 API 参数。保存后会写入 translation config 并立即生效。</div>

        {draftTranslationConfig ? (
          <>
            <div className="settings-translation-block">
              <div className="settings-translation-block-title">1) 提供方优先级</div>
              <div className="settings-about-item">主提供方失败后会按 Fallback 1 然后 Fallback 2 依次尝试。</div>
            </div>
            <div className="settings-translation-grid">
              <label className="settings-range-label">
                <span>主提供方</span>
                <select
                  className="settings-select"
                  value={primaryProvider}
                  onChange={(event) => {
                    const nextPrimary = event.target.value as TranslationProviderOption
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      defaultProvider: nextPrimary,
                      fallbackProviders: normalizeFallbacks(nextPrimary, fallbackFirst, fallbackSecond),
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                >
                  {(Object.keys(PROVIDER_LABELS) as TranslationProviderOption[]).map((provider) => (
                    <option key={provider} value={provider}>
                      {PROVIDER_LABELS[provider]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="settings-range-label">
                <span>Fallback 1</span>
                <select
                  className="settings-select"
                  value={fallbackFirst}
                  onChange={(event) => {
                    const nextFallback = event.target.value as TranslationProviderOption | ''
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      fallbackProviders: normalizeFallbacks(primaryProvider, nextFallback, fallbackSecond),
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                >
                  <option value="">none</option>
                  {(Object.keys(PROVIDER_LABELS) as TranslationProviderOption[]).map((provider) => (
                    <option key={provider} value={provider}>
                      {PROVIDER_LABELS[provider]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="settings-range-label">
                <span>Fallback 2</span>
                <select
                  className="settings-select"
                  value={fallbackSecond}
                  onChange={(event) => {
                    const nextFallback = event.target.value as TranslationProviderOption | ''
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      fallbackProviders: normalizeFallbacks(primaryProvider, fallbackFirst, nextFallback),
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                >
                  <option value="">none</option>
                  {(Object.keys(PROVIDER_LABELS) as TranslationProviderOption[]).map((provider) => (
                    <option key={provider} value={provider}>
                      {PROVIDER_LABELS[provider]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="settings-translation-block">
              <div className="settings-translation-block-title">2) OpenAI Compatible API</div>
              <div className="settings-about-item">可直接填写 API Key，或仅填写 API Key 环境变量名。</div>
            </div>
            <div className="settings-translation-grid">
              <label className="settings-range-label">
                <span>OpenAI Base URL</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.openaiCompatible.baseUrl}
                  onChange={(event) => {
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        openaiCompatible: {
                          ...draftTranslationConfig.providers.openaiCompatible,
                          baseUrl: event.target.value,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>OpenAI Model</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.openaiCompatible.model}
                  onChange={(event) => {
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        openaiCompatible: {
                          ...draftTranslationConfig.providers.openaiCompatible,
                          model: event.target.value,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>OpenAI API Key Env</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.openaiCompatible.apiKeyEnv}
                  onChange={(event) => {
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        openaiCompatible: {
                          ...draftTranslationConfig.providers.openaiCompatible,
                          apiKeyEnv: event.target.value,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>OpenAI API Key（可选直填）</span>
                <input
                  className="settings-select"
                  type="password"
                  value={draftTranslationConfig.providers.openaiCompatible.apiKey ?? ''}
                  placeholder="sk-... (留空则走环境变量)"
                  onChange={(event) => {
                    const raw = event.target.value.trim()
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        openaiCompatible: {
                          ...draftTranslationConfig.providers.openaiCompatible,
                          apiKey: raw.length > 0 ? raw : undefined,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
            </div>

            <div className="settings-translation-block">
              <div className="settings-translation-block-title">3) Tencent TMT API</div>
              <div className="settings-about-item">支持直填密钥，也支持通过环境变量读取。</div>
            </div>
            <div className="settings-translation-grid">
              <label className="settings-range-label">
                <span>Tencent Region</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.tencentTmt.region}
                  onChange={(event) => {
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        tencentTmt: {
                          ...draftTranslationConfig.providers.tencentTmt,
                          region: event.target.value,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>Tencent Source</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.tencentTmt.source}
                  onChange={(event) => {
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        tencentTmt: {
                          ...draftTranslationConfig.providers.tencentTmt,
                          source: event.target.value,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>Tencent Target</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.tencentTmt.target}
                  onChange={(event) => {
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        tencentTmt: {
                          ...draftTranslationConfig.providers.tencentTmt,
                          target: event.target.value,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>Tencent Project ID</span>
                <input
                  className="settings-select"
                  type="number"
                  value={String(draftTranslationConfig.providers.tencentTmt.projectId)}
                  onChange={(event) => {
                    const projectId = Number.parseInt(event.target.value || '0', 10)
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        tencentTmt: {
                          ...draftTranslationConfig.providers.tencentTmt,
                          projectId: Number.isFinite(projectId) ? projectId : 0,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>Tencent Secret ID Env</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.tencentTmt.secretIdEnv}
                  onChange={(event) => {
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        tencentTmt: {
                          ...draftTranslationConfig.providers.tencentTmt,
                          secretIdEnv: event.target.value,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>Tencent Secret Key Env</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.tencentTmt.secretKeyEnv}
                  onChange={(event) => {
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        tencentTmt: {
                          ...draftTranslationConfig.providers.tencentTmt,
                          secretKeyEnv: event.target.value,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>Tencent Secret ID（可选直填）</span>
                <input
                  className="settings-select"
                  value={draftTranslationConfig.providers.tencentTmt.secretId ?? ''}
                  onChange={(event) => {
                    const raw = event.target.value.trim()
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        tencentTmt: {
                          ...draftTranslationConfig.providers.tencentTmt,
                          secretId: raw.length > 0 ? raw : undefined,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
              <label className="settings-range-label">
                <span>Tencent Secret Key（可选直填）</span>
                <input
                  className="settings-select"
                  type="password"
                  value={draftTranslationConfig.providers.tencentTmt.secretKey ?? ''}
                  onChange={(event) => {
                    const raw = event.target.value.trim()
                    const nextConfig: TermbridgeTranslationConfig = {
                      ...draftTranslationConfig,
                      providers: {
                        ...draftTranslationConfig.providers,
                        tencentTmt: {
                          ...draftTranslationConfig.providers.tencentTmt,
                          secretKey: raw.length > 0 ? raw : undefined,
                        },
                      },
                    }
                    setDraftTranslationConfig(nextConfig)
                  }}
                />
              </label>
            </div>
            <div className="settings-translation-actions">
              <button
                className="settings-translation-save"
                onClick={() => {
                  if (!draftTranslationConfig) {
                    return
                  }
                  void onSaveTranslationConfig(draftTranslationConfig)
                }}
              >
                保存翻译设置
              </button>
            </div>
            <div className="settings-translation-status">{translationStatus || ' '}</div>
          </>
        ) : (
          <div className="settings-translation-status">翻译配置加载中...</div>
        )}
      </div>

      <div className="settings-about">
        <div className="settings-about-title">关于项目</div>
        <div className="settings-about-item">termbridge-v2 是一个桌面终端翻译镜像系统，左侧保留原生终端交互，右侧输出等宽网格镜像。</div>
        <div className="settings-about-item">核心设计原则：严格保持行列布局一致。仅在命中翻译规则且可容纳宽度时做原位替换，超宽内容通过 marker + popover 查看。</div>
        <div className="settings-about-item">翻译链路：本地词库命中优先，受保护规则可配置，再进入在线翻译提供方链路（主提供方 + fallback）。</div>
        <div className="settings-about-item">工程结构：Electron 主进程管理 PTY 与配置，Renderer 侧 xterm 负责源缓冲，Mirror 网格负责确定性渲染与补丁应用。</div>
        <div className="settings-about-item">当前功能：词库管理、翻译策略、命令检索、自动化脚本、分组与条目拖拽排序、临时参数模板执行（不污染原始库）。</div>
        <div className="settings-about-item">适用场景：跨语言运维协作、团队值班排障、命令知识沉淀、脚本流程标准化执行。</div>
      </div>
    </aside>
  )
}
