import type { PreviewEnvironment, PreviewOperation } from '@shared/preview'
import { getToken } from './session'

export interface RendererFeaturePreviewBridge {
  get(projectId: string, taskId: string): Promise<PreviewEnvironment | null>
  operate(projectId: string, taskId: string, operation: PreviewOperation, args?: { idempotencyKey?: string; scenario?: string; agentId?: string }): Promise<PreviewEnvironment>
  cancel(projectId: string, taskId: string): Promise<boolean>
}

export function createFeaturePreviewRest(httpBase: string): RendererFeaturePreviewBridge {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const token = getToken()
    const response = await fetch(httpBase + path, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
    })
    if (response.status === 404 && (!init || init.method === undefined)) return null as T
    const body = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
    return body as T
  }
  const base = (projectId: string, taskId: string): string =>
    `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/preview`
  return {
    get: (projectId, taskId) => request(base(projectId, taskId)),
    operate: (projectId, taskId, operation, args = {}) =>
      request(`${base(projectId, taskId)}/operations`, { method: 'POST', body: JSON.stringify({ operation, ...args }) }),
    cancel: async (projectId, taskId) => {
      await request(`${base(projectId, taskId)}/cancel`, { method: 'POST' })
      return true
    }
  }
}
