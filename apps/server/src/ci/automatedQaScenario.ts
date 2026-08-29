// Прогон сценария этапа Automated QA в изолированном Chromium.
//
// До этого модуля этап умел ровно одно: выполнить `projects.automated_qa_command`
// в воркспейсе задачи. Браузерная проверка была невозможна, хотя всё для неё уже
// собрано прошлыми кругами: раннер, селекторные действия и перевод
// `PreviewAction` → `BrowserCommand`. Здесь эти части складываются в
// воспроизводимый прогон: одинаковый сценарий, шаг за шагом, с вердиктом на
// каждый шаг и снимком экрана в конце.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AutomatedQaScenario, AutomatedQaStepResult, BrowserSelectorResult } from '@voicechat/shared'
import { planModelAction } from '../browser/modelActions.js'
import type { BrowserRunnerClient } from '../browser/runnerClient.js'

export interface AutomatedQaScenarioInput {
  runId: string
  userId: string
  scenario: AutomatedQaScenario
  signal: AbortSignal
  /** Общий бюджет прогона; шаги за его пределами не начинаются. */
  budgetMs?: number
  /** Прогресс: вызывается сразу после каждого шага, чтобы лента не молчала. */
  onStep?: (step: AutomatedQaStepResult, index: number, total: number) => void
}

export interface AutomatedQaScenarioOutcome {
  steps: AutomatedQaStepResult[]
  screenshotUrl: string | null
  /**
   * Заполнен, если прогон не состоялся по внешней причине (Chromium недоступен,
   * сценарий не настроен). Такой провал не должен возвращать задачу в
   * разработку — виноват не разработчик.
   */
  blocked: string | null
}

export interface AutomatedQaScenarioRunnerDeps {
  browser: BrowserRunnerClient
  /** Каталог снимков; файл называется по id рана. */
  screenshotDir: string
  screenshotUrl: (runId: string) => string
  now?: () => number
}

export interface AutomatedQaScenarioRunner {
  run(input: AutomatedQaScenarioInput): Promise<AutomatedQaScenarioOutcome>
}

/** Бюджет всего Playwright-прогона по умолчанию. */
const DEFAULT_BUDGET_MS = 10 * 60_000

/** Текст ошибки Playwright длинный и многострочный; в вердикт идёт первая строка. */
function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.split('\n')[0].slice(0, 300)
}

