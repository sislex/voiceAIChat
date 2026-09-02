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
  /**
   * Снимок содержимым вместо файла. У разового прогона нет рана в БД, а роут
   * снимка без рана отвечает 404: файл на диске был недостижим и удалялся
   * сборщиком как осиротевший — писать его значило плодить мусор.
   */
  inlineScreenshot?: boolean
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
  /** Снимок содержимым (`inlineScreenshot`), а не файлом на диске. */
  screenshotDataUrl?: string
  /**
   * Ошибки консоли страницы за прогон. Проба (`scripts/reader-probe.mjs`)
   * собирала их с самого начала, а этап — нет: разработчик получал шаг, деталь
   * и снимок, но не «Uncaught TypeError …», который обычно и есть ответ.
   */
  pageErrors: string[]
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

/**
 * Почему прогон прерван. `AbortSignal.timeout` кладёт в `reason` TimeoutError —
 * так разовая проверка отличает исчерпанный бюджет от «Отменить» человека.
 * Обе причины — не дефект реализации, и вердикт обязан это сказать.
 */
export function abortReason(signal: AbortSignal): string {
  const reason = signal.reason as { name?: unknown } | undefined
  return reason && typeof reason === 'object' && reason.name === 'TimeoutError'
    ? 'Исчерпан бюджет времени прогона сценария'
    : 'Прогон отменён'
}

/**
 * Ошибки консоли с момента прошлого чтения: журнал читается с `clear`, поэтому
 * каждый вызов отдаёт только новое. Повтор одного текста схлопывается с
 * кратностью — одно исключение раннер видит дважды, слушателями `console` и
 * `pageerror`, а «×12» отличает разовый сбой от цикла.
 */
async function readPageErrors(send: ScenarioSend): Promise<string[]> {
  try {
    const seen = await send({ type: 'inspect', action: { kind: 'console', level: 'error', limit: 50, clear: true } }) as { console?: Array<{ text?: string }> }
    const counts = new Map<string, number>()
    for (const entry of seen?.console ?? []) {
      const text = String(entry.text ?? '').slice(0, 500)
      if (text) counts.set(text, (counts.get(text) ?? 0) + 1)
    }
    return [...counts].map(([text, count]) => (count > 1 ? `${text} (×${count})` : text))
  } catch { return [] }
}

