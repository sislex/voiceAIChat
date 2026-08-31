// Поиск в рабочей копии: по путям — сразу на клиенте, по содержимому — `git grep` на
// машине по Enter. Разделение то же, что в Make: фильтр имени не должен ходить в сеть,
// а поиск по содержимому — обязан, иначе пришлось бы тащить весь репозиторий в браузер.
import { useState } from 'react'
import { Button, EmptyState, ErrorState, Skeleton } from '@voicechat/ui-kit'
import type { GitGrepResult } from '@shared/gitWorkspace'

export interface GitSearchPanelProps {
  /** Все пути рабочей копии, какие панель уже знает (изменения + прочитанные уровни дерева). */
  knownPaths: readonly string[]
  onOpenFile: (path: string) => void
  onSearch: (query: string) => Promise<GitGrepResult>
}

export function GitSearchPanel({ knownPaths, onOpenFile, onSearch }: GitSearchPanelProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<GitGrepResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = query.trim()
  const byPath = trimmed
    ? knownPaths.filter((path) => path.toLowerCase().includes(trimmed.toLowerCase())).slice(0, 50)
    : []

  const run = async (): Promise<void> => {
    if (trimmed.length < 2) return
    setBusy(true)
    setError(null)
    try {
      setResult(await onSearch(trimmed))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gitpane-search" data-testid="git-search">
      <form
        className="gitpane-search-form"
        onSubmit={(event) => { event.preventDefault(); void run() }}
      >
        <input
          aria-label="Поиск по файлам и содержимому"
          placeholder="Имя файла или текст, Enter — искать в содержимом"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setResult(null) }}
        />
        <Button size="sm" type="submit" loading={busy} disabled={trimmed.length < 2}>Искать</Button>
      </form>

      {error && <ErrorState compact message="Поиск не удался" detail={error} onRetry={() => void run()} />}

      {byPath.length > 0 && (
        <>
          <h4 className="gitpane-search-title">Файлы по имени</h4>
          <ul className="gitpane-search-list" role="list">
            {byPath.map((path) => (
              <li key={path} role="listitem">
                <button type="button" className="gitpane-search-row" onClick={() => onOpenFile(path)}>{path}</button>
              </li>
            ))}
          </ul>
        </>
      )}

      {busy && !result && <Skeleton variant="list" count={4} item="line" height={18} gap={6} />}

      {result && (
        <>
          <h4 className="gitpane-search-title">
            Совпадения в содержимом{result.truncated ? ' (показаны первые)' : ''}
          </h4>
          {result.matches.length === 0
            ? <EmptyState compact icon="🔍" title="Ничего не найдено" description={`В отслеживаемых файлах нет «${result.query}». Бинарные файлы поиск пропускает.`} />
            : (
              <ul className="gitpane-search-list" role="list">
                {result.matches.map((match, index) => (
                  <li key={`${match.path}:${match.line}:${index}`} role="listitem">
                    <button type="button" className="gitpane-search-row" onClick={() => onOpenFile(match.path)}>
                      <span className="gitpane-search-path">{match.path}:{match.line}</span>
                      <code className="gitpane-search-text">{match.text.trim()}</code>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </>
      )}

      {!trimmed && !result && (
        <EmptyState compact icon="🔍" title="Найти файл или текст" description="Имя файла фильтруется на месте; Enter ищет текст в отслеживаемых файлах через git grep." />
      )}
    </div>
  )
}
