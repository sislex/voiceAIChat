import { useEffect, useState } from 'react'
import type { TaskRepository } from '@shared/merge'
import type { ProjectMachine } from '@shared/projects'
import { Button } from '../ui/Button'
import { MergeRunFeed } from './MergeRunFeed'

/** Вкладка merge задачи: выбор машины рана, живая лента и копии репозиториев
 *  задачи по машинам. Пустой выбор машины — серверный дефолт (машина workspace). */
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
  useEffect(() => {
    let cancelled = false
    void (window.api?.['projects:get']({ id: props.projectId }) ?? Promise.resolve(null)).then((project) => {
      if (!cancelled && project) setMachines(project.machines)
    })
    return () => { cancelled = true }
  }, [props.projectId])
  useEffect(() => {
    let cancelled = false
    const load = (): void => { void window.ci?.getTaskRepositories(props.projectId, props.taskId).then((value) => { if (!cancelled) setRepos(value) }).catch(() => {}) }
    load()
    const timer = window.setInterval(load, 5000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [props.projectId, props.taskId, props.runId])
  return (
    <div className="merge-panel" data-testid="task-merge-panel">
      {props.canStart && props.onStartMerge && (
        <div className="merge-panel-start">
          <label>
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
        </div>
      )}
      {props.runId ? <MergeRunFeed runId={props.runId} /> : <p className="task-tab-empty">Merge-ранов у задачи ещё не было.</p>}
      {repos.length > 0 && (
        <section className="merge-panel-repos" data-testid="task-repositories">
          <strong>Репозитории задачи</strong>
          <ul>
            {repos.map((repo) => (
              <li key={repo.id}>
                <code>{repo.path}</code> · {repo.machineName ?? repo.agentId} · {repo.kind === 'dev-workspace' ? 'workspace разработки' : 'merge-клон'} · {repo.state === 'active' ? 'на диске' : 'удалён'}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
