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
import type { GitBranchList, GitFileDiff, GitWorkspaceStatus } from '@shared/gitWorkspace'
import { isProtectedGitBranch } from '@shared/gitWorkspace'
import { loadView, type LoadStatus } from '../../lib/loadState'
import { CodeDiff } from '../CodeDiff'
import { CodeEditor } from '../CodeEditor'
import { GitChangeList } from './GitChangeList'
import { GitTreeView } from './GitTreeView'
import { GitBranchDialog } from './GitBranchDialog'
import { gitProblemHint, gitProblemMessage } from './gitLabels'

/** Каналы моста, которые нужны панели. Больше она ни о чём не знает. */
export type GitPaneApi = Pick<
  RendererApi,
  'projects:gitStatus' | 'projects:gitBranches' | 'projects:gitDiff' | 'projects:gitTree' | 'projects:gitFile'
  | 'projects:gitSaveFile' | 'projects:gitCheckout' | 'projects:gitCreateBranch'
  | 'projects:gitCommit' | 'projects:gitPush'
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
  const [side, setSide] = useState<'changes' | 'files'>('changes')
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<GitFileDiff | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [savedText, setSavedText] = useState('')
  const [saving, setSaving] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [pushing, setPushing] = useState(false)
  // Каждый ответ обесценивает предыдущий: пока читался файл, человек мог выбрать другой.
  const requestRef = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    setLoad((prev) => ({ status: 'loading', error: prev.error }))
    try {
      const next = await api['projects:gitStatus']({ id: projectId, workspace: workspaceId })
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
    setStatus(null)
    setSelected(null)
    setDiff(null)
    setEditing(false)
    setPicked(new Set())
    void refresh()
  }, [refresh])

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

  const openFile = useCallback(async (path: string): Promise<void> => {
    const ticket = ++requestRef.current
    setSelected(path)
    setEditing(false)
    setDiff(null)
    setFileError(null)
    try {
      const next = await api['projects:gitDiff']({ id: projectId, workspace: workspaceId, path })
      if (requestRef.current !== ticket) return
      setDiff(next)
      const text = next.modified?.content ?? ''
      setDraft(text)
      setSavedText(text)
    } catch (error) {
      if (requestRef.current !== ticket) return
      setFileError(errorText(error))
    }
  }, [api, projectId, workspaceId])

  /**
   * Файл из дерева: у него может не быть изменений, поэтому сравнение бессмысленно —
   * читаем рабочую копию и сразу открываем в правке.
   */
  const openFromTree = useCallback(async (path: string): Promise<void> => {
    const ticket = ++requestRef.current
    setSelected(path)
    setDiff(null)
    setFileError(null)
    try {
      const file = await api['projects:gitFile']({ id: projectId, workspace: workspaceId, path })
      if (requestRef.current !== ticket) return
      setDraft(file.content)
      setSavedText(file.content)
      setEditing(true)
    } catch (error) {
      if (requestRef.current !== ticket) return
      setFileError(errorText(error))
    }
  }, [api, projectId, workspaceId])

  const loadTreeDir = useCallback(async (dir: string) => {
    const listing = await api['projects:gitTree']({ id: projectId, workspace: workspaceId, dir })
    return listing.entries
  }, [api, projectId, workspaceId])

  const ref = status?.ref ?? null
  const writable = Boolean(ref?.writable && !ref?.busy && !ref?.released)
  const dirtyDraft = editing && draft !== savedText
  const view = loadView(load.status, status !== null)
  const branchProtected = status?.branch ? isProtectedGitBranch(status.branch) : false
  const canCommit = writable && (picked.size > 0) && message.trim().length > 0
  const pickedList = useMemo(() => [...picked], [picked])

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
          <span className="gitpane-count">{status.changes.length} изменений{status.changesTruncated ? ' (показаны первые)' : ''}</span>
          {view.refreshing && <RefreshIndicator label="Обновляем состояние…" />}
        </div>
        <div className="gitpane-head-actions">
          <IconButton size="sm" title="Обновить состояние" aria-label="Обновить состояние рабочей копии" onClick={() => void refresh()}>⟳</IconButton>
          <Button size="sm" disabled={!writable} onClick={() => { setBranchDialog(true); void loadBranches(false) }}>Ветка…</Button>
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
          Рабочая копия доступна только для чтения: {ref.kind === 'merge-clone'
            ? 'это merge-клон, им управляет merge-ран'
            : 'запись запрещена политикой машины или режимом доступа проекта'}.
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
            <button type="button" role="tab" aria-selected={side === 'files'} className={side === 'files' ? 'on' : ''} onClick={() => setSide('files')}>Файлы</button>
          </div>
          {side === 'files' && <GitTreeView loadDir={loadTreeDir} selectedPath={selected} onOpenFile={(path) => void openFromTree(path)} />}
          {side === 'changes' && (status.changes.length === 0
            ? <EmptyState compact icon="✓" title="Рабочая копия чистая" description="Модель ещё ничего не меняла — или всё уже закоммичено." />
            : (
              <GitChangeList
                changes={status.changes}
                selectedPath={selected}
                checked={picked}
                writable={writable}
                onSelect={(path) => void openFile(path)}
                onToggle={(path, next) => setPicked((prev) => {
                  const copy = new Set(prev)
                  if (next) copy.add(path)
                  else copy.delete(path)
                  return copy
                })}
              />
            ))}
          {side === 'changes' && status.commitsAhead.length > 0 && (
            <div className="gitpane-commits">
              <h4>Коммиты сверх origin/{status.baseBranch}</h4>
              <ul role="list">
                {status.commitsAhead.map((item) => (
                  <li key={item.sha} role="listitem" title={item.sha}>
                    <code>{item.sha.slice(0, 8)}</code> {item.subject}
                  </li>
                ))}
              </ul>
            </div>
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
                <strong className="gitpane-main-path">{selected}</strong>
                <div className="sideswitch" role="tablist" aria-label="Вид файла">
                  <button type="button" role="tab" aria-selected={!editing} className={!editing ? 'on' : ''} onClick={() => setEditing(false)}>Изменения</button>
                  <button type="button" role="tab" aria-selected={editing} className={editing ? 'on' : ''} onClick={() => setEditing(true)}>Правка</button>
                </div>
                {editing && writable && (
                  <Button size="sm" variant="primary" loading={saving} disabled={!dirtyDraft} onClick={() => void save()}>Сохранить</Button>
                )}
              </div>
              {editing
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
          <Button size="sm" variant="primary" loading={committing} disabled={!canCommit} onClick={() => void commit()}>Закоммитить</Button>
          <Button
            size="sm"
            loading={pushing}
            disabled={!writable || !status.branch || branchProtected || status.ahead === 0}
            title={branchProtected
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
