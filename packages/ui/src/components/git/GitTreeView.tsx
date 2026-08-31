// Дерево файлов рабочей копии: раскрывается по уровням, а не грузится целиком.
//
// Целиком нельзя: вывод exec машины ограничен 200 КБ, и `git ls-files` монорепо в него
// не влезает. Поэтому каждый каталог — отдельный `ls-tree -l` по требованию, а уже
// открытые уровни кэшируются, пока панель жива.
import { useCallback, useEffect, useState } from 'react'
import { ErrorState, Skeleton } from '@voicechat/ui-kit'
import type { GitTreeEntry } from '@shared/gitWorkspace'

export interface GitTreeViewProps {
  /** Читает один уровень дерева: путь каталога («» — корень). */
  loadDir: (dir: string) => Promise<GitTreeEntry[]>
  selectedPath: string | null
  onOpenFile: (path: string) => void
}

interface Level {
  entries: GitTreeEntry[]
  error: string | null
}

export function GitTreeView({ loadDir, selectedPath, onOpenFile }: GitTreeViewProps): JSX.Element {
  const [levels, setLevels] = useState<Record<string, Level>>({})
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<Set<string>>(new Set())

  const read = useCallback(async (dir: string): Promise<void> => {
    setLoading((prev) => new Set(prev).add(dir))
    try {
      const entries = await loadDir(dir)
      setLevels((prev) => ({ ...prev, [dir]: { entries, error: null } }))
    } catch (error) {
      setLevels((prev) => ({ ...prev, [dir]: { entries: [], error: error instanceof Error ? error.message : String(error) } }))
    } finally {
      setLoading((prev) => {
        const copy = new Set(prev)
        copy.delete(dir)
        return copy
      })
    }
  }, [loadDir])

  useEffect(() => {
    setLevels({})
    setOpen(new Set())
    void read('')
  }, [read])

  const toggle = (dir: string): void => {
    setOpen((prev) => {
      const copy = new Set(prev)
      if (copy.has(dir)) copy.delete(dir)
      else {
        copy.add(dir)
        if (!levels[dir]) void read(dir)
      }
      return copy
    })
  }

  /** Глубже этого дерево не раскрываем: защита от кривых данных, а не ограничение UX. */
  const MAX_DEPTH = 24

  const renderLevel = (dir: string, depth: number): JSX.Element => {
    if (depth > MAX_DEPTH) return <></>
    const level = levels[dir]
    if (loading.has(dir) && !level) {
      return <Skeleton variant="list" count={3} item="line" height={18} gap={6} testId="git-tree-skeleton" />
    }
    if (level?.error) {
      return <ErrorState compact message="Каталог не прочитан" detail={level.error} onRetry={() => void read(dir)} />
    }
    return (
      <ul className="gitpane-tree" role={depth === 0 ? 'tree' : 'group'}>
        {(level?.entries ?? []).map((entry) => (
          <li key={entry.path} role="treeitem" aria-expanded={entry.kind === 'dir' ? open.has(entry.path) : undefined} aria-selected={entry.kind === 'file' && entry.path === selectedPath}>
            <button
              type="button"
              className="gitpane-tree-row"
              style={{ paddingLeft: `${depth * 12 + 6}px` }}
              onClick={() => entry.kind === 'dir' ? toggle(entry.path) : onOpenFile(entry.path)}
            >
              <span aria-hidden="true" className="gitpane-tree-mark">{entry.kind === 'dir' ? (open.has(entry.path) ? '▾' : '▸') : '·'}</span>
              <span className="gitpane-tree-name">{entry.name}</span>
            </button>
            {/* `entry.path !== dir` — страховка от ответа, где каталог содержит сам
                себя: без неё рекурсия рендера вешала бы вкладку. */}
            {entry.kind === 'dir' && entry.path !== dir && open.has(entry.path) && renderLevel(entry.path, depth + 1)}
          </li>
        ))}
      </ul>
    )
  }

  return <nav className="gitpane-treewrap" aria-label="Файлы рабочей копии" data-testid="git-tree">{renderLevel('', 0)}</nav>
}
