// История: коммиты ветки и что внутри коммита.
//
// Список приходит готовым (`git log`), состав файлов — по клику: спрашивать состав у
// пятидесяти коммитов сразу значит пятьдесят команд на машину ради строчки, которую
// человек, скорее всего, не откроет.
import { useState } from 'react'
import { ErrorState, Skeleton } from '@voicechat/ui-kit'
import { formatDateTime } from '../../lib/dateFormat'
import type { GitCommitDetail, GitCommitInfo } from '@shared/gitWorkspace'
import { gitChangeShort } from './gitLabels'

export interface GitCommitListProps {
  commits: GitCommitInfo[]
  /** Подпись списка: «сверх origin/main» или «история файла». */
  title: string
  loadDetail: (sha: string) => Promise<GitCommitDetail>
  onOpenFile?: (path: string) => void
}

export function GitCommitList({ commits, title, loadDetail, onOpenFile }: GitCommitListProps): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, GitCommitDetail | { error: string }>>({})

  const toggle = async (sha: string): Promise<void> => {
    if (open === sha) {
      setOpen(null)
      return
    }
    setOpen(sha)
    if (detail[sha]) return
    try {
      const loaded = await loadDetail(sha)
      setDetail((prev) => ({ ...prev, [sha]: loaded }))
    } catch (error) {
      setDetail((prev) => ({ ...prev, [sha]: { error: error instanceof Error ? error.message : String(error) } }))
    }
  }

  return (
    <div className="gitpane-commits" data-testid="git-commits">
      <h4>{title}</h4>
      <ul role="list">
        {commits.map((commit) => {
          const info = detail[commit.sha]
          return (
            <li key={commit.sha} role="listitem" className="gitpane-commit">
              <button
                type="button"
                className="gitpane-commit-row"
                aria-expanded={open === commit.sha}
                onClick={() => void toggle(commit.sha)}
              >
                <code>{commit.sha.slice(0, 8)}</code>
                <span className="gitpane-commit-subject">{commit.subject}</span>
                <span className="gitpane-commit-meta">{commit.author} · {formatDateTime(commit.at * 1000)}</span>
              </button>
              {open === commit.sha && (
                info === undefined
                  ? <Skeleton variant="list" count={2} item="line" height={16} gap={4} />
                  : 'error' in info
                    ? <ErrorState compact message="Коммит не прочитан" detail={info.error} onRetry={() => void toggle(commit.sha)} />
                    : (
                      <ul className="gitpane-commit-files" role="list">
                        {info.files.map((file) => (
                          <li key={file.path} role="listitem">
                            <button type="button" className="gitpane-commit-file" onClick={() => onOpenFile?.(file.path)}>
                              <span className="gitpane-change-mark" aria-hidden="true">{gitChangeShort(file.state)}</span>
                              {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                            </button>
                          </li>
                        ))}
                        {info.truncated && <li role="listitem" className="gitpane-commit-more">Показаны первые файлы</li>}
                      </ul>
                    )
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
