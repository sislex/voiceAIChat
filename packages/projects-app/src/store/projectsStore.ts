import type { Board, ProjectDetail, ProjectSummary, Task } from '@shared/projects'
import type { ProjectsClient, ProjectsNavigationModel, TaskPatch } from '../contracts'
import { buildProjectsRoute, type ProjectsRoute } from '../routes/projectsRoute'

export interface ProjectsState {
  projects: ProjectSummary[]
  projectsLoaded: boolean
  activeProjectId: string | null
  projectDetail: ProjectDetail | null
  board: Board | null
  loading: boolean
  error: string | null
  openTaskId: string | null
  route: ProjectsRoute
  includeCompleted: boolean
}

export interface ProjectsActions {
  loadProjects(): Promise<ProjectSummary[]>
  openProject(projectId: string): Promise<void>
  closeProject(): void
  reloadBoard(): Promise<void>
  setRoute(route: ProjectsRoute): void
  setOpenTask(taskId: string | null): void
  setIncludeCompleted(include: boolean): Promise<void>
  moveTask(taskId: string, columnId: string, afterId?: string | null, beforeId?: string | null): Promise<void>
  reorderColumns(order: string[]): Promise<void>
  updateTask(taskId: string, patch: TaskPatch): Promise<Task | null>
  dispose(): void
}

export interface ProjectsStore {
  getState(): ProjectsState
  subscribe(listener: () => void): () => void
  actions: ProjectsActions
  navigation(input: { createProject(): void; navigate(path: string): void }): ProjectsNavigationModel
}

const initialState = (): ProjectsState => ({
  projects: [], projectsLoaded: false, activeProjectId: null, projectDetail: null,
  board: null, loading: false, error: null, openTaskId: null, route: { kind: 'index' },
  includeCompleted: false
})

export function createProjectsStore(client: ProjectsClient): ProjectsStore {
  let state = initialState()
  const listeners = new Set<() => void>()
  let request = 0
  let unsubscribeBoard: (() => void) | null = null
  let disposed = false
  const set = (patch: Partial<ProjectsState>): void => {
    if (disposed) return
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }
  const message = (error: unknown): string => error instanceof Error ? error.message : String(error)
  const subscribeCurrent = (projectId: string): void => {
    unsubscribeBoard?.()
    const includeCompleted = state.includeCompleted
    unsubscribeBoard = client.subscribeBoard(projectId, (event) => {
      if (event.projectId !== state.activeProjectId) return
      set({ board: event.board })
    }, { includeCompleted })
  }
  const loadProjects = async (): Promise<ProjectSummary[]> => {
    const token = ++request
    try {
      const projects = await client.listProjects()
      if (token === request) set({ projects, projectsLoaded: true, error: null })
      return projects
    } catch (error) {
      if (token === request) set({ projectsLoaded: true, error: message(error) })
      return []
    }
  }
  const openProject = async (projectId: string): Promise<void> => {
    const token = ++request
    unsubscribeBoard?.(); unsubscribeBoard = null
    set({ activeProjectId: projectId, projectDetail: null, board: null, loading: true, error: null, openTaskId: null })
    try {
      const [projectDetail, board] = await Promise.all([
        client.getProject(projectId),
        client.getBoard(projectId, { includeCompleted: state.includeCompleted })
      ])
      if (token !== request || state.activeProjectId !== projectId) return
      if (!projectDetail) throw new Error('Project not found')
      set({ projectDetail, board, loading: false })
      subscribeCurrent(projectId)
    } catch (error) {
      if (token === request && state.activeProjectId === projectId) set({ loading: false, error: message(error) })
    }
  }
  const reloadBoard = async (): Promise<void> => {
    const projectId = state.activeProjectId
    if (!projectId) return
    const token = ++request
    set({ loading: true, error: null })
    try {
      const board = await client.getBoard(projectId, { includeCompleted: state.includeCompleted })
      if (token === request && state.activeProjectId === projectId) set({ board, loading: false })
    } catch (error) {
      if (token === request && state.activeProjectId === projectId) set({ loading: false, error: message(error) })
    }
  }
  const rollbackOrReload = async (snapshot: Board, error: unknown): Promise<void> => {
    if (state.activeProjectId && state.board) set({ board: snapshot, error: message(error) })
    await reloadBoard()
  }
  const moveTask = async (taskId: string, columnId: string, afterId?: string | null, beforeId?: string | null): Promise<void> => {
    const projectId = state.activeProjectId
    const snapshot = state.board
    if (!projectId || !snapshot) return
    const moving = snapshot.tasks.find((task) => task.id === taskId)
    if (!moving) return
    const remaining = snapshot.tasks.filter((task) => task.id !== taskId)
    const siblings = remaining.filter((task) => task.columnId === columnId)
    let index = siblings.length
    if (beforeId) index = Math.max(0, siblings.findIndex((task) => task.id === beforeId))
    else if (afterId) {
      const after = siblings.findIndex((task) => task.id === afterId)
      index = after < 0 ? siblings.length : after + 1
    }
    const previous = siblings[index - 1]?.position ?? 0
    const next = siblings[index]?.position ?? previous + 2048
    set({ board: { ...snapshot, tasks: [...remaining, { ...moving, columnId, position: (previous + next) / 2 }] } })
    try { await client.moveTask(projectId, taskId, columnId, afterId, beforeId) } catch (error) { await rollbackOrReload(snapshot, error) }
  }
  const reorderColumns = async (order: string[]): Promise<void> => {
    const projectId = state.activeProjectId
    const snapshot = state.board
    if (!projectId || !snapshot) return
    const rank = new Map(order.map((id, index) => [id, index]))
    set({ board: { ...snapshot, columns: snapshot.columns.map((column) => ({ ...column, position: (rank.get(column.id) ?? order.length) * 1024 })) } })
    try { await client.reorderColumns(projectId, order) } catch (error) { await rollbackOrReload(snapshot, error) }
  }
  const updateTask = async (taskId: string, patch: TaskPatch): Promise<Task | null> => {
    const projectId = state.activeProjectId
    if (!projectId) return null
    try {
      const task = await client.updateTask(projectId, taskId, patch)
      if (state.activeProjectId === projectId && state.board) set({ board: { ...state.board, tasks: state.board.tasks.map((item) => item.id === task.id ? task : item) } })
      return task
    } catch (error) { set({ error: message(error) }); return null }
  }
  const actions: ProjectsActions = {
    loadProjects, openProject,
    closeProject: () => { ++request; unsubscribeBoard?.(); unsubscribeBoard = null; set({ activeProjectId: null, projectDetail: null, board: null, loading: false, error: null, openTaskId: null }) },
    reloadBoard,
    setRoute: (route) => set({ route, openTaskId: 'taskId' in route ? route.taskId : null }),
    setOpenTask: (openTaskId) => set({ openTaskId }),
    setIncludeCompleted: async (includeCompleted) => { if (state.includeCompleted === includeCompleted) return; set({ includeCompleted }); if (state.activeProjectId) { subscribeCurrent(state.activeProjectId); await reloadBoard() } },
    moveTask, reorderColumns, updateTask,
    dispose: () => { ++request; disposed = true; unsubscribeBoard?.(); unsubscribeBoard = null; listeners.clear() }
  }
  return {
    getState: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    actions,
    navigation: ({ createProject, navigate }) => ({
      projects: state.projects, activeProjectId: state.activeProjectId, loaded: state.projectsLoaded,
      createProject,
      openProject: (projectId) => navigate(buildProjectsRoute({ kind: 'board', projectId }))
    })
  }
}
