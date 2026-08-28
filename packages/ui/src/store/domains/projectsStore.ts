// projectsStore — проекты, канбан-доска и CI-раннер (CHAT-236).
//
// Домен вынесен из глобального стора вместе с остальными, но его дом —
// `@voicechat/projects-app`: перенос состояния туда идёт отдельным шагом (сам
// пакет уже существует, экраны проектов ещё живут в `packages/ui`). До тех пор
// правило то же, что у прочих доменов: другие хранилища он не импортирует, а с
// Chat разговаривает только через порт, который выдаёт AppRuntime.

import type { Board, ProjectDetail, ProjectSummary, Task, TaskChatBadge, WorkItemType, TaskPriority, ProjectMachineDirectoryAssignments, ProjectMachineDirectoryKind } from '@shared/projects'
import type { ProjectTypeNode } from '@shared/projectTypes'
import type { ProjectInvitation, ProjectInvitationForUser } from '@shared/projects'
import type {
  CiCommand,
  CiCommandInput,
  CiCommandSuggestion,
  CiFixAttempt,
  CiGlobalSettings,
  CiInteraction,
  CiInteractionAnswer,
  CiLogLine,
  CiRun,
  CiRunConclusion,
  CiRunDetail,
  CiRunMode,
  CiRunStep,
  CiRunSummary,
  CiWorkspaceReportItem
} from '@shared/ci'
import { isTerminalCiStatus } from '@shared/ci'
import type { LoadStatus } from '../../lib/loadState'
import type { ProjectsClient } from '../../clients/types'
import { createStoreCore, type Store } from '../createStore'

/** Шаг дробного ранга для оптимистичного порядка на клиенте. */
const BOARD_RANK_STEP = 1024

/** Кэш одного рана: снимок ленты + накопленный лог + заключение. */
export interface CiRunCache {
  detail: CiRunDetail | null
  log: CiLogLine[]
  conclusion: CiRunConclusion | null
  /** Ошибка последней REST-подгрузки ленты (лента показывает её с «Повторить»). */
  error?: string | null
  loading?: boolean
}

