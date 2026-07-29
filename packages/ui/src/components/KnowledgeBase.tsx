import { useEffect, useMemo, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { KbDocument, KbDocumentKind, KbSearchResult, KbStatus } from '@shared/kb'
import { Markdown } from './Markdown'
import { ToolFrame } from './ToolFrame'

const KINDS: Array<{ id: KbDocumentKind | ''; label: string }> = [
  { id: '', label: 'Все' }, { id: 'feature', label: 'Фичи' }, { id: 'subsystem', label: 'Подсистемы' },
  { id: 'protocol', label: 'Протоколы' }, { id: 'decision', label: 'Решения' },
  { id: 'convention', label: 'Подходы' }, { id: 'runbook', label: 'Диагностика' }
]

export function KnowledgeBase({ api, onClose, variant = 'modal' }: { api: RendererApi; onClose: () => void; variant?: 'modal' | 'page' }): JSX.Element {
  const [status, setStatus] = useState<KbStatus | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KbDocumentKind | ''>('')
  const [results, setResults] = useState<KbSearchResult[]>([])
  const [document, setDocument] = useState<KbDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void api['kb:status']().then(setStatus).catch((e: unknown) => setError(String(e))) }, [api])
  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      setLoading(true); setError(null)
      const request = query.trim()
        ? api['kb:search']({ query: query.trim(), kinds: kind ? [kind] : undefined, limit: 30 })
        : api['kb:topics']().then((topics) => topics.filter((topic) => !kind || topic.kind === kind).map((topic, index): KbSearchResult => ({ documentId: topic.id, chunkId: `${topic.id}#overview`, title: topic.title, heading: topic.title, excerpt: `Документ базы знаний · ${topic.sourcePath}`, score: 1 - index / 1000, matchTypes: ['lexical'], explanation: 'Обзор базы знаний', freshness: topic.freshness, sourcePath: topic.sourcePath, anchor: '', symbols: [], relatedFiles: [] })))
      void request.then((items) => { if (active) setResults(items) }).catch((e: unknown) => { if (active) setError(String(e)) }).finally(() => { if (active) setLoading(false) })
    }, query ? 220 : 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [api, query, kind])

  const selectedId = document?.id
  const statusText = useMemo(() => !status ? 'Проверка индекса…' : status.available ? `${status.documents} документов · ${status.chunks} разделов · ${status.searchMode === 'hybrid' ? 'BM25 + LLM' : 'BM25'}` : 'База знаний недоступна', [status])

  const open = async (id: string): Promise<void> => { setError(null); const found = await api['kb:document']({ id }); if (found) setDocument(found); else setError('Документ не найден') }
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
          {loading && <p className="kbempty">Поиск…</p>}
          {!loading && results.length === 0 && <p className="kbempty">Ничего не найдено. Уточните запрос или снимите фильтр.</p>}
          {results.map((result) => <button key={result.chunkId} className={`kbresult${selectedId === result.documentId ? ' active' : ''}`} onClick={() => void open(result.documentId)}>
            <span className="kbresult-title">{result.title}</span><span className="kbresult-heading">{result.heading}</span>
            <span className="kbresult-text">{result.excerpt}</span><span className="kbresult-why">{result.explanation}</span>
          </button>)}
        </section>
        <article className="kbdoc">
          {error && <p className="kberror">{error}</p>}
          {!document && !error && <div className="kbwelcome"><strong>Как устроен voiceAIChat</strong><p>Найдите фичу, символ, файл или протокол. Выберите результат, чтобы открыть актуальное описание реализации.</p></div>}
          {document && <><header><h3>{document.title}</h3><p>{document.kind} · {document.sourcePath} · {document.updated ?? 'дата сверки не указана'}</p></header><Markdown>{document.body}</Markdown>{document.areas.length > 0 && <aside className="kbfiles"><strong>Связанные файлы</strong>{document.areas.map((path) => <code key={path}>{path}</code>)}</aside>}</>}
        </article>
      </div>
    </ToolFrame>
  )
}
