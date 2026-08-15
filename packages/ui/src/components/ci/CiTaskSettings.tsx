// CI-настройки задачи: команды и наследуемый движок/модель.
import { useEffect, useState, type JSX } from 'react'
import type { CiCommand, CiClarifyLevel, CiLlmConfig, CiRunMode, CiSlotConfig, CiTaskMachine } from '@shared/ci'
import { CI_CLARIFY_MAX_LIMIT, DEFAULT_CI_CLAUDE_MODEL, DEFAULT_CI_LLM_CONFIG } from '@shared/ci'
import { CLARIFY_LEVEL_LABEL, RUN_MODE_LABEL } from './ciFormat'
import { CODEX_MODELS } from '@shared/types'
import type { UserLlmAccess } from '@shared/llmAccess'
import { allowedModels, isProviderAllowed } from '@shared/llmAccess'
import { Button } from '@voicechat/ui-kit'
import { CiSlotEditor } from './CiSlotEditor'

export interface CiTaskSettingsProps {
  projectId: string
  taskId: string
  llmAccess?: UserLlmAccess[]
  section: 'commands' | 'machine' | 'model'
  mergeMachineBound?: boolean
}

export function CiTaskSettings(props: CiTaskSettingsProps): JSX.Element {
  const [commands, setCommands] = useState<CiCommand[]>([])
  const [before, setBefore] = useState<string[]>([])
  const [after, setAfter] = useState<string[]>([])
  const [overridden, setOverridden] = useState(false)
  const [saved, setSaved] = useState(true)
  const [llm, setLlm] = useState<CiLlmConfig>({ ...DEFAULT_CI_LLM_CONFIG })
  const [llmOverridden, setLlmOverridden] = useState(false)
  const [llmSaved, setLlmSaved] = useState(true)
  const [machines, setMachines] = useState<CiTaskMachine[]>([])
  const [agentId, setAgentId] = useState<string | null>(null)
  const [unavailableAgentId, setUnavailableAgentId] = useState<string | null>(null)
  const [unavailableName, setUnavailableName] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [forceStatus, setForceStatus] = useState<{ kind: 'idle' | 'started' | 'error'; text?: string }>({ kind: 'idle' })

  useEffect(() => {
    const bridge = window.ci
    if (!bridge) return
    let cancelled = false
    void bridge.listCommands(props.projectId).then((value) => {
      if (!cancelled) setCommands(value)
    })
    void bridge.getTaskCi(props.projectId, props.taskId).then((r) => {
      if (cancelled) return
      setBefore(r.config.beforeModel); setAfter(r.config.afterModel); setOverridden(r.overridden)
    })
    void bridge.getTaskCiLlm(props.projectId, props.taskId).then((r) => {
      if (cancelled) return
      setLlm(r.config); setLlmOverridden(r.overridden)
    })
    void bridge.getTaskMachines(props.projectId, props.taskId).then((result) => {
      if (cancelled) return
      setMachines(result.machines)
      setAgentId(result.selectedAgentId)
      setUnavailableAgentId(result.unavailableSelection?.agentId ?? null)
      setUnavailableName(result.unavailableSelection?.name ?? null)
    })
    return () => { cancelled = true }
  }, [props.projectId, props.taskId])

  const selectedMachine = agentId ? machines.find((machine) => machine.agentId === agentId) : undefined
  const personalMachines = machines.filter((machine) => machine.personal)
  const projectMachines = machines.filter((machine) => machine.project && !machine.personal)
  const machineLabel = (machine: CiTaskMachine): string => {
    const access = machine.personal && machine.project ? 'моя + проектная' : machine.personal ? 'личная' : 'проектная'
    return `${machine.name} — ${machine.online ? 'online' : 'offline'}; ${access}${machine.projectDefault ? '; по умолчанию' : ''} · ${machine.agentId.slice(0, 8)}`
  }
  const isCleanup = (id: string): boolean => commands.find((c) => c.id === id)?.isCleanup ?? false
  const cleanupWarn = after.some(isCleanup) && before.length === 0
  const save = (): void => {
    const cfg: CiSlotConfig = { beforeModel: before, afterModel: after }
    void window.ci?.putTaskCi(props.projectId, props.taskId, cfg).then(() => { setSaved(true); setOverridden(true) })
  }
  const access = props.llmAccess ?? []
  const models = llm.provider === 'codex' ? allowedModels(access, 'codex') : allowedModels(access, 'claude')
  const changeProvider = (provider: 'claude' | 'codex'): void => {
    setLlm({ ...llm, provider, model: provider === 'codex' ? CODEX_MODELS[0].id : DEFAULT_CI_CLAUDE_MODEL }); setLlmSaved(false)
  }
  const saveLlm = (): void => {
    void window.ci?.putTaskCiLlm(props.projectId, props.taskId, llm).then(() => { setLlmSaved(true); setLlmOverridden(true) })
  }
  const resetLlm = (): void => {
    void window.ci?.resetTaskCiLlm(props.projectId, props.taskId).then((r) => { setLlm(r.config); setLlmOverridden(r.overridden); setLlmSaved(true) })
  }

  return <section className="ci-task">
    {props.section === 'commands' && <>
    <div className="ci-task-head"><span className="ci-task-title">Команды воркфлоу</span><span className={`lozenge ${overridden ? 'lozenge-progress' : 'lozenge-neutral'}`}>{overridden ? 'переопределено' : 'унаследовано'}</span></div>
    <CiSlotEditor label="До работы модели" commands={commands} value={before} onChange={(v) => { setBefore(v); setSaved(false) }} />
    <CiSlotEditor label="После работы модели" commands={commands} value={after} onChange={(v) => { setAfter(v); setSaved(false) }} />
    {cleanupWarn && <div className="ci-warn">В слоте «после» есть cleanup-команда, но в «до» нет команды, создающей рабочую директорию.</div>}
    {!saved && <Button variant="primary" className="ci-task-save" onClick={save}>Сохранить команды</Button>}
    </>}
    {props.section === 'machine' && <>
    <div className="ci-task-head"><span className="ci-task-title">Машина выполнения</span></div>
    <label>Машина<select aria-label="Машина выполнения" className="sel" value={agentId ?? ''} onChange={(e) => {
      const next = e.target.value || null
      setAgentId(next)
      setUnavailableAgentId(null)
      setUnavailableName(null)
      setSaveError(null)
      void window.api?.['tasks:update']({ projectId: props.projectId, taskId: props.taskId, agentId: next })
        .catch((error: unknown) => setSaveError(error instanceof Error ? error.message : String(error)))
    }}>
      <option value="">Машина проекта по умолчанию</option>
      {unavailableAgentId && <option value={unavailableAgentId}>{unavailableName ?? 'Недоступная машина'} — недоступна · {unavailableAgentId.slice(0, 8)}</option>}
      {personalMachines.length > 0 && <optgroup label="Мои машины">
        {personalMachines.map((machine) => <option key={machine.agentId} value={machine.agentId}>{machineLabel(machine)}</option>)}
      </optgroup>}
      {projectMachines.length > 0 && <optgroup label="Машины проекта">
        {projectMachines.map((machine) => <option key={machine.agentId} value={machine.agentId}>{machineLabel(machine)}</option>)}
      </optgroup>}
    </select></label>
    {unavailableAgentId && <div className="ci-warn">Сохранённая машина больше не существует или недоступна. Выбор не изменён автоматически; запуск CI заблокирован до выбора доступной машины.</div>}
    {!agentId && !machines.some((machine) => machine.projectDefault) && <div className="ci-warn">Машина проекта по умолчанию не задана или недоступна. Запуск CI заблокирован.</div>}
    {selectedMachine && !selectedMachine.online && <div className="ci-warn">Машина offline. CI не ждёт подключения и не запустится, пока вы не выберете online-машину.</div>}
    {saveError && <div className="ci-warn">Не удалось сохранить машину: {saveError}</div>}
    {/* Принудительный запуск работает и для задачи, чей ран стоит в очереди:
        сервер продвинет его на выбранную машину, а не отменит. */}
    {agentId && selectedMachine?.online && (
      <div className="ci-task-llm-actions">
        <Button size="sm" onClick={() => {
          setForceStatus({ kind: 'idle' })
          void window.ci?.forceStartRun(props.projectId, props.taskId, agentId)
            .then(() => setForceStatus({ kind: 'started' }))
            .catch((err: unknown) => setForceStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) }))
        }} title="Запустить или продвинуть ожидающий ран на выбранной машине">Запустить на этой машине сейчас</Button>
      </div>
    )}
    {forceStatus.kind === 'started' && <p className="ci-task-hint">Ран запущен на выбранной машине, мимо очереди.</p>}
    {forceStatus.kind === 'error' && <div className="ci-warn">{forceStatus.text}</div>}
    </>}
    {props.section === 'model' && <>
    <div className="ci-task-head"><span className="ci-task-title">Движок модели</span><span className={`lozenge ${llmOverridden ? 'lozenge-progress' : 'lozenge-neutral'}`}>{llmOverridden ? 'переопределено' : 'унаследовано'}</span></div>
    <div className="ci-task-llm">
      <label>Движок<select aria-label="Движок модели" className="sel" value={llm.provider} onChange={(e) => changeProvider(e.target.value as 'claude' | 'codex')}>{isProviderAllowed(access, 'claude') && <option value="claude">Claude</option>}{isProviderAllowed(access, 'codex') && <option value="codex">Codex</option>}{!isProviderAllowed(access, 'claude') && !isProviderAllowed(access, 'codex') && <option value="">Нет доступных движков</option>}</select></label>
      <label>Модель<select aria-label="Модель" className="sel" value={llm.model} onChange={(e) => { setLlm({ ...llm, model: e.target.value }); setLlmSaved(false) }}>{!models.some((m) => m.id === llm.model) && <option value={llm.model}>{llm.model}</option>}{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    </div>
    <div className="ci-task-llm">
      <label>Режим запуска<select
        aria-label="Режим запуска"
        className="sel"
        value={llm.mode}
        onChange={(e) => { setLlm({ ...llm, mode: e.target.value as CiRunMode }); setLlmSaved(false) }}
      >{(['plan', 'development'] as CiRunMode[]).map((m) => <option key={m} value={m}>{RUN_MODE_LABEL[m]}</option>)}</select></label>
      <label>Уточнения<select
        aria-label="Степень уточнения"
        className="sel"
        value={llm.clarifyLevel}
        onChange={(e) => { setLlm({ ...llm, clarifyLevel: e.target.value as CiClarifyLevel }); setLlmSaved(false) }}
      >{(['none', 'few', 'medium', 'detailed'] as CiClarifyLevel[]).map((l) => <option key={l} value={l}>{CLARIFY_LEVEL_LABEL[l]}</option>)}</select></label>
    </div>
    {llm.clarifyLevel === 'detailed' && (
      <label className="ci-task-clarify-max">Сколько вопросов (1–{CI_CLARIFY_MAX_LIMIT})<input
        aria-label="Число вопросов"
        className="login-input"
        type="number"
        min={1}
        max={CI_CLARIFY_MAX_LIMIT}
        value={llm.clarifyMax}
        onChange={(e) => {
          const n = Number(e.target.value)
          setLlm({ ...llm, clarifyMax: Number.isFinite(n) ? Math.min(CI_CLARIFY_MAX_LIMIT, Math.max(1, Math.round(n))) : 1 })
          setLlmSaved(false)
        }}
      /></label>
    )}
    <p className="ci-task-hint">
      {llm.mode === 'plan'
        ? 'Модель сначала предложит план и дождётся одобрения в ленте рана.'
        : 'Модель сразу приступит к разработке.'}
    </p>
    <div className="ci-task-llm-actions">
      {!llmSaved && <Button variant="primary" className="ci-task-save" onClick={saveLlm}>Сохранить движок и модель</Button>}
      {llmOverridden && <button type="button" className="ci-task-reset" onClick={resetLlm}>Вернуть настройку проекта</button>}
    </div>
    </>}
  </section>
}
