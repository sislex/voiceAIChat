import { useCallback, useEffect, useState } from 'react'
import type { MergeMachineReadiness, MergeRun, TaskRepository } from '@shared/merge'
import type { CiTaskMachine } from '@shared/ci'
import { Button } from '@voicechat/ui-kit'
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
  const [readinessLoading, setReadinessLoading] = useState(true)
  const [repos, setRepos] = useState<TaskRepository[]>([])
  const [showDeleted, setShowDeleted] = useState(false)
  const [runs, setRuns] = useState<MergeRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setReadinessLoading(true)
    void Promise.all([
      window.ci?.getTaskMachines(props.projectId, props.taskId),
      window.ci?.getMergeMachines(props.projectId, props.taskId)
    ]).then(([taskResult, mergeResult]) => {
      if (cancelled) return
      setMachines(taskResult?.machines ?? [])
      setMergeReadiness(Object.fromEntries((mergeResult?.machines ?? []).map((machine) => [machine.agentId, machine.readiness])))
      setAgentId(mergeResult?.defaultAgentId ?? '')
    }).catch(() => { if (!cancelled) setMergeReadiness({}) }).finally(() => { if (!cancelled) setReadinessLoading(false) })
    return () => { cancelled = true }
  }, [props.projectId, props.taskId])
  const reload = useCallback((): void => {
    void window.ci?.getTaskRepositories(props.projectId, props.taskId).then(setRepos).catch(() => {})
    void window.ci?.listMergeRuns(props.projectId, props.taskId).then(setRuns).catch(() => {})
  }, [props.projectId, props.taskId])
  useEffect(() => {
    reload()
    const timer = window.setInterval(reload, 5000)
    return () => window.clearInterval(timer)
  }, [reload, props.runId])
  const activeRunId = selectedRunId ?? props.runId ?? runs[0]?.id ?? null
  const visibleRepos = showDeleted ? repos : repos.filter((repo) => repo.state === 'active')
  const personalMachines = machines.filter((machine) => machine.personal)
  const projectMachines = machines.filter((machine) => machine.project && !machine.personal)
  const selectedReadiness = agentId ? mergeReadiness[agentId] : undefined
  const machineOption = (machine: CiTaskMachine): JSX.Element => {
    const readiness = mergeReadiness[machine.agentId]
    const disabled = readinessLoading || !readiness?.selectable
    const suffix = readiness ? ` — ${readiness.message}${readiness.mode === 'legacy' && readiness.ready ? ' (legacy)' : ''}` : ' — готовность не проверена'
    return <option key={machine.agentId} value={machine.agentId} disabled={disabled}>{machine.name}{suffix}</option>
  }
  return (
    <div className="merge-panel" data-testid="task-merge-panel">
      {props.canStart && props.onStartMerge && (
        <div className="merge-start">
          <label className="merge-start-machine">
            Машина рана{' '}
            <select aria-label="Машина merge-рана" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
              <option value="" disabled>Выберите готовую машину</option>
              {personalMachines.length > 0 && <optgroup label="Мои машины">{personalMachines.map(machineOption)}</optgroup>}
              {projectMachines.length > 0 && <optgroup label="Машины проекта">{projectMachines.map(machineOption)}</optgroup>}
            </select>
          </label>
          <Button variant="primary" disabled={readinessLoading || !selectedReadiness?.selectable} onClick={() => props.onStartMerge?.(agentId)}>Мерж в main</Button>
          {selectedReadiness && !selectedReadiness.ready && <span className="merge-start-error" role="alert">{selectedReadiness.message}</span>}
          <span className="merge-start-hint">Ран сольёт подготовленную ветку задачи в main: изолированный клон, обязательные проверки, безопасный push.</span>
        </div>
      )}
      {activeRunId ? <MergeRunFeed runId={activeRunId} machines={machines} onRunChanged={reload} /> : <p className="task-tab-empty">Merge-ранов у задачи ещё не было.</p>}
      {runs.length > 1 && (
        <section className="merge-history">
          <strong>Попытки</strong>
          <ul>
            {runs.map((run) => (
              <li key={run.id}>
                <button type="button" className={`merge-history-item${run.id === activeRunId ? ' merge-history-item--active' : ''}`} onClick={() => setSelectedRunId(run.id)}>
                  <span className={`merge-badge merge-badge--${mergeStatusTone(run.status)}`}>{MERGE_STATUS_LABEL[run.status] ?? run.status}</span>
                  <span>{new Date(run.createdAt).toLocaleString()}</span>
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
            <strong>Репозитории задачи</strong>
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
