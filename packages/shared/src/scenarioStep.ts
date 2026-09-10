// Исполнение шага сценария Automated QA — один код на всех.
//
// До круга 17 шаг исполняли две реализации: этап на сервере (через
// `planModelAction`, весь словарь действий) и проба `scripts/reader-probe.mjs`
// (вручную, только click/type/wait). Расхождение уже случилось — круг 15 научил
// записывать прокрутку, и проба перестала понимать записанное. Здесь общая
// часть: перевод шага в команды и разбор ожиданий. Транспорт остаётся снаружи —
// у сервера это HTTP к раннеру, у пробы тот же HTTP, у панели мост `window`.

import type { AutomatedQaScenarioStep } from './qa'
import { isBrowserSessionMetadata, type BrowserCommand } from './types'
import { isPreviewAction } from './previewActions'
import { readScenarioText, type ScenarioText } from './scenarioReading'
import { planModelAction } from './browserActions'

export interface ScenarioStepOutcome {
  ok: boolean
  /** Причина провала либо пустая строка. */
  detail: string
  /** Действие вообще не выражается командой раннера — это не провал проверки. */
  unsupported?: boolean
  /**
   * Что именно не сошлось: само действие или проверка после него. В отчёте это
   * разные беды — «кнопка не нажалась» и «нажалась, но результат не тот».
   */
  failure?: 'action' | 'expectation'
  /**
   * Шаг не удалось проверить: действие невыразимо командой раннера, либо текст
   * страницы прочитан не целиком. Судить о реализации по такому шагу нельзя —
   * иначе этап объявляет дефект реализации и возвращает задачу разработчику за
   * беду сценария, а не кода.
   */
  unverifiable?: boolean
}

