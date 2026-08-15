import type { LlmEngineOption } from '@shared/admin'
import type { UserLlmAccess } from '@shared/llmAccess'
import { allowedModels, isProviderAllowed } from '@shared/llmAccess'
import { CODEX_MODELS, normalizeClaudeModel } from '@shared/types'
import type { LlmProvider } from '@shared/types'
import { Button } from '@voicechat/ui-kit'

export interface LlmSettingsValue {
  engineId?: string | null
  provider: LlmProvider
  model: string
}

export interface LlmSettingsEditorProps {
  value: LlmSettingsValue
  inherited?: LlmSettingsValue
  overridden?: boolean
  engines?: LlmEngineOption[]
  llmAccess?: UserLlmAccess[]
  editable?: boolean
  labels?: { engine?: string; provider?: string; model?: string }
  onChange: (value: LlmSettingsValue) => void
  onReset?: () => void
}

/** Общая форма выбора исполнителя, провайдера и модели для пользователя, проекта и чата. */
export function LlmSettingsEditor({ value, inherited, overridden = true, engines = [], llmAccess = [], editable = true, labels, onChange, onReset }: LlmSettingsEditorProps): JSX.Element {
  const claudeModels = allowedModels(llmAccess, 'claude')
  const codexModels = allowedModels(llmAccess, 'codex')
  const providers = (['claude', 'codex'] as const).filter((provider) => isProviderAllowed(llmAccess, provider) && (provider === 'claude' ? claudeModels.length : codexModels.length))
  const models = value.provider === 'claude' ? claudeModels : codexModels
  const state = inherited ? (overridden ? 'Переопределено на этом уровне' : 'Наследуется') : 'Пользовательское значение'
  const inheritedText = inherited ? `${inherited.provider === 'claude' ? 'Claude' : 'Codex'} · ${inherited.model || 'модель CLI по умолчанию'}` : null
  const changeProvider = (provider: LlmProvider): void => onChange({ ...value, provider, model: provider === 'claude' ? normalizeClaudeModel(inherited?.provider === 'claude' ? inherited.model : 'default') : (inherited?.provider === 'codex' ? inherited.model : CODEX_MODELS[0].id) })

  return <div className="llm-settings-editor" data-testid="llm-settings-editor">
    <p className="fsub" data-testid="llm-inheritance-state"><b>{state}</b>{inheritedText ? `: ${inheritedText}` : ''}</p>
    {engines.length > 0 && <div className="frow"><div><p className="flab">{labels?.engine ?? 'Исполнитель'}</p><p className="fsub">Подписка и контейнер выбранного CLI</p></div><select className="sel" aria-label={labels?.engine ?? 'Исполнитель LLM'} disabled={!editable} value={value.engineId ?? ''} onChange={(e) => { const engineId = e.target.value || null; const engine = engines.find((item) => item.id === engineId); onChange({ ...value, engineId, ...(engine ? { provider: engine.kind } : {}) }) }}><option value="">{inherited ? 'Наследовать исполнителя' : 'По умолчанию для роли'}</option>{engines.filter((engine) => providers.includes(engine.kind)).map((engine) => <option key={engine.id} value={engine.id}>{engine.name} · {engine.kind}{engine.isDefault ? ' (default)' : ''}</option>)}</select></div>}
    <div className="frow"><div><p className="flab">{labels?.provider ?? 'Движок'}</p><p className="fsub">Через какой CLI генерировать ответы</p></div><select className="sel" aria-label={labels?.provider ?? 'Движок'} disabled={!editable} value={value.provider} onChange={(e) => changeProvider(e.target.value as LlmProvider)}>{providers.includes('claude') && <option value="claude">Claude Code</option>}{providers.includes('codex') && <option value="codex">Codex</option>}{providers.length === 0 && <option value="">Нет доступных движков</option>}</select></div>
    <div className="frow"><div><p className="flab">{labels?.model ?? 'Модель'}</p><p className="fsub">{value.provider === 'claude' ? 'Через Claude CLI' : 'Через Codex CLI'}</p></div><select className="sel" aria-label={labels?.model ?? (value.provider === 'claude' ? 'Модель Claude' : 'Модель Codex')} disabled={!editable} value={value.provider === 'claude' ? normalizeClaudeModel(value.model) : value.model} onChange={(e) => onChange({ ...value, model: e.target.value })}>{value.provider === 'codex' && !models.some((m) => m.id === value.model) && <option value={value.model}>{value.model || 'По умолчанию (из codex)'}</option>}{models.map((m) => <option key={m.id} value={m.id} title={'hint' in m ? m.hint : undefined}>{m.label}</option>)}</select></div>
    {editable && inherited && overridden && onReset && <Button variant="secondary" onClick={onReset}>Сбросить и наследовать</Button>}
  </div>
}
