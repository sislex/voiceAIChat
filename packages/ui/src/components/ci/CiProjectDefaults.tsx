// Дефолты проекта: команды слотов, режим запуска и глубина уточнений
// (всё это наследуют задачи — см. resolveTaskSlots / resolveTaskLlmConfig).
import { useEffect, useState, type JSX } from 'react'
import type { CiClarifyLevel, CiCommand, CiLlmConfig, CiRunMode } from '@shared/ci'
import { CI_CLARIFY_MAX_LIMIT, DEFAULT_CI_LLM_CONFIG } from '@shared/ci'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { LlmEngineOption } from '@shared/admin'
import { Button } from '../ui/Button'
import { LlmSettingsEditor } from '../LlmSettingsEditor'
import { CiSlotEditor } from './CiSlotEditor'
import { CLARIFY_LEVEL_LABEL, RUN_MODE_LABEL } from './ciFormat'

export function CiProjectDefaults(props: { projectId: string; editable: boolean; llmAccess?: UserLlmAccess[]; llmEngines?: LlmEngineOption[]; section?: 'commands' | 'llm' }): JSX.Element {
  const [commands, setCommands] = useState<CiCommand[]>([])
  const [before, setBefore] = useState<string[]>([])
  const [after, setAfter] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [llm, setLlm] = useState<CiLlmConfig>({ ...DEFAULT_CI_LLM_CONFIG })
  const [inheritedLlm, setInheritedLlm] = useState<CiLlmConfig>({ ...DEFAULT_CI_LLM_CONFIG })
  const [llmOverridden, setLlmOverridden] = useState(false)
  const [llmDirty, setLlmDirty] = useState(false)

  useEffect(() => {
    const bridge = window.ci
    if (!bridge) return
    void bridge.listCommands(props.projectId).then(setCommands)
    void bridge.getProjectCi(props.projectId).then((c) => { setBefore(c.beforeModel); setAfter(c.afterModel) })
    void bridge.getProjectCiLlm(props.projectId).then((view) => { setLlm(view.config); setInheritedLlm(view.inherited); setLlmOverridden(view.overridden) })
  }, [props.projectId])

  const save = (): void => {
    void window.ci?.putProjectCi(props.projectId, { beforeModel: before, afterModel: after }).then(() => setDirty(false))
  }
  const saveLlm = (): void => {
    void window.ci?.putProjectCiLlm(props.projectId, llm).then((view) => {
      setLlm(view.config); setInheritedLlm(view.inherited); setLlmOverridden(view.overridden); setLlmDirty(false)
    })
  }
  const resetLlm = (): void => {
    void window.ci?.resetProjectCiLlm(props.projectId).then((view) => {
      setLlm(view.config); setInheritedLlm(view.inherited); setLlmOverridden(view.overridden); setLlmDirty(false)
    })
  }
  return (
    <div className="ci-defaults">
      {props.section !== 'llm' && <>
        <CiSlotEditor label="До работы модели (по умолчанию)" commands={commands} value={before} disabled={!props.editable} onChange={(v) => { setBefore(v); setDirty(true) }} />
        <CiSlotEditor label="После работы модели (по умолчанию)" commands={commands} value={after} disabled={!props.editable} onChange={(v) => { setBefore(v); setDirty(true) }} />
        {props.editable && dirty && <Button variant="primary" onClick={save}>Сохранить команды проекта</Button>}
      </>}
      {props.section !== 'commands' && <>
      <LlmSettingsEditor
        value={{ provider: llm.provider, model: llm.model }}
        inherited={{ provider: inheritedLlm.provider, model: inheritedLlm.model }}
        overridden={llmOverridden || llmDirty}
        editable={props.editable}
        llmAccess={props.llmAccess}
        labels={{ provider: 'Движок проекта', model: 'Модель проекта' }}
        onChange={(next) => { setLlm({ ...llm, provider: next.provider, model: next.model }); setLlmDirty(true) }}
        onReset={resetLlm}
      />
      <div className="ci-task-llm">
        <label>Исполнитель проекта<select aria-label="Исполнитель проекта" className="sel" disabled={!props.editable} value={llm.llmEngineId ?? ''} onChange={(e) => { setLlm({ ...llm, llmEngineId: e.target.value || null }); setLlmDirty(true) }}><option value="">Системный исполнитель</option>{(props.llmEngines ?? []).filter((engine) => engine.kind === llm.provider).map((engine) => <option key={engine.id} value={engine.id}>{engine.name}</option>)}</select></label>
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