export interface ScenarioStepOptions {
  /**
   * Сколько ждать, пока страница догонит действие. Ожидание проверялось
   * мгновенно после клика, а интерфейс обновляется асинхронно: шаг мигал —
   * иногда проходил, иногда нет. Недетерминированный тест хуже отсутствующего.
   */
  expectTimeoutMs?: number
  /** Пауза между попытками чтения страницы. */
  pollMs?: number
  /** Инъекция сна для тестов — реальные задержки в них не нужны. */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/** Отправка команды: возвращает ответ раннера как есть. */
export type ScenarioSend = (command: BrowserCommand) => Promise<unknown>

/** Текст ошибки Playwright длинный и многострочный; берём первую строку. */
export function firstLine(value: unknown, limit = 300): string {
  const message = value instanceof Error ? value.message : String(value ?? '')
  return message.split('\n')[0].slice(0, limit)
}

/**
 * Подсказка вместо голого текста Playwright. «Локатор не найден» не говорит, что
 * делать; чаще всего это либо гонка (нужно ожидание), либо слишком узкий
 * селектор.
 */
export function stepHint(detail: string): string {
  if (/прочитан не целиком/.test(detail)) {
    return 'Страница длиннее предела чтения: проверьте текст, который виден раньше, либо разбейте сценарий на экраны поменьше.'
  }
  if (/Timeout|timeout|не найден|not found|strict mode/i.test(detail)) {
    return 'Возможно, элемент ещё не появился — добавьте ожидаемый текст к предыдущему шагу или уточните селектор.'
  }
  return ''
}

const DEFAULT_EXPECT_TIMEOUT_MS = 5_000
const DEFAULT_POLL_MS = 250
/** Команда обязана подтвердить действие: отсутствие ответа не означает успех. */
export function scenarioCommandError(response: unknown): string | null {
  if (!response || typeof response !== 'object') return 'Раннер не подтвердил выполнение действия'
  const result = response as { ok?: unknown; error?: unknown }
  if (result.ok === false) return firstLine(result.error) || 'Действие не выполнено'
  if (isBrowserSessionMetadata(response)) {
    return response.state === 'ready' ? null : response.error?.message || 'Сессия Chromium не готова'
  }
  return result.ok === true ? null : 'Раннер не подтвердил выполнение действия'
}

export async function runScenarioStep(
  step: AutomatedQaScenarioStep,
  send: ScenarioSend,
  options: ScenarioStepOptions = {}
): Promise<ScenarioStepOutcome> {
  if (!isPreviewAction(step.action)) return { ok: false, detail: 'Некорректное действие сценария', unsupported: true, unverifiable: true, failure: 'action' }
  const plan = planModelAction(step.action)
  if (plan.kind === 'unsupported') return { ok: false, detail: plan.reason, unsupported: true, unverifiable: true, failure: 'action' }
  let response: unknown
  try { response = await send(plan.command) } catch (error) { return { ok: false, detail: firstLine(error), failure: 'action' } }
  const actionError = scenarioCommandError(response)
  if (actionError) return { ok: false, detail: actionError, failure: 'action' }
  if (!step.expectText && !step.expectAbsentText) return { ok: true, detail: '' }

  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  const timeout = options.expectTimeoutMs ?? DEFAULT_EXPECT_TIMEOUT_MS
  const poll = options.pollMs ?? DEFAULT_POLL_MS
  if (!Number.isFinite(timeout) || timeout < 0 || !Number.isFinite(poll) || poll <= 0) {
    return { ok: false, detail: 'Неверное время ожидания сценария', failure: 'expectation', unverifiable: true }
  }
  const deadline = now() + timeout
  let snapshot: ScenarioText = { text: '', complete: false }
  let missing = false, present = false
  for (;;) {
    try {
      snapshot = await readScenarioText(send, { expectText: step.expectText, expectAbsentText: step.expectAbsentText, frame: step.action.frame })
    } catch (error) {
      return { ok: false, detail: `Текст страницы не прочитан: ${firstLine(error)}`, failure: 'expectation', unverifiable: true }
    }
    missing = Boolean(step.expectText && !snapshot.text.includes(step.expectText))
    present = Boolean(step.expectAbsentText && snapshot.text.includes(step.expectAbsentText))
    if (!missing && !present && (!step.expectAbsentText || snapshot.complete)) return { ok: true, detail: '' }
    const remaining = deadline - now()
    if (remaining <= 0) break
    await sleep(Math.min(poll, remaining))
    // Сон до самого предела не даёт разрешения на ещё одно чтение за ним.
    if (now() >= deadline) break
  }
  const incomplete = !snapshot.complete && !present
  const what = present
    ? `На странице найден недопустимый текст «${step.expectAbsentText}»`
    : incomplete
      ? `Текст страницы прочитан не целиком: ${snapshot.reason || 'продолжение недоступно'}. Проверку ${missing ? `наличия «${step.expectText}»` : `отсутствия «${step.expectAbsentText}»`} подтвердить нельзя`
      : `На странице нет ожидаемого текста «${step.expectText}»`
  const seen = snapshot.text.trim().slice(0, 200)
  return { ok: false, detail: seen ? `${what}. Видно: ${seen}` : what, failure: 'expectation', ...(incomplete ? { unverifiable: true } : {}) }

}

/**
 * Что не так со сценарием до того, как он уедет в проект. Раньше туда попадали
 * шаги с неисполнимым действием и пустым селектором, и узнавалось это только на
 * прогоне — а прогон бывает через сутки, на доске, у другого человека.
 */
export function scenarioProblems(scenario: { startUrl: string; steps: AutomatedQaScenarioStep[] }): string[] {
  const problems: string[] = []
  if (!scenario.startUrl.trim()) problems.push('Не задан стартовый адрес')
  if (!scenario.steps.length) problems.push('В сценарии нет ни одного шага')
  scenario.steps.forEach((step, index) => {
    const position = `Шаг ${index + 1} («${step.title}»)`
    if (!isPreviewAction(step.action)) { problems.push(`${position}: некорректное действие`); return }
    const plan = planModelAction(step.action)
    if (plan.kind === 'unsupported') { problems.push(`${position}: ${plan.reason}`); return }
    const selector = 'selector' in step.action ? step.action.selector : undefined
    if (selector !== undefined && !String(selector).trim()) problems.push(`${position}: пустой селектор`)
  })
  if (!scenario.steps.some((step) => step.expectText || step.expectAbsentText)) {
    problems.push('Ни одной проверки: сценарий пройдёт, даже если страница сломана')
  }
  return problems
}

/**
 * Проверка набора целиком — то, чего не видит поштучная `scenarioProblems`.
 * Имя в наборе не украшение: по нему сценарии различают вердикт, лог,
 * переключатель настроек и сохранение записи. Без него два сценария неотличимы,
 * и один молча заменяет другой.
 */
export function scenarioSetProblems(scenarios: Array<{ name?: string; startUrl: string; steps: unknown[] }>): string[] {
  const problems: string[] = []
  if (!scenarios.length) return ['Ни одного сценария: этап Playwright запускать нечем']
  const named = scenarios.map((item, index) => ({ index, name: (item.name ?? '').trim() }))
  const unnamed = named.filter((item) => !item.name)
  if (unnamed.length && scenarios.length > 1) {
    problems.push(`Без названия: ${unnamed.length} из ${scenarios.length}. В наборе имя — единственный способ различить сценарии.`)
  }
  const seen = new Map<string, number>()
  for (const item of named) {
    if (!item.name) continue
    const before = seen.get(item.name)
    if (before !== undefined) problems.push(`Название «${item.name}» повторяется (сценарии ${before + 1} и ${item.index + 1})`)
    else seen.set(item.name, item.index)
  }
  scenarios.forEach((item, index) => {
    const label = (item.name ?? '').trim() || `Сценарий ${index + 1}`
    // Пустой сценарий раннер считает ненастроенным и блокирует им весь этап.
    if (!item.startUrl.trim()) problems.push(`«${label}»: не задан стартовый адрес — такой сценарий заблокирует весь этап`)
    else if (!item.steps.length) problems.push(`«${label}»: нет ни одного шага`)
  })
  return problems
}
