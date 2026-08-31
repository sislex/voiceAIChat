// Панель кода: git в рабочей копии задачи или сессии — ветка, изменения, сравнение,
// правка, коммит и отправка.
//
// Данные панель грузит сама через `api` (как `ReleaseCenter` и `MakePane`), а не через
// стор: она нужна и на странице проекта, и в карточке задачи, и рядом с чатом, где
// стора проекта нет вовсе. Транспорта в компоненте всё равно нет — только каналы моста.
//
// Что переиспользуется целиком: `CodeEditor` (Monaco + фолбэк в jsdom и на телефоне),
// `CodeDiff` (Monaco DiffEditor side-by-side), `loadView` и состояния экрана из ui-kit.
// Своего diff-парсера здесь нет намеренно: сервер отдаёт две версии файла, а разницу
// считает Monaco — зато правая сторона живая и её тут же можно править.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, EmptyState, ErrorState, IconButton, RefreshIndicator, Skeleton, StatusPill, useConfirm, useToast } from '@voicechat/ui-kit'
import type { RendererApi } from '@shared/ipc'
import type {
  GitBranchChanges, GitBranchList, GitCommitInfo, GitConflictSide, GitConflictStages,
  GitFileDiff, GitWorkspaceStatus
} from '@shared/gitWorkspace'
import { isProtectedGitBranch } from '@shared/gitWorkspace'
import { loadView, type LoadStatus } from '../../lib/loadState'
import { usePolling } from '../../lib/usePolling'
import { CodeDiff } from '../CodeDiff'
import { CodeEditor } from '../CodeEditor'
import { GitChangeList } from './GitChangeList'
import { GitTreeView } from './GitTreeView'
import { GitSearchPanel } from './GitSearchPanel'
import { GitConflictView } from './GitConflictView'
import { GitCommitList } from './GitCommitList'
import { GitBranchDialog } from './GitBranchDialog'
import { gitProblemHint, gitProblemMessage } from './gitLabels'

/** Каналы моста, которые нужны панели. Больше она ни о чём не знает. */
export type GitPaneApi = Pick<
  RendererApi,
  'projects:gitStatus' | 'projects:gitBranches' | 'projects:gitDiff' | 'projects:gitTree' | 'projects:gitFile'
  | 'projects:gitSaveFile' | 'projects:gitCheckout' | 'projects:gitCreateBranch'
  | 'projects:gitCommit' | 'projects:gitPush' | 'projects:gitPull' | 'projects:gitDiscard'
  | 'projects:gitBranchChanges' | 'projects:gitStage' | 'projects:gitLog'
  | 'projects:gitCommitDetail' | 'projects:gitGrep' | 'projects:gitFileBytes'
  | 'projects:gitConflict' | 'projects:gitResolveConflict'
>

export interface GitPaneProps {
  projectId: string
  /** id рабочей копии (`GitWorkspaceRef.id`) — путь панель не знает и знать не должна. */
  workspaceId: string
  api: GitPaneApi
  /** Открыть настройку git-доступа машины (состояние «push недоступен»). */
  onOpenGitAccess?: (agentId: string) => void
  /** Открыть ленту рана, который занял каталог. */
  onOpenRun?: (kind: 'ci' | 'merge', runId: string) => void
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)

