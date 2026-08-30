import { useCallback, useEffect, useRef, useState } from 'react'
import type { TaskPreparationLlmSelection, TaskPreparationRun } from '@shared/qa'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { LlmEngineOption } from '@shared/admin'
import type { CiTaskMachines } from '@shared/ci'
import { DEFAULT_CI_LLM_CONFIG } from '@shared/ci'
import { allowedModels, isProviderAllowed } from '@shared/llmAccess'
import { Button } from '@voicechat/ui-kit'
import { PreparationRunSteps } from '../ci/RunFeed'
import { EmptyState, ErrorState, Skeleton } from '@voicechat/ui-kit'
import { formatDateTime } from '../../lib/dateFormat'

export interface TaskPreparationTabProps {
  projectId: string
  taskId: string
  liveRunId?: string | null
  liveStatus?: TaskPreparationRun['status'] | null
  loadRuns?: (taskId: string) => Promise<TaskPreparationRun[]>
  /** Догрузка одного рана по id: обновление по WS патчит локальный список без перезапроса всего. */
  loadRun?: (runId: string) => Promise<TaskPreparationRun | null>
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

  // Патч одного рана в локальный список: WS-обновление приходит по одному рану,
  // поэтому весь тяжёлый список (`preparation/runs`) больше не перезапрашивается.
  const applyRun = useCallback((run: TaskPreparationRun | null): void => {
    if (!run) return
    setRuns((current) => {
      const index = current.findIndex((item) => item.id === run.id)
      if (index === -1) return [run, ...current]
      const next = current.slice(); next[index] = run; return next
    })
    setSelectedId((current) => current ?? run.id)
  }, [])

  useEffect(() => {
    const key = `${props.projectId}:${props.taskId}`
    identityRef.current = key
    setRuns([])
    setSelectedId(liveRunIdRef.current ?? null)
    setLoading(Boolean(props.loadRuns))
    setError(null)
    void refresh() // первичная загрузка списка — один раз при открытии

    // Обновления по WS: догружаем только изменившиеся раны (коалесинг по runId,
    // троттл 500мс). Без loadRun (старые тесты) — деградация к полному refresh.
    const pendingRunIds = new Set<string>()
    let debounceTimer: number | null = null
    const flush = async (): Promise<void> => {
      debounceTimer = null
      const ids = [...pendingRunIds]; pendingRunIds.clear()
      const loadRun = props.loadRun
      if (!loadRun) { if (identityRef.current === key) void refresh(); return }
      for (const id of ids) {
        try { const run = await loadRun(id); if (identityRef.current === key) applyRun(run) }
        catch { /* один пропущенный ран не роняет панель; reconnect дозагрузит */ }
      }
    }
    const scheduleRunPatch = (runId: string): void => {
      pendingRunIds.add(runId)
      if (debounceTimer !== null) return
      debounceTimer = window.setTimeout(() => { void flush() }, 500)
    }
    const bridge = window.board
    const offUpdate = bridge?.onPreparationRunUpdated?.((event) => {
      if (event.projectId === props.projectId && event.taskId === props.taskId) scheduleRunPatch(event.runId)
    })
    const offReconnect = bridge?.onReconnect?.(() => {
      if (identityRef.current === key) void refresh() // мог пропустить события — полная сверка
    })
    return () => {
      if (identityRef.current === key) identityRef.current = ''
      if (debounceTimer !== null) window.clearTimeout(debounceTimer)
      offUpdate?.()
      offReconnect?.()
    }
  }, [props.projectId, props.taskId, props.loadRuns, props.loadRun, refresh, applyRun])
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

