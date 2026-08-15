import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { KbDocument, KbDocumentKind, KbResearchRun, KbScope, KbSearchResult, KbStatus } from '@shared/kb'
import { KB_SCOPE_LABELS, KB_SCOPES } from '@shared/kb'
import type { ProjectSummary } from '@shared/projects'
import { Markdown } from './Markdown'
import { ToolFrame } from './ToolFrame'
import { Button } from '@voicechat/ui-kit'
import { Skeleton, RefreshIndicator } from '@voicechat/ui-kit'
import { EmptyState } from '@voicechat/ui-kit'
import { ErrorState } from '@voicechat/ui-kit'
import { loadView, type LoadStatus } from '../lib/loadState'

const KINDS: Array<{ id: KbDocumentKind | ''; label: string }> = [
  { id: '', label: 'Все' }, { id: 'feature', label: 'Фичи' }, { id: 'subsystem', label: 'Подсистемы' },
  { id: 'protocol', label: 'Протоколы' }, { id: 'decision', label: 'Решения' },
  { id: 'convention', label: 'Подходы' }, { id: 'runbook', label: 'Диагностика' }
]

/** Пока идёт исследование проекта — как часто спрашиваем сервер о его состоянии. */
const RESEARCH_POLL_MS = 3000

/** Черновик статьи в редакторе (разделы «Настройки пользователя» и «Разработка проекта»). */
interface Draft { id: string | null; title: string; body: string }

