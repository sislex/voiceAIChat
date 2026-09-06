// Режим «Проект» в Make: компоненты реального репозитория, их просмотр в настоящем
// Storybook проекта и правка прямо в рабочей копии на машине.
//
// Почему отдельный компонент, а не пятый режим внутри `MakePane`: у песочницы Make и
// у рабочей копии разные источники данных (`make:*` против `projects:git*`), разные
// права и разный жизненный цикл. Общего у них — только раскладка «список слева, кадр
// справа», и её дешевле повторить, чем ветвить две тысячи строк панели.
//
// Кадр стори приходит через прокси `/api/preview`, который доставляет HTTP с порта
// машины по алиасу `<agentId>.machine.internal`. Из этого следует одно видимое
// ограничение: WebSocket через прокси не ходит, поэтому HMR не работает и после
// сохранения файла кадр перезагружается сам.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dialog, EmptyState, ErrorState, IconButton, Skeleton, StatusPill, useToast, type StatusTone } from '@voicechat/ui-kit'
import type { RendererApi } from '@shared/ipc'
import type { GitWorkspaceRef } from '@shared/gitWorkspace'
import type { ProjectComponentEntry, ProjectComponentsListing, ProjectStorybookAccess, ProjectStorybookSession } from '@shared/projectComponents'
import { machineOrigin, projectStorybookFrameUrl, storybookFrameUrlAt } from '@shared/projectComponents'
import { makeStorybookCommandKey } from '../store/contracts'
import { loadView, type LoadStatus } from '../lib/loadState'
import { usePolling } from '../lib/usePolling'
import { CodeEditor } from './CodeEditor'

export type MakeProjectComponentsApi = Pick<
  RendererApi,
  'projects:gitWorkspaces' | 'projects:components' | 'projects:componentStories'
  | 'projects:storybookSession' | 'projects:storybookAction'
  | 'projects:gitFile' | 'projects:gitSaveFile' | 'projects:componentTicket'
  | 'projects:storybookOpen' | 'projects:storybookCloseTunnel'
>

