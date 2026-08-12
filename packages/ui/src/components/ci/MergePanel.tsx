import { useCallback, useEffect, useState } from 'react'
import type { MergeRun, TaskRepository } from '@shared/merge'
import type { ProjectMachine } from '@shared/projects'
import { Button } from '../ui/Button'
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
  const [machines, setMachines] = useState<ProjectMachine[]>([])
  const [agentId, setAgentId] = useState('')
  const [repos, setRepos] = useState<TaskRepository[]>([])
  const [showDeleted, setShowDeleted] = useState(false)
  const [runs, setRuns] = useState<MergeRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void (window.api?.['projects:get']({ id: props.projectId }) ?? Promise.resolve(null)).then((project) => {
      if (!cancelled && project) setMachines(project.machines)
    })
    return () => { cancelled = true }
  }, [props.projectId])
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
  return (
    <div className="merge-panel" data-testid="task-merge-panel">
      {props.canStart && props.onStartMerge && (
        <div className="merge-start">
          <label className="merge-start-machine">
            Машина рана{' '}
            <select aria-label="Машина merge-рана" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
              <option value="">Машина workspace (по умолчанию)</option>
              {machines.map((machine) => (
                <option key={machine.agentId} value={machine.agentId} disabled={machine.online === false}>
                  {machine.name ?? machine.agentId}{machine.online === false ? ' (офлайн)' : ''}
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" onClick={() => props.onStartMerge?.(agentId || null)}>Мерж в main</Button>
          <span className="merge-start-hint">Ран сольёт подготовленную ветку задачи в main: изолированный клон, обязательные проверки, безопасный push.</span>
        </div>
      )}
      {activeRunId ? <MergeRunFeed runId={activeRunId} onRunChanged={reload} /> : <p className="task-tab-empty">Merge-ранов у задачи ещё не было.</p>}
      {runs.length > 1 && (
        <section className="merge-history">
          <strong>Попытки</strong>
          <ul>
            {runs.map((run) => (
              <li key={run.id}>
                <button type="button" className={`merge-history-item${run.id === activeRunId ? ' merge-history-item--active' : ''}`} onClick={() => setSelectedRunId(run.id)}>
                  <span className={`merge-badge merge-badge--${mergeStatusTone(run.status)}`}>{MERGE_STATUS_LABEL[run.status] ?? run.status}</span>
                  <span>{new Date(run.createdAt).toLocaleString()}</span>
                  <span>{run.machineName ?? run.agentId}</span>
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