export function createAutomatedQaScenarioRunner(deps: AutomatedQaScenarioRunnerDeps): AutomatedQaScenarioRunner {
  const now = deps.now ?? Date.now
  return {
    async run(input) {
      const steps = input.scenario.steps
      if (!input.scenario.startUrl.trim()) {
        return { steps: [], screenshotUrl: null, blocked: 'Сценарий Automated QA не настроен: не задан стартовый адрес' }
      }
      const sessionId = `qa-${input.runId}`
      const deadline = now() + (input.budgetMs ?? DEFAULT_BUDGET_MS)
      let incarnation: string
      try {
        // Ран может перезапускаться с тем же id (после рестарта сервера), а
        // `start` идемпотентен — иначе прогон продолжился бы в старой странице
        // со старым состоянием, и воспроизводимость сценария пропала бы.
        await deps.browser.stop(sessionId).catch(() => undefined)
        const session = await deps.browser.start({ sessionId, userKey: input.userId, conversationKey: input.runId })
        incarnation = session.incarnation
      } catch (error) {
        return { steps: [], screenshotUrl: null, blocked: `Изолированный Chromium недоступен: ${shortError(error)}` }
      }
      const send = async (command: Parameters<BrowserRunnerClient['command']>[1]['command']): Promise<unknown> =>
        deps.browser.command(sessionId, { requestId: randomUUID(), incarnation, actor: 'assistant', command }, input.signal)
      const results: AutomatedQaStepResult[] = []
      let screenshotUrl: string | null = null
      let blocked: string | null = null
      let expiredBudget = false
      try {
        try {
          await send({ type: 'navigate', url: input.scenario.startUrl })
        } catch (error) {
          return { steps: [], screenshotUrl: null, blocked: `Стартовый адрес не открылся: ${shortError(error)}` }
        }
        let failed = false
        let expired = false
        for (let index = 0; index < steps.length; index++) {
          const step = steps[index]
          if (input.signal.aborted) break
          // Бюджет всего прогона: у командного режима он есть с самого начала, а
          // сценарий мог идти часами — сто шагов по 30 секунд ожидания.
          if (!failed && now() >= deadline) expired = true
          if (failed || expired) {
            const skipped: AutomatedQaStepResult = { id: step.id, title: step.title, status: 'skipped', detail: expired ? 'Пропущен: исчерпан бюджет времени прогона' : 'Пропущен после провала предыдущего шага', durationMs: 0 }
            results.push(skipped)
            input.onStep?.(skipped, index, steps.length)
            continue
          }
          const startedAt = now()
          const outcome = await runStep(step, send)
          const result: AutomatedQaStepResult = { id: step.id, title: step.title, status: outcome.ok ? 'passed' : 'failed', detail: outcome.detail, durationMs: now() - startedAt }
          results.push(result)
          input.onStep?.(result, index, steps.length)
          if (!outcome.ok) failed = true
        }
        expiredBudget = expired
        // Снимок делается в любом исходе: на провале он объясняет причину, на
        // успехе служит доказательством, что проверялась именно та страница.
        try {
          const shot = await deps.browser.screenshot(sessionId, { requestId: randomUUID(), incarnation, actor: 'assistant', command: { type: 'screenshot', format: 'png' } })
          const file = join(deps.screenshotDir, `${input.runId}.png`)
          mkdirSync(dirname(file), { recursive: true })
          writeFileSync(file, shot.buffer)
          screenshotUrl = deps.screenshotUrl(input.runId)
        } catch { /* снимок — не повод завалить этап */ }
      } catch (error) {
        blocked = `Прогон сценария прерван: ${shortError(error)}`
      } finally {
        await deps.browser.stop(sessionId).catch(() => undefined)
      }
      // Исчерпанный бюджет — инфраструктура, а не дефект реализации: сценарий
      // не досмотрен, и судить по нему о работоспособности нельзя.
      if (expiredBudget) return { steps: results, screenshotUrl, blocked: 'Исчерпан бюджет времени прогона сценария' }
      return { steps: results, screenshotUrl, blocked }
    }
  }
}

async function runStep(
  step: AutomatedQaScenario['steps'][number],
  send: (command: Parameters<BrowserRunnerClient['command']>[1]['command']) => Promise<unknown>
): Promise<{ ok: boolean; detail: string }> {
  const plan = planModelAction(step.action)
  if (plan.kind === 'unsupported') return { ok: false, detail: plan.reason }
  let response: unknown
  try {
    response = await send(plan.command)
  } catch (error) {
    return { ok: false, detail: shortError(error) }
  }
  const selector = response as BrowserSelectorResult | null
  if (selector && typeof selector === 'object' && 'ok' in selector && selector.ok === false) {
    return { ok: false, detail: selector.error ?? 'Действие не выполнено' }
  }
  if (!step.expectText && !step.expectAbsentText) return { ok: true, detail: '' }
  let pageText = ''
  try {
    const read = await send({ type: 'selector', action: { kind: 'read' } }) as BrowserSelectorResult
    pageText = typeof read?.text === 'string' ? read.text : ''
  } catch (error) {
    return { ok: false, detail: `Текст страницы не прочитан: ${shortError(error)}` }
  }
  if (step.expectText && !pageText.includes(step.expectText)) return { ok: false, detail: `На странице нет ожидаемого текста «${step.expectText}»` }
  if (step.expectAbsentText && pageText.includes(step.expectAbsentText)) return { ok: false, detail: `На странице найден недопустимый текст «${step.expectAbsentText}»` }
  return { ok: true, detail: '' }
}