export function createAutomatedQaScenarioRunner(deps: AutomatedQaScenarioRunnerDeps): AutomatedQaScenarioRunner {
  const now = deps.now ?? Date.now
  return {
    async run(input) {
      const steps = input.scenario.steps
      if (!input.scenario.startUrl.trim()) {
        return { steps: [], screenshotUrl: null, pageErrors: [], blocked: 'Сценарий Automated QA не настроен: не задан стартовый адрес' }
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
        return { steps: [], screenshotUrl: null, pageErrors: [], blocked: `Изолированный Chromium недоступен: ${firstLine(error)}` }
      }
      // Тип клиента теперь честный (`BrowserRunnerCommandResult`), поэтому
      // приведение осталось одно — к общей форме отправителя шага.
      const send: ScenarioSend = (command) =>
        deps.browser.command(sessionId, { requestId: randomUUID(), incarnation, actor: 'assistant', command }, input.signal)
      const results: AutomatedQaStepResult[] = []
      let screenshotUrl: string | null = null
      let screenshotError = ''
      let screenshotDataUrl = ''
      const pageErrors: string[] = []
      let blocked: string | null = null
      let expiredBudget = false
      try {
        try {
          await send({ type: 'navigate', url: input.scenario.startUrl })
        } catch (error) {
          return { steps: [], screenshotUrl: null, pageErrors: [], blocked: `Стартовый адрес не открылся: ${firstLine(error)}` }
        }
        let failed = false
        let expired = false
        let aborted: string | null = null
        let unverifiable: string | null = null
        for (let index = 0; index < steps.length; index++) {
          const step = steps[index]
          // Прерванный прогон раньше просто обрывал цикл: недошедшие шаги
          // исчезали из отчёта, и разовая проверка считала сценарий пройденным
          // по двум шагам из пяти. Теперь они пропущены с причиной, а прогон
          // заблокирован — судить о реализации по нему нельзя.
          if (input.signal.aborted && !aborted) aborted = abortReason(input.signal)
          // Бюджет всего прогона: у командного режима он есть с самого начала, а
          // сценарий мог идти часами — сто шагов по 30 секунд ожидания.
          if (!failed && !aborted && now() >= deadline) expired = true
          if (failed || expired || aborted) {
            const detail = aborted ? `Пропущен: ${aborted.toLowerCase()}` : expired ? 'Пропущен: исчерпан бюджет времени прогона' : 'Пропущен после провала предыдущего шага'
            const skipped: AutomatedQaStepResult = { id: step.id, title: step.title, status: 'skipped', detail, durationMs: 0 }
            results.push(skipped)
            input.onStep?.(skipped, index, steps.length)
            continue
          }
          const startedAt = now()
          const outcome = await runScenarioStep(step, send)
          // Прервали посреди шага: команда упала с «запрос отменён», и шаг шёл
          // в отчёт провалом — то есть дефектом реализации за то, что человек
          // нажал «Отменить» или кончился бюджет.
          if (input.signal.aborted) {
            aborted = abortReason(input.signal)
            const cut: AutomatedQaStepResult = { id: step.id, title: step.title, status: 'skipped', detail: `Прерван: ${aborted.toLowerCase()}`, durationMs: now() - startedAt }
            results.push(cut)
            input.onStep?.(cut, index, steps.length)
            continue
          }
          // Журнал читается с очисткой: следующий шаг увидит только свои
          // ошибки. Иначе одна поломка тянулась бы по всем шагам подряд, а за
          // весь прогон (как в круге 27) непонятно, какое действие её вызвало.
          const stepErrors = await readPageErrors(send)
          const result: AutomatedQaStepResult = {
            id: step.id, title: step.title, status: outcome.ok ? 'passed' : 'failed', detail: outcome.detail, durationMs: now() - startedAt,
            ...(stepErrors.length ? { pageErrors: stepErrors } : {})
          }
          pageErrors.push(...stepErrors)
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
        if (aborted) blocked = aborted
        // Хвост: ошибки, прилетевшие после последнего шага (асинхронный запрос
        // страницы вполне мог не успеть к моменту его завершения).
        pageErrors.push(...await readPageErrors(send))
        // Снимок делается в любом исходе: на провале он объясняет причину, на
        // успехе служит доказательством, что проверялась именно та страница.
        // Сигнал отмены передаётся и сюда: круг 29 научил `screenshot()` его
        // слушать, но единственный вызывающий сигнал не передавал — после
        // «Отменить» снимок висел до собственного таймаута в 35 с.
        try {
          const shot = await deps.browser.screenshot(sessionId, { requestId: randomUUID(), incarnation, actor: 'assistant', command: { type: 'screenshot', format: 'png' } }, input.signal)
          if (input.inlineScreenshot) {
            screenshotDataUrl = `data:image/png;base64,${shot.buffer.toString('base64')}`
          } else {
            const file = join(deps.screenshotDir, `${input.runId}.png`)
            mkdirSync(dirname(file), { recursive: true })
            writeFileSync(file, shot.buffer)
            screenshotUrl = deps.screenshotUrl(input.runId)
          }
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
      const shot = { ...(screenshotError ? { screenshotError } : {}), ...(screenshotDataUrl ? { screenshotDataUrl } : {}) }
      if (expiredBudget) return { steps: results, screenshotUrl, pageErrors, blocked: 'Исчерпан бюджет времени прогона сценария', ...shot }
      return { steps: results, screenshotUrl, pageErrors, blocked, ...shot }
    }
  }
}
