import { useCallback, useEffect, useRef, useState } from 'react'
import type { TaskPreparationLlmSelection, TaskPreparationRun } from '@shared/qa'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { LlmEngineOption } from '@shared/admin'
import type { CiTaskMachines } from '@shared/ci'
import { DEFAULT_CI_LLM_CONFIG } from '@shared/ci'
import { allowedModels, isProviderAllowed } from '@shared/llmAccess'
import { Button } from '@voicechat/ui-kit'
import { PreparationRunSteps } from '../ci/RunFeed'

export interface TaskPreparationTabProps {
  projectId: string
  taskId: string
  liveRunId?: string | null
  liveStatus?: TaskPreparationRun['status'] | null
  loadRuns?: (taskId: string) => Promise<TaskPreparationRun[]>
  onStart?: (taskId: string, selection: TaskPreparationLlmSelection) => Promise<TaskPreparationRun | void>
  onRetry?: (runId: string, selection: TaskPreparationLlmSelection) => Promise<TaskPreparationRun | void>
  llmAccess?: UserLlmAccess[]
  llmEngines?: LlmEngineOption[]
  onCancel?: (runId: string) => Promise<TaskPreparationRun | void>
  onAnswer?: (questionId: string, answer: string) => Promise<unknown>
  onExport?: (runId: string, format: 'md' | 'json') => Promise<void>
}

const STATUS_LABEL: Record<TaskPreparationRun['status'], string> = {
  queued: 'в очереди',
  running: 'выполняется',
  waiting_for_answer: 'ожидает ответа',
  validating: 'проверяется',
  completed: 'завершено',
  success: 'успешно',
  failed: 'ошибка',
  cancelled: 'отменён',
  blocked: 'заблокирован'
}

