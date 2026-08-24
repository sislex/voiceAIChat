export { ProjectsApp } from './ProjectsApp'
export { normalizeBoard, normalizeColumn, normalizeTask } from './kanban/normalize'
export { makeBoard, makeCiSummary, makeColumn, makeDefaultColumns, makeMembers, makeTask, noopHandlers } from './kanban/fixtures'
export type { ProjectsAppProps } from './ProjectsApp'
export { ProjectsProvider, useProjectsActions, useProjectsNavigation, useProjectsStore } from './store/ProjectsProvider'
export { createProjectsStore } from './store/projectsStore'
export type { ProjectsActions, ProjectsState, ProjectsStore } from './store/projectsStore'
export { buildProjectsRoute, parseProjectsRoute, projectRouteId } from './routes/projectsRoute'
export type { ProjectsRoute } from './routes/projectsRoute'
export type {
  BoardInvalidation, CreateProjectInput, CreateTaskInput, ProjectsChatPort, ProjectsClient,
  ProjectsHost, ProjectsNavigationModel, TaskChatReference, TaskPatch, UpdateProjectInput
} from './contracts'
