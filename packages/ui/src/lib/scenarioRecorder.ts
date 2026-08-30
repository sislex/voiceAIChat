// Запись действий человека в сценарий этапа Automated QA.
//
// Ради этого Reader и делался инструментом автотестов: человек проходит сценарий
// руками, а на выходе получается воспроизводимый набор шагов, а не описание «я
// потыкал и всё работает». Раньше сценарий набивался в настройках проекта по
// одному шагу вручную.
//
// Логика вынесена из компонента: она чистая и проверяется без DOM.

import type { AutomatedQaScenario, AutomatedQaScenarioStep } from '@shared/qa'
import type { BrowserElementDescription } from '@shared/types'

export interface RecordedStep extends AutomatedQaScenarioStep {
  /** Насколько надёжен селектор шага — показывается человеку при записи. */
  stability: BrowserElementDescription['stability']
  /** Сколько узлов отвечает селектору: больше одного — шаг кликнет по первому. */
  matches?: number
  /** Пауза перед этим шагом: длинная означает, что человек ждал страницу. */
  pauseMs?: number
}

/** Человеческое название шага: по тексту элемента, иначе по тегу и селектору. */
export type ClickKind = 'left' | 'right' | 'double'

const CLICK_VERB: Record<ClickKind, string> = { left: 'Нажать', right: 'Нажать правой кнопкой', double: 'Двойной клик' }

export function stepTitle(element: BrowserElementDescription, kind: 'click' | 'type', click: ClickKind = 'left'): string {
  const what = element.text ? `«${element.text.slice(0, 40)}»` : element.selector
  return kind === 'type' ? `Ввести в ${what}` : `${CLICK_VERB[click]} ${what}`
}

export function recordClick(steps: RecordedStep[], element: BrowserElementDescription, click: ClickKind = 'left'): RecordedStep[] {
  return [...steps, {
    id: `step-${steps.length + 1}`,
    title: stepTitle(element, 'click', click),
    action: {
      kind: 'click',
      selector: element.selector,
      ...(click === 'right' ? { button: 'right' as const } : {}),
      ...(click === 'double' ? { dblclick: true } : {})
    },
    stability: element.stability,
    ...(typeof element.matches === 'number' ? { matches: element.matches } : {})
  }]
}

/**
 * Прокрутка одним шагом, а не по одному на каждый щелчок колеса. Человек крутит
 * десяток раз подряд, и без слияния сценарий превратился бы в простыню
 * бессмысленных шагов.
 */
export function recordScroll(steps: RecordedStep[], deltaY: number): RecordedStep[] {
  const last = steps.at(-1)
  if (last && last.action.kind === 'scroll' && typeof last.action.dy === 'number') {
    const merged = last.action.dy + deltaY
    return steps.map((step, index) => (index === steps.length - 1
      ? { ...step, title: `Прокрутить на ${merged} px`, action: { kind: 'scroll' as const, dy: merged } }
      : step))
  }
  return [...steps, {
    id: `step-${steps.length + 1}`,
    title: `Прокрутить на ${deltaY} px`,
    action: { kind: 'scroll', dy: deltaY },
    stability: 'id'
  }]
}

/** Переименование шага: именно названия читаются в отчёте этапа. */
export function renameStep(steps: RecordedStep[], id: string, title: string): RecordedStep[] {
  const value = title.trim()
  if (!value) return steps
  return steps.map((step) => (step.id === id ? { ...step, title: value } : step))
}

/**
 * Долгая пауза перед действием почти всегда значит, что человек ждал страницу.
 * Сценарий без явного ожидания на этом месте будет мигать: раннер нажмёт
 * быстрее, чем появится элемент.
 */
export const SLOW_PAUSE_MS = 2500
export function needsWaitHint(steps: RecordedStep[]): boolean {
  return steps.some((step) => (step.pauseMs ?? 0) >= SLOW_PAUSE_MS && !step.expectText && !step.expectAbsentText)
}

/**
 * Ожидание на последнем шаге. Сценарий без единой проверки тестом не является:
 * он зелёный, пока клики попадают, даже если страница показала ошибку.
 */
export function expectOnLastStep(steps: RecordedStep[], text: string, absent = false): RecordedStep[] {
  if (!steps.length || !text.trim()) return steps
  const key = absent ? 'expectAbsentText' : 'expectText'
  return steps.map((step, index) => (index === steps.length - 1 ? { ...step, [key]: text.trim() } : step))
}

/** Убрать шаг: промах мышью не должен стоить всей записи. */
export function removeStep(steps: RecordedStep[], id: string): RecordedStep[] {
  return steps.filter((step) => step.id !== id).map((step, index) => ({ ...step, id: `step-${index + 1}` }))
}

/** Есть ли в сценарии хоть одна проверка — иначе прогон ничего не докажет. */
export function hasAssertions(steps: RecordedStep[]): boolean {
  return steps.some((step) => Boolean(step.expectText || step.expectAbsentText))
}

/** Шаги с неоднозначным селектором: кликнут по первому из нескольких. */
export function ambiguousSteps(steps: RecordedStep[]): RecordedStep[] {
  return steps.filter((step) => typeof step.matches === 'number' && step.matches > 1)
}

export function recordType(steps: RecordedStep[], element: BrowserElementDescription, text: string): RecordedStep[] {
  return [...steps, {
    id: `step-${steps.length + 1}`,
    title: stepTitle(element, 'type'),
    action: { kind: 'type', selector: element.selector, text },
    stability: element.stability,
    ...(typeof element.matches === 'number' ? { matches: element.matches } : {})
  }]
}

export function recordNavigate(steps: RecordedStep[], url: string): RecordedStep[] {
  return [...steps, {
    id: `step-${steps.length + 1}`,
    title: `Открыть ${url}`,
    action: { kind: 'open', url },
    stability: 'id'
  }]
}

/**
 * Готовый сценарий для настроек проекта. Стартовый адрес берётся из первого
 * шага-перехода, а сам этот шаг из списка убирается: у сценария есть отдельное
 * поле `startUrl`, и дублировать его шагом — значит открывать страницу дважды.
 */
export function toScenario(steps: RecordedStep[], currentUrl: string): AutomatedQaScenario {
  const first = steps[0]
  const opensFirst = first?.action.kind === 'open'
  const startUrl = opensFirst && first.action.kind === 'open' ? first.action.url : currentUrl
  const rest = opensFirst ? steps.slice(1) : steps
  return {
    startUrl,
    steps: rest.map((step, index) => ({
      id: `step-${index + 1}`,
      title: step.title,
      action: step.action,
      // `pauseMs`, `stability` и `matches` в сценарий не уезжают: они нужны при
      // записи, а этапу важно только что делать и чего ждать.
      ...(step.expectText ? { expectText: step.expectText } : {}),
      ...(step.expectAbsentText ? { expectAbsentText: step.expectAbsentText } : {})
    }))
  }
}

/** Сколько шагов опирается на ненадёжный селектор — предупреждение при записи. */
export function fragileSteps(steps: RecordedStep[]): RecordedStep[] {
  return steps.filter((step) => step.stability === 'path')
}