  if (loading && runs.length === 0) return <>
    <span className="vc-sr-only" aria-live="polite">Загрузка истории подготовки…</span>
    <Skeleton variant="list" count={3} item="block" height={64} gap={10} />
  </>
  if (error && runs.length === 0) return <ErrorState message="Не удалось загрузить историю подготовки" detail={error} onRetry={() => void refresh()} />

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
      {/* Форма запуска — та же карточка с секциями, что во вкладке «Настройки»:
          селекты в сетке «подпись сверху», а не голыми контролами в строке. */}
      {!selected && <section className="task-preparation-setup" aria-label="Настройка запуска подготовки">
        <div className="ci-task-head"><h3 className="ci-task-title">Исполнитель подготовки</h3></div>
        {machinesLoading ? <Skeleton variant="block" height={44} />
          : machinesError ? <ErrorState compact message="Не удалось загрузить машины" detail={machinesError} onRetry={() => void loadMachines()} />
            : (machines?.machines.length ?? 0) === 0
              ? <EmptyState compact icon="🖥" title="Доступных машин нет" description="Добавьте машину в проект или проверьте доступ к личным машинам." testId="task-preparation-no-machines" />
              : <label className="task-preparation-field">Машина
                <select className="sel" aria-label="Машина подготовки" value={selection.machineId} onChange={(event) => setSelection((current) => ({ ...current, machineId: event.target.value }))}>
                  {(machines?.machines ?? []).filter((machine) => machine.agentId.trim()).map((machine) => <option key={machine.agentId} value={machine.agentId} disabled={!machine.online || machine.canUse === false}>{machine.name?.trim() || machine.agentId}{machine.online ? '' : ' (offline)'}</option>)}
                </select>
              </label>}
        {machineFallback && <p className="ci-task-hint" role="status">Машина проекта по умолчанию недоступна — выбрана первая доступная online-машина.</p>}
        <div className="ci-task-head"><h3 className="ci-task-title">LLM-конфигурация</h3></div>
        {modelsLoading ? <Skeleton variant="block" height={44} />
          : modelsError ? <ErrorState compact message="Не удалось загрузить модели" detail={modelsError} onRetry={() => void loadModels()} />
            : <div className="task-preparation-grid">
              <label className="task-preparation-field">Исполнитель LLM <select className="sel" aria-label="Исполнитель LLM" value={selection.llmEngineId ?? ''} onChange={(event) => setSelection((current) => ({ ...current, llmEngineId: event.target.value || null }))}>{engineOptions.map((engine) => <option key={engine.id} value={engine.id}>{engine.name}</option>)}</select></label>
              <label className="task-preparation-field">Провайдер <select className="sel" aria-label="Провайдер модели" value={selection.provider} onChange={(event) => { const provider = event.target.value as 'claude' | 'codex'; const first = allowedModels(props.llmAccess ?? [], provider)[0]; setSelection((current) => ({ ...current, provider, model: first?.id ?? '' })) }}><option value="claude" disabled={!isProviderAllowed(props.llmAccess ?? [], 'claude')}>Claude</option><option value="codex" disabled={!isProviderAllowed(props.llmAccess ?? [], 'codex')}>Codex</option></select></label>
              <label className="task-preparation-field">Модель <select className="sel" aria-label="Модель подготовки" value={selection.model} onChange={(event) => setSelection((current) => ({ ...current, model: event.target.value }))}>{modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
            </div>}
        {/* Это подсказка, а не пустой экран: пунктирная рамка `.task-tab-empty`
            обещала содержимое, которого здесь и не должно быть. */}
        <p className="ci-task-hint">Выбор будет зафиксирован в новой попытке.</p>
        <div data-testid="task-preparation-empty">
          <EmptyState
            compact
            icon="🧭"
            title="Подготовка к разработке ещё не запускалась"
            description="Модель разберётся в задаче и соберёт Development Brief."
            actionLabel={props.onStart ? 'Запустить подготовку' : undefined}
            onAction={props.onStart && selectionReady && !machinesLoading && !modelsLoading ? () => void start() : undefined}
            testId="task-preparation-empty-state"
          />
        </div>
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
          <ul data-testid="task-preparation-gates">{(selected.gateResults ?? []).map((gate) => <li key={gate.code}><span className={`vc-feed-dot vc-feed-dot--${gate.status === 'pass' ? 'success' : 'danger'}`} aria-hidden="true" /> {gate.code}: {gate.status === 'pass' ? 'пройден' : 'не пройден'} — {gate.explanation}</li>)}</ul>
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
              Попытка {run.attempt} · {formatDateTime(run.createdAt)} · {run.provider ?? 'claude'} · {run.model || 'по умолчанию'} · {STATUS_LABEL[run.status]}
            </button>
          </li>
        ))}
      </ol>
      </>}
    </div>
  )
}
