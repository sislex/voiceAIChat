/**
 * Вкладки настроек проекта — часть адреса (`/projects/:id/settings/:tab`), чтобы
 * ссылка вела на конкретную вкладку, а «Назад» возвращал на предыдущую.
 * Без сегмента открывается «Общее».
 */
export const PROJECT_SETTINGS_TABS = ['general', 'llm', 'board', 'workflow', 'members', 'machines'] as const
export type ProjectSettingsTab = (typeof PROJECT_SETTINGS_TABS)[number]

export function isProjectSettingsTab(value: string | undefined): value is ProjectSettingsTab {
  return (PROJECT_SETTINGS_TABS as readonly string[]).includes(value ?? '')
}

export type ProjectsRoute =
  | { kind: 'index' }
  | { kind: 'board'; projectId: string }
  | { kind: 'settings'; projectId: string; tab?: ProjectSettingsTab }
  /** Release Center; with `releaseId` the detail of that release (or deploy attempt) is open. */
  | { kind: 'releases'; projectId: string; releaseId?: string }
  /** Панель кода: без `workspaceId` — список рабочих копий, с ним — сама панель. */
  | { kind: 'code'; projectId: string; workspaceId?: string }
  | { kind: 'assistant'; projectId: string }
  | { kind: 'task'; projectId: string; taskId: string }
  /** Stable child route for a task-card tab. */
  | { kind: 'task-tab'; projectId: string; taskId: string; tab: TaskRouteTab }

export const TASK_ROUTE_TABS = ['general', 'chat', 'preparation', 'settings', 'progress', 'timeline', 'activity', 'improvements', 'component_qa', 'integration_tests', 'automated_qa', 'qa', 'code', 'merge', 'feed'] as const
export type TaskRouteTab = (typeof TASK_ROUTE_TABS)[number]
export function isTaskRouteTab(value: string | undefined): value is TaskRouteTab {
  return (TASK_ROUTE_TABS as readonly string[]).includes(value ?? '')
}

const clean = (value: string): string[] => value.replace(/^#?\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
const enc = encodeURIComponent

export function parseProjectsRoute(value: string): ProjectsRoute | null {
  const parts = clean(value)
  if (parts[0] !== 'projects') return null
  if (parts.length === 1) return { kind: 'index' }
  const projectId = parts[1]
  if (!projectId) return null
  if (parts.length === 2) return { kind: 'board', projectId }
  if (parts[2] === 'settings') {
    if (parts.length === 3) return { kind: 'settings', projectId }
    if (parts.length === 4 && isProjectSettingsTab(parts[3])) return { kind: 'settings', projectId, tab: parts[3] }
    return null
  }
  if (parts.length === 3 && (parts[2] === 'releases' || parts[2] === 'assistant')) {
    return { kind: parts[2], projectId }
  }
  if (parts[2] === 'releases' && parts.length === 4 && parts[3]) return { kind: 'releases', projectId, releaseId: parts[3] }
  if (parts[2] === 'code') {
    if (parts.length === 3) return { kind: 'code', projectId }
    if (parts.length === 4 && parts[3]) return { kind: 'code', projectId, workspaceId: parts[3] }
    return null
  }
  const taskId = parts[2] === 'task' ? parts[3] : undefined
  if (!taskId) return null
  if (parts.length === 4) return { kind: 'task', projectId, taskId }
  return parts.length === 5 && isTaskRouteTab(parts[4])
    ? { kind: 'task-tab', projectId, taskId, tab: parts[4] }
    : null
}

export function buildProjectsRoute(route: ProjectsRoute): string {
  if (route.kind === 'index') return '/projects'
  const base = `/projects/${enc(route.projectId)}`
  if (route.kind === 'board') return base
  if (route.kind === 'settings') return route.tab ? `${base}/settings/${route.tab}` : `${base}/settings`
  if (route.kind === 'releases') return route.releaseId ? `${base}/releases/${enc(route.releaseId)}` : `${base}/releases`
  if (route.kind === 'assistant') return `${base}/assistant`
  if (route.kind === 'code') return route.workspaceId ? `${base}/code/${enc(route.workspaceId)}` : `${base}/code`
  const task = `${base}/task/${enc(route.taskId)}`
  if (route.kind === 'task') return task
  return `${task}/${route.tab}`
}

export function projectRouteId(route: ProjectsRoute | null): string | null {
  return route && route.kind !== 'index' ? route.projectId : null
}
