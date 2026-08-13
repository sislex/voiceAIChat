import { REST } from '@shared/protocol'
import type { AcceptanceCriterion, AcceptanceCriterionSnapshot, QaCriterionResult, QaSession, QaTaskState } from '@shared/qa'
import { getToken } from './session'

type StartSessionInput = { branch: string; commitSha: string; testRunId: string; previewId?: string | null; previewSha?: string | null; appUrl?: string | null; storybookUrl?: string | null; testDataScenario?: string; testerId?: string | null }
export interface RendererQaBridge {
  get(projectId: string, taskId: string): Promise<QaTaskState | null>
  createCriterion(projectId: string, taskId: string, input: AcceptanceCriterionSnapshot & { order?: number }): Promise<AcceptanceCriterion>
  reviseCriterion(projectId: string, taskId: string, criterionId: string, input: AcceptanceCriterionSnapshot & { reason: string; semanticChange?: boolean }): Promise<AcceptanceCriterion>
  completePreparation(projectId: string, taskId: string): Promise<QaTaskState>
  retryPreparation?(projectId: string, taskId: string): Promise<import('@shared/qa').QaPreparationRun>
  startSession(projectId: string, taskId: string, input: StartSessionInput): Promise<QaSession>
  saveResult(projectId: string, taskId: string, resultId: string, revision: number, patch: Partial<QaCriterionResult> & Record<string, unknown>): Promise<QaCriterionResult>
  addAttachment(projectId: string, taskId: string, resultId: string, uploadId: string, caption: string): Promise<import('@shared/qa').QaAttachment>
  complete(projectId: string, taskId: string, sessionId: string, summary: string): Promise<QaSession>
  requestFix(projectId: string, taskId: string, sessionId: string): Promise<{ id: string }>
}

export function createQaRest(httpBase: string): RendererQaBridge {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const token = getToken()
    const response = await fetch(httpBase + path, { ...init, headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } })
    if (response.status === 404 && !init) return null as T
    const body = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
    return body as T
  }
  return {
    get: (projectId, taskId) => request(REST.taskQa(projectId, taskId)),
    createCriterion: (projectId, taskId, input) => request(REST.taskQaCriteria(projectId, taskId), { method: 'POST', body: JSON.stringify(input) }),
    reviseCriterion: (projectId, taskId, criterionId, input) => request(REST.taskQaCriterion(projectId, taskId, criterionId), { method: 'PUT', body: JSON.stringify(input) }),
    completePreparation: (projectId, taskId) => request(REST.taskQaPreparationComplete(projectId, taskId), { method: 'POST' }),
    retryPreparation: (projectId, taskId) => request(REST.taskQaPreparationRetry(projectId, taskId), { method: 'POST' }),
    startSession: (projectId: string, taskId: string, input: StartSessionInput) => request(REST.taskQaSessions(projectId, taskId), { method: 'POST', body: JSON.stringify(input) }),
    saveResult: (projectId, taskId, resultId, revision, patch) => request(REST.taskQaResult(projectId, taskId, resultId), { method: 'PATCH', body: JSON.stringify({ revision, patch }) }),
    addAttachment: (projectId, taskId, resultId, uploadId, caption) => request(`${REST.taskQaResult(projectId, taskId, resultId)}/attachments`, { method: 'POST', body: JSON.stringify({ uploadId, caption }) }),
    complete: (projectId, taskId, sessionId, summary) => request(REST.taskQaComplete(projectId, taskId, sessionId), { method: 'POST', body: JSON.stringify({ summary }) }),
    requestFix: (projectId, taskId, sessionId) => request(REST.taskQaFix(projectId, taskId, sessionId), { method: 'POST' })
  }
}
