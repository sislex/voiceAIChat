import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from '../../test/uiRender'
import { createFakeCi } from '../../test/fakeApi'
import { TaskRunFeed } from './TaskRunFeed'
import '../../styles/app.css'
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

  // В списке рядом стояли русское «Успешно» и сырое `awaiting_merge`, а даты
  // печатались двумя разными форматами.
  it('подписывает merge-раны по-русски и общим форматом даты', async () => {
    window.ci = {
      ...window.ci!,
      listMergeRuns: vi.fn(async () => [
        { id: 'merge-1', projectId: 'p1', taskId: 't1', status: 'production_checks', createdAt: Date.UTC(2024, 0, 2, 9, 5) }
      ] as never)
    }
    render(<TaskRunFeed projectId="p1" taskId="t1" />)
    const select = await screen.findByRole('combobox', { name: 'Выбранный запуск' })
    const merge = within(select).getByRole('option', { name: /^Merge/ })

    expect(merge).toHaveTextContent('проверки прода')
    expect(merge).not.toHaveTextContent('production_checks')
    expect(merge.textContent).toMatch(/\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/)
  })

  it('сразу загружает и показывает активный development-ран внутри вкладки', async () => {
    render(<TaskRunFeed projectId="p1" taskId="t1" activeDevelopmentRunId="dev-active" />)
    const loading = screen.getByText('Загрузка технической ленты…')
    expect(loading).toBeInTheDocument()
    expect(loading.parentElement).toHaveClass('task-run-feed')
    await waitFor(() => expect(window.ci?.getRun).toHaveBeenCalledWith('dev-active'))
    expect(screen.getByTestId('ci-runfeed')).toBeInTheDocument()
    const feed = screen.getByTestId('ci-runfeed').parentElement!
    expect(feed).toHaveClass('task-run-feed')
    expect(getComputedStyle(feed).width).toBe('100%')
    expect(getComputedStyle(feed).overflowX).toBe('hidden')
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

  it('показывает полноширинное пустое состояние', async () => {
    window.ci = {
      ...window.ci!,
      getTaskReport: vi.fn(async () => makeTaskReport([])),
      listMergeRuns: vi.fn(async () => [])
    }
    render(<TaskRunFeed projectId="p1" taskId="t1" />)

    const empty = await screen.findByTestId('empty-state')
    expect(empty.parentElement).toHaveClass('task-run-feed')
    expect(getComputedStyle(empty.parentElement!).width).toBe('100%')
  })

  it('показывает ошибку списка и повторяет загрузку', async () => {
    window.ci = { ...window.ci!, getTaskReport: vi.fn(async () => { throw new Error('offline') }) }
    render(<TaskRunFeed projectId="p1" taskId="t1" />)
    const retry = await screen.findByRole('button', { name: 'Повторить' })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('offline')
    expect(alert.parentElement).toHaveClass('task-run-feed')
    expect(getComputedStyle(alert.parentElement!).width).toBe('100%')
    fireEvent.click(retry)
    expect(window.ci.getTaskReport).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['light', 1280],
    ['dark', 390]
  ])('сохраняет полноширинный контейнер без внешнего overflow в теме %s при viewport %ipx', async (theme, viewportWidth) => {
    document.documentElement.dataset.theme = theme
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth })
    render(<TaskRunFeed projectId="p1" taskId="t1" activeDevelopmentRunId="dev-active" />)

    const feed = (await screen.findByTestId('ci-runfeed')).parentElement!
    expect(feed).toHaveClass('task-run-feed')
    expect(feed).toHaveStyle({ width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', overflowX: 'hidden' })

    delete document.documentElement.dataset.theme
  })
})
