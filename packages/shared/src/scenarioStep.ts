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
  if (/Timeout|timeout|не найден|not found|strict mode/i.test(detail)) {
    return 'Возможно, элемент ещё не появился — добавьте ожидаемый текст к предыдущему шагу или уточните селектор.'
  }
  return ''
}

export async function runScenarioStep(step: AutomatedQaScenarioStep, send: ScenarioSend): Promise<ScenarioStepOutcome> {
  const plan = planModelAction(step.action)
  if (plan.kind === 'unsupported') return { ok: false, detail: plan.reason, unsupported: true }
  let response: unknown
  try { response = await send(plan.command) } catch (error) { return { ok: false, detail: firstLine(error) } }
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
    return { ok: false, detail: `Текст страницы не прочитан: ${firstLine(error)}` }
  }
  if (step.expectText && !pageText.includes(step.expectText)) return { ok: false, detail: `На странице нет ожидаемого текста «${step.expectText}»` }
  if (step.expectAbsentText && pageText.includes(step.expectAbsentText)) return { ok: false, detail: `На странице найден недопустимый текст «${step.expectAbsentText}»` }
  return { ok: true, detail: '' }
}
