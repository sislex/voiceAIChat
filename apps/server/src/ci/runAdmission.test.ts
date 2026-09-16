import { describe, expect, it } from 'vitest'
import { AdmissionReservations, admitPipelineRun, failurePolicy, type AdmissionSnapshot } from './runAdmission.js'

const ready = (over: Partial<AdmissionSnapshot> = {}): AdmissionSnapshot => ({
  stage: 'development', machineOnline: true, machineAllowed: true,
  workspacePath: '/work/task', workspaceOwnerMatches: true, workspaceReady: true,
  dirty: false, mergeInProgress: false, activeAttempt: false, blockedByDecision: false,
  attemptsUsed: 0, retryLimit: 3, nextRetryAt: null, now: 1000,
  bindingVersion: 'v1', expectedBindingVersion: 'v1', firstAttempt: true, ...over
})

describe('shared pipeline admission and failure matrix', () => {
  // @testCase TC-1
  it('classifies missing toolchain as infrastructure for every stage', () => {
    for (const stage of ['development', 'component_qa', 'integration_tests', 'automated_qa', 'merge'] as const) {
      expect({ stage, ...failurePolicy('toolchain_missing') }).toMatchObject({ classification: 'infrastructure', retryable: true, resumeFromStep: true })
    }
  })

  // @testCase TC-2
  it('rejects offline and requires a fresh admission after the binding changes', () => {
    expect(admitPipelineRun(ready({ machineOnline: false }))).toMatchObject({ allowed: false, code: 'offline' })
    expect(admitPipelineRun(ready({ bindingVersion: 'v2' }))).toMatchObject({ allowed: false, code: 'binding_changed' })
    expect(admitPipelineRun(ready({ machineOnline: true }))).toEqual({ allowed: true, attempt: 1 })
  })

  // @testCase TC-3
  it.each(['enospc', 'origin_unavailable'] as const)('keeps infrastructure failure %s resumable', code => {
    expect(failurePolicy(code)).toMatchObject({ classification: 'infrastructure', retryable: true, resumeFromStep: true, requiresDecision: false })
  })

  // @testCase TC-4
  it.each(['workspace_dirty', 'merge_in_progress'] as const)('preserves valuable work for %s', code => {
    const policy = failurePolicy(code)
    expect(policy).toMatchObject({ classification: 'human_decision', retryable: false, resumeFromStep: true, requiresDecision: true })
    expect(policy.userAction).toContain('Сохраните')
  })

  // @testCase TC-5
  it('rejects an invalid target before changing the active binding', () => {
    expect(admitPipelineRun(ready({ workspacePath: 'relative/task' }))).toMatchObject({ allowed: false, code: 'workspace_path_invalid' })
    expect(admitPipelineRun(ready({ workspaceOwnerMatches: false }))).toMatchObject({ allowed: false, code: 'workspace_owner_mismatch' })
  })

  // @testCase TC-6
  it('deduplicates concurrent reservations and keeps budget/backoff persistent in the snapshot', () => {
    const reservations = new AdmissionReservations()
    expect(reservations.reserve('task:v1')).toBe(true)
    expect(reservations.reserve('task:v1')).toBe(false)
    expect(admitPipelineRun(ready({ firstAttempt: false, attemptsUsed: 3, retryLimit: 3 }))).toMatchObject({ code: 'retry_budget_exhausted' })
    expect(admitPipelineRun(ready({ firstAttempt: false, attemptsUsed: 1, nextRetryAt: 1001 }))).toMatchObject({ code: 'retry_backoff' })
    reservations.release('task:v1')
    expect(reservations.reserve('task:v1')).toBe(true)
  })

  // @testCase TC-7
  it('permits first launch at zero retry limit and prefers retry from step for infrastructure', () => {
    expect(admitPipelineRun(ready({ retryLimit: 0 }))).toEqual({ allowed: true, attempt: 1 })
    expect(failurePolicy('offline').resumeFromStep).toBe(true)
    expect(failurePolicy('implementation_defect').classification).toBe('implementation_defect')
  })

  // @testCase TC-8
  it('provides an exact safe user action for decision_required diagnostics', () => {
    const blocked = admitPipelineRun(ready({ dirty: true, firstAttempt: false }))
    expect(blocked).toMatchObject({ allowed: false, code: 'workspace_dirty', policy: { requiresDecision: true } })
    if (!blocked.allowed) expect(blocked.policy.userAction).toContain('безопасный шаг')
  })

  // @testCase TC-9
  it('uses serializable inputs and deterministic outputs across process restarts', () => {
    const snapshot = ready({ firstAttempt: false, attemptsUsed: 2, nextRetryAt: 2000 })
    expect(admitPipelineRun(JSON.parse(JSON.stringify(snapshot)) as AdmissionSnapshot)).toEqual(admitPipelineRun(snapshot))
  })
})
