import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../../test/uiRender'
import { createFakeCi } from '../../test/fakeApi'
import { TaskRunFeed } from './TaskRunFeed'
import type { CiRun, CiRunDetail, CiTaskReport } from '@shared/ci'
import { makeRunReport, makeTaskReport } from '../../test/fixtures'

function run(id: string, status: CiRun['status'] = 'success'): CiRun {
  return {
    id, projectId: 'p1', taskId: 't1', status, mode: 'full', llmProvider: 'claude', llmModel: 'opus',
    llmEngineId: null, slotProgress: { done: 1, total: 1, phase: 'Готово' }, durationMs: 1,
    startedAt: 1, finishedAt: 2, createdAt: 1, terminalColumnId: null
  } as unknown as CiRun
}

function detail(id: string): CiRunDetail {
  return { run: run(id), steps: [], fixAttempts: [], interactions: [] }
}

function report(): CiTaskReport {
  return makeTaskReport([
    makeRunReport({ runId: 'dev-active', status: 'running', startedAt: 3, finishedAt: null, durationMs: null, createdAt: 3 }),
    makeRunReport({ runId: 'dev-old', status: 'success', startedAt: 1, finishedAt: 2, durationMs: 1, createdAt: 1 })
  ])
}

describe('TaskRunFeed', () => {
  beforeEach(() => {
    window.ci = {
      ...createFakeCi(),
      getTaskReport: vi.fn(async () => report()),
      listMergeRuns: vi.fn(async () => []),
      getRun: vi.fn(async (id) => detail(id)),
      getRunLog: vi.fn(async () => [])
    }
  })

  it('сразу загружает и показывает активный development-ран внутри вкладки', async () => {
    render(<TaskRunFeed projectId="p1" taskId="t1" activeDevelopmentRunId="dev-active" />)
    expect(screen.getByText('Загрузка технической ленты…')).toBeInTheDocument()
    await waitFor(() => expect(window.ci?.getRun).toHaveBeenCalledWith('dev-active'))
    expect(screen.getByTestId('ci-runfeed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Открыть техническую ленту' })).not.toBeInTheDocument()
    expect(screen.getByText('Development')).toBeInTheDocument()
  })

  it('переключает предыдущие development-раны и не принимает событие другого рана', async () => {
    render(<TaskRunFeed projectId="p1" taskId="t1" activeDevelopmentRunId="dev-active" />)
    const select = await screen.findByLabelText('Выбранный запуск')
    fireEvent.change(select, { target: { value: 'dev-old' } })
    await waitFor(() => expect(window.ci?.getRun).toHaveBeenCalledWith('dev-old'))
    expect(select).toHaveValue('dev-old')
  })

  it('показывает ошибку списка и повторяет загрузку', async () => {
    window.ci = { ...window.ci!, getTaskReport: vi.fn(async () => { throw new Error('offline') }) }
    render(<TaskRunFeed projectId="p1" taskId="t1" />)
    const retry = await screen.findByRole('button', { name: 'Повторить' })
    expect(screen.getByRole('alert')).toHaveTextContent('offline')
    fireEvent.click(retry)
    expect(window.ci.getTaskReport).toHaveBeenCalledTimes(2)
  })
})
