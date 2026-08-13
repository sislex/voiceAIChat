import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AutomationProgressView } from './AutomationProgressView'
import type { AutomationProgress } from '@shared/ci'

const base: AutomationProgress = {
  runId: 'r', version: 1, stage: 'Тесты', status: 'running', startedAt: 1_000,
  finishedAt: null, elapsedMs: 2_000, percent: 60, completedSteps: 3, totalSteps: 5,
  currentStep: 'Vitest', etaMs: 240_000, etaRangeMs: [180_000, 300_000],
  etaUnavailableReason: null, logUrl: '/log', steps: []
}

describe('AutomationProgressView', () => {
  it('renders determinate ARIA progress and ETA', () => {
    render(<AutomationProgressView progress={base} now={() => 3_000} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '60')
    expect(screen.getByText(/ETA:/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Журнал' })).toHaveAttribute('href', '/log')
  })

  it('renders indeterminate progress without a fake numeric value', () => {
    render(<AutomationProgressView progress={{ ...base, percent: null, totalSteps: null, etaRangeMs: null, etaMs: null, etaUnavailableReason: 'Пока недостаточно данных' }} />)
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
    expect(screen.getByText(/недостаточно данных/)).toBeInTheDocument()
  })

  it('announces manual waiting and keeps terminal elapsed frozen', () => {
    vi.useFakeTimers()
    render(<AutomationProgressView progress={{ ...base, status: 'waiting', percent: null, currentStep: null }} />)
    expect(screen.getAllByText('Ожидает действия пользователя').length).toBeGreaterThan(0)
    vi.useRealTimers()
  })
})