export function KnowledgeBase({ api, onClose, variant = 'modal', documentId = null }: { api: RendererApi; onClose: () => void; variant?: 'modal' | 'page'; /** Документ из адреса (#/kb/:documentId) — открыть его сразу. */ documentId?: string | null }): JSX.Element {
  const [status, setStatus] = useState<KbStatus | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KbDocumentKind | ''>('')
  // Раздел базы знаний: «Использование» — общее, «Настройки пользователя» — своё,
  // «Разработка проекта» — знания выбранного проекта (только для его участников).
  const [scope, setScope] = useState<KbScope>('usage')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectId, setProjectId] = useState<string>('')
  const [research, setResearch] = useState<KbResearchRun | null>(null)
  const [researchError, setResearchError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
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
  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => { void api['kb:status']().then(setStatus).catch((e: unknown) => setError(String(e))) }, [api])

  // Проекты нужны только вкладке «Разработка проекта», но список дешёвый и
  // подгружается сразу: иначе первый клик по вкладке показывает пустой выбор.
  useEffect(() => {
    let active = true
    void api['projects:list']().then((list) => {
      if (!active) return
      setProjects(list)
      setProjectId((current) => current || list[0]?.id || '')
    }).catch(() => { /* без проектов вкладка просто пустая */ })
    return () => { active = false }
  }, [api])

  // Вкладка «Разработка проекта» без выбранного проекта ничего не ищет: проектные
  // знания всегда принадлежат конкретному проекту.
  const projectFilter = scope === 'project' ? projectId : ''
  const inactiveProject = scope === 'project' && !projectFilter

  useEffect(() => {
    let active = true
    if (inactiveProject) { setResults([]); setSearch('ready'); return () => { active = false } }
    const filter = { scope, ...(projectFilter ? { projectId: projectFilter } : {}) }
    const timer = window.setTimeout(() => {
      setSearch('loading'); setSearchError(null)
      const request = query.trim()
        ? api['kb:search']({ query: query.trim(), kinds: kind ? [kind] : undefined, limit: 30, ...filter })
        : api['kb:topics'](filter).then((topics) => topics.filter((topic) => !kind || topic.kind === kind).map((topic, index): KbSearchResult => ({ documentId: topic.id, chunkId: `${topic.id}#overview`, title: topic.title, heading: topic.title, excerpt: `Документ базы знаний · ${topic.sourcePath}`, score: 1 - index / 1000, matchTypes: ['lexical'], explanation: 'Обзор базы знаний', freshness: topic.freshness, sourcePath: topic.sourcePath, anchor: '', symbols: [], relatedFiles: [], scope: topic.scope, projectId: topic.projectId ?? null })))
      // Прошлые результаты не гасим: при новом запросе список остаётся на месте,
      // а факт поиска показывает индикатор — иначе панель мигает на каждой букве.
      void request.then((items) => { if (active) { setResults(items); setSearch('ready') } }).catch((e: unknown) => { if (active) { setSearchError(String(e)); setSearch('error') } })
    }, query ? 220 : 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [api, query, kind, attempt, scope, projectFilter, inactiveProject])

  // Документ из адреса: панель «Использование БЗ» и чипсы «Подробнее» ведут
  // прямо на раздел, поэтому открытие идёт от маршрута, а не только от клика.
  useEffect(() => {
    if (documentId && documentId !== document?.id) void open(documentId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId])

  // Пока модель исследует репозиторий — опрашиваем состояние прогона; на
  // финише перечитываем список статей (их могло стать больше).
  const researching = research?.state === 'running'
  const doneRef = useRef<number | null>(null)
  useEffect(() => {
    if (!researching || !projectFilter) return
    const timer = window.setInterval(() => {
      void api['kb:researchStatus']({ projectId: projectFilter }).then((run) => {
        if (!run) return
        setResearch(run)
        if (run.state !== 'running' && doneRef.current !== run.finishedAt) { doneRef.current = run.finishedAt; reload() }
      }).catch(() => { /* следующая попытка через интервал */ })
    }, RESEARCH_POLL_MS)
    return () => window.clearInterval(timer)
  }, [api, researching, projectFilter, reload])

  const selectedId = document?.id
  const statusText = useMemo(() => !status ? 'Проверка индекса…' : status.available ? `${status.documents} документов · ${status.chunks} разделов · ${status.searchMode === 'hybrid' ? 'BM25 + LLM' : 'BM25'}` : 'База знаний недоступна', [status])
  const view = loadView(search, results.length > 0)
  const canWrite = scope === 'user' || (scope === 'project' && !!projectFilter)

  const open = async (id: string): Promise<void> => {
    setError(null)
    setDraft(null)
    setLastOpenId(id)
    try {
      const found = await api['kb:document']({ id })
      if (found) setDocument(found)
      else setError('Документ не найден')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const save = async (): Promise<void> => {
    if (!draft || !draft.title.trim()) return
    setError(null)
    try {
      const saved = await api['kb:saveDocument']({
        ...(draft.id ? { id: draft.id } : {}),
        scope,
        ...(scope === 'project' ? { projectId: projectFilter } : {}),
        title: draft.title.trim(),
        body: draft.body
      })
      setDraft(null)
      setDocument(saved)
      reload()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const remove = async (id: string): Promise<void> => {
    setError(null)
    try {
      await api['kb:deleteDocument']({ id })
      setDocument(null)
      reload()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const startResearch = async (): Promise<void> => {
    if (!projectFilter) return
    setResearchError(null)
    try {
      setResearch(await api['kb:research']({ projectId: projectFilter }))
    } catch (e: unknown) {
      setResearchError(e instanceof Error ? e.message : String(e))
    }
  }

  const researchText = !research
    ? null
    : research.state === 'running'
      ? 'Модель исследует репозиторий проекта…'
      : research.state === 'error'
        ? `Исследование не удалось: ${research.error ?? 'неизвестная ошибка'}`
        : `Исследование завершено: статей обновлено ${research.documents.length}${research.note ? ` · ${research.note}` : ''}`

  return (
    <ToolFrame title="База знаний" variant={variant} onClose={onClose} testId="kb-overlay" className="kbtool">
      <div className="kbbar">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Фича, функция, класс, API или подход…" aria-label="Поиск по базе знаний" autoFocus />
        <span className="kbstatus">{statusText}</span>
      </div>
      <nav className="kbscopes" aria-label="Разделы базы знаний">
        {KB_SCOPES.map((item) => (
          <button key={item} className={scope === item ? 'active' : ''} aria-pressed={scope === item} onClick={() => { setScope(item); setDraft(null) }}>{KB_SCOPE_LABELS[item]}</button>
        ))}
        {scope === 'project' && (
          <>
            <select aria-label="Проект" value={projectId} onChange={(e) => { setProjectId(e.target.value); setResearch(null) }}>
              {!projects.length && <option value="">Нет доступных проектов</option>}
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <Button size="sm" variant="secondary" disabled={!projectFilter || researching} onClick={() => void startResearch()}>
              {researching ? 'Исследуем…' : 'Исследовать проект'}
            </Button>
          </>
        )}
        {canWrite && <Button size="sm" variant="ghost" onClick={() => setDraft({ id: null, title: '', body: '' })}>Новая статья</Button>}
      </nav>
      {(researchText || researchError) && <p className="kbresearch">{researchError ?? researchText}</p>}
      <div className="kblayout">
        <nav className="kbfilters" aria-label="Типы знаний">
          {KINDS.map((item) => <button key={item.id} className={kind === item.id ? 'active' : ''} onClick={() => setKind(item.id)}>{item.label}</button>)}
        </nav>
        <section className="kbresults" aria-label="Результаты поиска">
          {inactiveProject && <EmptyState compact icon="📁" title="Проект не выбран" description="Выберите проект: знания раздела «Разработка проекта» доступны только его участникам." />}
          {!inactiveProject && view.state === 'skeleton' && (
            /* Высота косточки — высота карточки .kbresult (название, раздел, выдержка, объяснение). */
            <Skeleton variant="list" count={5} height={92} lines={3} className="kbskel" testId="kb-skeleton" />
          )}
          {!inactiveProject && view.state === 'error' && (
            <ErrorState message="Поиск по базе знаний не удался" detail={searchError} onRetry={reload} />
          )}
          {!inactiveProject && view.state === 'empty' && (
            <EmptyState compact icon="🔍" title="Ничего не найдено" description="Уточните запрос, смените раздел или снимите фильтр по типу знаний." />
          )}
          {view.staleError && (
            <ErrorState compact message="Список мог устареть: поиск не удался" detail={searchError} onRetry={reload} />
          )}
          {view.refreshing && <p className="kbrefresh"><RefreshIndicator label="Ищем…" /></p>}
          {!inactiveProject && results.map((result) => <button key={result.chunkId} className={`kbresult${selectedId === result.documentId ? ' active' : ''}`} onClick={() => void open(result.documentId)}>
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
          {draft && (
            <form className="kbeditor" onSubmit={(e) => { e.preventDefault(); void save() }}>
              <input aria-label="Заголовок статьи" placeholder="Заголовок статьи" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              <textarea aria-label="Текст статьи" placeholder="Текст статьи (Markdown)" rows={16} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
              <div className="kbeditor-actions">
                <Button size="sm" type="submit" disabled={!draft.title.trim()}>Сохранить</Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setDraft(null)}>Отмена</Button>
              </div>
            </form>
          )}
          {!draft && !document && !error && (
            <EmptyState
              icon="📚"
              title={scope === 'usage' ? 'Как пользоваться ChatAI' : scope === 'user' ? 'Ваши знания о настройках' : 'Знания по разработке проекта'}
              description={scope === 'usage'
                ? 'Найдите тему и выберите результат — откроется описание того, как это работает.'
                : scope === 'user'
                  ? 'Здесь только ваши записи: настройки, привычные формулировки, предпочтения. Другим пользователям они не видны.'
                  : 'Статьи проекта видны только его участникам. «Исследовать проект» просканирует репозиторий на машине проекта и сверит статьи с кодом.'}
            />
          )}
          {!draft && document && <>
            <header>
              <h3>{document.title}</h3>
              <p>{KB_SCOPE_LABELS[document.scope]} · {document.kind} · {document.sourcePath} · {document.updated ?? 'дата сверки не указана'}</p>
              {document.editable && (
                <div className="kbdoc-actions">
                  <Button size="sm" variant="secondary" onClick={() => setDraft({ id: document.id, title: document.title, body: document.body })}>Править</Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(document.id)}>Удалить</Button>
                </div>
              )}
            </header>
            <Markdown>{document.body}</Markdown>
            {document.areas.length > 0 && <aside className="kbfiles"><strong>Связанные файлы</strong>{document.areas.map((path) => <code key={path}>{path}</code>)}</aside>}
          </>}
        </article>
      </div>
    </ToolFrame>
  )
}
