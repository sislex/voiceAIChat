import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/uiRender'
import { expectNoViolations } from '../../test/a11y'
import { createFakeCi } from '../../test/fakeApi'
import type { TaskTimeline as Timeline } from '@shared/timeline'
import { TaskTimeline, formatTimelineDuration } from './TaskTimeline'

const timeline: Timeline = {
  version: 1, taskId: 't1', generatedAt: '2024-01-01T00:00:10.000Z',
  summary: {
    createdAt: '2024-01-01T00:00:00.000Z', firstStartedAt: '2024-01-01T00:00:02.000Z',
    finishedAt: null, calendarDuration: null, activeDuration: 3000, queueDuration: 2000,
    awaitingInputDuration: 1000, lastChangedAt: '2024-01-01T00:00:06.000Z'
  },
  stages: [{
    id: 'stage:development', type: 'development', title: 'Development', status: 'running',
    queuedAt: '2024-01-01T00:00:00.000Z', startedAt: '2024-01-01T00:00:02.000Z', finishedAt: null,
    queueDuration: 2000, activeDuration: 3000, awaitingInputDuration: 1000, calendarDuration: null,
    attemptCount: 2, successfulDuration: 2000, unsuccessfulDuration: 1000,
    executor: 'alice', machine: 'Mac', model: 'gpt-test', reason: null, workflowPosition: 20, dataComplete: true,
    runs: [{ id: 'run-1', kind: 'ci' }],
    attempts: [{
      id: 'ci:run-1', number: 2, status: 'running', queuedAt: '2024-01-01T00:00:00.000Z',
      startedAt: '2024-01-01T00:00:02.000Z', finishedAt: null,
      queueIntervals: [{ startedAt: '2024-01-01T00:00:00.000Z', finishedAt: '2024-01-01T00:00:02.000Z', durationMs: 2000 }],
      activeIntervals: [{ startedAt: '2024-01-01T00:00:05.000Z', finishedAt: null, durationMs: null }],
      awaitingInputIntervals: [{ startedAt: '2024-01-01T00:00:04.000Z', finishedAt: '2024-01-01T00:00:05.000Z', durationMs: 1000 }],
      queueDuration: 2000, activeDuration: 3000, awaitingInputDuration: 1000, calendarDuration: null,
      executor: 'alice', machine: 'Mac', model: 'gpt-test', reason: null,
      runs: [{ id: 'run-1', kind: 'ci' }], dataComplete: true
    }]
  }]
}

describe('TaskTimeline', () => {
  beforeEach(() => {
    window.ci = { ...createFakeCi(), getTaskTimeline: vi.fn(async () => timeline) }
  })
  afterEach(() => vi.useRealTimers())

  it('показывает сводку, раскрываемые этапы и фактические данные попытки', async () => {
    render(<TaskTimeline projectId="p1" taskId="t1" />)
    const summary = await screen.findByText('Сводка задачи')
    expect(within(summary.closest('details')!).getByText('Первый запуск')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Development'))
    await userEvent.click(screen.getByText(/Попытка 2/))
    expect(screen.getByText('gpt-test')).toBeInTheDocument()
    expect(screen.getByText('Mac')).toBeInTheDocument()
    expect(screen.getByText(/ci: run-1/)).toBeInTheDocument()
    await expectNoViolations(summary.closest('section')!)
  })

  it('живой тик не пересоздаёт раскрытый этап и не сбрасывает фокус', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<TaskTimeline projectId="p1" taskId="t1" />)
    const stageLabel = await screen.findByText('Development')
    const stageSummary = stageLabel.closest('summary')!
    await userEvent.click(stageSummary)
    const details = stageSummary.closest('details')!
    stageSummary.focus()
    await vi.advanceTimersByTimeAsync(2000)
    expect(details.open).toBe(true)
    expect(document.activeElement).toBe(stageSummary)
    expect(window.ci!.getTaskTimeline).toHaveBeenCalledTimes(1)
  })

  it('форматирует границы секунд, минут, часов и дней единообразно', () => {
    expect(formatTimelineDuration(45_000)).toBe('45 с')
    expect(formatTimelineDuration(12 * 60_000)).toBe('12 мин')
    expect(formatTimelineDuration((2 * 60 + 15) * 60_000)).toBe('2 ч 15 мин')
    expect(formatTimelineDuration((3 * 24 + 4) * 60 * 60_000)).toBe('3 д 4 ч')
    expect(formatTimelineDuration(null)).toBe('Нет данных')
  })
})
