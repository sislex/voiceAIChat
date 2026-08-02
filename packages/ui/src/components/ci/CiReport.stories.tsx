// Сториз раздела «Отчёт»: во что обошлась задача. Раньше эти числа были видны
// только в БД, а «дорого ли вышло» выяснялось на глаз по длительности рана.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import { CiReport } from './CiReport'
import { EMPTY_CI_USAGE_TOTALS } from '@shared/ci'
import { makeRunReport, makeTaskReport, makeUsageTotals } from '../../test/fixtures'

const meta: Meta<typeof CiReport> = {
  title: 'CI/CiReport',
  component: CiReport,
  args: { report: makeTaskReport(), onOpenRun: fn() },
  decorators: [(Story) => <div style={{ maxWidth: 620 }}><Story /></div>]
}
export default meta
type Story = StoryObj<typeof CiReport>

/** Один успешный ран: плитки итогов и шаги со статусом, попыткой и временем. */
export const OneRun: Story = {}

/** Стоимость посчитана по прайсу (CLI её не отдал) — везде «≈». */
export const EstimatedCost: Story = {
  args: {
    report: makeTaskReport([
      makeRunReport({ totals: makeUsageTotals({ costUsd: 2.07, costEstimated: true }) })
    ])
  }
}

/** Несколько ранов: переключатель и итог по задаче (повторы складываются). */
export const SeveralRuns: Story = {
  args: {
    report: makeTaskReport([
      makeRunReport({ runId: 'run-2', durationMs: 420_000, totals: makeUsageTotals({ requests: 2, tokens: 90_000, costUsd: 0.74 }) }),
      makeRunReport({ runId: 'run-1', status: 'failed', fixAttempts: 3 })
    ])
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Итог по задаче' }))
    await expect(c.getByTestId('ci-report-runs')).toBeInTheDocument()
  }
}

/** Старый ран: строк расхода нет — шаги и время есть, деньги и токены прочерками. */
export const NoUsage: Story = {
  args: {
    report: makeTaskReport([
      makeRunReport({
        totals: { ...EMPTY_CI_USAGE_TOTALS },
        // Стадии считаются по строкам расхода — у такого рана их нет вовсе.
        stages: [],
        steps: makeRunReport().steps.map((s) => ({ ...s, usage: null })),
        fixAttempts: 0
      })
    ])
  }
}

/**
 * Ран через исполнителя: стоимости от CLI нет, а у части ходов неизвестна и
 * модель — итог помечен и оценкой, и заниженным.
 */
export const UnderstatedCost: Story = {
  args: {
    report: makeTaskReport([
      makeRunReport({ totals: makeUsageTotals({ costUsd: 0.62, costEstimated: true, costUnderstated: true, inputNormalized: true }) })
    ])
  }
}

/** Ран до появления счётчика вызовов: строки «Инструменты» нет вовсе, не «0». */
export const NoToolCalls: Story = {
  args: { report: makeTaskReport([makeRunReport({ toolCalls: null, toolChars: null, toolResponses: [] })]) }
}

/**
 * Ран codex: числа запросов к API CLI не сообщает, поэтому контекст на запрос —
 * прочерк с объяснением, а не ноль.
 */
export const NoContextPerRequest: Story = {
  args: {
    report: makeTaskReport([
      makeRunReport({ provider: 'codex', totals: makeUsageTotals({ apiRequests: 0, maxContextPerRequest: 0 }) })
    ])
  }
}

/** Отчёт не прочитался: сообщение вместо чисел — карточку это не ломает. */
export const Failed: Story = { args: { report: null, error: 'HTTP 500' } }

/** Пока грузится — короткая строка вместо пустоты. */
export const Loading: Story = { args: { report: null, loading: true } }