/** История и realtime могут принести одну строку повторно; seq стабилен внутри рана. */
export function mergeCiLogLines(current: CiLogLine[], incoming: CiLogLine[]): CiLogLine[] {
  const bySeq = new Map(current.map((line) => [line.seq, line]))
  for (const line of incoming) bySeq.set(line.seq, line)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

/**
 * Id задач в колонках, меняющих видимость чатов (`done` и `cancelled`).
 * Для `done` список зависит от пользовательского фильтра, `cancelled` скрыт всегда.
 */
function taskChatVisibilityIds(board: Board): Set<string> {
  const hiddenColumns = new Set(board.columns.filter((c) => c.semanticType === 'done' || c.semanticType === 'cancelled').map((c) => c.id))
  return new Set(board.tasks.filter((t) => hiddenColumns.has(t.columnId)).map((t) => t.id))
}

function sameTaskChatVisibility(a: Board, b: Board): boolean {
  const before = taskChatVisibilityIds(a)
  const after = taskChatVisibilityIds(b)
  return before.size === after.size && [...before].every((id) => after.has(id))
}

export interface ProjectsState {
  projectsOpen: boolean
  projects: ProjectSummary[]
  /** Список прочитан с сервера — иначе «проекта нет» не отличить от «не грузили». */
  projectsLoaded: boolean
  projectDetail: ProjectDetail | null
  /** Каталог типов, видимый пользователю: встроенные, опубликованные и свои. */
  projectTypes: ProjectTypeNode[]
  projectTypesLoaded: boolean
  /** Живые приглашения открытого проекта (владельцу). */
  projectInvitations: ProjectInvitation[]
  /** Приглашения, адресованные мне: показываются вне проекта. */
  myInvitations: ProjectInvitationForUser[]
  activeProjectId: string | null
  projectSettingsOpen: boolean
  board: Board | null
  boardLoading: boolean
  boardError: string | null
  boardIncludeCompleted: boolean
  ciOpen: boolean
  ciCommands: CiCommand[]
  ciStatus: LoadStatus
  ciError: string | null
  ciSettings: CiGlobalSettings | null
  ciSuggestions: CiCommandSuggestion[]
  ciWorkspaces: CiWorkspaceReportItem[]
  ciRuns: Record<string, CiRunCache>
  ciSummaries: Record<string, CiRunSummary>
  ciActiveRunId: string | null
  /** Id закрытых пауз рана: форма вопроса в чате гаснет после ответа. */
  answeredCiInteractions: string[]
}

export interface ProjectsActions {
  openProjects(): Promise<void>
  closeProjects(): void
  refreshProjects(): Promise<ProjectSummary[]>
  loadNavigation(): Promise<void>
  selectProject(id: string): Promise<void>
  createProject(input: Parameters<ProjectsClient['projects:create']>[0]): Promise<ProjectDetail | null>
  /** Загрузить каталог типов (идемпотентно; повторный вызов обновляет список). */
  loadProjectTypes(): Promise<ProjectTypeNode[]>
  loadProjectInvitations(id: string): Promise<void>
  inviteToProject(id: string, invitee: string, role: 'owner' | 'member'): Promise<boolean>
  resendProjectInvitation(id: string, invitationId: string): Promise<void>
  revokeProjectInvitation(id: string, invitationId: string): Promise<void>
  loadMyInvitations(): Promise<void>
  acceptInvitation(token: string): Promise<string | null>
  declineInvitation(token: string): Promise<void>
  createProjectType(input: Parameters<ProjectsClient['projectTypes:create']>[0]): Promise<ProjectTypeNode | null>
  updateProjectType(id: string, fields: Omit<Parameters<ProjectsClient['projectTypes:update']>[0], 'id'>): Promise<void>
  deleteProjectType(id: string): Promise<void>
  publishProjectType(id: string): Promise<void>
  unpublishProjectType(id: string): Promise<void>
  updateProject(id: string, fields: Omit<Parameters<ProjectsClient['projects:update']>[0], 'id'>): Promise<void>
  deleteProject(id: string): Promise<void>
  addProjectMember(id: string, username: string): Promise<void>
  updateProjectMemberRole(id: string, username: string, role: 'owner' | 'member'): Promise<void>
  removeProjectMember(id: string, username: string): Promise<void>
  linkProjectMachine(id: string, agentId: string): Promise<void>
  unlinkProjectMachine(id: string, agentId: string): Promise<void>
  /** Уровень доступа предоставленной машины (п.18). */
  setProjectMachineShareAccess(id: string, agentId: string, access: 'full' | 'read'): Promise<void>
  configureProjectMachineStorage(id: string, agentId: string, storageId: string, directories?: ProjectMachineDirectoryAssignments): Promise<void>
  resetProjectMachineDirectory(id: string, agentId: string, kind: ProjectMachineDirectoryKind): Promise<void>
  setProjectMachinePath(id: string, agentId: string, path: string): Promise<void>
  setProjectReposRoot(id: string, agentId: string, reposRoot: string): Promise<void>
  setProjectMachineSsh(id: string, agentId: string, sshHost: string, sshUser: string): Promise<void>
  setProjectDefaultMachine(id: string, agentId: string): Promise<void>
  fetchProjectDetail(id: string): Promise<ProjectDetail | null>
  openBoard(id: string): Promise<void>
  closeBoard(): void
  openProjectSettings(): void
  closeProjectSettings(): void
  applyBoardChanged(projectId: string): void
  setBoardIncludeCompleted(include: boolean): Promise<void>
  createColumn(name: string): Promise<void>
  updateColumn(columnId: string, fields: { name?: string; wipLimit?: number | null }): Promise<void>
  setColumnHidden(columnId: string, hidden: boolean): Promise<void>
  reorderColumns(order: string[]): Promise<void>
  deleteColumn(columnId: string): Promise<void>
  createTask(
    columnId: string,
    input: { title: string; description?: string; acceptanceCriteria?: string; type?: WorkItemType; parentId?: string | null; priority?: TaskPriority; assignee?: string | null }
  ): Promise<void>
  createTaskAndStartCi(
    projectId: string,
    input: { title: string; provider: 'claude' | 'codex'; model: string } & Partial<Pick<Task, 'description' | 'acceptanceCriteria' | 'type' | 'parentId' | 'priority' | 'assignee' | 'labels' | 'skills' | 'storyPoints' | 'dueDate'>>
  ): Promise<CiRun | null>
  createTaskFromProposalInPreparation(projectId: string, proposalId: string, input: Pick<Task, 'title' | 'description' | 'acceptanceCriteria' | 'type' | 'parentId' | 'priority' | 'assignee' | 'labels' | 'skills' | 'storyPoints' | 'dueDate'> & { selection?: import('@voicechat/shared').TaskPreparationLlmSelection }): Promise<import('@voicechat/shared').TaskLaunchResult>
  updateTask(
    taskId: string,
    fields: { title?: string; description?: string; acceptanceCriteria?: string; type?: WorkItemType; parentId?: string | null; priority?: TaskPriority; assignee?: string | null; labels?: string[]; skills?: string[]; storyPoints?: number | null; dueDate?: number | null; flagged?: boolean }
  ): Promise<void>
  moveTask(taskId: string, columnId: string, afterId?: string | null, beforeId?: string | null): Promise<boolean>
  deleteTask(taskId: string): Promise<void>
  openTaskChat(taskId: string): Promise<string | null>
  ensureTaskChat(taskId: string): Promise<void>
  // --- CI ---
  openCi(): Promise<void>
  closeCi(): void
  reloadCiCommands(projectId?: string): Promise<void>
  createCiCommand(input: CiCommandInput): Promise<CiCommand | null>
  updateCiCommand(id: string, input: CiCommandInput): Promise<void>
  deleteCiCommand(id: string): Promise<void>
  ciCommandUsage(id: string): Promise<{ projects: Array<{ id: string; name: string }>; tasks: Array<{ id: string; title: string }> }>
  saveCiSettings(settings: Partial<CiGlobalSettings>): Promise<void>
  resolveCiSuggestion(id: string, accept: boolean): Promise<void>
  reloadCiWorkspaces(projectId?: string): Promise<void>
  startCiRun(projectId: string, taskId: string, options?: CiRunMode | { mode?: CiRunMode; provider?: 'claude' | 'codex'; model?: string; launch?: 'queue' | 'parallel' }): Promise<CiRun | null>
  startMergeRun(projectId: string, taskId: string, agentId?: string | null): Promise<boolean>
  cancelCiRun(runId: string): Promise<void>
  dequeueCiRun(runId: string): Promise<void>
  retryCiRun(runId: string): Promise<CiRun | null>
  retryCiRunFromStep(runId: string, selection?: { provider: 'claude' | 'codex'; model: string; llmEngineId?: string | null }): Promise<CiRun | null>
  discardCiWorkspaceAndRetry(runId: string): Promise<CiRun | null>
  loadCiRun(runId: string): Promise<void>
  openCiRun(runId: string): void
  closeCiRun(): void
  ciSubscribe(runId: string): void
  ciUnsubscribe(runId: string): void
  applyCiSnapshot(runId: string, detail: CiRunDetail, log: CiLogLine[]): void
  applyCiRun(runId: string, run: CiRun): void
  applyCiStep(runId: string, step: CiRunStep): void
  applyCiLog(runId: string, line: CiLogLine): void
  applyCiFix(runId: string, attempt: CiFixAttempt): void
  applyCiDone(runId: string, run: CiRun, conclusion?: CiRunConclusion): void
  applyCiSummary(projectId: string, summary: CiRunSummary): void
  applyCiInteraction(runId: string, interaction: CiInteraction): void
  answerCiInteraction(runId: string, interactionId: string, answer: CiInteractionAnswer): Promise<void>
  /** Сводки ранов из меток чатов задач (их приносит chatStore через runtime). */
  applyTaskChatRuns(badges: TaskChatBadge[]): void
  reset(): void
}

export type ProjectsStore = Store<ProjectsState, ProjectsActions>

/** Что домен просит у Chat — выдаёт AppRuntime, прямого импорта нет. */
export interface ProjectsChatPort {
  scheduleConversationsRefresh(): void
  refreshConversations(options?: { keepActiveListed?: boolean }): Promise<void>
  selectConversation(id: string): Promise<boolean>
  reloadActiveMessages(): Promise<void>
}

export interface ProjectsDeps {
  projects: ProjectsClient
  chat: ProjectsChatPort
  fail?: (err: unknown, retry?: () => void) => void
  notify?: (notice: { kind: 'error' | 'success' | 'info'; text: string }) => void
  now?: () => number
}

function initialState(): ProjectsState {
  return {
    projectsOpen: false,
    projects: [],
    projectsLoaded: false,
    projectDetail: null,
    projectTypes: [],
    projectTypesLoaded: false,
    projectInvitations: [],
    myInvitations: [],
    activeProjectId: null,
    projectSettingsOpen: false,
    board: null,
    boardLoading: false,
    boardError: null,
    boardIncludeCompleted: false,
    ciOpen: false,
    ciCommands: [],
    ciStatus: 'loading',
    ciError: null,
    ciSettings: null,
    ciSuggestions: [],
    ciWorkspaces: [],
    ciRuns: {},
    ciSummaries: {},
    ciActiveRunId: null,
    answeredCiInteractions: []
  }
}

export function createProjectsStore(deps: ProjectsDeps): ProjectsStore {
  const client = deps.projects
  const boardBridge = client.board
  const ciBridge = client.ci
  const core = createStoreCore<ProjectsState>(initialState())
  const { getState, setState } = core
  const fail = deps.fail ?? (() => {})
  const notify = deps.notify ?? (() => {})
  const now = deps.now ?? Date.now

  // Merge — длинная операция: терминальный исход показываем тостом, где бы
  // пользователь ни находился. Дедуп по (ран, статус) — снимки приходят повторно.
  const mergeNoticeSeen = new Map<string, string>()
  const unsubscribeMerge = ciBridge?.onMerge?.(({ run }) => {
    if (!['success', 'failed', 'cancelled', 'decision_required'].includes(run.status)) {
      mergeNoticeSeen.set(run.id, run.status)
      return
    }
    if (mergeNoticeSeen.get(run.id) === run.status) return
    mergeNoticeSeen.set(run.id, run.status)
    if (run.status === 'success') notify({ kind: 'success', text: `Merge ${run.sourceBranch} → main завершён успешно` })
    else if (run.status === 'decision_required') notify({ kind: 'error', text: `Merge ${run.sourceBranch}: нужно решение — ${run.error ?? 'см. вкладку Merge задачи'}` })
    else if (run.status === 'failed') notify({ kind: 'error', text: `Merge ${run.sourceBranch} завершился с ошибкой: ${run.error ?? 'см. вкладку Merge задачи'}` })
  })
  if (unsubscribeMerge) core.onDispose(unsubscribeMerge)
  const BOARD_CHANGE_DEBOUNCE_MS = 50
  let boardGeneration = 0
  let boardTimer: ReturnType<typeof setTimeout> | null = null
  let boardFlight: { generation: number; promise: Promise<void> } | null = null
  let boardPending = false

  function clearBoardSync(): void {
    boardGeneration++
    boardPending = false
    if (boardTimer) clearTimeout(boardTimer)
    boardTimer = null
  }

  async function syncBoard(): Promise<void> {
    const id = getState().activeProjectId
    if (!id) return
    const includeCompleted = getState().boardIncludeCompleted
    const generation = boardGeneration
    if (boardFlight?.generation === generation) {
      boardPending = true
      return boardFlight.promise
    }
    if (boardTimer) clearTimeout(boardTimer)
    boardTimer = null
    let promise!: Promise<void>
    promise = (async () => {
      try {
        const board = await client['board:get']({ id, includeCompleted })
        if (generation !== boardGeneration || getState().activeProjectId !== id || getState().boardIncludeCompleted !== includeCompleted) return
        const ciSummaries = { ...getState().ciSummaries }
        for (const r of board.ciRuns ?? []) ciSummaries[r.taskId] = r
        const prev = getState().board
        setState({ board, ciSummaries, boardError: null })
        if (prev && !sameTaskChatVisibility(prev, board)) deps.chat.scheduleConversationsRefresh()
      } catch (err) {
        if (generation === boardGeneration && getState().activeProjectId === id) fail(err, () => void syncBoard())
      } finally {
        if (boardFlight?.promise === promise) boardFlight = null
        if (generation === boardGeneration && boardPending) {
          boardPending = false
          void syncBoard()
        }
      }
    })()
    boardFlight = { generation, promise }
    return promise
  }

  function scheduleBoardSync(): void {
    if (!getState().activeProjectId) return
    if (getState().boardLoading) {
      boardPending = true
      return
    }
    if (boardFlight?.generation === boardGeneration) {
      boardPending = true
      return
    }
    if (boardTimer) clearTimeout(boardTimer)
    boardTimer = setTimeout(() => {
      boardTimer = null
      void syncBoard()
    }, BOARD_CHANGE_DEBOUNCE_MS)
  }

  const unsubscribeBoardChanged = boardBridge?.onChanged(({ projectId }) => {
    if (projectId === getState().activeProjectId) scheduleBoardSync()
  })
  const unsubscribeBoardConnected = boardBridge?.onConnected(() => {
    const id = getState().activeProjectId
    if (!id) return
    boardBridge.subscribe(id)
    scheduleBoardSync()
  })
  core.onDispose(() => {
    clearBoardSync()
    if (getState().activeProjectId) boardBridge?.unsubscribe()
    unsubscribeBoardChanged?.()
    unsubscribeBoardConnected?.()
  })

  // --- Проекты --------------------------------------------------------------

  async function refreshProjects(): Promise<ProjectSummary[]> {
    const projects = await client['projects:list']()
    setState({ projects, projectsLoaded: true })
    return projects
  }

  async function refreshBoard(): Promise<void> {
    await syncBoard()
  }

  async function loadBoardForCompletedFilter(includeCompleted: boolean): Promise<void> {
    const id = getState().activeProjectId
    if (!id || getState().boardIncludeCompleted !== includeCompleted) return
    clearBoardSync()
    const generation = boardGeneration
    setState({ board: null, boardLoading: true, boardError: null })
    try {
      const board = await client['board:get']({ id, includeCompleted })
      if (generation !== boardGeneration || getState().activeProjectId !== id || getState().boardIncludeCompleted !== includeCompleted) return
      setState({ board, boardLoading: false, boardError: null })
      if (boardPending) { boardPending = false; void syncBoard() }
    } catch (err) {
      if (generation !== boardGeneration || getState().activeProjectId !== id || getState().boardIncludeCompleted !== includeCompleted) return
      setState({ boardLoading: false, boardError: err instanceof Error ? err.message : String(err) })
      fail(err, () => void loadBoardForCompletedFilter(includeCompleted))
    }
  }

  async function openBoard(id: string): Promise<void> {
    if (getState().activeProjectId) boardBridge?.unsubscribe()
    clearBoardSync()
    const generation = boardGeneration
    setState({ activeProjectId: id, boardLoading: true, boardError: null, board: null, projectDetail: null, projectSettingsOpen: false })
    boardBridge?.subscribe(id)
    try {
      const includeCompleted = getState().boardIncludeCompleted
      const [board, detail] = await Promise.all([
        client['board:get']({ id, includeCompleted }),
        client['projects:get']({ id })
      ])
      if (generation !== boardGeneration || getState().activeProjectId !== id || getState().boardIncludeCompleted !== includeCompleted) return
      const ciSummaries = { ...getState().ciSummaries }
      for (const r of board.ciRuns ?? []) ciSummaries[r.taskId] = r
      setState({ board, projectDetail: detail, ciSummaries, boardLoading: false, boardError: null })
    } catch (err) {
      if (generation !== boardGeneration || getState().activeProjectId !== id) return
      setState({ boardLoading: false, boardError: err instanceof Error ? err.message : String(err) })
      fail(err, () => void openBoard(id))
    }
  }

  function closeBoard(): void {
    clearBoardSync()
    if (getState().activeProjectId) boardBridge?.unsubscribe()
    setState({ activeProjectId: null, projectSettingsOpen: false, board: null, boardLoading: false, boardError: null })
  }

  // --- CI -------------------------------------------------------------------

  function patchCiRun(runId: string, fn: (cache: CiRunCache) => CiRunCache): void {
    const prev = getState().ciRuns[runId] ?? { detail: null, log: [], conclusion: null }
    setState({ ciRuns: { ...getState().ciRuns, [runId]: fn(prev) } })
  }

  function mergeStep(detail: CiRunDetail | null, step: CiRunStep): CiRunDetail | null {
    if (!detail) return { run: { id: step.runId } as CiRun, steps: [step], fixAttempts: [], interactions: [] }
    const steps = detail.steps.some((x) => x.id === step.id)
      ? detail.steps.map((x) => (x.id === step.id ? step : x))
      : [...detail.steps, step]
    return { ...detail, steps }
  }

  function mergeCiDetail(current: CiRunDetail | null, incoming: CiRunDetail): CiRunDetail {
    if (!current) return incoming
    let detail: CiRunDetail | null = incoming
    for (const step of current.steps) detail = mergeStep(detail, step)
    return {
      ...detail!,
      fixAttempts: [...new Map([...incoming.fixAttempts, ...current.fixAttempts].map((item) => [item.id, item])).values()],
      interactions: [...new Map([...(incoming.interactions ?? []), ...(current.interactions ?? [])].map((item) => [item.id, item])).values()]
    }
  }

  async function loadCiRun(runId: string): Promise<void> {
    if (!ciBridge) return
    patchCiRun(runId, (c) => ({ ...c, loading: true, error: null }))
    try {
      const [detail, log] = await Promise.all([ciBridge.getRun(runId), ciBridge.getRunLog(runId)])
      patchCiRun(runId, (c) => ({
        ...c,
        detail: mergeCiDetail(c.detail, detail),
        log: mergeCiLogLines(c.log, log),
        loading: false,
        error: null
      }))
    } catch (err) {
      // Лента без шагов и без объяснения читалась как «ран пустой».
      patchCiRun(runId, (c) => ({ ...c, loading: false, error: err instanceof Error ? err.message : String(err) }))
      fail(err, () => void loadCiRun(runId))
    }
  }

  function applyCiRun(runId: string, run: CiRun): void {
    patchCiRun(runId, (c) => ({
      ...c,
      detail: c.detail ? { ...c.detail, run } : { run, steps: [], fixAttempts: [], interactions: [] }
    }))
    const known = getState().ciSummaries[run.taskId]
    setState({
      ciSummaries: {
        ...getState().ciSummaries,
        [run.taskId]: {
          id: run.id,
          taskId: run.taskId,
          status: run.status,
          slotProgress: run.slotProgress,
          durationMs: run.durationMs,
          modelActive: known?.modelActive ?? false,
          awaitingInput: run.status === 'awaiting_input',
          progress: known?.id === run.id ? known.progress : undefined
        }
      }
    })
  }

  function applyCiDone(runId: string, run: CiRun, conclusion?: CiRunConclusion): void {
    patchCiRun(runId, (c) => ({
      ...c,
      conclusion: conclusion ?? c.conclusion,
      detail: c.detail ? { ...c.detail, run } : { run, steps: [], fixAttempts: [], interactions: [] }
    }))
    const previous = getState().ciSummaries[run.taskId]
    const terminal = {
      id: run.id,
      taskId: run.taskId,
      status: run.status,
      slotProgress: run.slotProgress,
      durationMs: run.durationMs,
      modelActive: false,
      awaitingInput: false,
      terminalColumnId: run.terminalColumnId
    }
    const display =
      (run.status === 'cancelled' || run.status === 'skipped') && previous?.status === 'success'
        ? { ...previous, latestAttempt: terminal }
        : terminal
    setState({ ciSummaries: { ...getState().ciSummaries, [run.taskId]: display } })
    // Финализация рана увозит карточку по колонкам, а с ней меняется видимость
    // чата задачи в сайдбаре.
    deps.chat.scheduleConversationsRefresh()
  }

  function applyCiInteraction(runId: string, interaction: CiInteraction): void {
    if (interaction.status !== 'pending' && !getState().answeredCiInteractions.includes(interaction.id)) {
      setState({ answeredCiInteractions: [...getState().answeredCiInteractions, interaction.id] })
    }
    patchCiRun(runId, (c) => {
      if (!c.detail) return c
      const list = c.detail.interactions ?? []
      const interactions = list.some((x) => x.id === interaction.id)
        ? list.map((x) => (x.id === interaction.id ? interaction : x))
        : [...list, interaction]
      return { ...c, detail: { ...c.detail, interactions } }
    })
  }

  async function startCiRun(
    projectId: string,
    taskId: string,
    options?: CiRunMode | { mode?: CiRunMode; provider?: 'claude' | 'codex'; model?: string; launch?: 'queue' | 'parallel' }
  ): Promise<CiRun | null> {
    if (!ciBridge) return null
    try {
      const launchOptions = typeof options === 'string' ? { mode: options } : options
      const run = await ciBridge.startRun(projectId, taskId, launchOptions)
      setState({
        ciSummaries: {
          ...getState().ciSummaries,
          [taskId]: {
            id: run.id,
            taskId,
            status: run.status,
            slotProgress: run.slotProgress,
            durationMs: run.durationMs,
            modelActive: false,
            awaitingInput: false
          }
        }
      })
      patchCiRun(run.id, (c) => ({
        ...c,
        detail: c.detail ? { ...c.detail, run } : { run, steps: [], fixAttempts: [], interactions: [] }
      }))
      return run
    } catch (err) {
      fail(err)
      return null
    }
  }

  async function reloadCiCommands(projectId?: string): Promise<void> {
    if (!ciBridge) return
    setState({ ciCommands: await ciBridge.listCommands(projectId) })
  }

  // Объект действий объявлен переменной, а не литералом в `return`: колбэки
  // «Повторить» ссылаются на соседние действия, и `this` здесь не годится —
  // действие часто передают в компонент отдельной функцией.
  const actions: ProjectsActions = {
      async openProjects() {
        setState({ projectsOpen: true })
        try {
          await refreshProjects()
        } catch (err) {
          fail(err, () => void actions.openProjects())
        }
      },
      closeProjects() {
        closeBoard()
        setState({ projectsOpen: false, projects: [], projectsLoaded: false, projectDetail: null })
      },
      refreshProjects,
      async loadNavigation() {
        try {
          await refreshProjects()
        } catch (err) {
          // Навигация по проектам необязательна: чат из-за неё не ломается.
          console.warn('[projects] не удалось загрузить список проектов', err)
        }
      },
      async selectProject(id) {
        try {
          setState({ projectDetail: await client['projects:get']({ id }) })
        } catch (err) {
          fail(err, () => void actions.selectProject(id))
        }
      },
      async loadProjectTypes() {
        try {
          const types = await client['projectTypes:list']()
          setState({ projectTypes: types, projectTypesLoaded: true })
          return types
        } catch (err) {
          // Чтение — идемпотентно, поэтому даём «Повторить».
          fail(err, () => void actions.loadProjectTypes())
          return []
        }
      },
      async loadProjectInvitations(id) {
        try {
          setState({ projectInvitations: await client['projects:invitations']({ id }) })
        } catch (err) {
          fail(err, () => void actions.loadProjectInvitations(id))
        }
      },
      async inviteToProject(id, invitee, role) {
        try {
          await client['projects:invite']({ id, invitee, role })
          await actions.loadProjectInvitations(id)
          return true
        } catch (err) {
          // Создание не идемпотентно — «Повторить» не предлагаем.
          fail(err)
          return false
        }
      },
      async resendProjectInvitation(id, invitationId) {
        try {
          await client['projects:resendInvitation']({ id, invitationId })
          await actions.loadProjectInvitations(id)
        } catch (err) {
          fail(err)
        }
      },
      async revokeProjectInvitation(id, invitationId) {
        try {
          await client['projects:revokeInvitation']({ id, invitationId })
          await actions.loadProjectInvitations(id)
        } catch (err) {
          fail(err)
        }
      },
      async loadMyInvitations() {
        try {
          setState({ myInvitations: await client['invitations:list']() })
        } catch (err) {
          fail(err, () => void actions.loadMyInvitations())
        }
      },
      async acceptInvitation(token) {
        try {
          const { projectId } = await client['invitations:accept']({ token })
          await actions.loadMyInvitations()
          await refreshProjects()
          return projectId
        } catch (err) {
          fail(err)
          return null
        }
      },
      async declineInvitation(token) {
        try {
          await client['invitations:decline']({ token })
          await actions.loadMyInvitations()
        } catch (err) {
          fail(err)
        }
      },
      async createProjectType(input) {
        try {
          const node = await client['projectTypes:create'](input)
          await actions.loadProjectTypes()
          return node
        } catch (err) {
          fail(err)
          return null
        }
      },
      async updateProjectType(id, fields) {
        try {
          await client['projectTypes:update']({ id, ...fields })
          await actions.loadProjectTypes()
        } catch (err) {
          fail(err)
        }
      },
      async deleteProjectType(id) {
        try {
          await client['projectTypes:delete']({ id })
          await actions.loadProjectTypes()
        } catch (err) {
          fail(err)
        }
      },
      async publishProjectType(id) {
        try {
          await client['projectTypes:publish']({ id })
          await actions.loadProjectTypes()
        } catch (err) {
          fail(err)
        }
      },
      async unpublishProjectType(id) {
        try {
          await client['projectTypes:unpublish']({ id })
          await actions.loadProjectTypes()
        } catch (err) {
          fail(err)
        }
      },
      async createProject(input) {
        try {
          const detail = await client['projects:create'](input)
          await refreshProjects()
          setState({ projectDetail: detail })
          return detail
        } catch (err) {
          fail(err)
          return null
        }
      },
      async updateProject(id, fields) {
        try {
          const detail = await client['projects:update']({ id, ...fields })
          setState({ projectDetail: detail })
          await refreshProjects()
        } catch (err) {
          fail(err, () => void actions.updateProject(id, fields))
        }
      },
      async deleteProject(id) {
        try {
          await client['projects:delete']({ id })
          if (getState().activeProjectId === id) closeBoard()
          if (getState().projectDetail?.id === id) setState({ projectDetail: null })
          await refreshProjects()
        } catch (err) {
          fail(err)
        }
      },
      async addProjectMember(id, username) {
        try {
          setState({ projectDetail: await client['projects:addMember']({ id, username }) })
          await refreshProjects()
        } catch (err) {
          fail(err)
        }
      },
      async updateProjectMemberRole(id, username, role) {
        try {
          setState({ projectDetail: await client['projects:updateMemberRole']({ id, username, role }) })
          await refreshProjects()
        } catch (err) {
          fail(err)
        }
      },
      async removeProjectMember(id, username) {
        try {
          setState({ projectDetail: await client['projects:removeMember']({ id, username }) })
          if (getState().activeProjectId === id) await refreshBoard()
        } catch (err) {
          fail(err)
        }
      },
      async linkProjectMachine(id, agentId) {
        try {
          setState({ projectDetail: await client['projects:linkMachine']({ id, agentId }) })
        } catch (err) {
          fail(err)
        }
      },
      async setProjectMachineShareAccess(id, agentId, access) {
        try {
          setState({ projectDetail: await client['projects:setMachineShareAccess']({ id, agentId, access }) })
        } catch (err) {
          fail(err)
        }
      },
      async unlinkProjectMachine(id, agentId) {
        try {
          setState({ projectDetail: await client['projects:unlinkMachine']({ id, agentId }) })
        } catch (err) {
          fail(err)
        }
      },
      async configureProjectMachineStorage(id, agentId, storageId, directories) {
        try {
          setState({ projectDetail: await client['projects:configureMachineStorage']({ id, agentId, storageId, directories }) })
        } catch (err) {
          fail(err)
          throw err
        }
      },
      async resetProjectMachineDirectory(id, agentId, kind) {
        try {
          setState({ projectDetail: await client['projects:resetMachineDirectory']({ id, agentId, kind }) })
        } catch (err) {
          fail(err)
          throw err
        }
      },
      async setProjectMachinePath(id, agentId, path) {
        try {
          setState({ projectDetail: await client['projects:setMachinePath']({ id, agentId, path }) })
        } catch (err) {
          fail(err, () => void actions.setProjectMachinePath(id, agentId, path))
          throw err
        }
      },
      async setProjectReposRoot(id, agentId, reposRoot) {
        try {
          setState({ projectDetail: await client['projects:setReposRoot']({ id, agentId, reposRoot }) })
        } catch (err) {
          fail(err, () => void actions.setProjectReposRoot(id, agentId, reposRoot))
          throw err
        }
      },
      async setProjectMachineSsh(id, agentId, sshHost, sshUser) {
        try {
          setState({ projectDetail: await client['projects:setMachineSsh']({ id, agentId, sshHost, sshUser }) })
        } catch (err) {
          fail(err, () => void actions.setProjectMachineSsh(id, agentId, sshHost, sshUser))
          throw err
        }
      },
      async setProjectDefaultMachine(id, agentId) {
        try {
          setState({ projectDetail: await client['projects:setUserDefaultMachine']({ id, agentId }) })
        } catch (err) {
          fail(err, () => void actions.setProjectDefaultMachine(id, agentId))
        }
      },
      async fetchProjectDetail(id) {
        try {
          return await client['projects:get']({ id })
        } catch (err) {
          fail(err)
          return null
        }
      },
      openBoard,
      closeBoard,
      openProjectSettings() {
        setState({ projectSettingsOpen: true })
      },
      closeProjectSettings() {
        setState({ projectSettingsOpen: false })
      },
      applyBoardChanged(projectId) {
        if (projectId !== getState().activeProjectId) return
        scheduleBoardSync()
      },
      async setBoardIncludeCompleted(include) {
        if (getState().boardIncludeCompleted === include) return
        setState({ boardIncludeCompleted: include })
        await loadBoardForCompletedFilter(include)
      },
      async createColumn(name) {
        const id = getState().activeProjectId
        if (!id) return
        try {
          await client['columns:create']({ projectId: id, name })
          await refreshBoard()
        } catch (err) {
          fail(err)
        }
      },
      async updateColumn(columnId, fields) {
        const id = getState().activeProjectId
        if (!id) return
        try {
          await client['columns:rename']({ projectId: id, columnId, ...fields })
          await refreshBoard()
        } catch (err) {
          fail(err, () => void actions.updateColumn(columnId, fields))
        }
      },
      async setColumnHidden(columnId, hidden) {
        const id = getState().activeProjectId
        if (!id) return
        try {
          await client['columns:setHidden']({ projectId: id, columnId, hidden })
          await refreshBoard()
        } catch (err) {
          fail(err, () => void actions.setColumnHidden(columnId, hidden))
        }
      },
      async reorderColumns(order) {
        const id = getState().activeProjectId
        const prev = getState().board
        if (!id || !prev) return
        const byId = new Map(prev.columns.map((c) => [c.id, c]))
        const columns = order
          .map((cid, i) => {
            const c = byId.get(cid)
            return c ? { ...c, position: (i + 1) * BOARD_RANK_STEP } : null
          })
          .filter((c): c is NonNullable<typeof c> => c !== null)
        setState({ board: { ...prev, columns } })
        try {
          await client['columns:reorder']({ projectId: id, order })
          await refreshBoard()
        } catch (err) {
          setState({ board: prev })
          fail(err, () => void actions.reorderColumns(order))
        }
      },
      async deleteColumn(columnId) {
        const id = getState().activeProjectId
        if (!id) return
        try {
          await client['columns:delete']({ projectId: id, columnId })
          await refreshBoard()
        } catch (err) {
          fail(err)
        }
      },
      async createTask(columnId, input) {
        const id = getState().activeProjectId
        if (!id) return
        try {
          await client['tasks:create']({ projectId: id, columnId, ...input })
          await refreshBoard()
        } catch (err) {
          fail(err)
        }
      },
      async createTaskFromProposalInPreparation(projectId, proposalId, input) {
        const result = await client['tasks:createFromProposalInPreparation']({ projectId, proposalId, ...input })
        if (getState().activeProjectId === projectId) await refreshBoard()
        return result
      },
      async createTaskAndStartCi(projectId, input) {
        if (!ciBridge) return null
        try {
          // Чат может быть открыт без доски, поэтому колонку берём свежим снимком.
          const board = await client['board:get']({ id: projectId })
          const column =
            board.columns.find((item) => item.semanticType === 'ready') ??
            board.columns.find((item) => item.semanticType === 'backlog') ??
            board.columns[0]
          if (!column) throw new Error('В проекте нет колонки для новой задачи')
          const task = await client['tasks:create']({
            projectId,
            columnId: column.id,
            title: input.title,
            description: input.description,
            acceptanceCriteria: input.acceptanceCriteria,
            type: input.type,
            parentId: input.parentId,
            priority: input.priority,
            assignee: input.assignee,
            labels: input.labels,
            skills: input.skills,
            storyPoints: input.storyPoints,
            dueDate: input.dueDate
          })
          if (getState().activeProjectId === projectId) await refreshBoard()
          return await startCiRun(projectId, task.id, { provider: input.provider, model: input.model })
        } catch (err) {
          fail(err)
          return null
        }
      },
      async updateTask(taskId, fields) {
        const id = getState().activeProjectId
        if (!id) return
        try {
          await client['tasks:update']({ projectId: id, taskId, ...fields })
          await refreshBoard()
        } catch (err) {
          fail(err, () => void actions.updateTask(taskId, fields))
        }
      },
      async moveTask(taskId, columnId, afterId, beforeId) {
        const id = getState().activeProjectId
        const prev = getState().board
        if (!id || !prev) return false
        const tasks = prev.tasks.map((t) => ({ ...t }))
        const moving = tasks.find((t) => t.id === taskId)
        const fromColumnId = moving?.columnId ?? null
        if (moving) {
          moving.columnId = columnId
          const done = prev.columns.find((column) => column.id === columnId)?.semanticType === 'done'
          moving.doneAt = done ? moving.doneAt ?? now() : null
          const after = afterId ? tasks.find((t) => t.id === afterId) : null
          const before = beforeId ? tasks.find((t) => t.id === beforeId) : null
          moving.position =
            after && before
              ? (after.position + before.position) / 2
              : after
                ? after.position + BOARD_RANK_STEP
                : before
                  ? before.position - BOARD_RANK_STEP
                  : Math.max(0, ...tasks.filter((t) => t.columnId === columnId && t.id !== taskId).map((t) => t.position)) +
                    BOARD_RANK_STEP
          setState({ board: { ...prev, tasks } })
        }
        try {
          await client['tasks:move']({ projectId: id, taskId, columnId, fromColumnId, afterId: afterId ?? null, beforeId: beforeId ?? null })
          await refreshBoard()
          // Переезд в «Готово» и обратно прячет/возвращает чат задачи в сайдбаре.
          // Не в общем try: упавший список — не повод откатывать удавшийся перенос.
          void deps.chat.refreshConversations({ keepActiveListed: true }).catch(() => {})
          return true
        } catch (err) {
          setState({ board: prev })
          fail(err, () => void actions.moveTask(taskId, columnId, afterId, beforeId))
          return false
        }
      },
      async deleteTask(taskId) {
        const id = getState().activeProjectId
        if (!id) return
        try {
          await client['tasks:delete']({ projectId: id, taskId })
          await refreshBoard()
        } catch (err) {
          fail(err)
        }
      },
      async openTaskChat(taskId) {
        const id = getState().activeProjectId
        if (!id) return null
        try {
          const conv = await client['tasks:openChat']({ projectId: id, taskId })
          await Promise.all([deps.chat.refreshConversations(), refreshBoard()])
          await deps.chat.selectConversation(conv.id)
          return conv.id
        } catch (err) {
          fail(err)
          return null
        }
      },
      async ensureTaskChat(taskId) {
        const id = getState().activeProjectId
        if (!id) return
        try {
          // Идемпотентно на сервере, поэтому повторный вызов безопасен.
          await client['tasks:openChat']({ projectId: id, taskId })
          await refreshBoard()
        } catch {
          /* без чата карточка всё равно работает */
        }
      },
      async openCi() {
        setState({ ciOpen: true, ciStatus: 'loading', ciError: null })
        if (!ciBridge) return
        try {
          const [commands, settings, suggestions, workspaces] = await Promise.all([
            ciBridge.listCommands(),
            ciBridge.getSettings(),
            ciBridge.listSuggestions(),
            ciBridge.listWorkspaces()
          ])
          setState({ ciCommands: commands, ciSettings: settings, ciSuggestions: suggestions, ciWorkspaces: workspaces, ciStatus: 'ready', ciError: null })
        } catch (err) {
          setState({ ciStatus: 'error', ciError: err instanceof Error ? err.message : String(err) })
          fail(err, () => void actions.openCi())
        }
      },
      closeCi() {
        setState({ ciOpen: false })
      },
      reloadCiCommands,
      async createCiCommand(input) {
        if (!ciBridge) return null
        try {
          const cmd = await ciBridge.createCommand(input)
          setState({ ciCommands: [...getState().ciCommands, cmd] })
          return cmd
        } catch (err) {
          fail(err)
          return null
        }
      },
      async updateCiCommand(id, input) {
        if (!ciBridge) return
        try {
          const cmd = await ciBridge.updateCommand(id, input)
          setState({ ciCommands: getState().ciCommands.map((c) => (c.id === id ? cmd : c)) })
        } catch (err) {
          fail(err, () => void actions.updateCiCommand(id, input))
        }
      },
      async deleteCiCommand(id) {
        if (!ciBridge) return
        try {
          await ciBridge.deleteCommand(id)
          setState({ ciCommands: getState().ciCommands.filter((c) => c.id !== id) })
        } catch (err) {
          fail(err)
        }
      },
      async ciCommandUsage(id) {
        if (!ciBridge) return { projects: [], tasks: [] }
        return ciBridge.commandUsage(id)
      },
      async saveCiSettings(settings) {
        if (!ciBridge) return
        try {
          setState({ ciSettings: await ciBridge.putSettings(settings) })
        } catch (err) {
          fail(err, () => void actions.saveCiSettings(settings))
        }
      },
      async resolveCiSuggestion(id, accept) {
        if (!ciBridge) return
        try {
          await ciBridge.resolveSuggestion(id, accept)
          setState({ ciSuggestions: getState().ciSuggestions.filter((x) => x.id !== id) })
          if (accept) await reloadCiCommands()
        } catch (err) {
          fail(err)
        }
      },
      async reloadCiWorkspaces(projectId) {
        if (!ciBridge) return
        setState({ ciWorkspaces: await ciBridge.listWorkspaces(projectId) })
      },
      startCiRun,
      async startMergeRun(projectId, taskId, agentId) {
        if (!ciBridge) return false
        try {
          await ciBridge.startMerge(projectId, taskId, agentId)
          await openBoard(projectId)
          notify({ kind: 'info', text: 'Merge-ран запущен' })
          return true
        } catch (err) {
          fail(err)
          return false
        }
      },
      async cancelCiRun(runId) {
        if (!ciBridge) return
        try {
          await ciBridge.cancelRun(runId)
        } catch (err) {
          fail(err)
        }
      },
      async dequeueCiRun(runId) {
        if (!ciBridge) return
        try {
          const result = await ciBridge.dequeueRun(runId)
          if (result.status === 'removed') {
            // Ответ HTTP уже содержит финальный ран; не ждём WS.
            applyCiDone(runId, result.run)
          } else if (result.status === 'running') {
            applyCiRun(runId, result.run)
            notify({ kind: 'error', text: 'Ран уже выполняется. Откройте ленту и остановите выполнение, если нужно вернуть задачу в TODO.' })
          } else if (result.status === 'not_queued') {
            applyCiRun(runId, result.run)
            notify({ kind: 'error', text: 'Ран больше не ожидает запуска: очередь не была изменена.' })
          } else {
            notify({ kind: 'error', text: 'Ран не найден.' })
          }
        } catch (err) {
          fail(err)
        }
      },
      async retryCiRun(runId) {
        if (!ciBridge) return null
        try {
          return await ciBridge.retryRun(runId)
        } catch (err) {
          fail(err)
          return null
        }
      },
      async retryCiRunFromStep(runId, selection) {
        // Повтор с упавшего шага — тот же ран; после запуска перечитываем ленту.
        if (!ciBridge) return null
        try {
          const r = await ciBridge.retryRunFromStep(runId, selection)
          await loadCiRun(runId)
          return r
        } catch (err) {
          fail(err)
          return null
        }
      },
      async discardCiWorkspaceAndRetry(runId) {
        if (!ciBridge) return null
        try {
          return await ciBridge.discardChangesAndRetry(runId)
        } catch (err) {
          fail(err)
          return null
        }
      },
      loadCiRun,
      openCiRun(runId) {
        setState({ ciActiveRunId: runId })
      },
      closeCiRun() {
        setState({ ciActiveRunId: null })
      },
      ciSubscribe(runId) {
        ciBridge?.subscribe(runId)
      },
      ciUnsubscribe(runId) {
        ciBridge?.unsubscribe(runId)
      },
      applyCiSnapshot(runId, detail, log) {
        patchCiRun(runId, (c) => ({ ...c, detail: mergeCiDetail(c.detail, detail), log: mergeCiLogLines(c.log, log) }))
      },
      applyCiRun,
      applyCiStep(runId, step) {
        patchCiRun(runId, (c) => ({ ...c, detail: mergeStep(c.detail, step) }))
      },
      applyCiLog(runId, line) {
        patchCiRun(runId, (c) => ({ ...c, log: mergeCiLogLines(c.log, [line]) }))
      },
      applyCiFix(runId, attempt) {
        patchCiRun(runId, (c) => {
          if (!c.detail) return c
          const fixAttempts = c.detail.fixAttempts.some((x) => x.id === attempt.id)
            ? c.detail.fixAttempts.map((x) => (x.id === attempt.id ? attempt : x))
            : [...c.detail.fixAttempts, attempt]
          return { ...c, detail: { ...c.detail, fixAttempts } }
        })
      },
      applyCiDone,
      applyCiSummary(_projectId, summary) {
        const known = getState().ciSummaries[summary.taskId]
        // Новый runId всегда сильнее старого. Внутри одного запуска принимаем
        // только монотонную серверную версию.
        if (known?.progress && summary.progress) {
          if (
            known.progress.runId !== summary.progress.runId &&
            known.progress.startedAt != null &&
            summary.progress.startedAt != null &&
            known.progress.startedAt > summary.progress.startedAt
          )
            return
          if (known.progress.runId === summary.progress.runId && known.progress.version > summary.progress.version) return
        }
        setState({ ciSummaries: { ...getState().ciSummaries, [summary.taskId]: summary } })
        // Сводка приходит на все соединения пользователя: для страницы без
        // открытой ленты это единственный сигнал, что ран кончился.
        if (isTerminalCiStatus(summary.status)) deps.chat.scheduleConversationsRefresh()
      },
      applyCiInteraction,
      async answerCiInteraction(runId, interactionId, answer) {
        // Пауза гасится сразу, даже если запрос упал с 409 (ответили из чата).
        if (!getState().answeredCiInteractions.includes(interactionId)) {
          setState({ answeredCiInteractions: [...getState().answeredCiInteractions, interactionId] })
        }
        try {
          const updated = await ciBridge?.answerInteraction(runId, interactionId, answer)
          if (updated) applyCiInteraction(runId, updated)
        } catch (err) {
          fail(err)
          void loadCiRun(runId)
        }
        // Сервер дописывает ответ репликой в связанный чат — подтягиваем ленту.
        await deps.chat.reloadActiveMessages()
      },
      applyTaskChatRuns(badges) {
        // Состояние известного рана ведут живые кадры `ci.*`: медленный ответ
        // меток не должен откатывать их назад.
        const ciSummaries = { ...getState().ciSummaries }
        let changed = false
        for (const badge of badges) {
          const known = ciSummaries[badge.taskId]
          if (badge.run && (!known || known.id !== badge.run.id)) {
            ciSummaries[badge.taskId] = badge.run
            changed = true
          }
        }
        if (changed) setState({ ciSummaries })
      },
      reset() {
        if (getState().activeProjectId) boardBridge?.unsubscribe()
        mergeNoticeSeen.clear()
        core.resetState(initialState())
      }
  }

  return { getState, subscribe: core.subscribe, dispose: core.dispose, actions }
}

