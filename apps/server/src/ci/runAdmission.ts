export type PipelineStage = 'development' | 'component_qa' | 'integration_tests' | 'automated_qa' | 'merge'
export type FailureClass = 'implementation_defect' | 'infrastructure' | 'human_decision'
export type FailureCode = 'implementation_defect' | 'offline' | 'toolchain_missing' | 'origin_unavailable' | 'enospc' | 'workspace_missing' | 'workspace_path_invalid' | 'workspace_owner_mismatch' | 'workspace_dirty' | 'merge_in_progress' | 'binding_changed' | 'active_attempt' | 'retry_backoff' | 'retry_budget_exhausted' | 'unknown'

export interface FailurePolicy {
  classification: FailureClass
  retryable: boolean
  resumeFromStep: boolean
  requiresDecision: boolean
  userAction: string
}

const INFRA = new Set<FailureCode>(['offline', 'toolchain_missing', 'origin_unavailable', 'enospc', 'workspace_missing'])
const HUMAN = new Set<FailureCode>(['workspace_path_invalid', 'workspace_owner_mismatch', 'workspace_dirty', 'merge_in_progress', 'binding_changed', 'retry_budget_exhausted', 'unknown'])

export function failurePolicy(code: FailureCode): FailurePolicy {
  if (code === 'active_attempt') return { classification: 'infrastructure', retryable: false, resumeFromStep: false, requiresDecision: false, userAction: 'Дождитесь завершения активной попытки' }
  if (code === 'retry_backoff') return { classification: 'infrastructure', retryable: true, resumeFromStep: true, requiresDecision: false, userAction: 'Дождитесь времени следующей попытки' }
  if (INFRA.has(code)) return { classification: 'infrastructure', retryable: true, resumeFromStep: true, requiresDecision: false, userAction: 'Восстановите готовность машины и повторите с упавшего шага' }
  if (HUMAN.has(code)) return { classification: 'human_decision', retryable: false, resumeFromStep: code === 'workspace_dirty' || code === 'merge_in_progress', requiresDecision: true, userAction: code === 'workspace_dirty' || code === 'merge_in_progress' ? 'Сохраните локальную работу и выберите безопасный шаг продолжения' : 'Проверьте привязку машины и рабочей копии' }
  return { classification: 'implementation_defect', retryable: true, resumeFromStep: false, requiresDecision: false, userAction: 'Исправьте реализацию в пределах бюджета повторов' }
}

export function classifyPipelineFailure(message: string): { code: FailureCode; policy: FailurePolicy } {
  const text = message.toLowerCase()
  let code: FailureCode = 'implementation_defect'
  if (/offline|отключил|disconnected/.test(text)) code = 'offline'
  else if (/enospc|недостаточно места|no space left/.test(text)) code = 'enospc'
  else if (/origin|ls-remote|authentication failed|could not resolve host/.test(text)) code = 'origin_unavailable'
  else if (/command not found|не найден инструмент|toolchain/.test(text)) code = 'toolchain_missing'
  else if (/локальные изменения|dirty workspace/.test(text)) code = 'workspace_dirty'
  else if (/merge_head|незаверш.нн.*merge|unmerged/.test(text)) code = 'merge_in_progress'
  return { code, policy: failurePolicy(code) }
}

export interface AdmissionSnapshot {
  stage: PipelineStage
  machineOnline: boolean
  machineAllowed: boolean
  workspacePath: string
  workspaceOwnerMatches: boolean
  workspaceReady: boolean
  dirty: boolean
  mergeInProgress: boolean
  activeAttempt: boolean
  blockedByDecision: boolean
  attemptsUsed: number
  retryLimit: number
  nextRetryAt: number | null
  now: number
  bindingVersion: string
  expectedBindingVersion: string
  firstAttempt: boolean
}

export type AdmissionDecision =
  | { allowed: true; attempt: number }
  | { allowed: false; code: FailureCode; policy: FailurePolicy; nextRetryAt: number | null }

const absolutePath = (path: string): boolean => /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path)

export function admitPipelineRun(input: AdmissionSnapshot): AdmissionDecision {
  let code: FailureCode | null = null
  if (input.activeAttempt) code = 'active_attempt'
  else if (input.blockedByDecision) code = 'unknown'
  else if (input.bindingVersion !== input.expectedBindingVersion) code = 'binding_changed'
  else if (!input.machineAllowed || !input.workspaceOwnerMatches) code = 'workspace_owner_mismatch'
  else if (!input.machineOnline) code = 'offline'
  else if (!absolutePath(input.workspacePath)) code = 'workspace_path_invalid'
  else if (!input.workspaceReady) code = 'workspace_missing'
  else if (input.mergeInProgress) code = 'merge_in_progress'
  else if (input.dirty && !input.firstAttempt) code = 'workspace_dirty'
  else if (!input.firstAttempt && input.attemptsUsed >= input.retryLimit) code = 'retry_budget_exhausted'
  else if (!input.firstAttempt && input.nextRetryAt != null && input.now < input.nextRetryAt) code = 'retry_backoff'
  if (code) return { allowed: false, code, policy: failurePolicy(code), nextRetryAt: input.nextRetryAt }
  return { allowed: true, attempt: input.firstAttempt ? 1 : input.attemptsUsed + 1 }
}

export class AdmissionReservations {
  private readonly reserved = new Set<string>()
  reserve(key: string): boolean {
    if (this.reserved.has(key)) return false
    this.reserved.add(key)
    return true
  }
  release(key: string): void { this.reserved.delete(key) }
}
