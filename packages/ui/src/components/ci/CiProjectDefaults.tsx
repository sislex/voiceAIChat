// Дефолты проекта: команды слотов, режим запуска и глубина уточнений
// (всё это наследуют задачи — см. resolveTaskSlots / resolveTaskLlmConfig).
import { useEffect, useState, type JSX } from 'react'
import type { CiClarifyLevel, CiCommand, CiLlmConfig, CiRunMode } from '@shared/ci'
import { CI_CLARIFY_MAX_LIMIT, DEFAULT_CI_CLAUDE_MODEL, DEFAULT_CI_LLM_CONFIG } from '@shared/ci'
import { CODEX_MODELS } from '@shared/types'
import type { UserLlmAccess } from '@shared/llmAccess'
import { allowedModels, isProviderAllowed } from '@shared/llmAccess'
import { Button } from '../ui/Button'
import { CiSlotEditor } from './CiSlotEditor'
import { CLARIFY_LEVEL_LABEL, RUN_MODE_LABEL } from './ciFormat'

export function CiProjectDefaults(props: { projectId: string; editable: boolean; llmAccess?: UserLlmAccess[]; section?: 'commands' | 'llm' }): JSX.Element {
  const [commands, setCommands] = useState<CiCommand[]>([])
  const [before, setBefore] = useState<string[]>([])
  const [after, setAfter] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [llm, setLlm] = useState<CiLlmConfig>({ ...DEFAULT_CI_LLM_CONFIG })
  const [llmDirty, setLlmDirty] = useState(false)

  useEffect(() => {
    const bridge = window.ci
    if (!bridge) return
    void bridge.listCommands(props.projectId).then(setCommands)
    void bridge.getProjectCi(props.projectId).then((c) => { setBefore(c.beforeModel); setAfter(c.afterModel) })
    void bridge.getProjectCiLlm(props.projectId).then(setLlm)
  }, [props.projectId])

  const save = (): void => {
    void window.ci?.putProjectCi(props.projectId, { beforeModel: before, afterModel: after }).then(() => setDirty(false))
  }
  const access = props.llmAccess ?? []
  const models = llm.provider === 'codex' ? allowedModels(access, 'codex') : allowedModels(access, 'claude')
  const changeProvider = (provider: 'claude' | 'codex'): void => {
    setLlm({ ...llm, provider, model: provider === 'codex' ? CODEX_MODELS[0].id : DEFAULT_CI_CLAUDE_MODEL })
    setLlmDirty(true)
  }
  const saveLlm = (): void => {
    void window.ci?.putProjectCiLlm(props.projectId, llm).then(() => setLlmDirty(false))
  }
  return (
    <div className="ci-defaults">
      {props.section !== 'llm' && <>
        <CiSlotEditor label="До работы модели (по умолчанию)" commands={commands} value={before} disabled={!props.editable} onChange={(v) => { setBefore(v); setDirty(true) }} />
        <CiSlotEditor label="После работы модели (по умолчанию)" commands={commands} value={after} disabled={!props.editable} onChange={(v) => { setBefore(v); setDirty(true) }} />
        {props.editable && dirty && <Button variant="primary" onClick={save}>Сохранить команды проекта</Button>}
      </>}
      {props.section !== 'commands' && <>
      <div className="ci-task-llm">
        <label>Движок по умолчанию<select
          aria-label="Движок проекта"
          className="sel"
          disabled={!props.editable}
          value={llm.provider}
          onChange={(e) => changeProvider(e.target.value as 'claude' | 'codex')}
        >{isProviderAllowed(access, 'claude') && <option value="claude">Claude</option>}{isProviderAllowed(access, 'codex') && <option value="codex">Codex</option>}{!isProviderAllowed(access, 'claude') && !isProviderAllowed(access, 'codex') && <option value="">Нет доступных движков</option>}</select></label>
        <label>Модель по умолчанию<select
          aria-label="Модель проекта"
          className="sel"
          disabled={!props.editable}
          value={llm.model}
          onChange={(e) => { setLlm({ ...llm, model: e.target.value }); setLlmDirty(true) }}
        >{!models.some((m) => m.id === llm.model) && <option value={llm.model}>{llm.model}</option>}{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      </div>
      <div className="ci-task-llm">
        <label>Режим запуска по умолчанию<select
          aria-label="Режим запуска по умолчанию"
          className="sel"
          disabled={!props.editable}
          value={llm.mode}
          onChange={(e) => { setLlm({ ...llm, mode: e.target.value as CiRunMode }); setLlmDirty(true) }}
        >{(['plan', 'development'] as CiRunMode[]).map((m) => <option key={m} value={m}>{RUN_MODE_LABEL[m]}</option>)}</select></label>
        <label>Уточнения по умолчанию<select
          aria-label="Степень уточнения по умолчанию"
          className="sel"
          disabled={!props.editable}
          value={llm.clarifyLevel}
          onChange={(e) => { setLlm({ ...llm, clarifyLevel: e.target.value as CiClarifyLevel }); setLlmDirty(true) }}
        >{(['none', 'few', 'medium', 'detailed'] as CiClarifyLevel[]).map((l) => <option key={l} value={l}>{CLARIFY_LEVEL_LABEL[l]}</option>)}</select></label>
      </div>
      {llm.clarifyLevel === 'detailed' && (
        <label className="ci-task-clarify-max">Сколько вопросов (1–{CI_CLARIFY_MAX_LIMIT})<input
          aria-label="Число вопросов по умолчанию"
          className="login-input"
          type="number"
          min={1}
          max={CI_CLARIFY_MAX_LIMIT}
          disabled={!props.editable}
          value={llm.clarifyMax}
          onChange={(e) => {
            const n = Number(e.target.value)
            setLlm({ ...llm, clarifyMax: Number.isFinite(n) ? Math.min(CI_CLARIFY_MAX_LIMIT, Math.max(1, Math.round(n))) : 1 })
            setLlmDirty(true)
          }}
        /></label>
      )}
      {props.editable && llmDirty && <Button variant="primary" onClick={saveLlm}>Сохранить режим проекта</Button>}
      </>}
    </div>
  )
}
