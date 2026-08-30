// Разовый прогон набора сценариев по требованию.
//
// Жил замыканием внутри `buildServer` и потому не проверялся ничем: ни деление
// бюджета, ни защита от параллельного запуска, ни выбор одного сценария. Здесь
// та же логика отдельной функцией — её можно позвать в тесте с подставным
// исполнителем.

import { randomUUID } from 'node:crypto'
import type { AutomatedQaCheckResult, AutomatedQaScenario } from '@voicechat/shared'
import { scenarioLabel } from '@voicechat/shared'
import type { AutomatedQaScenarioRunner } from './automatedQaScenario.js'

export interface AutomatedQaCheckDeps {
  scenariosOf: (userId: string, projectId: string) => AutomatedQaScenario[]
  runner: AutomatedQaScenarioRunner
  /** Бюджет на весь прогон, а не на каждый сценарий. */
  budgetMs: number
  now?: () => number
  newRunId?: () => string
}

/** Минимум времени на сценарий: делить бюджет до нуля бессмысленно. */
const MIN_SHARE_MS = 10_000

export type AutomatedQaCheck = (userId: string, projectId: string, scenarioIndex?: number) => Promise<AutomatedQaCheckResult[]>

export function createAutomatedQaCheck(deps: AutomatedQaCheckDeps): AutomatedQaCheck {
  const now = deps.now ?? Date.now
  const newRunId = deps.newRunId ?? (() => randomUUID().slice(0, 8))
  // Один прогон на проект: второе нажатие (или вторая вкладка) подняло бы
  // второй Chromium на тот же набор и удвоило ожидание обоим.
  const running = new Set<string>()
  return async (userId, projectId, scenarioIndex) => {
    if (running.has(projectId)) throw new Error('check_already_running')
    running.add(projectId)
    try {
      const all = deps.scenariosOf(userId, projectId)
      // Отладка записи не должна стоить прогона всего набора.
      const chosen = scenarioIndex === undefined
        ? all.map((scenario, index) => ({ scenario, index }))
        : all[scenarioIndex] ? [{ scenario: all[scenarioIndex], index: scenarioIndex }] : []
      const results: AutomatedQaCheckResult[] = []
      // Бюджет общий: человек ждёт синхронный ответ, и пять сценариев по 90 с
      // держали бы его семь с половиной минут.
      const deadline = now() + deps.budgetMs
      for (const [position, { scenario, index }] of chosen.entries()) {
        const startedAt = now()
        const share = Math.max(MIN_SHARE_MS, Math.floor((deadline - startedAt) / (chosen.length - position)))
        const outcome = await deps.runner.run({
          runId: `check-${projectId}-${index}-${newRunId()}`,
          userId, scenario, signal: AbortSignal.timeout(share), budgetMs: share, inlineScreenshot: true
        })
        results.push({
          name: scenarioLabel(scenario, index),
          passed: !outcome.blocked && outcome.steps.length > 0 && outcome.steps.every((step) => step.status === 'passed'),
          blocked: outcome.blocked,
          steps: outcome.steps,
          durationMs: now() - startedAt,
          ...(outcome.pageErrors.length ? { pageErrors: outcome.pageErrors } : {}),
          ...(outcome.screenshotDataUrl ? { screenshot: outcome.screenshotDataUrl } : {})
        })
        // Первый провалившийся останавливает проверку — как в этапе, чтобы
        // поведение проверки и настоящего прогона не расходилось.
        if (outcome.blocked || outcome.steps.some((step) => step.status === 'failed')) break
        if (now() >= deadline) break
      }
      return results
    } finally {
      running.delete(projectId)
    }
  }
}
