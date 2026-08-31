// Точка входа в панель кода: рабочие копии проекта. Список собирается сервером из
// своих таблиц (`ci_workspaces`, `task_repositories`, папка проекта на машине), без
// единого обращения к машинам — поэтому вкладка открывается мгновенно даже там, где
// половина машин офлайн, а состояние git читается уже после выбора копии.
import { Button, EmptyState, ErrorState, Skeleton, StatusPill } from '@voicechat/ui-kit'
import type { GitWorkspaceRef } from '@shared/gitWorkspace'
import { loadView, type LoadStatus } from '../../lib/loadState'
import { gitWorkspaceLabel } from './gitLabels'

export interface GitWorkspaceListProps {
  workspaces: GitWorkspaceRef[]
  status: LoadStatus
  error: string | null
  onOpen: (workspaceId: string) => void
  onRetry: () => void
}

export function GitWorkspaceList({ workspaces, status, error, onOpen, onRetry }: GitWorkspaceListProps): JSX.Element {
  const view = loadView(status, workspaces.length > 0)
  if (view.state === 'skeleton') {
    return <div className="gitlist" data-testid="git-workspace-list" aria-busy="true"><Skeleton variant="list" count={3} item="block" height={56} gap={12} /></div>
  }
  if (view.state === 'error') {
    return <div className="gitlist" data-testid="git-workspace-list"><ErrorState message="Не удалось загрузить рабочие копии" detail={error} onRetry={onRetry} /></div>
  }
  if (view.state === 'empty') {
    return (
      <div className="gitlist" data-testid="git-workspace-list">
        <EmptyState
          icon="🌿"
          title="Рабочих копий пока нет"
          description="Копия появляется, когда ран задачи клонирует репозиторий на машину. Запустите ран задачи — и здесь можно будет смотреть и править её код."
        />
      </div>
    )
  }
  return (
    <div className="gitlist" data-testid="git-workspace-list">
      {view.staleError && <ErrorState compact message="Список мог устареть" detail={error} onRetry={onRetry} />}
      <ul className="gitlist-items" role="list">
        {workspaces.map((ref) => (
          <li key={ref.id} role="listitem" className="gitlist-item">
            <div className="gitlist-item-main">
              <strong className="gitlist-item-title">{gitWorkspaceLabel(ref)}</strong>
              <code className="gitlist-item-path">{ref.path}</code>
            </div>
            <div className="gitlist-item-tags">
              {!ref.online && <StatusPill tone="warning">машина офлайн</StatusPill>}
              {ref.released && <StatusPill tone="danger">каталог освобождён</StatusPill>}
              {ref.busy && <StatusPill tone="running">{ref.busy.kind === 'ci' ? 'идёт CI-ран' : 'идёт merge-ран'}</StatusPill>}
              {!ref.writable && !ref.released && <StatusPill tone="neutral">только чтение</StatusPill>}
              {ref.pushed === false && <StatusPill tone="accent">не отправлена</StatusPill>}
            </div>
            <Button size="sm" disabled={!ref.online} onClick={() => onOpen(ref.id)}>Открыть</Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
