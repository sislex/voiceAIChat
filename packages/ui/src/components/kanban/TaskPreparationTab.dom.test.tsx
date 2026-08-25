// Задача A: список ранов подготовки грузится один раз (REST), а обновления
// приходят по WS точечно — на событие preparation.run.updated догружается только
// изменившийся ран (loadRun), без перезапроса всего тяжёлого списка (loadRuns).

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { TaskPreparationRun } from '@shared/qa'
import { TaskPreparationTab } from './TaskPreparationTab'

function run(over: Partial<TaskPreparationRun> = {}): TaskPreparationRun {
  return { id: 'run-1', projectId: 'p1', taskId: 't1', status: 'running', stage: 'brief_generation', attempt: 1, log: 'log', events: [], questions: [], readiness: null, gateResults: [], gateReasons: [], createdBy: 'admin', createdAt: 1, updatedAt: 1, ...over } as TaskPreparationRun
}

let updateCb: ((e: { projectId: string; taskId: string; runId: string }) => void) | null = null
function stubBoard(): void {
  ;(window as { board?: unknown }).board = {
    onPreparationRunUpdated: (cb: (e: { projectId: string; taskId: string; runId: string }) => void) => { updateCb = cb; return () => { updateCb = null } },
    onReconnect: () => () => {}
  }
  ;(window as { ci?: unknown }).ci = { getTaskMachines: async () => ({ machines: [], effectiveAgentId: null }) }
}

afterEach(() => { cleanup(); vi.useRealTimers(); delete (window as { board?: unknown }).board; delete (window as { ci?: unknown }).ci; updateCb = null })

describe('TaskPreparationTab — REST один раз, обновления по WS', () => {
  it('грузит список один раз, а на WS-событие догружает только один ран', async () => {
    stubBoard()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const loadRuns = vi.fn(async () => [run({ status: 'running' })])
    const loadRun = vi.fn(async (id: string) => run({ id, status: 'completed' }))
    render(<TaskPreparationTab projectId="p1" taskId="t1" loadRuns={loadRuns} loadRun={loadRun} />)
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(1))

    // Несколько WS-событий по одному рану коалесятся в одну догрузку.
    updateCb?.({ projectId: 'p1', taskId: 't1', runId: 'run-1' })
    updateCb?.({ projectId: 'p1', taskId: 't1', runId: 'run-1' })
    await vi.advanceTimersByTimeAsync(600)
    await waitFor(() => expect(loadRun).toHaveBeenCalledWith('run-1'))
    // Список НЕ перезапрашивается на обновлениях.
    expect(loadRuns).toHaveBeenCalledTimes(1)
  })

  it('чужой taskId в событии игнорируется', async () => {
    stubBoard()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const loadRuns = vi.fn(async () => [run()])
    const loadRun = vi.fn(async (id: string) => run({ id }))
    render(<TaskPreparationTab projectId="p1" taskId="t1" loadRuns={loadRuns} loadRun={loadRun} />)
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(1))
    updateCb?.({ projectId: 'p1', taskId: 'OTHER', runId: 'run-9' })
    await vi.advanceTimersByTimeAsync(600)
    expect(loadRun).not.toHaveBeenCalled()
  })
})