export function GitPane({ projectId, workspaceId, api, onOpenGitAccess, onOpenRun }: GitPaneProps): JSX.Element {
  const toast = useToast()
  const confirm = useConfirm()
  const [status, setStatus] = useState<GitWorkspaceStatus | null>(null)
  const [load, setLoad] = useState<{ status: LoadStatus; error: string | null }>({ status: 'idle', error: null })
  const [branches, setBranches] = useState<GitBranchList | null>(null)
  const [branchDialog, setBranchDialog] = useState(false)
  const [branchBusy, setBranchBusy] = useState(false)
  const [branchError, setBranchError] = useState<string | null>(null)
  const [side, setSide] = useState<'changes' | 'branch' | 'files' | 'search'>('changes')
  const [branchChanges, setBranchChanges] = useState<GitBranchChanges | null>(null)
  const [branchChangesError, setBranchChangesError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<GitConflictStages | null>(null)
  const [conflictBusy, setConflictBusy] = useState(false)
  const [fileLog, setFileLog] = useState<{ path: string; commits: GitCommitInfo[] } | null>(null)
  const [staging, setStaging] = useState(false)
  const [treePaths, setTreePaths] = useState<string[]>([])
  /** Сколько изменений просим у сервера: список бывает длиннее лимита по умолчанию. */
  const [changesLimit, setChangesLimit] = useState<number | undefined>(undefined)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<GitFileDiff | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  /**
   * Черновики по пути. Раньше открытие другого файла молча перетирало правку: человек
   * возвращался и находил исходный текст. Теперь несохранённое остаётся в памяти
   * панели, помечается точкой в списке и восстанавливается при возврате к файлу.
   */
  const [drafts, setDrafts] = useState<Record<string, { draft: string; saved: string }>>({})
  const [draft, setDraft] = useState('')
  const [savedText, setSavedText] = useState('')
  const [saving, setSaving] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [fetching, setFetching] = useState(false)
  // Каждый ответ обесценивает предыдущий: пока читался файл, человек мог выбрать другой.
  const requestRef = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    setLoad((prev) => ({ status: 'loading', error: prev.error }))
    try {
      const next = await api['projects:gitStatus']({
        id: projectId, workspace: workspaceId, ...(changesLimit ? { changesLimit } : {})
      })
      setStatus(next)
      setLoad({ status: 'ready', error: null })
      // Список выбранных файлов подрезаем под то, что реально изменено: после коммита
      // прежние отметки указывали бы в пустоту.
      setPicked((prev) => new Set([...prev].filter((path) => next.changes.some((change) => change.path === path))))
    } catch (error) {
      setLoad({ status: 'error', error: errorText(error) })
    }
  }, [api, projectId, workspaceId])

  useEffect(() => {
    if (side === 'branch' && !branchChanges && !branchChangesError) void loadBranchChanges()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, branchChanges, branchChangesError])

  useEffect(() => {
    setStatus(null)
    setSelected(null)
    setDiff(null)
    setEditing(false)
    setPicked(new Set())
    void refresh()
  }, [refresh])

  /**
   * Пока панель открыта, состояние подтягивается само: модель правит файлы прямо
   * сейчас, и «нажми обновить, чтобы увидеть» — плохой ответ. Опрос встаёт вместе со
   * вкладкой (`usePolling`), а во время правки и мутаций не мешает: обновляется только
   * статус, черновики и выбранный файл он не трогает.
   */
  usePolling(() => { void refresh() }, { enabled: !editing && !saving && !committing && !pushing, intervalMs: 15_000 })

  const loadBranches = useCallback(async (refreshRemote: boolean): Promise<void> => {
    setBranchBusy(true)
    setBranchError(null)
    try {
      setBranches(await api['projects:gitBranches']({ id: projectId, workspace: workspaceId, refresh: refreshRemote }))
    } catch (error) {
      setBranchError(errorText(error))
    } finally {
      setBranchBusy(false)
    }
  }, [api, projectId, workspaceId])

  /** Отложить текущий черновик, прежде чем открыть другой файл. */
  const keepDraft = useCallback((): void => {
    setSelected((current) => {
      if (current) setDrafts((prev) => ({ ...prev, [current]: { draft, saved: savedText } }))
      return current
    })
  }, [draft, savedText])

  const openFile = useCallback(async (path: string): Promise<void> => {
    const ticket = ++requestRef.current
    keepDraft()
    setSelected(path)
    setEditing(false)
    setDiff(null)
    setFileError(null)
    try {
      const next = await api['projects:gitDiff']({ id: projectId, workspace: workspaceId, path })
      if (requestRef.current !== ticket) return
      setDiff(next)
      const text = next.modified?.content ?? ''
      // Незакоммиченный черновик этого файла важнее только что прочитанного текста:
      // человек его набрал и не сохранил.
      const kept = drafts[path]
      setDraft(kept && kept.saved === text ? kept.draft : text)
      setSavedText(text)
      if (kept && kept.saved === text && kept.draft !== text) setEditing(true)
    } catch (error) {
      if (requestRef.current !== ticket) return
      setFileError(errorText(error))
    }
  }, [api, projectId, workspaceId, keepDraft, drafts])

  /**
   * Файл из дерева: у него может не быть изменений, поэтому сравнение бессмысленно —
   * читаем рабочую копию и сразу открываем в правке.
   */
  const openFromTree = useCallback(async (path: string): Promise<void> => {
    const ticket = ++requestRef.current
    keepDraft()
    setSelected(path)
    setDiff(null)
    setFileError(null)
    try {
      const file = await api['projects:gitFile']({ id: projectId, workspace: workspaceId, path })
      if (requestRef.current !== ticket) return
      const kept = drafts[path]
      setDraft(kept && kept.saved === file.content ? kept.draft : file.content)
      setSavedText(file.content)
      setEditing(true)
    } catch (error) {
      if (requestRef.current !== ticket) return
      setFileError(errorText(error))
    }
  }, [api, projectId, workspaceId])

  const loadTreeDirCached = useCallback(async (dir: string) => {
    const listing = await api['projects:gitTree']({ id: projectId, workspace: workspaceId, dir })
    // Пути прочитанных уровней — материал для поиска по имени: он работает без сети.
    setTreePaths((prev) => [...new Set([...prev, ...listing.entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path)])])
    return listing.entries
  }, [api, projectId, workspaceId])

  const openConflict = useCallback(async (path: string): Promise<void> => {
    setConflict(null)
    try {
      setConflict(await api['projects:gitConflict']({ id: projectId, workspace: workspaceId, path }))
    } catch (error) {
      setFileError(errorText(error))
    }
  }, [api, projectId, workspaceId])

  const resolveConflict = async (path: string, conflictSide: GitConflictSide): Promise<void> => {
    setConflictBusy(true)
    try {
      setStatus(await api['projects:gitResolveConflict']({ id: projectId, workspace: workspaceId, path, side: conflictSide }))
      setConflict(null)
      toast.success(conflictSide === 'ours' ? 'Оставлена наша версия' : 'Оставлена версия из origin')
    } catch (error) {
      toast.error(`Не удалось разрешить конфликт: ${errorText(error)}`)
    } finally {
      setConflictBusy(false)
    }
  }

  const stage = async (unstage: boolean): Promise<void> => {
    setStaging(true)
    try {
      setStatus(await api['projects:gitStage']({ id: projectId, workspace: workspaceId, paths: pickedList, unstage }))
      toast.success(unstage ? 'Снято с индекса' : 'Добавлено в индекс')
    } catch (error) {
      toast.error(`Индекс не изменён: ${errorText(error)}`)
    } finally {
      setStaging(false)
    }
  }

  /** История файла — по требованию: у всех файлов сразу её никто не смотрит. */
  const loadFileLog = async (path: string): Promise<void> => {
    try {
      const result = await api['projects:gitLog']({ id: projectId, workspace: workspaceId, path })
      setFileLog({ path, commits: result.commits })
    } catch (error) {
      toast.error(`История не прочитана: ${errorText(error)}`)
    }
  }

  /** Скачать файл как есть: бинарник и файл сверх лимита показать нельзя, а забрать — можно. */
  const downloadFile = async (path: string): Promise<void> => {
    try {
      const result = await api['projects:gitFileBytes']({ id: projectId, workspace: workspaceId, path })
      const bytes = Uint8Array.from(atob(result.dataBase64), (char) => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes]))
      const link = document.createElement('a')
      link.href = url
      link.download = path.split('/').pop() ?? 'file'
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(`Не удалось скачать: ${errorText(error)}`)
    }
  }

  /** Изменения ветки против общего предка с origin/<base>: «что задача меняет вообще». */
  const loadBranchChanges = useCallback(async (): Promise<void> => {
    setBranchChangesError(null)
    try {
      setBranchChanges(await api['projects:gitBranchChanges']({ id: projectId, workspace: workspaceId }))
    } catch (error) {
      setBranchChangesError(errorText(error))
    }
  }, [api, projectId, workspaceId])

  /** Файл из списка изменений ветки: сравниваем с базой, а не с HEAD. */
  const openBranchFile = useCallback(async (path: string, base: string): Promise<void> => {
    const ticket = ++requestRef.current
    keepDraft()
    setSelected(path)
    setEditing(false)
    setConflict(null)
    setFileError(null)
    try {
      const next = await api['projects:gitDiff']({ id: projectId, workspace: workspaceId, path, base })
      if (requestRef.current !== ticket) return
      setDiff(next)
      const text = next.modified?.content ?? ''
      setDraft(text)
      setSavedText(text)
    } catch (error) {
      if (requestRef.current !== ticket) return
      setFileError(errorText(error))
    }
  }, [api, projectId, workspaceId, keepDraft])

  const ref = status?.ref ?? null
  const writable = Boolean(ref?.writable && !ref?.busy && !ref?.released)
  const dirtyDraft = editing && draft !== savedText
  const view = loadView(load.status, status !== null)
  const branchProtected = status?.branch ? isProtectedGitBranch(status.branch) : false
  const selectedConflicted = Boolean(selected && status?.changes.some((change) => change.path === selected && change.state === 'conflict'))
  const canCommit = writable && (picked.size > 0) && message.trim().length > 0
  const pickedList = useMemo(() => [...picked], [picked])
  /** Файлы с несохранёнными правками: и отложенные черновики, и открытый сейчас. */
  const dirtySet = useMemo(() => {
    const set = new Set(Object.entries(drafts).filter(([, value]) => value.draft !== value.saved).map(([path]) => path))
    if (selected && draft !== savedText) set.add(selected)
    return set
  }, [drafts, selected, draft, savedText])

  const save = async (): Promise<void> => {
    if (!selected) return
    const ok = await confirm({
      title: 'Сохранить файл в рабочей копии?',
      message: `${selected} на машине «${ref?.machineName ?? ref?.agentId ?? ''}». Файл перезапишется целиком.`,
      confirmLabel: 'Сохранить файл'
    })
    if (!ok) return
    setSaving(true)
    try {
      const result = await api['projects:gitSaveFile']({ id: projectId, workspace: workspaceId, path: selected, content: draft })
      setSavedText(result.file.content)
      setDrafts((prev) => ({ ...prev, [selected]: { draft: result.file.content, saved: result.file.content } }))
      setStatus(result.status)
      toast.success('Файл сохранён')
    } catch (error) {
      toast.error(`Не удалось сохранить: ${errorText(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const checkout = async (branch: string, confirmDirty: boolean): Promise<void> => {
    setBranchBusy(true)
    setBranchError(null)
    try {
      const result = await api['projects:gitCheckout']({ id: projectId, workspace: workspaceId, branch, confirmDirty })
      setStatus(result.status)
      setBranchDialog(false)
      setSelected(null)
      setDiff(null)
      toast.success(result.createdLocal ? `Ветка ${branch} создана из origin и выбрана` : `Переключились на ${branch}`)
    } catch (error) {
      setBranchError(errorText(error))
    } finally {
      setBranchBusy(false)
    }
  }

  const createBranch = async (name: string): Promise<void> => {
    setBranchBusy(true)
    setBranchError(null)
    try {
      const result = await api['projects:gitCreateBranch']({ id: projectId, workspace: workspaceId, name })
      setStatus(result.status)
      setBranchDialog(false)
      toast.success(`Ветка ${name} создана`)
    } catch (error) {
      setBranchError(errorText(error))
    } finally {
      setBranchBusy(false)
    }
  }

  const commit = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Создать коммит?',
      message: `${pickedList.length} файлов в ветке ${status?.branch ?? '—'} от вашего имени.`,
      confirmLabel: 'Создать коммит'
    })
    if (!ok) return
    setCommitting(true)
    try {
      const result = await api['projects:gitCommit']({ id: projectId, workspace: workspaceId, message: message.trim(), paths: pickedList })
      setStatus(result.status)
      setPicked(new Set())
      setMessage('')
      toast.success(`Коммит ${result.sha.slice(0, 8)} создан`)
    } catch (error) {
      toast.error(`Коммит не создан: ${errorText(error)}`)
    } finally {
      setCommitting(false)
    }
  }

  /** Подтянуть origin: без этого отказ push с non-fast-forward был тупиком. */
  const pull = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Подтянуть изменения из origin?',
      message: `Ветка ${status?.branch ?? '—'} будет перебазирована на origin/${status?.branch ?? '—'}. Рабочая копия должна быть без незакоммиченных правок.`,
      confirmLabel: 'Подтянуть'
    })
    if (!ok) return
    setPulling(true)
    try {
      const result = await api['projects:gitPull']({ id: projectId, workspace: workspaceId, mode: 'rebase' })
      setStatus(result.status)
      toast.success(result.pulled > 0 ? `Подтянуто коммитов: ${result.pulled}` : 'Уже актуально')
    } catch (error) {
      toast.error(`Не удалось подтянуть: ${errorText(error)}`)
    } finally {
      setPulling(false)
    }
  }

  /** Обновить данные origin, не открывая диалог ветки: иначе ↑/↓ нечем освежить. */
  const fetchOrigin = async (): Promise<void> => {
    setFetching(true)
    try {
      setBranches(await api['projects:gitBranches']({ id: projectId, workspace: workspaceId, refresh: true }))
      await refresh()
      toast.success('Данные origin обновлены')
    } catch (error) {
      toast.error(`Не удалось обновить: ${errorText(error)}`)
    } finally {
      setFetching(false)
    }
  }

  /**
   * Отбросить правки — необратимо, поэтому подтверждение с вводом имени ветки
   * (`requireText`), как у удаления колонки с задачами.
   */
  const discard = async (): Promise<void> => {
    const expected = status?.branch ?? status?.head?.slice(0, 8) ?? ''
    const ok = await confirm({
      title: `Отбросить правки в ${pickedList.length} файлах?`,
      message: 'Изменения будут потеряны безвозвратно: отслеживаемые файлы вернутся к HEAD, новые — удалятся с машины.',
      variant: 'danger',
      confirmLabel: 'Отбросить',
      requireText: expected
    })
    if (!ok) return
    setDiscarding(true)
    try {
      const result = await api['projects:gitDiscard']({ id: projectId, workspace: workspaceId, paths: pickedList, confirmText: expected })
      setStatus(result.status)
      setPicked(new Set())
      setSelected(null)
      setDiff(null)
      toast.success(`Возвращено файлов: ${result.reverted}, удалено новых: ${result.removed}`)
    } catch (error) {
      toast.error(`Не удалось отбросить: ${errorText(error)}`)
    } finally {
      setDiscarding(false)
    }
  }

  const push = async (): Promise<void> => {
    const branch = status?.branch
    if (!branch) return
    const ok = await confirm({
      title: `Отправить ветку ${branch} в origin?`,
      message: 'Отправку увидит вся команда; она же станет источником для merge-рана задачи.',
      confirmLabel: 'Отправить в origin'
    })
    if (!ok) return
    setPushing(true)
    try {
      const result = await api['projects:gitPush']({ id: projectId, workspace: workspaceId, branch })
      setStatus(result.status)
      toast.success(`Ветка ${result.branch} отправлена (${result.sha.slice(0, 8)})`)
    } catch (error) {
      toast.error(`Отправка не удалась: ${errorText(error)}`)
    } finally {
      setPushing(false)
    }
  }

  if (view.state === 'skeleton') {
    return (
      <div className="gitpane" data-testid="git-pane" aria-busy="true">
        <Skeleton variant="list" count={5} item="block" height={28} gap={8} testId="git-pane-skeleton" />
      </div>
    )
  }

  if (view.state === 'error' || !status) {
    return (
      <div className="gitpane" data-testid="git-pane">
        <ErrorState message="Не удалось прочитать состояние рабочей копии" detail={load.error} onRetry={() => void refresh()} />
      </div>
    )
  }

  if (status.problem) {
    return (
      <div className="gitpane" data-testid="git-pane">
        <ErrorState
          message={gitProblemMessage(status.problem)}
          detail={[gitProblemHint(status.problem), status.detail].filter(Boolean).join('\n')}
          onRetry={() => void refresh()}
        />
      </div>
    )
  }

  return (
    <div className="gitpane" data-testid="git-pane">
      <header className="gitpane-head">
        <div className="gitpane-head-main">
          <StatusPill tone={status.detached ? 'warning' : 'neutral'}>
            {status.detached ? `detached @ ${status.head?.slice(0, 8) ?? '—'}` : status.branch ?? '—'}
          </StatusPill>
          {!status.detached && (
            <span className="gitpane-track" title="Коммитов впереди и позади origin">
              ↑{status.ahead} ↓{status.behind}
            </span>
          )}
          <span className="gitpane-machine">{ref?.machineName ?? ref?.agentId}</span>
          <span className="gitpane-count">{status.changes.length} изменений</span>
          {status.changesTruncated && (
            <Button size="sm" variant="ghost" onClick={() => setChangesLimit((prev) => (prev ?? 500) * 4)}>
              Показать больше
            </Button>
          )}
          {view.refreshing && <RefreshIndicator label="Обновляем состояние…" />}
        </div>
        <div className="gitpane-head-actions">
          <IconButton size="sm" title="Обновить состояние" aria-label="Обновить состояние рабочей копии" onClick={() => void refresh()}>⟳</IconButton>
          <Button size="sm" loading={fetching} onClick={() => void fetchOrigin()}>Обновить из origin</Button>
          {status.behind > 0 && (
            <Button
              size="sm"
              loading={pulling}
              disabled={!writable || status.changes.length > 0}
              title={status.changes.length > 0 ? 'Сначала закоммитьте или отбросьте изменения' : `Перебазировать на origin/${status.branch ?? ''}`}
              onClick={() => void pull()}
            >
              Подтянуть ({status.behind})
            </Button>
          )}
          <Button size="sm" disabled={!writable} title={writable ? undefined : ref?.readOnlyReason ?? undefined} onClick={() => { setBranchDialog(true); void loadBranches(false) }}>Ветка…</Button>
        </div>
      </header>

      {view.staleError && <ErrorState compact message="Состояние могло устареть" detail={load.error} onRetry={() => void refresh()} />}

      {ref?.busy && (
        <p className="gitpane-banner gitpane-banner--busy" role="status">
          Каталог занят {ref.busy.kind === 'ci' ? 'CI-раном' : 'merge-раном'} задачи: файлы можно смотреть, менять — нет.
          {onOpenRun && <Button size="sm" variant="ghost" onClick={() => onOpenRun(ref.busy!.kind, ref.busy!.runId)}>Открыть ран</Button>}
        </p>
      )}

      {ref && !ref.busy && !ref.writable && (
        <p className="gitpane-banner" role="status">
          Рабочая копия доступна только для чтения: {ref.readOnlyReason ?? 'изменение запрещено'}.
        </p>
      )}

      {status.changes.length > 0 && (
        <p className="gitpane-banner gitpane-banner--dirty" role="status">
          Есть незакоммиченные изменения. Следующий CI-ран задачи требует чистой рабочей копии — закоммитьте их,
          иначе он остановится на проверке.
        </p>
      )}

      <div className="gitpane-body">
        <section className="gitpane-side" aria-label="Файлы рабочей копии">
          <div className="sideswitch gitpane-side-tabs" role="tablist" aria-label="Что показать слева">
            <button type="button" role="tab" aria-selected={side === 'changes'} className={side === 'changes' ? 'on' : ''} onClick={() => setSide('changes')}>Изменения</button>
            <button type="button" role="tab" aria-selected={side === 'branch'} className={side === 'branch' ? 'on' : ''} onClick={() => setSide('branch')}>Ветка</button>
            <button type="button" role="tab" aria-selected={side === 'files'} className={side === 'files' ? 'on' : ''} onClick={() => setSide('files')}>Файлы</button>
            <button type="button" role="tab" aria-selected={side === 'search'} className={side === 'search' ? 'on' : ''} onClick={() => setSide('search')}>Поиск</button>
          </div>
          {side === 'files' && <GitTreeView loadDir={loadTreeDirCached} selectedPath={selected} onOpenFile={(path) => void openFromTree(path)} />}
          {side === 'search' && (
            <GitSearchPanel
              knownPaths={[...new Set([...treePaths, ...status.changes.map((change) => change.path)])]}
              onOpenFile={(path) => void openFromTree(path)}
              onSearch={(query) => api['projects:gitGrep']({ id: projectId, workspace: workspaceId, query })}
            />
          )}
          {side === 'branch' && (
            branchChangesError
              ? <ErrorState compact message="Не удалось прочитать изменения ветки" detail={branchChangesError} onRetry={() => { setBranchChangesError(null); void loadBranchChanges() }} />
              : !branchChanges
                ? <Skeleton variant="list" count={4} item="line" height={20} gap={6} />
                : branchChanges.changes.length === 0
                  ? <EmptyState compact icon="=" title="Ветка не отличается от базы" description={`Относительно origin/${status.baseBranch} изменений нет — работа ещё не закоммичена или уже слита.`} />
                  : (
                    <>
                      <p className="gitpane-side-note">
                        Против {branchChanges.base.slice(0, 8)} (общий предок с origin/{status.baseBranch})
                        {branchChanges.truncated ? ' · показаны первые' : ''}
                      </p>
                      <GitChangeList
                        changes={branchChanges.changes}
                        selectedPath={selected}
                        checked={new Set()}
                        writable={false}
                        onSelect={(path) => void openBranchFile(path, branchChanges.base)}
                        onToggle={() => {}}
                      />
                    </>
                  )
          )}
          {side === 'changes' && (status.changes.length === 0
            ? <EmptyState compact icon="✓" title="Рабочая копия чистая" description="Модель ещё ничего не меняла — или всё уже закоммичено." />
            : (
              <GitChangeList
                changes={status.changes}
                selectedPath={selected}
                checked={picked}
                writable={writable}
                dirtyPaths={dirtySet}
                onSelect={(path) => void openFile(path)}
                onToggle={(path, next) => setPicked((prev) => {
                  const copy = new Set(prev)
                  if (next) copy.add(path)
                  else copy.delete(path)
                  return copy
                })}
              />
            ))}
          {(side === 'changes' || side === 'branch') && status.commitsAhead.length > 0 && (
            <GitCommitList
              commits={status.commitsAhead}
              title={`Коммиты сверх origin/${status.baseBranch}`}
              loadDetail={(sha) => api['projects:gitCommitDetail']({ id: projectId, workspace: workspaceId, sha })}
              onOpenFile={(path) => void openFromTree(path)}
            />
          )}
        </section>

        <section className="gitpane-main" aria-label="Содержимое файла">
          {!selected && <EmptyState compact icon="📄" title="Файл не выбран" description="Выберите файл слева, чтобы увидеть изменения и поправить их." />}
          {selected && fileError && (
            <ErrorState message="Не удалось прочитать файл" detail={fileError} onRetry={() => void openFile(selected)} />
          )}
          {selected && !fileError && (
            <>
              <div className="gitpane-main-head">
                <strong className="gitpane-main-path">{selected}{dirtyDraft ? ' ●' : ''}</strong>
                <div className="sideswitch" role="tablist" aria-label="Вид файла">
                  <button type="button" role="tab" aria-selected={!editing && !conflict} className={!editing && !conflict ? 'on' : ''} onClick={() => { setEditing(false); setConflict(null) }}>Изменения</button>
                  <button type="button" role="tab" aria-selected={editing} className={editing ? 'on' : ''} onClick={() => { setEditing(true); setConflict(null) }}>Правка</button>
                  {selectedConflicted && (
                    <button type="button" role="tab" aria-selected={Boolean(conflict)} className={conflict ? 'on' : ''} onClick={() => void openConflict(selected)}>Конфликт</button>
                  )}
                </div>
                {editing && writable && (
                  <Button size="sm" variant="primary" loading={saving} disabled={!dirtyDraft} onClick={() => void save()}>Сохранить</Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => void loadFileLog(selected)}>История файла</Button>
                <IconButton size="sm" title="Скачать файл" aria-label={`Скачать ${selected}`} onClick={() => void downloadFile(selected)}>⬇</IconButton>
              </div>
              {conflict
                ? (
                  <GitConflictView
                    stages={conflict}
                    writable={writable}
                    busy={conflictBusy}
                    onResolve={(conflictSide) => void resolveConflict(conflict.path, conflictSide)}
                    {...(ref && onOpenRun ? {} : {})}
                  />
                )
                : editing
                ? (
                  <div className="gitpane-editor" data-testid="git-editor">
                    {diff?.modified?.binary || diff?.modified?.truncated
                      ? <EmptyState compact icon="🧱" title="Файл нельзя править здесь" description="Бинарный или слишком большой файл — откройте его в проводнике машины." />
                      : (
                        <CodeEditor
                          path={selected}
                          value={draft}
                          onChange={setDraft}
                          onSave={() => void save()}
                          ariaLabel={`Содержимое ${selected}`}
                          readOnly={!writable}
                        />
                      )}
                  </div>
                )
                : (
                  <div className="gitpane-diff" data-testid="git-diff">
                    {diff?.original?.binary || diff?.modified?.binary
                      ? <EmptyState compact icon="🧱" title="Бинарный файл" description="Сравнение недоступно: откройте файл в проводнике машины." />
                      : (
                        <CodeDiff
                          path={selected}
                          original={diff?.original?.content ?? ''}
                          modified={diff?.modified?.content ?? ''}
                        />
                      )}
                  </div>
                )}
              {fileLog && fileLog.path === selected && (
                <GitCommitList
                  commits={fileLog.commits}
                  title={`История файла (${fileLog.commits.length})`}
                  loadDetail={(sha) => api['projects:gitCommitDetail']({ id: projectId, workspace: workspaceId, sha })}
                  onOpenFile={(path) => void openFromTree(path)}
                />
              )}
            </>
          )}
        </section>
      </div>

      <footer className="gitpane-foot">
        <label className="gitpane-message">
          <span>Сообщение коммита</span>
          <input
            aria-label="Сообщение коммита"
            value={message}
            placeholder="fix: поправил то, что наменяла модель"
            disabled={!writable}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <div className="gitpane-foot-actions">
          <span className="gitpane-picked">{picked.size} выбрано</span>
          <Button size="sm" disabled={!writable || status.changes.length === 0} onClick={() => setPicked(new Set(status.changes.map((change) => change.path)))}>Выбрать все</Button>
          <Button size="sm" loading={staging} disabled={!writable || picked.size === 0} onClick={() => void stage(false)}>В индекс</Button>
          <Button size="sm" loading={staging} disabled={!writable || picked.size === 0} onClick={() => void stage(true)}>Из индекса</Button>
          <Button
            size="sm"
            variant="danger"
            loading={discarding}
            disabled={!writable || picked.size === 0}
            title={writable ? 'Вернуть выбранные файлы к HEAD, новые — удалить' : ref?.readOnlyReason ?? undefined}
            onClick={() => void discard()}
          >
            Отбросить
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={committing}
            disabled={!canCommit}
            title={!writable ? ref?.readOnlyReason ?? undefined : undefined}
            onClick={() => void commit()}
          >
            Закоммитить
          </Button>
          <Button
            size="sm"
            loading={pushing}
            disabled={!writable || !status.branch || branchProtected || status.ahead === 0}
            title={!writable
              ? ref?.readOnlyReason ?? undefined
              : branchProtected
                ? 'В main, master и release/* панель не отправляет: это делают merge-ран и релизы'
                : status.ahead === 0 ? 'Нет коммитов для отправки' : undefined}
            onClick={() => void push()}
          >
            Отправить ветку
          </Button>
        </div>
        {branchProtected && (
          <p className="gitpane-foot-note" role="status">
            Ветка {status.branch} защищена: в неё попадают только через merge-ран задачи и релизы.
          </p>
        )}
        {ref && status.gitUrl && onOpenGitAccess && (
          <Button size="sm" variant="ghost" onClick={() => onOpenGitAccess(ref.agentId)}>Git-доступ машины…</Button>
        )}
      </footer>

      <GitBranchDialog
        open={branchDialog}
        branches={branches}
        current={status.branch}
        changes={status.changes}
        busy={branchBusy}
        error={branchError}
        onClose={() => setBranchDialog(false)}
        onCheckout={(branch, confirmDirty) => void checkout(branch, confirmDirty)}
        onCreate={(name) => void createBranch(name)}
        onRefresh={() => void loadBranches(true)}
      />
    </div>
  )
}
