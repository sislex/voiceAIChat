import { useEffect, useMemo, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { KbDocument, KbDocumentKind, KbSearchResult, KbStatus } from '@shared/kb'
import { Markdown } from './Markdown'
import { ToolFrame } from './ToolFrame'
import { Skeleton, RefreshIndicator } from './ui/Skeleton'
import { EmptyState } from './ui/EmptyState'
import { ErrorState } from './ui/ErrorState'
import { loadView, type LoadStatus } from '../lib/loadState'

const KINDS: Array<{ id: KbDocumentKind | ''; label: string }> = [
  { id: '', label: 'Все' }, { id: 'feature', label: 'Фичи' }, { id: 'subsystem', label: 'Подсистемы' },
  { id: 'protocol', label: 'Протоколы' }, { id: 'decision', label: 'Решения' },
  { id: 'convention', label: 'Подходы' }, { id: 'runbook', label: 'Диагностика' }
]

export function KnowledgeBase({ api, onClose, variant = 'modal', documentId = null }: { api: RendererApi; onClose: () => void; variant?: 'modal' | 'page'; /** Документ из адреса (#/kb/:documentId) — открыть его сразу. */ documentId?: string | null }): JSX.Element {
  const [status, setStatus] = useState<KbStatus | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KbDocumentKind | ''>('')
  const [results, setResults] = useState<KbSearchResult[]>([])
  const [document, setDocument] = useState<KbDocument | null>(null)
  // Состояние поиска и его ошибка отдельно от ошибки открытия документа: это два
  // разных места экрана, и «не нашлось» не должно выглядеть как «сломалось».
  const [search, setSearch] = useState<LoadStatus>('loading')
  const [searchError, setSearchError] = useState<string | null>(null)
  // Счётчик попыток: кнопка «Повторить» просто дёргает эффект поиска заново.
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [lastOpenId, setLastOpenId] = useState<string | null>(null)

  useEffect(() => { void api['kb:status']().then(setStatus).catch((e: unknown) => setError(String(e))) }, [api])
  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      setSearch('loading'); setSearchError(null)
      const request = query.trim()
        ? api['kb:search']({ query: query.trim(), kinds: kind ? [kind] : undefined, limit: 30 })
        : api['kb:topics']().then((topics) => topics.filter((topic) => !kind || topic.kind === kind).map((topic, index): KbSearchResult => ({ documentId: topic.id, chunkId: `${topic.id}#overview`, title: topic.title, heading: topic.title, excerpt: `Документ базы знаний · ${topic.sourcePath}`, score: 1 - index / 1000, matchTypes: ['lexical'], explanation: 'Обзор базы знаний', freshness: topic.freshness, sourcePath: topic.sourcePath, anchor: '', symbols: [], relatedFiles: [] })))
      // Прошлые результаты не гасим: при новом запросе список остаётся на месте,
      // а факт поиска показывает индикатор — иначе панель мигает на каждой букве.
      void request.then((items) => { if (active) { setResults(items); setSearch('ready') } }).catch((e: unknown) => { if (active) { setSearchError(String(e)); setSearch('error') } })
    }, query ? 220 : 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [api, query, kind, attempt])

  // Документ из адреса: панель «Использование БЗ» и чипсы «Подробнее» ведут
  // прямо на раздел, поэтому открытие идёт от маршрута, а не только от клика.
  useEffect(() => {
    if (documentId && documentId !== document?.id) void open(documentId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId])

  const selectedId = document?.id
  const statusText = useMemo(() => !status ? 'Проверка индекса…' : status.available ? `${status.documents} документов · ${status.chunks} разделов · ${status.searchMode === 'hybrid' ? 'BM25 + LLM' : 'BM25'}` : 'База знаний недоступна', [status])
  const view = loadView(search, results.length > 0)

  const open = async (id: string): Promise<void> => {
    setError(null)
    setLastOpenId(id)
    try {
      const found = await api['kb:document']({ id })
      if (found) setDocument(found)
      else setError('Документ не найден')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <ToolFrame title="База знаний проекта" variant={variant} onClose={onClose} testId="kb-overlay" className="kbtool">
      <div className="kbbar">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Фича, функция, класс, API или подход…" aria-label="Поиск по базе знаний" autoFocus />
        <span className="kbstatus">{statusText}</span>
      </div>
      <div className="kblayout">
        <nav className="kbfilters" aria-label="Типы знаний">
          {KINDS.map((item) => <button key={item.id} className={kind === item.id ? 'active' : ''} onClick={() => setKind(item.id)}>{item.label}</button>)}
        </nav>
        <section className="kbresults" aria-label="Результаты поиска">
          {view.state === 'skeleton' && (
            /* Высота косточки — высота карточки .kbresult (название, раздел, выдержка, объяснение). */
            <Skeleton variant="list" count={5} height={92} lines={3} className="kbskel" testId="kb-skeleton" />
          )}
          {view.state === 'error' && (
            <ErrorState message="Поиск по базе знаний не удался" detail={searchError} onRetry={() => setAttempt((n) => n + 1)} />
          )}
          {view.state === 'empty' && (
            <EmptyState compact icon="🔍" title="Ничего не найдено" description="Уточните запрос или снимите фильтр по типу знаний." />
          )}
          {view.staleError && (
            <ErrorState compact message="Список мог устареть: поиск не удался" detail={searchError} onRetry={() => setAttempt((n) => n + 1)} />
          )}
          {view.refreshing && <p className="kbrefresh"><RefreshIndicator label="Ищем…" /></p>}
          {results.map((result) => <button key={result.chunkId} className={`kbresult${selectedId === result.documentId ? ' active' : ''}`} onClick={() => void open(result.documentId)}>
            <span className="kbresult-title">{result.title}</span><span className="kbresult-heading">{result.heading}</span>
            <span className="kbresult-text">{result.excerpt}</span><span className="kbresult-why">{result.explanation}</span>
          </button>)}
        </section>
        <article className="kbdoc">
          {error && (
            <ErrorState
              compact
              className="kberror"
              message="Не удалось открыть документ"
              detail={error}
              {...(lastOpenId ? { onRetry: () => void open(lastOpenId) } : {})}
            />
          )}
          {!document && !error && (
            <EmptyState
              icon="📚"
              title="Как устроен voiceAIChat"
              description="Найдите фичу, символ, файл или протокол и выберите результат — откроется актуальное описание реализации."
            />
          )}
          {document && <><header><h3>{document.title}</h3><p>{document.kind} · {document.sourcePath} · {document.updated ?? 'дата сверки не указана'}</p></header><Markdown>{document.body}</Markdown>{document.areas.length > 0 && <aside className="kbfiles"><strong>Связанные файлы</strong>{document.areas.map((path) => <code key={path}>{path}</code>)}</aside>}</>}
        </article>
      </div>
    </ToolFrame>
  )
}
