export type ProjectsRoute =
  | { kind: 'index' }
  | { kind: 'board'; projectId: string }
  | { kind: 'settings'; projectId: string }
  | { kind: 'releases'; projectId: string }
  /** Панель кода: без `workspaceId` — список рабочих копий, с ним — сама панель. */
  | { kind: 'code'; projectId: string; workspaceId?: string }
  | { kind: 'assistant'; projectId: string }
  | { kind: 'task'; projectId: string; taskId: string }
  | { kind: 'task-preparation'; projectId: string; taskId: string }
  | { kind: 'task-chat'; projectId: string; taskId: string; conversationId: string }

const clean = (value: string): string[] => value.replace(/^#?\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
const enc = encodeURIComponent

export function parseProjectsRoute(value: string): ProjectsRoute | null {
  const parts = clean(value)
  if (parts[0] !== 'projects') return null
  if (parts.length === 1) return { kind: 'index' }
  const projectId = parts[1]
  if (!projectId) return null
  if (parts.length === 2) return { kind: 'board', projectId }
  if (parts.length === 3 && (parts[2] === 'settings' || parts[2] === 'releases' || parts[2] === 'assistant')) {
    return { kind: parts[2], projectId }
  }
  if (parts[2] === 'code') {
    if (parts.length === 3) return { kind: 'code', projectId }
    if (parts.length === 4 && parts[3]) return { kind: 'code', projectId, workspaceId: parts[3] }
    return null
  }
  const taskId = parts[2] === 'task' ? parts[3] : undefined
  if (!taskId) return null
  if (parts.length === 4) return { kind: 'task', projectId, taskId }
  if (parts.length === 5 && parts[4] === 'preparation') return { kind: 'task-preparation', projectId, taskId }
  const conversationId = parts[4] === 'chat' ? parts[5] : undefined
  return parts.length === 6 && conversationId ? { kind: 'task-chat', projectId, taskId, conversationId } : null
}

export function buildProjectsRoute(route: ProjectsRoute): string {
  if (route.kind === 'index') return '/projects'
  const base = `/projects/${enc(route.projectId)}`
  if (route.kind === 'board') return base
  if (route.kind === 'settings' || route.kind === 'releases' || route.kind === 'assistant') return `${base}/${route.kind}`
  if (route.kind === 'code') return route.workspaceId ? `${base}/code/${enc(route.workspaceId)}` : `${base}/code`
  const task = `${base}/task/${enc(route.taskId)}`
  if (route.kind === 'task') return task
  if (route.kind === 'task-preparation') return `${task}/preparation`
  return `${task}/chat/${enc(route.conversationId)}`
}

export function projectRouteId(route: ProjectsRoute | null): string | null {
  return route && route.kind !== 'index' ? route.projectId : null
}
