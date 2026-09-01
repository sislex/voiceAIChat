// Трёхсторонний просмотр конфликта: наша версия против их, с общим предком под рукой.
//
// Сравниваем `ours` ↔ `theirs` существующим `CodeDiff`: это то, что человек и решает —
// какую сторону оставить. Общий предок (`:1:`) показываем по требованию: он нужен, чтобы
// понять, кто что изменил, но постоянно занимать им половину экрана незачем.
//
// Автоматического слияния здесь нет намеренно: панель либо оставляет одну сторону
// целиком, либо отправляет человека в терминал. Полуавтоматика на конфликтах — это
// способ молча потерять чужую правку.
import { useState } from 'react'
import { Button, EmptyState } from '@voicechat/ui-kit'
import type { GitConflictStages, GitConflictSide } from '@shared/gitWorkspace'
import { CodeDiff } from '../CodeDiff'

export interface GitConflictViewProps {
  stages: GitConflictStages
  writable: boolean
  busy: boolean
  onResolve: (side: GitConflictSide) => void
  onOpenTerminal?: () => void
}

export function GitConflictView({ stages, writable, busy, onResolve, onOpenTerminal }: GitConflictViewProps): JSX.Element {
  const [showBase, setShowBase] = useState(false)
  const ours = stages.ours?.content ?? ''
  const theirs = stages.theirs?.content ?? ''
  const binary = stages.ours?.binary || stages.theirs?.binary

  if (binary) {
    return (
      <div className="gitpane-conflict" data-testid="git-conflict">
        <EmptyState
          compact
          icon="🧱"
          title="Бинарный конфликт"
          description="Сравнить нельзя — выберите сторону целиком или разрешите конфликт в терминале машины."
        />
        <ConflictActions writable={writable} busy={busy} onResolve={onResolve} onOpenTerminal={onOpenTerminal} />
      </div>
    )
  }

  return (
    <div className="gitpane-conflict" data-testid="git-conflict">
      <div className="gitpane-conflict-head">
        <span className="gitpane-conflict-legend">Слева — наша версия, справа — их</span>
        <Button size="sm" variant="ghost" onClick={() => setShowBase((prev) => !prev)}>
          {showBase ? 'Скрыть общего предка' : 'Показать общего предка'}
        </Button>
      </div>
      <div className="gitpane-conflict-diff">
        <CodeDiff path={stages.path} original={ours} modified={theirs} />
      </div>
      {showBase && (
        <div className="gitpane-conflict-base" data-testid="git-conflict-base">
          <span className="gitpane-conflict-legend">Общий предок ↔ наша версия</span>
          <CodeDiff path={stages.path} original={stages.base?.content ?? ''} modified={ours} />
        </div>
      )}
      <ConflictActions writable={writable} busy={busy} onResolve={onResolve} onOpenTerminal={onOpenTerminal} />
    </div>
  )
}

function ConflictActions({ writable, busy, onResolve, onOpenTerminal }: Omit<GitConflictViewProps, 'stages'>): JSX.Element {
  return (
    <div className="gitpane-conflict-actions">
      <Button size="sm" loading={busy} disabled={!writable} onClick={() => onResolve('ours')}>Оставить нашу</Button>
      <Button size="sm" loading={busy} disabled={!writable} onClick={() => onResolve('theirs')}>Оставить их</Button>
      {onOpenTerminal && <Button size="sm" variant="ghost" onClick={onOpenTerminal}>Открыть терминал машины</Button>}
    </div>
  )
}