export interface MakeProjectComponentsProps {
  projectId: string
  api: MakeProjectComponentsApi
  /** Cookie-гейт превью: iframe ходит без Bearer, как и в остальных наших кадрах. */
  ensurePreview?: () => Promise<void>
  /** Открыть заведённую карточку на доске. */
  onOpenTask?: (projectId: string, taskId: string) => void
  /** Отдать правку ассистенту чата (кнопка «В чат»). */
  onInsertToChat?: (text: string) => void
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Подпись рабочей копии: задача понятнее пути, а машина объясняет, где это лежит. */
export function workspaceLabel(ref: GitWorkspaceRef): string {
  const base = ref.taskSeq ? `#${ref.taskSeq} ${ref.taskTitle ?? ''}`.trim() : ref.kind === 'project-worktree' ? 'Копия проекта' : ref.path
  return ref.machineName ? `${base} · ${ref.machineName}` : base
}

const STATE_LABEL: Record<ProjectStorybookSession['state'], string> = {
  stopped: 'Storybook остановлен',
  starting: 'Storybook собирается…',
  running: 'Storybook работает',
  failed: 'Storybook не запустился'
}

/** Как открыт кадр — короткой подписью рядом со статусом. */
const ACCESS_LABEL: Record<ProjectStorybookAccess['kind'], string> = {
  direct: 'кадр напрямую',
  tunnel: 'кадр через локальный агент',
  proxy: 'кадр через мост машины'
}

const STATE_TONE: Record<ProjectStorybookSession['state'], StatusTone> = {
  stopped: 'neutral',
  starting: 'running',
  running: 'success',
  failed: 'danger'
}

export function MakeProjectComponents({ projectId, api, ensurePreview, onOpenTask, onInsertToChat }: MakeProjectComponentsProps): JSX.Element {
  const toast = useToast()
  const [workspaces, setWorkspaces] = useState<GitWorkspaceRef[] | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [load, setLoad] = useState<{ status: LoadStatus; error: string | null }>({ status: 'idle', error: null })
  const [listing, setListing] = useState<ProjectComponentsListing | null>(null)
  const [session, setSession] = useState<ProjectStorybookSession | null>(null)
  const [sessionBusy, setSessionBusy] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<{ path: string; storyId: string | null }>({ path: '', storyId: null })
  const [view, setView] = useState<'frame' | 'code'>('frame')
  const [file, setFile] = useState<{ path: string; content: string; saved: string } | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [frameRev, setFrameRev] = useState(0)
  /**
   * Как открыт кадр. Прокси работает всегда, но каждый модуль Vite идёт до машины
   * отдельным запросом: на медленном канале кадр не собирается. Поэтому сначала
   * пробуем прямой адрес (браузер на той же машине), затем туннель локального
   * агента и только потом прокси.
   */
  const [access, setAccess] = useState<ProjectStorybookAccess | null>(null)
  const [previewReady, setPreviewReady] = useState(!ensurePreview)
  const [ticketOpen, setTicketOpen] = useState(false)
  const [ticketTitle, setTicketTitle] = useState('')
  const [ticketNote, setTicketNote] = useState('')
  const [ticketBusy, setTicketBusy] = useState(false)
  /**
   * Команда запуска. Сервер её не угадывает: в монорепо `npm run storybook` живёт в
   * пакете витрины, а не в корне. Запоминаем на проект — команда у команды одна.
   */
  const [command, setCommand] = useState<string>(() => {
    try { return localStorage.getItem(makeStorybookCommandKey(projectId)) ?? '' } catch { return '' }
  })
  const [commandOpen, setCommandOpen] = useState(false)
  const [ticketError, setTicketError] = useState<string | null>(null)
  /** Пути, изменённые в этой панели: из них собирается коммит тикета. */
  const [changed, setChanged] = useState<string[]>([])
  const requestRef = useRef(0)

  const workspace = useMemo(() => workspaces?.find((ref) => ref.id === workspaceId) ?? null, [workspaces, workspaceId])

  useEffect(() => {
    let alive = true
    setLoad({ status: 'loading', error: null })
    api['projects:gitWorkspaces']({ id: projectId })
      .then((list) => {
        if (!alive) return
        setWorkspaces(list)
        setWorkspaceId((prev) => prev || list.find((ref) => ref.online && !ref.released)?.id || list[0]?.id || '')
        setLoad({ status: 'ready', error: null })
      })
      .catch((error) => { if (alive) setLoad({ status: 'error', error: errorText(error) }) })
    return () => { alive = false }
  }, [api, projectId])

  useEffect(() => {
    if (!ensurePreview) return
    let alive = true
    void ensurePreview().then(() => { if (alive) setPreviewReady(true) }).catch(() => { if (alive) setPreviewReady(true) })
    return () => { alive = false }
  }, [ensurePreview])

  const loadComponents = useCallback(async (): Promise<void> => {
    if (!workspaceId) return
    const ticket = ++requestRef.current
    try {
      const next = await api['projects:components']({ id: projectId, workspace: workspaceId })
      if (ticket === requestRef.current) { setListing(next); setLoad({ status: 'ready', error: null }) }
    } catch (error) {
      if (ticket === requestRef.current) setLoad({ status: 'error', error: errorText(error) })
    }
  }, [api, projectId, workspaceId])

  const loadSession = useCallback(async (): Promise<void> => {
    if (!workspaceId) return
    try {
      setSession(await api['projects:storybookSession']({ id: projectId, workspace: workspaceId }))
    } catch {
      // Состояние сессии — не главный экран: молча оставляем прежнее, ошибки покажет действие.
    }
  }, [api, projectId, workspaceId])

  useEffect(() => {
    setListing(null)
    setSelected({ path: '', storyId: null })
    setFile(null)
    setChanged([])
    if (!workspaceId) return
    void loadSession()
    void loadComponents()
  }, [workspaceId, loadComponents, loadSession])

  // Пока идёт сборка, состояние спрашиваем сами: `running` придёт вместе с готовностью.
  usePolling(() => {
    void loadSession().then(() => { if (session?.state === 'starting') void loadComponents() })
  }, { enabled: session?.state === 'starting', intervalMs: 4000 })

  // Как только Storybook поднялся, список перечитывается: у живого индекса настоящие id стори.
  const readyAt = session?.readyAt ?? null
  useEffect(() => { if (readyAt) void loadComponents() }, [readyAt, loadComponents])

  /**
   * Проба прямого адреса: если Storybook слушает на той же машине, где открыт
   * браузер, кадр берётся напрямую и мост не нужен вовсе. Storybook (Vite) отдаёт
   * CORS, поэтому ответ читается; чужая машина ответит ошибкой или не ответит.
   */
  const probeDirect = useCallback(async (port: number): Promise<boolean> => {
    if (typeof window === 'undefined' || typeof AbortController === 'undefined') return false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 1500)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/index.json`, { signal: controller.signal, mode: 'cors' })
      return res.ok
    } catch {
      return false
    } finally {
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!session || session.state !== 'running' || !workspaceId) { setAccess(null); return }
    let alive = true
    let opened: ProjectStorybookAccess | null = null
    void (async () => {
      if (await probeDirect(session.port)) {
        if (alive) setAccess({ kind: 'direct', url: `http://127.0.0.1:${session.port}`, tunnelId: null, note: 'Storybook на этой же машине — кадр берётся напрямую.' })
        return
      }
      try {
        const localAgentId = window.featurePreview?.localAgentId ?? null
        const result = await api['projects:storybookOpen']({ id: projectId, workspace: workspaceId, localAgentId })
        opened = result
        if (alive) setAccess(result)
      } catch {
        // Сервер не ответил — прокси всё равно доступен по прямому адресу машины.
        if (alive) setAccess({ kind: 'proxy', url: `/api/preview?url=${encodeURIComponent(machineOrigin(session.agentId, session.port))}`, tunnelId: null, note: 'Кадр идёт через мост машины.' })
      }
    })()
    return () => {
      alive = false
      // Туннель живёт, пока открыта вкладка: чужой порт на машине не бросаем.
      if (opened?.tunnelId) void api['projects:storybookCloseTunnel']({ id: projectId, tunnelId: opened.tunnelId, workspace: workspaceId }).catch(() => undefined)
    }
  }, [api, projectId, workspaceId, session?.state, session?.port, session?.agentId, probeDirect])

  const act = useCallback(async (action: 'start' | 'stop' | 'restart'): Promise<void> => {
    if (!workspaceId) return
    setSessionBusy(true)
    try {
      setSession(await api['projects:storybookAction']({
        id: projectId, workspace: workspaceId, action, ...(command.trim() ? { command: command.trim() } : {})
      }))
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setSessionBusy(false)
    }
  }, [api, command, projectId, workspaceId, toast])

  const openComponent = useCallback(async (component: ProjectComponentEntry): Promise<void> => {
    setSelected({ path: component.path, storyId: component.stories[0]?.id ?? null })
    setFileError(null)
    if (component.stories.length || !component.path) return
    // Storybook ещё не поднят: имена стори берём разбором CSF, чтобы список был не пустым.
    try {
      const parsed = await api['projects:componentStories']({ id: projectId, workspace: workspaceId, path: component.path })
      setListing((prev) => prev && {
        ...prev,
        components: prev.components.map((item) => (item.path === parsed.path ? { ...item, ...parsed } : item))
      })
      setSelected({ path: component.path, storyId: parsed.stories[0]?.id ?? null })
    } catch (error) {
      setFileError(errorText(error))
    }
  }, [api, projectId, workspaceId])

  const openFile = useCallback(async (path: string): Promise<void> => {
    setView('code')
    setFileError(null)
    try {
      const content = await api['projects:gitFile']({ id: projectId, workspace: workspaceId, path })
      setFile({ path, content: content.content, saved: content.content })
    } catch (error) {
      setFile(null)
      setFileError(errorText(error))
    }
  }, [api, projectId, workspaceId])

  const save = useCallback(async (): Promise<void> => {
    if (!file || file.content === file.saved) return
    setSaving(true)
    try {
      await api['projects:gitSaveFile']({ id: projectId, workspace: workspaceId, path: file.path, content: file.content })
      setFile((prev) => (prev ? { ...prev, saved: prev.content } : prev))
      setChanged((prev) => (prev.includes(file.path) ? prev : [...prev, file.path]))
      // HMR через прокси не проходит — перезагружаем кадр сами, иначе правка «не видна».
      setFrameRev((rev) => rev + 1)
      toast.success('Файл сохранён в рабочей копии')
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setSaving(false)
    }
  }, [api, file, projectId, workspaceId, toast])

  const createTicket = useCallback(async (): Promise<void> => {
    if (!ticketTitle.trim() || !changed.length) return
    setTicketBusy(true)
    setTicketError(null)
    try {
      const result = await api['projects:componentTicket']({
        id: projectId, workspace: workspaceId, title: ticketTitle.trim(),
        description: ticketNote.trim() || undefined, paths: changed
      })
      setTicketOpen(false)
      setChanged([])
      setTicketTitle('')
      setTicketNote('')
      toast.success(`Задача ${result.branch} готова к слиянию`)
      onOpenTask?.(projectId, result.taskId)
    } catch (error) {
      setTicketError(errorText(error))
    } finally {
      setTicketBusy(false)
    }
  }, [api, changed, onOpenTask, projectId, ticketNote, ticketTitle, toast, workspaceId])

  const components = useMemo(() => {
    const list = listing?.components ?? []
    const needle = query.trim().toLowerCase()
    return needle ? list.filter((c) => c.title.toLowerCase().includes(needle) || c.path.toLowerCase().includes(needle)) : list
  }, [listing, query])

  const activeComponent = components.find((c) => c.path === selected.path) ?? listing?.components.find((c) => c.path === selected.path) ?? null
  const frameUrl = session && session.state === 'running' && selected.storyId && previewReady && access
    ? access.kind === 'proxy'
      ? `${projectStorybookFrameUrl(session.agentId, session.port, selected.storyId)}&rev=${frameRev}`
      : `${storybookFrameUrlAt(access.url, selected.storyId)}&rev=${frameRev}`
    : null
  const dirty = !!file && file.content !== file.saved
  const readOnly = !!workspace && (!workspace.writable || !!workspace.busy || workspace.released)

  const listView = loadView(load.status, !!listing?.components.length)

  return (
    <div className="mpc">
      <div className="mpc-head">
        <label className="mpc-ws">
          <span className="mpc-ws-label">Рабочая копия</span>
          <select
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
            disabled={!workspaces?.length}
            aria-label="Рабочая копия проекта"
          >
            {!workspaces?.length && <option value="">Копий нет</option>}
            {workspaces?.map((ref) => (
              <option key={ref.id} value={ref.id}>{workspaceLabel(ref)}{ref.online ? '' : ' · офлайн'}</option>
            ))}
          </select>
        </label>
        <StatusPill tone={STATE_TONE[session?.state ?? 'stopped']}>
          {STATE_LABEL[session?.state ?? 'stopped']}{session?.adopted ? ' (запущен вне панели)' : ''}
        </StatusPill>
        {session?.state === 'running' || session?.state === 'starting' ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => void act('restart')} loading={sessionBusy}>Перезапустить</Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void act('stop')}
              loading={sessionBusy}
              title={session?.adopted ? 'Storybook запущен вне панели — остановите его там же, где запускали' : undefined}
              disabled={session?.adopted}
            >
              Остановить
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="primary"
            onClick={() => void act('start')}
            loading={sessionBusy}
            disabled={!workspace || !workspace.online || readOnly}
          >
            Запустить Storybook
          </Button>
        )}
        {access && <span className="mpc-access" title={access.note}>{ACCESS_LABEL[access.kind]}</span>}
        <Button size="sm" variant="ghost" onClick={() => setCommandOpen(true)}>Команда</Button>
        <Button size="sm" variant="ghost" onClick={() => setLogOpen(true)} disabled={!session?.log}>Лог</Button>
        {changed.length > 0 && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => { setTicketTitle(`Правка ${activeComponent?.title ?? 'компонента'}`); setTicketOpen(true) }}
          >
            Создать задачу ({changed.length})
          </Button>
        )}
      </div>

      {workspace && !workspace.online && (
        <ErrorState compact message="Машина этой копии не в сети" detail="Storybook запускать негде, файлы тоже не прочитать." />
      )}
      {readOnly && workspace?.online && (
        <ErrorState compact message="Копия доступна только для чтения" detail={workspace.readOnlyReason ?? 'Каталог занят раном или машина открыта на чтение.'} />
      )}
      {session?.state === 'failed' && session.error && (
        <ErrorState compact message={session.error} detail="Откройте лог запуска — там видно, на чём остановилась сборка." />
      )}

      <div className="mpc-body">
        <div className="mpc-list">
          <input
            className="mpc-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск компонента"
            aria-label="Поиск компонента"
          />
          {listView.state === 'skeleton' && <div className="mpc-skeletons">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={28} />)}</div>}
          {listView.state === 'error' && <ErrorState message="Не удалось прочитать компоненты" detail={load.error ?? undefined} onRetry={() => void loadComponents()} />}
          {listView.state === 'empty' && (
            <EmptyState
              title="Компонентов не найдено"
              description="В рабочей копии нет файлов *.stories.tsx — заведите сториз, и компонент появится здесь."
            />
          )}
          {listView.state === 'data' && (
            <ul className="mpc-items" role="list">
              {components.map((component) => (
                <li key={component.path || component.title} className={component.path === selected.path ? 'mpc-item mpc-item--on' : 'mpc-item'}>
                  <button type="button" onClick={() => void openComponent(component)} aria-current={component.path === selected.path}>
                    <span className="mpc-item-title">{component.title}</span>
                    <span className="mpc-item-path">{component.path}</span>
                  </button>
                  {component.path === selected.path && component.stories.length > 0 && (
                    <ul className="mpc-stories" role="list">
                      {component.stories.map((story) => (
                        <li key={story.id}>
                          <button
                            type="button"
                            onClick={() => { setSelected({ path: component.path, storyId: story.id }); setView('frame') }}
                            aria-current={story.id === selected.storyId}
                            className={story.id === selected.storyId ? 'mpc-story mpc-story--on' : 'mpc-story'}
                          >
                            {story.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          {listing?.truncated && <p className="mpc-note">Список обрезан: компонентов больше, чем помещается в ответ машины.</p>}
        </div>

        <div className="mpc-main">
          <div className="mpc-tabs" role="tablist" aria-label="Просмотр компонента">
            <button type="button" role="tab" aria-selected={view === 'frame'} onClick={() => setView('frame')}>Кадр</button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'code'}
              onClick={() => { setView('code'); if (selected.path && file?.path !== selected.path) void openFile(selected.path) }}
              disabled={!selected.path}
            >
              Код
            </button>
            {view === 'frame' && frameUrl && (
              <IconButton aria-label="Перезагрузить кадр" title="Перезагрузить кадр" onClick={() => setFrameRev((rev) => rev + 1)}>⟳</IconButton>
            )}
          </div>

          {view === 'frame' && (
            frameUrl ? (
              <iframe
                className="mpc-frame"
                title="Стори компонента"
                src={frameUrl}
                sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
              />
            ) : (
              <EmptyState
                title={session?.state === 'running' ? 'Выберите стори слева' : 'Storybook ещё не запущен'}
                description={session?.state === 'running'
                  ? 'Кадр покажет компонент так, как его собирает сам проект.'
                  : 'Запустите Storybook на машине — он соберёт компоненты этой рабочей копии.'}
              />
            )
          )}

          {view === 'code' && (
            <div className="mpc-editor">
              {fileError && <ErrorState compact message="Файл не прочитан" detail={fileError} onRetry={() => selected.path && void openFile(selected.path)} />}
              {file && (
                <>
                  <div className="mpc-editor-head">
                    <span className="mpc-editor-path">{file.path}{dirty ? ' · не сохранено' : ''}</span>
                    <Button size="sm" variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty || readOnly}>Сохранить</Button>
                    {onInsertToChat && (
                      <Button size="sm" variant="ghost" onClick={() => onInsertToChat(`Работаем над компонентом ${activeComponent?.title ?? file.path} (файл ${file.path} в рабочей копии проекта).`)}>
                        В чат
                      </Button>
                    )}
                  </div>
                  <CodeEditor
                    path={file.path}
                    value={file.content}
                    onChange={(value) => setFile((prev) => (prev ? { ...prev, content: value } : prev))}
                    onSave={() => void save()}
                    ariaLabel={`Содержимое ${file.path}`}
                    readOnly={readOnly}
                  />
                </>
              )}
              {!file && !fileError && <EmptyState title="Файл не выбран" description="Выберите компонент слева — откроется его файл сториз." />}
            </div>
          )}
        </div>
      </div>

      {commandOpen && (
        <Dialog
          title="Команда запуска Storybook"
          onClose={() => setCommandOpen(false)}
          actions={<Button variant="primary" onClick={() => {
            try { localStorage.setItem(makeStorybookCommandKey(projectId), command.trim()) } catch { /* приватный режим — команда останется на сеанс */ }
            setCommandOpen(false)
          }}>Запомнить</Button>}
        >
          <p className="mpc-ticket-note">
            Выполняется в каталоге рабочей копии; порт, <code>--no-open</code> и <code>--ci</code>
            панель добавит сама. В монорепо укажите пакет витрины — например
            <code> npm run -w @voicechat/ui storybook --</code>.
          </p>
          <label className="mpc-field">
            <span>Команда</span>
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="npm run storybook --"
              autoFocus
            />
          </label>
        </Dialog>
      )}

      {logOpen && (
        <Dialog title="Лог запуска Storybook" onClose={() => setLogOpen(false)} size="lg">
          <pre className="mpc-log">{session?.log || 'Пока пусто'}</pre>
        </Dialog>
      )}

      {ticketOpen && (
        <Dialog
          title="Задача из правки"
          onClose={() => setTicketOpen(false)}
          closeOnOverlay={false}
          actions={<Button variant="primary" onClick={() => void createTicket()} loading={ticketBusy} disabled={!ticketTitle.trim()}>Создать и подготовить к слиянию</Button>}
        >
          <p className="mpc-ticket-note">
            Правка уйдёт в отдельную ветку и будет отправлена в origin, а карточка встанет
            в колонку «Ожидает слияния» — слить её можно кнопкой на доске.
          </p>
          <label className="mpc-field">
            <span>Название</span>
            <input value={ticketTitle} onChange={(event) => setTicketTitle(event.target.value)} autoFocus />
          </label>
          <label className="mpc-field">
            <span>Что изменено</span>
            <textarea value={ticketNote} onChange={(event) => setTicketNote(event.target.value)} rows={3} />
          </label>
          <ul className="mpc-ticket-paths" role="list">
            {changed.map((path) => <li key={path}>{path}</li>)}
          </ul>
          {ticketError && <ErrorState compact message="Задача не создана" detail={ticketError} />}
        </Dialog>
      )}
    </div>
  )
}
