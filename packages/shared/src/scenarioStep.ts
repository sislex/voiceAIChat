// Исполнение шага сценария Automated QA — один код на всех.
//
// До круга 17 шаг исполняли две реализации: этап на сервере (через
// `planModelAction`, весь словарь действий) и проба `scripts/reader-probe.mjs`
// (вручную, только click/type/wait). Расхождение уже случилось — круг 15 научил
// записывать прокрутку, и проба перестала понимать записанное. Здесь общая
// часть: перевод шага в команды и разбор ожиданий. Транспорт остаётся снаружи —
// у сервера это HTTP к раннеру, у пробы тот же HTTP, у панели мост `window`.

import type { AutomatedQaScenarioStep } from './qa'
import type { BrowserCommand, BrowserSelectorResult } from './types'
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
/**
 * Сколько текста страницы читать под проверку. Раннер по умолчанию отдаёт 4000
 * символов — этого хватает модели, которой текст идёт в контекст, но не
 * проверке: измерено на собственной странице настроек (5807 символов), где
 * ожидаемый текст стоял на позиции 4488 и шаг проваливался словами «на странице
 * нет ожидаемого текста». Ложный провал этапа возвращает задачу в разработку
 * из-за дефекта, которого нет. Берём потолок раннера.
 */
const EXPECT_READ_LIMIT = 20_000

export async function runScenarioStep(
  step: AutomatedQaScenarioStep,
  send: ScenarioSend,
  options: ScenarioStepOptions = {}
): Promise<ScenarioStepOutcome> {
  const plan = planModelAction(step.action)
  if (plan.kind === 'unsupported') return { ok: false, detail: plan.reason, unsupported: true, unverifiable: true, failure: 'action' }
  let response: unknown
  try { response = await send(plan.command) } catch (error) { return { ok: false, detail: firstLine(error), failure: 'action' } }
  const selector = response as BrowserSelectorResult | null
  if (selector && typeof selector === 'object' && 'ok' in selector && selector.ok === false) {
    return { ok: false, detail: selector.error ?? 'Действие не выполнено', failure: 'action' }
  }
  if (!step.expectText && !step.expectAbsentText) return { ok: true, detail: '' }

  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  const deadline = now() + (options.expectTimeoutMs ?? DEFAULT_EXPECT_TIMEOUT_MS)
  let pageText = ''
  let truncated = false
  for (;;) {
    try {
      const read = await send({ type: 'selector', action: { kind: 'read', limit: EXPECT_READ_LIMIT } }) as BrowserSelectorResult
      pageText = typeof read?.text === 'string' ? read.text : ''
      truncated = read?.truncated === true
    } catch (error) {
      return { ok: false, detail: `Текст страницы не прочитан: ${firstLine(error)}`, failure: 'expectation' }
    }
    const missing = step.expectText ? !pageText.includes(step.expectText) : false
    const present = step.expectAbsentText ? pageText.includes(step.expectAbsentText) : false
    if (!missing && !present) return { ok: true, detail: '' }
    if (now() >= deadline) {
      // Показываем, что на странице всё-таки есть: «нет текста X» без этого не
      // объясняет, куда смотреть.
      const seen = pageText.trim().slice(0, 200)
      // Обрезанное чтение не даёт права утверждать, что текста нет: до него
      // просто не дочитали. Обратная проверка («текста быть не должно») от
      // обрезки не страдает — найденное найдено.
      const what = missing
        ? truncated
          ? `Текст страницы прочитан не целиком (первые ${EXPECT_READ_LIMIT} символов), ожидаемого текста «${step.expectText}» в этой части нет`
          : `На странице нет ожидаемого текста «${step.expectText}»`
        : `На странице найден недопустимый текст «${step.expectAbsentText}»`
      return { ok: false, detail: seen ? `${what}. Видно: ${seen}` : what, failure: 'expectation', ...(missing && truncated ? { unverifiable: true } : {}) }
    }
    await sleep(options.pollMs ?? DEFAULT_POLL_MS)
  }
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
