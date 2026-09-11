import { Dialog, ErrorState, useToast } from '../i18n/ui'
import { localizeMakeText, mt, useMakeLocale } from '../i18n'
import { probeLocalStorybook } from '@voicechat/ui-foundation/lib/browserResources'
// Make Project mode displays real repository components in the project's Storybook and edits files
// directly in a machine working copy. It is separate from MakePane because repository copies and
// Make workshops have different data sources, permissions, and lifecycles: projects:git* versus
// make:*. Reusing the simple list-and-frame layout avoids branching the large workshop panel. The
// /api/preview proxy reaches the machine port through <agentId>.machine.internal. It does not
// forward WebSockets, so HMR is unavailable through that path and saving reloads the frame.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, EmptyState, IconButton, Skeleton, StatusPill, type StatusTone } from '@voicechat/ui-kit'
import type { RendererApi } from '@shared/ipc'
import type { GitWorkspaceRef } from '@shared/gitWorkspace'
import type { ProjectComponentEntry, ProjectComponentsListing, ProjectStorybookAccess, ProjectStorybookSession } from '@shared/projectComponents'
import { machineOrigin, projectStorybookFrameUrl, storybookFrameUrlAt } from '@shared/projectComponents'
import { makeStorybookCommandKey } from '@voicechat/ui-foundation/persistence'
import { loadView, type LoadStatus } from '@voicechat/ui-foundation/lib/loadState'
import { usePolling } from '@voicechat/ui-foundation/lib/usePolling'
import { CodeEditor } from './MakeCodeEditor'

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
  /** Preview cookie gate: the iframe cannot send Bearer headers, like the other embedded previews. */
  localAgentId?: string | null
  ensurePreview?: () => Promise<void>
  /** Open the newly created task card on the board. */
  onOpenTask?: (projectId: string, taskId: string) => void
  /** Send the edit to the chat assistant. */
  onInsertToChat?: (text: string) => void
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Working-copy label: the task is clearer than a path, while the machine identifies where it lives. */
export function workspaceLabel(ref: GitWorkspaceRef): string {
  const base = ref.taskSeq ? `#${ref.taskSeq} ${ref.taskTitle ?? ''}`.trim() : ref.kind === 'project-worktree' ? mt("projectCopy") : ref.path
  return ref.machineName ? `${base} · ${ref.machineName}` : base
}

const STATE_LABEL: Record<ProjectStorybookSession['state'], string> = {
  get stopped() { return mt("storybookStopped") },
  get starting() { return mt("storybookIsBuilding") },
  get running() { return mt("storybookIsRunning") },
  get failed() { return mt("storybookFailedToStart") }
}

/** Short connection-mode label beside the preview status. */
const ACCESS_LABEL: Record<ProjectStorybookAccess['kind'], string> = {
  get direct() { return mt("directFrame") },
  get tunnel() { return mt("frameThroughLocalAgent") },
  get proxy() { return mt("frameThroughMachineBridge") }
}

const STATE_TONE: Record<ProjectStorybookSession['state'], StatusTone> = {
  stopped: 'neutral',
  starting: 'running',
  running: 'success',
  failed: 'danger'
}

