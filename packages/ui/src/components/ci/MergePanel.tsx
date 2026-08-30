import { useCallback, useEffect, useRef, useState } from 'react'
import { formatDateTime } from '../../lib/dateFormat'
import type { MergeMachineReadiness, MergeRun, TaskRepository } from '@shared/merge'
import type { CiTaskMachine } from '@shared/ci'
import { Button, EmptyState, ErrorState, RefreshIndicator, Skeleton } from '@voicechat/ui-kit'
import { loadView, type LoadStatus } from '../../lib/loadState'
import { MERGE_STATUS_LABEL, MergeRunFeed, mergeStatusTone } from './MergeRunFeed'

/** Вкладка merge задачи: запуск с выбором машины, живая лента выбранной
 *  попытки, история попыток и копии репозиториев задачи по машинам. */
export function MergePanel(props: {
  projectId: string
  taskId: string
  runId: string | null
  canStart: boolean
  onStartMerge?: (agentId: string | null) => void
}): JSX.Element {
  const [machines, setMachines] = useState<CiTaskMachine[]>([])
  const [agentId, setAgentId] = useState('')
  const [mergeReadiness, setMergeReadiness] = useState<Record<string, MergeMachineReadiness>>({})
  const [machinesLoad, setMachinesLoad] = useState<{ key: string; status: LoadStatus; error: string | null }>({
    key: `${props.projectId}:${props.taskId}`,
    status: 'idle',
    error: null
  })
  const [loadedMachinesKey, setLoadedMachinesKey] = useState<string | null>(null)
  const [machinesReload, setMachinesReload] = useState(0)
  const [repos, setRepos] = useState<TaskRepository[]>([])
  const [showDeleted, setShowDeleted] = useState(false)
  const [runs, setRuns] = useState<MergeRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const key = `${props.projectId}:${props.taskId}`
    setMachinesLoad({ key, status: 'loading', error: null })
    void Promise.all([
      window.ci?.getTaskMachines(props.projectId, props.taskId),
      window.ci?.getMergeMachines(props.projectId, props.taskId)
    ]).then(([taskResult, mergeResult]) => {
      if (cancelled) return
      setMachines(taskResult?.machines ?? [])
      setMergeReadiness(Object.fromEntries((mergeResult?.machines ?? []).map((machine) => [machine.agentId, machine.readiness])))
      setAgentId(mergeResult?.defaultAgentId ?? '')
      setLoadedMachinesKey(key)
      setMachinesLoad({ key, status: 'ready', error: null })
    }).catch((error: unknown) => {
      if (cancelled) return
      setMachinesLoad({ key, status: 'error', error: error instanceof Error ? error.message : String(error) })
    })
    return () => { cancelled = true }
  }, [props.projectId, props.taskId, machinesReload])
  const identityRef = useRef('')
  const refreshRef = useRef({
    repositories: { running: false, pending: false },
    runs: { running: false, pending: false }
  })
  const loadResource = useCallback(async (resource: 'repositories' | 'runs'): Promise<void> => {
    const key = `${props.projectId}:${props.taskId}`
    const state = refreshRef.current[resource]
    if (state.running) { state.pending = true; return }
    state.running = true
    try {
      do {
        state.pending = false
        try {
          if (resource === 'repositories') {
            const value = await window.ci?.getTaskRepositories(props.projectId, props.taskId)
            if (identityRef.current === key && value) setRepos(value)
          } else {
            const value = await window.ci?.listMergeRuns(props.projectId, props.taskId)
            if (identityRef.current === key && value) setRuns(value)
          }
        } catch { /* сохраняем последний успешный снимок при фоновой ошибке */ }
      } while (state.pending && identityRef.current === key)
    } finally {
      state.running = false
    }
  }, [props.projectId, props.taskId])
  const upsertRun = useCallback((run: MergeRun): void => {
    setRuns((previous) => [run, ...previous.filter((item) => item.id !== run.id)])
  }, [])
  useEffect(() => {
    const key = `${props.projectId}:${props.taskId}`
    identityRef.current = key
    refreshRef.current = {
      repositories: { running: false, pending: false },
      runs: { running: false, pending: false }
    }
    setRepos([])
    setRuns([])
    setSelectedRunId(null)
    void loadResource('repositories')
    void loadResource('runs')
    let repositoriesTimer: number | null = null
    const scheduleRepositories = (): void => {
      if (repositoriesTimer !== null) window.clearTimeout(repositoriesTimer)
      repositoriesTimer = window.setTimeout(() => {
        repositoriesTimer = null
        if (identityRef.current === key) void loadResource('repositories')
      }, 100)
    }
    const offRepositories = window.board?.onTaskRepositoriesUpdated?.((event) => {
      if (event.projectId === props.projectId && event.taskId === props.taskId) scheduleRepositories()
    })
    const offMerge = window.ci?.onMerge(({ run }) => {
      if (identityRef.current === key && run.projectId === props.projectId && run.taskId === props.taskId) upsertRun(run)
    })
    const offReconnect = window.board?.onReconnect?.(() => {
      if (identityRef.current !== key) return
      scheduleRepositories()
      void loadResource('runs')
    })
    return () => {
      if (identityRef.current === key) identityRef.current = ''
      if (repositoriesTimer !== null) window.clearTimeout(repositoriesTimer)
      offRepositories?.()
      offMerge?.()
      offReconnect?.()
    }
  }, [props.projectId, props.taskId, loadResource, upsertRun])
  const activeRunId = selectedRunId ?? props.runId ?? runs[0]?.id ?? null
  const activeRun = runs.find((run) => run.id === activeRunId)
  const visibleRepos = showDeleted ? repos : repos.filter((repo) => repo.state === 'active')
  const machinesKey = `${props.projectId}:${props.taskId}`
  const currentMachines = loadedMachinesKey === machinesKey ? machines : []
  const currentStatus: LoadStatus = machinesLoad.key === machinesKey ? machinesLoad.status : 'idle'
  const machinesView = loadView(currentStatus, currentMachines.length > 0)
  const personalMachines = currentMachines.filter((machine) => machine.personal)
  const projectMachines = currentMachines.filter((machine) => machine.project && !machine.personal)
  const selectedReadiness = agentId ? mergeReadiness[agentId] : undefined
  const machineOption = (machine: CiTaskMachine): JSX.Element => {
    const readiness = mergeReadiness[machine.agentId]
    const disabled = currentStatus === 'loading' || !readiness?.selectable
    const suffix = readiness ? ` — ${readiness.message}${readiness.mode === 'legacy' && readiness.ready ? ' (legacy)' : ''}` : ' — готовность не проверена'
    return <option key={machine.agentId} value={machine.agentId} disabled={disabled}>{machine.name}{suffix}</option>
  }
  return (
    <div className="merge-panel" data-testid="task-merge-panel">
      <section className="merge-machines" data-testid="merge-machines" aria-busy={machinesView.state === 'skeleton'}>
        {machinesView.state === 'skeleton' && <Skeleton variant="list" item="line" count={2} height={32} testId="merge-machines-skeleton" />}
        {machinesView.state === 'error' && (
          <ErrorState
            message="Не удалось загрузить машины для merge"
            detail={machinesLoad.error}
            onRetry={() => setMachinesReload((value) => value + 1)}
            testId="merge-machines-error"
          />
        )}
        {machinesView.state === 'empty' && (
          <EmptyState
            compact
            icon="🖥"
            title="Нет доступных машин для merge"
            description="Добавьте машину к проекту или проверьте доступ к личным машинам."
            testId="merge-machines-empty"
          />
        )}
        {machinesView.state === 'data' && <>
          {machinesView.refreshing && <RefreshIndicator label="Обновляем машины…" />}
          {machinesView.staleError && (
            <ErrorState compact message="Не удалось обновить машины для merge" detail={machinesLoad.error} onRetry={() => setMachinesReload((value) => value + 1)} />
          )}
          {props.canStart && props.onStartMerge && (
            <div className="merge-start">
              <label className="merge-start-machine">
                Машина рана{' '}
                <select className="sel" aria-label="Машина merge-рана" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                  <option value="" disabled>Выберите готовую машину</option>
                  {personalMachines.length > 0 && <optgroup label="Мои машины">{personalMachines.map(machineOption)}</optgroup>}
                  {projectMachines.length > 0 && <optgroup label="Машины проекта">{projectMachines.map(machineOption)}</optgroup>}
                </select>
              </label>
              <Button variant="primary" disabled={currentStatus === 'loading' || !selectedReadiness?.selectable} onClick={() => props.onStartMerge?.(agentId)}>Мерж в main</Button>
              {selectedReadiness && !selectedReadiness.ready && <span className="merge-start-error" role="alert">{selectedReadiness.message}</span>}
              <span className="merge-start-hint">Ран сольёт подготовленную ветку задачи в main: изолированный клон, обязательные проверки, безопасный push.</span>
            </div>
          )}
        </>}
      </section>
      {activeRun
        ? <MergeRunFeed runId={activeRun.id} initialRun={activeRun} machines={machines} onRunChanged={(run) => { if (run) upsertRun(run) }} />
        : activeRunId
          ? <>
            <span className="vc-sr-only" aria-live="polite">Загрузка merge-рана…</span>
            <Skeleton variant="list" count={3} item="block" height={64} gap={10} />
          </>
          : <EmptyState compact icon="🔀" title="Merge-ранов у задачи ещё не было" description="Ран появится после запуска слияния ветки задачи в main." testId="merge-runs-empty" />}
      {runs.length > 1 && (
        <section className="merge-history">
          <h3 className="ci-task-title">Попытки</h3>
          <ul>
            {runs.map((run) => (
              <li key={run.id}>
                <button type="button" className={`merge-history-item${run.id === activeRunId ? ' merge-history-item--active' : ''}`} onClick={() => setSelectedRunId(run.id)}>
                  <span className={`merge-badge merge-badge--${mergeStatusTone(run.status)}`}>{MERGE_STATUS_LABEL[run.status] ?? run.status}</span>
                  <span>{formatDateTime(run.createdAt)}</span>
                  <span title={run.agentId}>{run.machineName ?? run.agentId}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {repos.length > 0 && (
        <section className="merge-repos" data-testid="task-repositories">
          <div className="merge-repos-head">
            <h3 className="ci-task-title">Репозитории задачи</h3>
            {repos.some((repo) => repo.state === 'deleted') && (
              <label><input type="checkbox" checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)} /> показывать удалённые</label>
            )}
          </div>
          <table>
            <thead><tr><th>Путь</th><th>Машина</th><th>Тип</th><th>Состояние</th></tr></thead>
            <tbody>
              {visibleRepos.map((repo) => (
                <tr key={repo.id}>
                  <td><code>{repo.path}</code></td>
                  <td>{repo.machineName ?? repo.agentId}</td>
                  <td><span className="merge-chip">{repo.kind === 'dev-workspace' ? 'workspace разработки' : 'merge-клон'}</span></td>
                  <td><span className={`merge-chip merge-chip--${repo.state === 'active' ? 'ok' : 'muted'}`}>{repo.state === 'active' ? 'на диске' : 'удалён'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