export function TaskPreparationTab(props: TaskPreparationTabProps): JSX.Element {
  const [runs, setRuns] = useState<TaskPreparationRun[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(props.liveRunId ?? null)
  const [loading, setLoading] = useState(Boolean(props.loadRuns))
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<'start' | 'retry' | 'cancel' | 'answer' | null>(null)
  const [answer, setAnswer] = useState('')
  const [selection, setSelection] = useState<TaskPreparationLlmSelection>({ machineId: '', provider: DEFAULT_CI_LLM_CONFIG.provider, model: DEFAULT_CI_LLM_CONFIG.model, llmEngineId: DEFAULT_CI_LLM_CONFIG.llmEngineId })
  const [machines, setMachines] = useState<CiTaskMachines | null>(null)
  const [machinesLoading, setMachinesLoading] = useState(true)
  const [machinesError, setMachinesError] = useState<string | null>(null)
  const [modelsLoading, setModelsLoading] = useState(true)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [machineFallback, setMachineFallback] = useState(false)
  const identityRef = useRef('')
  const liveRunIdRef = useRef(props.liveRunId)
  const refreshStatesRef = useRef(new Map<string, { running: boolean; pending: boolean }>())
  liveRunIdRef.current = props.liveRunId

  const refresh = useCallback(async (): Promise<void> => {
    const loadRuns = props.loadRuns
    const key = `${props.projectId}:${props.taskId}`
    if (!loadRuns) { if (identityRef.current === key) setLoading(false); return }
    let state = refreshStatesRef.current.get(key)
    if (!state) {
      state = { running: false, pending: false }
      refreshStatesRef.current.set(key, state)
    }
    if (state.running) { state.pending = true; return }
    state.running = true
    try {
      do {
        state.pending = false
        try {
          const next = await loadRuns(props.taskId)
          if (identityRef.current !== key) return
          setRuns(next)
          setSelectedId((current) => {
            const liveRunId = liveRunIdRef.current
            if (liveRunId && next.some((run) => run.id === liveRunId)) return liveRunId
            return current && next.some((run) => run.id === current) ? current : next[0]?.id ?? null
          })
          setError(null)
        } catch (reason) {
          if (identityRef.current === key) setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          if (identityRef.current === key) setLoading(false)
        }
      } while (state.pending && identityRef.current === key)
    } finally {
      state.running = false
      if (refreshStatesRef.current.get(key) === state && identityRef.current !== key) refreshStatesRef.current.delete(key)
    }
  }, [props.loadRuns, props.projectId, props.taskId])

  useEffect(() => {
    const key = `${props.projectId}:${props.taskId}`
    identityRef.current = key
    setRuns([])
    setSelectedId(liveRunIdRef.current ?? null)
    setLoading(Boolean(props.loadRuns))
    setError(null)
    void refresh()

    let debounceTimer: number | null = null
    const scheduleRefresh = (): void => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer)
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null
        if (identityRef.current === key) void refresh()
      }, 100)
    }
    const bridge = window.board
    const offUpdate = bridge?.onPreparationRunUpdated?.((event) => {
      if (event.projectId === props.projectId && event.taskId === props.taskId) scheduleRefresh()
    })
    const offReconnect = bridge?.onReconnect?.(() => {
      if (identityRef.current === key) void refresh()
    })
    return () => {
      if (identityRef.current === key) identityRef.current = ''
      if (debounceTimer !== null) window.clearTimeout(debounceTimer)
      offUpdate?.()
      offReconnect?.()
    }
  }, [props.projectId, props.taskId, props.loadRuns, refresh])
  const loadMachines = useCallback(async (): Promise<void> => {
    setMachinesLoading(true)
    setMachinesError(null)
    try {
      if (!window.ci) throw new Error('CI bridge недоступен')
      const value = await window.ci.getTaskMachines(props.projectId, props.taskId)
      setMachines(value)
      const preferred = value.effectiveAgentId
      const preferredMachine = value.machines.find((machine) => machine.agentId === preferred && machine.canUse !== false && machine.online)
      const fallback = value.machines.find((machine) => machine.canUse !== false && machine.online)
      const chosen = preferredMachine ?? fallback
      setSelection((current) => ({ ...current, machineId: chosen?.agentId ?? '' }))
      setMachineFallback(Boolean(preferred && !preferredMachine && fallback))
    } catch (reason) {
      setMachinesError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setMachinesLoading(false)
    }
  }, [props.projectId, props.taskId])

  const loadModels = useCallback(async (): Promise<void> => {
    setModelsLoading(true)
    setModelsError(null)
    try {
      if (!window.ci) throw new Error('CI bridge недоступен')
      const value = await window.ci.getTaskPreparationLlm(props.projectId, props.taskId)
      setSelection((current) => ({ ...current, provider: value.provider, model: value.model, llmEngineId: value.llmEngineId }))
    } catch (reason) {
      setModelsError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setModelsLoading(false)
    }
  }, [props.projectId, props.taskId])

  useEffect(() => { void loadMachines(); void loadModels() }, [loadMachines, loadModels])

  const selected = runs.find((run) => run.id === selectedId) ?? runs[0] ?? null
  const selectedMachine = machines?.machines.find((machine) => machine.agentId === selection.machineId)
  const modelOptions = allowedModels(props.llmAccess ?? [], selection.provider)
  const engineOptions = (props.llmEngines ?? []).filter((engine) => engine.kind === selection.provider)
  const selectionReady = Boolean(selectedMachine?.online && selectedMachine.canUse !== false && selection.model && isProviderAllowed(props.llmAccess ?? [], selection.provider))

  const act = async (kind: 'retry' | 'cancel'): Promise<void> => {
    if (!selected || pending) return
    setPending(kind)
    try {
      const next = await (kind === 'retry' ? props.onRetry?.(selected.id, selection) : props.onCancel?.(selected.id))
      if (next) {
        setRuns((previous) => [next, ...previous.filter((run) => run.id !== next.id)])
        setSelectedId(next.id)
      }
    } finally {
      setPending(null)
    }
  }

  const submitAnswer = async (questionId: string): Promise<void> => {
    if (!answer.trim() || pending || !props.onAnswer) return
    setPending('answer')
    try {
      await props.onAnswer(questionId, answer.trim())
      setAnswer('')
      await refresh()
    } finally {
      setPending(null)
    }
  }

  if (loading && runs.length === 0) return <p className="task-tab-empty">Загрузка истории подготовки…</p>
  if (error && runs.length === 0) return <div role="alert"><p>{error}</p><Button size="sm" onClick={() => void refresh()}>Повторить загрузку</Button></div>

  const start = async (): Promise<void> => {
    if (!props.onStart || pending || !selectionReady) return
    setPending('start')
    try {
      const next = await props.onStart(props.taskId, selection)
      if (next) { setRuns((previous) => [next, ...previous.filter((run) => run.id !== next.id)]); setSelectedId(next.id) }
    } finally { setPending(null) }
  }

  return (
    <div className="task-preparation-tab" data-testid="task-preparation-tab">
      {!selected && <section aria-label="Настройка запуска подготовки">
        <h4>Исполнитель подготовки</h4>
        {machinesLoading ? <p aria-live="polite">Загрузка списка машин…</p> : machinesError ? <div role="alert"><p>Не удалось загрузить машины: {machinesError}</p><Button size="sm" onClick={() => void loadMachines()}>Повторить загрузку машин</Button></div> : (machines?.machines.length ?? 0) === 0 ? <p role="status">В проекте нет доступных машин.</p> : <label>Машина
          <select aria-label="Машина подготовки" value={selection.machineId} onChange={(event) => setSelection((current) => ({ ...current, machineId: event.target.value }))}>
            {(machines?.machines ?? []).map((machine) => <option key={machine.agentId} value={machine.agentId} disabled={!machine.online || machine.canUse === false}>{machine.name}{machine.online ? '' : ' (offline)'}</option>)}
          </select>
        </label>}
        {machineFallback && <p role="status">Машина проекта по умолчанию недоступна — выбрана первая доступная online-машина.</p>}
        <h4>LLM-конфигурация</h4>
        {modelsLoading ? <p aria-live="polite">Загрузка каталога моделей…</p> : modelsError ? <div role="alert"><p>Не удалось загрузить модели: {modelsError}</p><Button size="sm" onClick={() => void loadModels()}>Повторить загрузку моделей</Button></div> : <>
          <label>Исполнитель LLM <select aria-label="Исполнитель LLM" value={selection.llmEngineId ?? ''} onChange={(event) => setSelection((current) => ({ ...current, llmEngineId: event.target.value || null }))}>{engineOptions.map((engine) => <option key={engine.id} value={engine.id}>{engine.name}</option>)}</select></label>
          <label>Провайдер <select aria-label="Провайдер модели" value={selection.provider} onChange={(event) => { const provider = event.target.value as 'claude' | 'codex'; const first = allowedModels(props.llmAccess ?? [], provider)[0]; setSelection((current) => ({ ...current, provider, model: first?.id ?? '' })) }}><option value="claude" disabled={!isProviderAllowed(props.llmAccess ?? [], 'claude')}>Claude</option><option value="codex" disabled={!isProviderAllowed(props.llmAccess ?? [], 'codex')}>Codex</option></select></label>
          <label>Модель <select aria-label="Модель подготовки" value={selection.model} onChange={(event) => setSelection((current) => ({ ...current, model: event.target.value }))}>{modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
        </>}
        <p className="task-tab-empty">Выбор будет зафиксирован в новой попытке.</p>
        <div data-testid="task-preparation-empty"><p className="task-tab-empty">Подготовка к разработке ещё не запускалась.</p>{props.onStart && <Button variant="primary" size="sm" loading={pending === 'start'} disabled={!selectionReady || machinesLoading || modelsLoading} onClick={() => void start()}>Запустить подготовку</Button>}</div>
      </section>}
      {selected && <>
      <div className="jmodal-ci-head">
        <span className="ci-task-title">Подготовка к разработке</span>
        <span className="ci-lozenge">Статус: {STATUS_LABEL[selected.status]}</span>
        <span className="ci-lozenge">Фаза: {selected.phase ?? 'initialization'}</span>
        <span className="ci-lozenge">Машина: {selected.machineName ?? (selected.machineId ? selected.machineId : 'legacy: снимок отсутствует')}</span>
        <span className="ci-lozenge">LLM: {selected.provider ?? 'claude'} · {selected.model || 'по умолчанию'}</span>
        <span className="ci-lozenge">Длительность: {Math.round((selected.durationMs ?? 0) / 1000)} с</span>
      </div>
      {(selected.status === 'failed' || selected.status === 'blocked') && selected.error && <p role="alert">Причина остановки: {selected.error}</p>}
      {(selected.questions ?? []).filter((question) => question.status === 'open').map((question) => (
        <section key={question.questionId} data-testid="task-preparation-question">
          <h4>Требуется уточнение</h4>
          <p>{question.text}</p>
          <textarea aria-label="Ответ на вопрос подготовки" value={answer} onChange={(event) => setAnswer(event.target.value)} />
          <Button size="sm" loading={pending === 'answer'} disabled={!answer.trim()} onClick={() => void submitAnswer(question.questionId)}>Отправить ответ</Button>
        </section>
      ))}
      {(selected.gateResults?.length ?? 0) > 0 && (
        <div>
          <h4>Readiness-гейты</h4>
          <ul data-testid="task-preparation-gates">{(selected.gateResults ?? []).map((gate) => <li key={gate.code}>{gate.code}: {gate.status} — {gate.explanation}</li>)}</ul>
        </div>
      )}
      {selected.gateReasons.length > 0 && (
        <div>
          <h4>Непройденные условия готовности</h4>
          <ul data-testid="task-preparation-gate-reasons">{selected.gateReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
      )}
      <PreparationRunSteps steps={selected.steps ?? []} fallback={selected.log || (selected.canCancel ? 'Ожидаем ответ модели…' : 'Лента этой попытки пуста.')} />
      {selected.readiness && <section data-testid="task-preparation-brief"><h4>Development Brief</h4><pre className="ci-console-pre">{JSON.stringify(selected.readiness, null, 2)}</pre></section>}
      <div className="jmodal-ci-actions">
        {selected.canCancel && props.onCancel && <Button variant="danger" size="sm" loading={pending === 'cancel'} onClick={() => void act('cancel')}>Отменить</Button>}
        {selected.canRetry && props.onRetry && <Button variant="primary" size="sm" loading={pending === 'retry'} onClick={() => void act('retry')}>Повторить подготовку</Button>}
        {props.onExport && <><Button size="sm" onClick={() => void props.onExport?.(selected.id, 'md')}>Скачать Markdown</Button><Button size="sm" onClick={() => void props.onExport?.(selected.id, 'json')}>Скачать JSON</Button></>}
      </div>
      <h4>Предыдущие попытки</h4>
      <ol className="task-progress-list" data-testid="task-preparation-history">
        {runs.map((run) => (
          <li key={run.id}>
            <button type="button" aria-pressed={selected.id === run.id} onClick={() => setSelectedId(run.id)}>
              Попытка {run.attempt} · {new Date(run.createdAt).toLocaleString('ru')} · {run.provider ?? 'claude'} · {run.model || 'по умолчанию'} · {STATUS_LABEL[run.status]}
            </button>
          </li>
        ))}
      </ol>
      </>}
    </div>
  )
}
