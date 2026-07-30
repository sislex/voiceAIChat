// CI-настройки задачи: команды и наследуемый движок/модель.
import { useEffect, useState, type JSX } from 'react'
import type { CiCommand, CiLlmConfig, CiSlotConfig } from '@shared/ci'
import { CLAUDE_MODELS, CODEX_MODELS } from '@shared/types'
import { CiSlotEditor } from './CiSlotEditor'

export interface CiTaskSettingsProps { projectId: string; taskId: string }

export function CiTaskSettings(props: CiTaskSettingsProps): JSX.Element {
  const [commands, setCommands] = useState<CiCommand[]>([])
  const [before, setBefore] = useState<string[]>([])
  const [after, setAfter] = useState<string[]>([])
  const [overridden, setOverridden] = useState(false)
  const [saved, setSaved] = useState(true)
  const [llm, setLlm] = useState<CiLlmConfig>({ provider: 'claude', model: 'sonnet' })
  const [llmOverridden, setLlmOverridden] = useState(false)
  const [llmSaved, setLlmSaved] = useState(true)

  useEffect(() => {
    const bridge = window.ci
    if (!bridge) return
    void bridge.listCommands(props.projectId).then(setCommands)
    void bridge.getTaskCi(props.projectId, props.taskId).then((r) => {
      setBefore(r.config.beforeModel); setAfter(r.config.afterModel); setOverridden(r.overridden)
    })
    void bridge.getTaskCiLlm(props.projectId, props.taskId).then((r) => {
      setLlm(r.config); setLlmOverridden(r.overridden)
    })
  }, [props.projectId, props.taskId])

  const isCleanup = (id: string): boolean => commands.find((c) => c.id === id)?.isCleanup ?? false
  const cleanupWarn = after.some(isCleanup) && before.length === 0
  const save = (): void => {
    const cfg: CiSlotConfig = { beforeModel: before, afterModel: after }
    void window.ci?.putTaskCi(props.projectId, props.taskId, cfg).then(() => { setSaved(true); setOverridden(true) })
  }
  const models = llm.provider === 'codex' ? CODEX_MODELS : CLAUDE_MODELS
  const changeProvider = (provider: 'claude' | 'codex'): void => {
    setLlm({ provider, model: provider === 'codex' ? CODEX_MODELS[0].id : 'sonnet' }); setLlmSaved(false)
  }
  const saveLlm = (): void => {
    void window.ci?.putTaskCiLlm(props.projectId, props.taskId, llm).then(() => { setLlmSaved(true); setLlmOverridden(true) })
  }
  const resetLlm = (): void => {
    void window.ci?.resetTaskCiLlm(props.projectId, props.taskId).then((r) => { setLlm(r.config); setLlmOverridden(r.overridden); setLlmSaved(true) })
  }

  return <section className="ci-task">
    <div className="ci-task-head"><span className="ci-task-title">Команды воркфлоу</span><span className={`lozenge ${overridden ? 'lozenge-progress' : 'lozenge-neutral'}`}>{overridden ? 'переопределено' : 'унаследовано'}</span></div>
    <CiSlotEditor label="До работы модели" commands={commands} value={before} onChange={(v) => { setBefore(v); setSaved(false) }} />
    <CiSlotEditor label="После работы модели" commands={commands} value={after} onChange={(v) => { setAfter(v); setSaved(false) }} />
    {cleanupWarn && <div className="ci-warn">В слоте «после» есть cleanup-команда, но в «до» нет команды, создающей рабочую директорию.</div>}
    {!saved && <button type="button" className="btn-primary ci-task-save" onClick={save}>Сохранить команды</button>}
    <div className="ci-task-head ci-task-llm-head"><span className="ci-task-title">Движок модели</span><span className={`lozenge ${llmOverridden ? 'lozenge-progress' : 'lozenge-neutral'}`}>{llmOverridden ? 'переопределено' : 'унаследовано'}</span></div>
    <div className="ci-task-llm">
      <label>Движок<select aria-label="Движок модели" className="sel" value={llm.provider} onChange={(e) => changeProvider(e.target.value as 'claude' | 'codex')}><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
      <label>Модель<select aria-label="Модель" className="sel" value={llm.model} onChange={(e) => { setLlm({ ...llm, model: e.target.value }); setLlmSaved(false) }}>{!models.some((m) => m.id === llm.model) && <option value={llm.model}>{llm.model}</option>}{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    </div>
    <div className="ci-task-llm-actions">
      {!llmSaved && <button type="button" className="btn-primary ci-task-save" onClick={saveLlm}>Сохранить движок и модель</button>}
      {llmOverridden && <button type="button" className="ci-task-reset" onClick={resetLlm}>Вернуть настройку проекта</button>}
    </div>
  </section>
}
