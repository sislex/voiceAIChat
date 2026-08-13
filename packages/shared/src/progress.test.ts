import { describe, expect, it } from 'vitest'
import { buildCiAutomationProgress, type CiRun, type CiRunStep } from './ci'

const run: CiRun = {
  id: 'run-new', projectId: 'p', taskId: 't', agentId: 'a', status: 'running',
  workspaceId: null, triggeredBy: 'u', prevColumnId: null, llmProvider: 'claude',
  llmModel: 'opus', mode: 'development', clarifyLevel: 'few', clarifyMax: 3,
  conversationId: null, kbContextMode: 'auto', slotProgress: { done: 1, total: 3, phase: 'Тесты' },
  startedAt: 1_000, finishedAt: null, durationMs: null, createdAt: 500
}
const step = (patch: Partial<CiRunStep>): CiRunStep => ({
  id: 's', runId: run.id, slot: 'after_model', position: 0, kind: 'command',
  parentStepId: null, initiatedBy: 'system', commandId: null, commandSnapshot: null,
  title: 'Typecheck', workdir: null, status: 'success', exitCode: 0, attempt: 1,
  fixedByModel: false, startedAt: 1_000, finishedAt: 3_000, durationMs: 2_000,
  ...patch
})

describe('buildCiAutomationProgress', () => {
  it('uses completed measurable steps and recalculates an approximate ETA', () => {
    const progress = buildCiAutomationProgress(run, [
      step({ id: 'done' }),
      step({ id: 'current', position: 1, title: 'Тесты', status: 'running', startedAt: 3_000, finishedAt: null, durationMs: null })
    ], {}, 4_000)
    expect(progress.percent).toBe(33)
    expect(progress.completedSteps).toBe(1)
    expect(progress.etaRangeMs).toEqual([3_000, 5_000])
    expect(progress.elapsedMs).toBe(3_000)
  })

  it('is indeterminate for model work and never invents a percentage or ETA', () => {
    const progress = buildCiAutomationProgress(run, [
      step({ kind: 'model_work', status: 'running', finishedAt: null, durationMs: null, title: 'Выполнение задачи' })
    ], {}, 4_000)
    expect(progress.percent).toBeNull()
    expect(progress.totalSteps).toBeNull()
    expect(progress.etaMs).toBeNull()
    expect(progress.etaUnavailableReason).toContain('неизвестен')
  })

  it('freezes terminal progress at 100 percent', () => {
    const progress = buildCiAutomationProgress({ ...run, status: 'success', finishedAt: 5_000, durationMs: 4_000 }, [step({})], {}, 20_000)
    expect(progress.percent).toBe(100)
    expect(progress.elapsedMs).toBe(4_000)
    expect(progress.etaMs).toBeNull()
  })

  it('maps waiting and cancellation without changing terminal time', () => {
    expect(buildCiAutomationProgress({ ...run, status: 'awaiting_input' }, [], {}, 2_000).status).toBe('waiting')
    const cancelled = buildCiAutomationProgress({ ...run, status: 'cancelled', finishedAt: 2_500, durationMs: 1_500 }, [], {}, 9_000)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.elapsedMs).toBe(1_500)
  })
})
