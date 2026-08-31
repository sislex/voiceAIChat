import { describe, expect, it } from 'vitest'
import {
  orchestrationItemMaxAttempts,
  orchestrationItemReady,
  orchestrationPlanError,
  orchestrationStatusOf,
  type OrchestrationItem
} from './orchestration'

function item(patch: Partial<OrchestrationItem> & { position: number }): OrchestrationItem {
  return {
    id: `i${patch.position}`,
    kind: 'run_ci',
    title: 'Шаг',
    taskId: 't1',
    dependsOn: [],
    payload: {},
    status: 'pending',
    runId: null,
    attempts: 0,
    error: null,
    startedAt: null,
    finishedAt: null,
    ...patch
  }
}

describe('orchestrationPlanError', () => {
  it('принимает связный план с задачей из create_task', () => {
    expect(orchestrationPlanError([
      { kind: 'create_task', title: 'Завести задачу' },
      { kind: 'run_ci', title: 'Разработка', dependsOn: [0] },
      { kind: 'wait_merge', title: 'Дождаться merge', dependsOn: [1] }
    ])).toBeNull()
  })

  it('требует задачу у шагов, которые её не создают', () => {
    expect(orchestrationPlanError([{ kind: 'run_ci', title: 'Разработка' }]))
      .toContain('нужна задача')
  })

  it('ловит цикл, самозависимость и ссылку в пустоту', () => {
    expect(orchestrationPlanError([
      { kind: 'create_task', title: 'A', dependsOn: [1] },
      { kind: 'create_task', title: 'B', dependsOn: [0] }
    ])).toBe('В плане есть цикл зависимостей')
    expect(orchestrationPlanError([{ kind: 'create_task', title: 'A', dependsOn: [0] }]))
      .toContain('сам от себя')
    expect(orchestrationPlanError([{ kind: 'create_task', title: 'A', dependsOn: [7] }]))
      .toContain('несуществующего')
    expect(orchestrationPlanError([])).toBe('План пуст')
  })
})

describe('orchestrationItemReady', () => {
  it('ждёт завершения всех зависимостей', () => {
    const all = [item({ position: 0, status: 'running' }), item({ position: 1, dependsOn: [0] })]
    expect(orchestrationItemReady(all[1]!, all)).toBe(false)
    const done = [item({ position: 0, status: 'done' }), item({ position: 1, dependsOn: [0] })]
    expect(orchestrationItemReady(done[1]!, done)).toBe(true)
  })

  it('уже запущенный или завершённый шаг заново не берётся', () => {
    const all = [item({ position: 0, status: 'running' })]
    expect(orchestrationItemReady(all[0]!, all)).toBe(false)
  })
})

describe('orchestrationStatusOf', () => {
  it('падение важнее отмены, а «готово» — только когда готовы все', () => {
    expect(orchestrationStatusOf([item({ position: 0, status: 'done' })])).toBe('done')
    expect(orchestrationStatusOf([item({ position: 0, status: 'done' }), item({ position: 1, status: 'running' })])).toBe('running')
    expect(orchestrationStatusOf([item({ position: 0, status: 'failed' }), item({ position: 1, status: 'cancelled' })])).toBe('failed')
    expect(orchestrationStatusOf([item({ position: 0, status: 'cancelled' })])).toBe('cancelled')
  })
})

describe('orchestrationItemMaxAttempts', () => {
  it('по умолчанию повторов нет, значение из payload ограничено тремя', () => {
    expect(orchestrationItemMaxAttempts({ payload: {} })).toBe(0)
    expect(orchestrationItemMaxAttempts({ payload: { retries: 2 } })).toBe(2)
    expect(orchestrationItemMaxAttempts({ payload: { retries: 99 } })).toBe(3)
    expect(orchestrationItemMaxAttempts({ payload: { retries: -1 } })).toBe(0)
    expect(orchestrationItemMaxAttempts({ payload: { retries: 'два' } })).toBe(0)
  })
})
