// Панель кода, привязанная к задаче или к разговору, а не к выбранной рабочей копии.
//
// Нужна там, где человек не выбирает копию руками: в карточке задачи и рядом с чатом.
// Копию находит сама — по списку рабочих копий проекта, — и отдаёт `GitPane`. Своей
// логики git здесь нет, только выбор цели и объяснение, если её нет.
import { useCallback, useEffect, useState } from 'react'
import { EmptyState, ErrorState, Skeleton } from '@voicechat/ui-kit'
import type { RendererApi } from '@shared/ipc'
import type { GitWorkspaceRef } from '@shared/gitWorkspace'
import { GitPane, type GitPaneApi } from './GitPane'
import { loadView, type LoadStatus } from '../../lib/loadState'

export type GitTargetPaneApi = GitPaneApi & Pick<RendererApi, 'projects:gitWorkspaces'>

export interface GitTargetPaneProps {
  projectId: string
  api: GitTargetPaneApi
  /** Задача, чью рабочую копию открыть. */
  taskId?: string
  /** Разговор, чью рабочую копию открыть (если задача не указана). */
  conversationId?: string
  onOpenGitAccess?: (agentId: string) => void
  onOpenRun?: (kind: 'ci' | 'merge', runId: string) => void
}

/**
 * Какую копию показать: у задачи — её рабочую копию разработки (merge-клон только
 * читается и для «посмотреть, что наменяла модель» не годится), у разговора — его.
 */
export function pickGitWorkspace(
  workspaces: GitWorkspaceRef[],
  target: { taskId?: string; conversationId?: string }
): GitWorkspaceRef | null {
  if (target.conversationId) {
    return workspaces.find((ref) => ref.conversationId === target.conversationId) ?? null
  }
  if (!target.taskId) return null
  const ofTask = workspaces.filter((ref) => ref.taskId === target.taskId)
  return ofTask.find((ref) => ref.kind === 'task-workspace' && !ref.released)
    ?? ofTask.find((ref) => ref.kind === 'task-workspace')
    ?? ofTask[0]
    ?? null
}

export function GitTargetPane({ projectId, api, taskId, conversationId, onOpenGitAccess, onOpenRun }: GitTargetPaneProps): JSX.Element {
  const [workspaces, setWorkspaces] = useState<GitWorkspaceRef[]>([])
  const [state, setState] = useState<{ status: LoadStatus; error: string | null }>({ status: 'idle', error: null })

  const load = useCallback(async (): Promise<void> => {
    setState((prev) => ({ ...prev, status: 'loading' }))
    try {
      setWorkspaces(await api['projects:gitWorkspaces']({ id: projectId }))
      setState({ status: 'ready', error: null })
    } catch (error) {
      setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }, [api, projectId])

  useEffect(() => { void load() }, [load])

  const chosen = pickGitWorkspace(workspaces, { ...(taskId ? { taskId } : {}), ...(conversationId ? { conversationId } : {}) })
  const view = loadView(state.status, chosen !== null)

  if (view.state === 'skeleton') {
    return <div className="gitpane" data-testid="git-target-pane" aria-busy="true"><Skeleton variant="list" count={4} item="block" height={28} gap={8} /></div>
  }
  if (view.state === 'error') {
    return (
      <div className="gitpane" data-testid="git-target-pane">
        <ErrorState message="Не удалось найти рабочую копию" detail={state.error} onRetry={() => void load()} />
      </div>
    )
  }
  if (!chosen) {
    return (
      <div className="gitpane" data-testid="git-target-pane">
        <EmptyState
          icon="🌿"
          title="Рабочей копии пока нет"
          description={taskId
            ? 'Копия появится, когда ран задачи клонирует репозиторий на машину. Запустите ран — и код задачи можно будет смотреть и править здесь.'
            : 'У этого разговора нет рабочего каталога с git. Задайте его в настройках разговора или работайте с копией задачи.'}
        />
      </div>
    )
  }
  return (
    <GitPane
      projectId={projectId}
      workspaceId={chosen.id}
      api={api}
      {...(onOpenGitAccess ? { onOpenGitAccess } : {})}
      {...(onOpenRun ? { onOpenRun } : {})}
    />
  )
}
