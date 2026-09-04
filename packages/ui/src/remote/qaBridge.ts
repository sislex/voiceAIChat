import { REST } from '@shared/protocol'
import type { AcceptanceCriterion, AcceptanceCriterionSnapshot, ComponentQaRun, ComponentQaTaskState, IntegrationTestRun, IntegrationTestTaskState, QaCriterionResult, QaSession, QaTaskState } from '@shared/qa'
import { authHeaders } from './session'

type StartSessionInput = { branch: string; commitSha: string; testRunId: string; previewId?: string | null; previewSha?: string | null; appUrl?: string | null; storybookUrl?: string | null; testDataScenario?: string; testerId?: string | null }
export interface RendererQaBridge {
  get(projectId: string, taskId: string): Promise<QaTaskState | null>
  getComponent?(projectId:string,taskId:string):Promise<ComponentQaTaskState|null>
  startComponent?(projectId:string,taskId:string):Promise<ComponentQaRun>
  cancelComponent?(projectId:string,taskId:string,runId:string):Promise<ComponentQaRun>
  completeComponent?(projectId:string,taskId:string,runId:string):Promise<ComponentQaRun>
  fixComponent?(projectId:string,taskId:string,runId:string):Promise<{id:string}>
  getIntegration?(projectId:string,taskId:string):Promise<IntegrationTestTaskState|null>
  startIntegration?(projectId:string,taskId:string):Promise<IntegrationTestRun>
  cancelIntegration?(projectId:string,taskId:string,runId:string):Promise<IntegrationTestRun>
  completeIntegration?(projectId:string,taskId:string,runId:string):Promise<IntegrationTestRun>
  fixIntegration?(projectId:string,taskId:string,runId:string):Promise<{id:string}>
  createCriterion(projectId: string, taskId: string, input: AcceptanceCriterionSnapshot & { order?: number }): Promise<AcceptanceCriterion>
  reviseCriterion(projectId: string, taskId: string, criterionId: string, input: AcceptanceCriterionSnapshot & { reason: string; semanticChange?: boolean }): Promise<AcceptanceCriterion>
  completePreparation(projectId: string, taskId: string): Promise<QaTaskState>
  retryPreparation?(projectId: string, taskId: string): Promise<import('@shared/qa').QaPreparationRun>
  startSession(projectId: string, taskId: string, input: StartSessionInput): Promise<QaSession>
  saveResult(projectId: string, taskId: string, resultId: string, revision: number, patch: Partial<QaCriterionResult> & Record<string, unknown>): Promise<QaCriterionResult>
  addAttachment(projectId: string, taskId: string, resultId: string, uploadId: string, caption: string): Promise<import('@shared/qa').QaAttachment>
  saveAdditionalIssues?(projectId: string, taskId: string, sessionId: string, additionalIssues: string): Promise<QaSession>
  complete(projectId: string, taskId: string, sessionId: string, summary: string): Promise<QaSession>
  requestFix(projectId: string, taskId: string, sessionId: string): Promise<{ id: string }>
  listStageRuns?(projectId: string, taskId: string, stage: import('@shared/qa').QaRunStage): Promise<import('@shared/qa').AnyQaStageRun[]>
  startStageRun?(projectId: string, taskId: string, stage: import('@shared/qa').QaRunStage): Promise<import('@shared/qa').AnyQaStageRun>
  cancelStageRun?(runId: string): Promise<import('@shared/qa').AnyQaStageRun>
  retryStageRun?(runId: string): Promise<import('@shared/qa').AnyQaStageRun>
  answerStageRun?(runId: string, answer: string): Promise<import('@shared/qa').AnyQaStageRun>
}

