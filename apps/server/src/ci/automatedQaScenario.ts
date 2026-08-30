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
import type { AutomatedQaScenario, AutomatedQaStepResult } from '@voicechat/shared'
import { firstLine, runScenarioStep, type ScenarioSend } from '@voicechat/shared'
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
  /** Почему не вышло снять экран. Пустое — снимок либо сделан, либо не нужен. */
  screenshotError?: string
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
        return { steps: [], screenshotUrl: null, blocked: `Изолированный Chromium недоступен: ${firstLine(error)}` }
      }
      const send = async (command: Parameters<BrowserRunnerClient['command']>[1]['command']): Promise<unknown> =>
        deps.browser.command(sessionId, { requestId: randomUUID(), incarnation, actor: 'assistant', command }, input.signal)
      const results: AutomatedQaStepResult[] = []
      let screenshotUrl: string | null = null
      let screenshotError = ''
      let blocked: string | null = null
      let expiredBudget = false
      try {
        try {
          await send({ type: 'navigate', url: input.scenario.startUrl })
        } catch (error) {
          return { steps: [], screenshotUrl: null, blocked: `Стартовый адрес не открылся: ${firstLine(error)}` }
        }
        let failed = false
        let expired = false
        let unverifiable: string | null = null
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
          const outcome = await runScenarioStep(step, send as ScenarioSend)
          const result: AutomatedQaStepResult = { id: step.id, title: step.title, status: outcome.ok ? 'passed' : 'failed', detail: outcome.detail, durationMs: now() - startedAt }
          results.push(result)
          input.onStep?.(result, index, steps.length)
          // Шаг, который нельзя проверить (действие невыразимо, страница длиннее
          // предела чтения), — беда сценария, а не кода. Раньше он приходил
          // обычным провалом, этап объявлял дефект реализации и возвращал задачу
          // разработчику за то, чего тот не ломал.
          if (outcome.unverifiable) { unverifiable = `Шаг «${step.title}» проверить нельзя: ${outcome.detail}`; failed = true; continue }
          if (!outcome.ok) failed = true
        }
        expiredBudget = expired
        if (unverifiable) blocked = unverifiable
        // Снимок делается в любом исходе: на провале он объясняет причину, на
        // успехе служит доказательством, что проверялась именно та страница.
        try {
          const shot = await deps.browser.screenshot(sessionId, { requestId: randomUUID(), incarnation, actor: 'assistant', command: { type: 'screenshot', format: 'png' } })
          const file = join(deps.screenshotDir, `${input.runId}.png`)
          mkdirSync(dirname(file), { recursive: true })
          writeFileSync(file, shot.buffer)
          screenshotUrl = deps.screenshotUrl(input.runId)
        } catch (error) {
          // Снимок — не повод завалить этап, но и молчать нельзя: если он
          // перестанет получаться совсем, у вердиктов просто никогда не будет
          // картинки, и никто не станет разбираться почему.
          screenshotError = firstLine(error)
        }
      } catch (error) {
        blocked = `Прогон сценария прерван: ${firstLine(error)}`
      } finally {
        await deps.browser.stop(sessionId).catch(() => undefined)
      }
      // Исчерпанный бюджет — инфраструктура, а не дефект реализации: сценарий
      // не досмотрен, и судить по нему о работоспособности нельзя.
      if (expiredBudget) return { steps: results, screenshotUrl, blocked: 'Исчерпан бюджет времени прогона сценария', ...(screenshotError ? { screenshotError } : {}) }
      return { steps: results, screenshotUrl, blocked, ...(screenshotError ? { screenshotError } : {}) }
    }
  }
}