export function MakeProjectComponents({ projectId, api, ensurePreview, localAgentId = null, onOpenTask, onInsertToChat }: MakeProjectComponentsProps): JSX.Element {
  useMakeLocale()
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
   * Preview connection strategy: the proxy works remotely, but separate requests for every Vite
   * module make slow links costly. Try a direct URL when the browser is on the same machine, then a
   * local agent tunnel, then the proxy.
   */
  const [access, setAccess] = useState<ProjectStorybookAccess | null>(null)
  const [previewReady, setPreviewReady] = useState(!ensurePreview)
  const [ticketOpen, setTicketOpen] = useState(false)
  const [ticketTitle, setTicketTitle] = useState('')
  const [ticketNote, setTicketNote] = useState('')
  const [ticketBusy, setTicketBusy] = useState(false)
  /**
   * Startup command: the server cannot infer the correct monorepo workspace. Persist it per project
   * because the team shares one command.
   */
  const [command, setCommand] = useState<string>(() => {
    try { return localStorage.getItem(makeStorybookCommandKey(projectId)) ?? '' } catch { return '' }
  })
  const [commandOpen, setCommandOpen] = useState(false)
  const [ticketError, setTicketError] = useState<string | null>(null)
  /** Paths modified in this panel become the ticket's commit contents. */
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
      // Keep the previous session status on refresh errors; explicit actions will report failures.
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

  // Poll while building until the running state confirms readiness.
  usePolling(() => {
    void loadSession().then(() => { if (session?.state === 'starting') void loadComponents() })
  }, { enabled: session?.state === 'starting', intervalMs: 4000 })

  // Reload the list when Storybook starts because its live index contains the actual story IDs.
  const readyAt = session?.readyAt ?? null
  useEffect(() => { if (readyAt) void loadComponents() }, [readyAt, loadComponents])

  /**
   * Probe the direct URL: if Storybook runs on the browser's machine, the frame can bypass the
   * bridge. Storybook/Vite sends CORS headers, allowing the response to be read; another machine's
   * address will fail or time out.
   */
  const probeDirect = probeLocalStorybook

  const listedStoryIds = useMemo(() => listing?.components.flatMap((component) => component.stories.map((story) => story.id)) ?? [], [listing])
  const listedStoryIdsKey = listedStoryIds.join('\n')

  useEffect(() => {
    if (!session || session.state !== 'running' || !workspaceId || !listedStoryIds.length) { setAccess(null); return }
    let alive = true
    let opened: ProjectStorybookAccess | null = null
    void (async () => {
      if (await probeDirect(session.port, listedStoryIds)) {
        if (alive) setAccess({ kind: 'direct', url: `http://127.0.0.1:${session.port}`, tunnelId: null, note: mt("storybookRunsOnThisMachineSoTheFrameLoads") })
        return
      }
      try {
        const result = await api['projects:storybookOpen']({ id: projectId, workspace: workspaceId, localAgentId })
        opened = result
        if (alive) setAccess(result)
      } catch {
        // If the server does not respond, the proxy can still use the machine's direct address.
        if (alive) setAccess({ kind: 'proxy', url: `/api/preview?url=${encodeURIComponent(machineOrigin(session.agentId, session.port))}`, tunnelId: null, note: mt("theFrameLoadsThroughTheMachineBridge") })
      }
    })()
    return () => {
      alive = false
      // Keep the tunnel only while the tab is open so remote ports are not left behind.
      if (opened?.tunnelId) void api['projects:storybookCloseTunnel']({ id: projectId, tunnelId: opened.tunnelId, workspace: workspaceId }).catch(() => undefined)
    }
  }, [api, projectId, workspaceId, session?.state, session?.port, session?.agentId, listedStoryIdsKey, probeDirect])

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
    // Before Storybook starts, parse CSF names to populate the list.
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
      // HMR cannot pass through the proxy; reload the frame after saving so edits become visible.
      setFrameRev((rev) => rev + 1)
      toast.success(mt("fileSavedToWorkingCopy"))
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
      toast.success(mt("taskValueIsReadyToMerge", { p0: result.branch }))
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
          <span className="mpc-ws-label">{mt("workingCopy")}</span>
          <select
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
            disabled={!workspaces?.length}
            aria-label={mt("projectWorkingCopy")}
          >
            {!workspaces?.length && <option value="">{mt("noWorkingCopies")}</option>}
            {workspaces?.map((ref) => (
              <option key={ref.id} value={ref.id}>{workspaceLabel(ref)}{ref.online ? '' : mt("offline")}</option>
            ))}
          </select>
        </label>
        <StatusPill tone={STATE_TONE[session?.state ?? 'stopped']}>
          {STATE_LABEL[session?.state ?? 'stopped']}{session?.adopted ? mt("startedOutsideThePanel") : ''}
        </StatusPill>
        {session?.state === 'running' || session?.state === 'starting' ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => void act('restart')} loading={sessionBusy}>{mt("restart")}</Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void act('stop')}
              loading={sessionBusy}
              title={session?.adopted ? mt("storybookWasStartedOutsideThePanelStopItWhere") : undefined}
              disabled={session?.adopted}
            >{mt("stop")}</Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="primary"
            onClick={() => void act('start')}
            loading={sessionBusy}
            disabled={!workspace || !workspace.online || readOnly}
          >{mt("startStorybook")}</Button>
        )}
        {access && <span className="mpc-access" title={access.note ? localizeMakeText(access.note) : undefined}>{ACCESS_LABEL[access.kind]}</span>}
        <Button size="sm" variant="ghost" onClick={() => setCommandOpen(true)}>{mt("command")}</Button>
        <Button size="sm" variant="ghost" onClick={() => setLogOpen(true)} disabled={!session?.log}>{mt("log")}</Button>
        {changed.length > 0 && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => { setTicketTitle(mt("editValue", { p0: activeComponent?.title ?? mt("component") })); setTicketOpen(true) }}
          >{mt("createTask")}{changed.length})
          </Button>
        )}
      </div>

      {workspace && !workspace.online && (
        <ErrorState compact message={mt("thisWorkingCopySMachineIsOffline")} detail={mt("storybookCannotRunAndFilesCannotBeRead")} />
      )}
      {readOnly && workspace?.online && (
        <ErrorState compact message={mt("thisWorkingCopyIsReadOnly")} detail={workspace.readOnlyReason ?? mt("theDirectoryIsInUseByARunOr")} />
      )}
      {session?.state === 'failed' && session.error && (
        <ErrorState compact message={session.error} detail={mt("openTheStartupLogToSeeWhereTheBuild")} />
      )}

      <div className="mpc-body">
        <div className="mpc-list">
          <input
            className="mpc-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mt("searchComponents")}
            aria-label={mt("searchComponents")}
          />
          {listView.state === 'skeleton' && <div className="mpc-skeletons">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={28} />)}</div>}
          {listView.state === 'error' && <ErrorState message={mt("couldNotReadComponents")} detail={load.error ?? undefined} onRetry={() => void loadComponents()} />}
          {listView.state === 'empty' && (
            <EmptyState
              title={mt("noComponentsFound")}
              description={mt("theWorkingCopyHasNoStoriesTsxFilesAdd")}
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
          {listing?.truncated && <p className="mpc-note">{mt("theListIsTruncatedMoreComponentsExistThanFit")}</p>}
        </div>

        <div className="mpc-main">
          <div className="mpc-tabs" role="tablist" aria-label={mt("componentPreview")}>
            <button type="button" role="tab" aria-selected={view === 'frame'} onClick={() => setView('frame')}>{mt("frame")}</button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'code'}
              onClick={() => { setView('code'); if (selected.path && file?.path !== selected.path) void openFile(selected.path) }}
              disabled={!selected.path}
            >{mt("code")}</button>
            {view === 'frame' && frameUrl && (
              <IconButton aria-label={mt("reloadFrame")} title={mt("reloadFrame")} onClick={() => setFrameRev((rev) => rev + 1)}>⟳</IconButton>
            )}
          </div>

          {view === 'frame' && (
            frameUrl ? (
              <iframe
                className="mpc-frame"
                title={mt("componentStories")}
                src={frameUrl}
                sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin allow-downloads"
              />
            ) : (
              <EmptyState
                title={session?.state === 'running' ? mt("selectAStoryOnTheLeft") : mt("storybookHasNotStartedYet")}
                description={session?.state === 'running'
                  ? mt("theFrameShowsTheComponentAsBuiltByThe")
                  : mt("startStorybookOnTheMachineToBuildComponentsFrom")}
              />
            )
          )}

          {view === 'code' && (
            <div className="mpc-editor">
              {fileError && <ErrorState compact message={mt("fileHasNotBeenRead")} detail={fileError} onRetry={() => selected.path && void openFile(selected.path)} />}
              {file && (
                <>
                  <div className="mpc-editor-head">
                    <span className="mpc-editor-path">{file.path}{dirty ? mt("unsaved_a117f2") : ''}</span>
                    <Button size="sm" variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty || readOnly}>{mt("save")}</Button>
                    {onInsertToChat && (
                      <Button size="sm" variant="ghost" onClick={() => onInsertToChat(mt("workOnComponentValueFileValueInTheProject", { p0: activeComponent?.title ?? file.path, p1: file.path }))}>{mt("toChat")}</Button>
                    )}
                  </div>
                  <CodeEditor
                    path={file.path}
                    value={file.content}
                    onChange={(value) => setFile((prev) => (prev ? { ...prev, content: value } : prev))}
                    onSave={() => void save()}
                    ariaLabel={mt("contentsOfValue", { p0: file.path })}
                    readOnly={readOnly}
                  />
                </>
              )}
              {!file && !fileError && <EmptyState title={mt("noFileSelected")} description={mt("selectAComponentOnTheLeftToOpenIts")} />}
            </div>
          )}
        </div>
      </div>

      {commandOpen && (
        <Dialog
          title={mt("storybookStartupCommand")}
          onClose={() => setCommandOpen(false)}
          actions={<Button variant="primary" onClick={() => {
            try { localStorage.setItem(makeStorybookCommandKey(projectId), command.trim()) } catch { /* In private browsing, keep the command for this session only. */ }
            setCommandOpen(false)
          }}>{mt("remember")}</Button>}
        >
          <p className="mpc-ticket-note">{mt("runsInTheWorkingCopyDirectoryThePanelAdds")}{' '}<code>--no-open</code>{' '}{mt("and")}{' '}<code>--ci</code>{mt("automaticallyInAMonorepoSpecifyTheShowcasePackageFor")}<code> npm run -w @voicechat/ui storybook --</code>.
          </p>
          <label className="mpc-field">
            <span>{mt("command")}</span>
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
        <Dialog title={mt("storybookStartupLog")} onClose={() => setLogOpen(false)} size="lg">
          <pre className="mpc-log">{session?.log || mt("emptyForNow")}</pre>
        </Dialog>
      )}

      {ticketOpen && (
        <Dialog
          title={mt("taskFromEdit")}
          onClose={() => setTicketOpen(false)}
          closeOnOverlay={false}
          actions={<Button variant="primary" onClick={() => void createTicket()} loading={ticketBusy} disabled={!ticketTitle.trim()}>{mt("createAndPrepareToMerge")}</Button>}
        >
          <p className="mpc-ticket-note">{mt("theEditWillBeCommittedToASeparateBranch")}</p>
          <label className="mpc-field">
            <span>{mt("title")}</span>
            <input value={ticketTitle} onChange={(event) => setTicketTitle(event.target.value)} autoFocus />
          </label>
          <label className="mpc-field">
            <span>{mt("whatChanged")}</span>
            <textarea value={ticketNote} onChange={(event) => setTicketNote(event.target.value)} rows={3} />
          </label>
          <ul className="mpc-ticket-paths" role="list">
            {changed.map((path) => <li key={path}>{path}</li>)}
          </ul>
          {ticketError && <ErrorState compact message={mt("taskWasNotCreated")} detail={ticketError} />}
        </Dialog>
      )}
    </div>
  )
}