export function createQaRest(httpBase: string): RendererQaBridge {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    // Заголовки — только через общий authHeaders: он кладёт и Bearer, и
    // `x-vc-csrf`. Собственная сборка знала лишь про Bearer, а в вебе после
    // перезагрузки страницы токен живёт только в памяти и авторизует cookie —
    // поэтому каждый POST панелей QA отвечал 403 `csrf`.
    const response = await fetch(httpBase + path, {
      ...init,
      headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...authHeaders() }
    })
    if (response.status === 404 && !init) return null as T
    const body = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
    return body as T
  }
  return {
    get: (projectId, taskId) => request(REST.taskQa(projectId, taskId)),
    getComponent:(projectId,taskId)=>request(REST.taskComponentQa(projectId,taskId)),
    startComponent:(projectId,taskId)=>request(REST.taskComponentQaRuns(projectId,taskId),{method:'POST'}),
    cancelComponent:(projectId,taskId,runId)=>request(REST.taskComponentQaAction(projectId,taskId,runId,'cancel'),{method:'POST'}),
    completeComponent:(projectId,taskId,runId)=>request(REST.taskComponentQaAction(projectId,taskId,runId,'complete'),{method:'POST'}),
    fixComponent:(projectId,taskId,runId)=>request(REST.taskComponentQaAction(projectId,taskId,runId,'fix'),{method:'POST'}),
    getIntegration:(projectId,taskId)=>request(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/qa/integration`),
    startIntegration:(projectId,taskId)=>request(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/qa/integration/runs`,{method:'POST'}),
    cancelIntegration:(projectId,taskId,runId)=>request(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/qa/integration/runs/${encodeURIComponent(runId)}/cancel`,{method:'POST'}),
    completeIntegration:(projectId,taskId,runId)=>request(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/qa/integration/runs/${encodeURIComponent(runId)}/complete`,{method:'POST'}),
    fixIntegration:(projectId,taskId,runId)=>request(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/qa/integration/runs/${encodeURIComponent(runId)}/fix`,{method:'POST'}),
    createCriterion: (projectId, taskId, input) => request(REST.taskQaCriteria(projectId, taskId), { method: 'POST', body: JSON.stringify(input) }),
    reviseCriterion: (projectId, taskId, criterionId, input) => request(REST.taskQaCriterion(projectId, taskId, criterionId), { method: 'PUT', body: JSON.stringify(input) }),
    completePreparation: (projectId, taskId) => request(REST.taskQaPreparationComplete(projectId, taskId), { method: 'POST' }),
    retryPreparation: (projectId, taskId) => request(REST.taskQaPreparationRetry(projectId, taskId), { method: 'POST' }),
    startSession: (projectId: string, taskId: string, input: StartSessionInput) => request(REST.taskQaSessions(projectId, taskId), { method: 'POST', body: JSON.stringify(input) }),
    saveResult: (projectId, taskId, resultId, revision, patch) => request(REST.taskQaResult(projectId, taskId, resultId), { method: 'PATCH', body: JSON.stringify({ revision, patch }) }),
    addAttachment: (projectId, taskId, resultId, uploadId, caption) => request(`${REST.taskQaResult(projectId, taskId, resultId)}/attachments`, { method: 'POST', body: JSON.stringify({ uploadId, caption }) }),
    saveAdditionalIssues: (projectId, taskId, sessionId, additionalIssues) => request(REST.taskQaSession(projectId, taskId, sessionId), { method: 'PATCH', body: JSON.stringify({ additionalIssues }) }),
    complete: (projectId, taskId, sessionId, summary) => request(REST.taskQaComplete(projectId, taskId, sessionId), { method: 'POST', body: JSON.stringify({ summary }) }),
    requestFix: (projectId, taskId, sessionId) => request(REST.taskQaFix(projectId, taskId, sessionId), { method: 'POST' }),
    listStageRuns: (projectId, taskId, stage) => request(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/qa/runs/${stage}`),
    startStageRun: (projectId, taskId, stage) => request(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/qa/runs/${stage}`, { method: 'POST' }),
    cancelStageRun: (runId) => request(`/api/qa/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' }),
    retryStageRun: (runId) => request(`/api/qa/runs/${encodeURIComponent(runId)}/retry`, { method: 'POST' }),
    answerStageRun: (runId, answer) => request(`/api/qa/runs/${encodeURIComponent(runId)}/answer`, { method: 'POST', body: JSON.stringify({ answer }) })
  }
}
