import { describe, expect, it } from 'vitest'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'
import { assignToCycles, ciStageStatus, mergeStageStatus, pluralRu, preparationStageStatus, qaRunStageStatus, qaSessionStageStatus, qaStageRunStatus, stageStatusOf, stageStatusTone, stageTitle } from './taskCycles'

function cycle(over: Partial<TaskReworkCycleViewModel>): TaskReworkCycleViewModel {
  return {
    id: 'c', sequence: 1, description: 'Доработка', criteria: [], makeSources: [], attachments: [],
    createdBy: 'alex', createdAt: 100, preparationRunId: null, status: 'submitted', ...over
  }
}

describe('assignToCycles', () => {
  const cycles = [cycle({ id: 'c1', sequence: 1, createdAt: 100 }), cycle({ id: 'c2', sequence: 2, createdAt: 200, preparationRunId: 'r-pinned' })]
  const runs = [
    { id: 'r0', createdAt: 50 }, { id: 'r1', createdAt: 150 }, { id: 'r2', createdAt: 250 }, { id: 'r-pinned', createdAt: 10 }
  ]

  it('делит раны между исходной постановкой и циклами по времени', () => {
    const stages = assignToCycles(cycles, runs, { createdAt: (run) => run.createdAt })
    expect(stages.map((stage) => stage.number)).toEqual([1, 2, 3])
    expect(stages[0]!.items.map((run) => run.id)).toEqual(['r-pinned', 'r0'])
    expect(stages[1]!.items.map((run) => run.id)).toEqual(['r1'])
    expect(stages[2]!.items.map((run) => run.id)).toEqual(['r2'])
  })

  it('жёсткая привязка (preparationRunId) сильнее времени', () => {
    const stages = assignToCycles(cycles, runs, {
      createdAt: (run) => run.createdAt,
      pinnedCycleId: (run, all) => all.find((item) => item.preparationRunId === run.id)?.id ?? null
    })
    expect(stages[2]!.items.map((run) => run.id)).toEqual(['r-pinned', 'r2'])
    expect(stages[0]!.items.map((run) => run.id)).toEqual(['r0'])
  })

  it('черновики не образуют этапов, а цикл без ранов ждёт', () => {
    const stages = assignToCycles([cycle({ id: 'draft', status: 'draft', createdAt: 1 }), ...cycles], [{ id: 'r0', createdAt: 50 }], { createdAt: (run) => run.createdAt })
    expect(stages).toHaveLength(3)
    expect(stageStatusOf(stages[2]!, () => 'success')).toBe('idle')
    expect(stageStatusOf(stages[0]!, () => 'running')).toBe('running')
  })

  it('без циклов — один этап со всеми ранами', () => {
    const stages = assignToCycles([], runs, { createdAt: (run) => run.createdAt })
    expect(stages).toHaveLength(1)
    expect(stages[0]!.items).toHaveLength(4)
    expect(stageTitle('Component QA', stages[0]!)).toBe('Component QA · первоначальная постановка')
    expect(stageTitle('Merge', { key: 'c2', number: 2, cycle: cycles[1]!, items: [] })).toBe('Merge · доработка 2')
  })
})

describe('статусы этапов', () => {
  it('переводит статусы подсистем в словарь дизайна', () => {
    expect(preparationStageStatus('completed')).toBe('success')
    expect(preparationStageStatus('waiting_for_answer')).toBe('waiting_for_answer')
    expect(ciStageStatus('awaiting_input')).toBe('waiting_for_answer')
    expect(ciStageStatus('interrupted')).toBe('failed')
    expect(ciStageStatus('skipped')).toBe('skipped')
    expect(qaRunStageStatus('passed')).toBe('success')
    expect(qaRunStageStatus('stale')).toBe('paused')
    expect(qaStageRunStatus('gate_failed')).toBe('blocked')
    expect(mergeStageStatus('merging')).toBe('running')
    expect(mergeStageStatus('decision_required')).toBe('paused')
    expect(qaSessionStageStatus('active')).toBe('running')
  })

  it('тон бейджа следует смыслу состояния', () => {
    expect(stageStatusTone('running')).toBe('running')
    expect(stageStatusTone('failed')).toBe('danger')
    expect(stageStatusTone('cancelled')).toBe('warning')
    expect(stageStatusTone('success')).toBe('success')
    expect(stageStatusTone('idle')).toBe('neutral')
  })

  it('склоняет существительные', () => {
    expect(pluralRu(1, 'этап', 'этапа', 'этапов')).toBe('1 этап')
    expect(pluralRu(3, 'этап', 'этапа', 'этапов')).toBe('3 этапа')
    expect(pluralRu(11, 'этап', 'этапа', 'этапов')).toBe('11 этапов')
    expect(pluralRu(22, 'проход', 'прохода', 'проходов')).toBe('22 прохода')
  })
})
