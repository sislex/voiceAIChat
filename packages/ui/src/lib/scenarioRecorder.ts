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

function nextStepId(steps: Pick<RecordedStep, 'id'>[]): string {
  const taken = new Set(steps.map(step => step.id))
  let index = steps.length + 1
  while (taken.has(`step-${index}`)) index++
  return `step-${index}`
}

const CLICK_VERB: Record<ClickKind, string> = { left: 'Нажать', right: 'Нажать правой кнопкой', double: 'Двойной клик' }

export function stepTitle(element: BrowserElementDescription, kind: 'click' | 'type', click: ClickKind = 'left'): string {
  const what = element.text ? `«${element.text.slice(0, 40)}»` : element.selector
  return kind === 'type' ? `Ввести в ${what}` : `${CLICK_VERB[click]} ${what}`
}

export function recordClick(steps: RecordedStep[], element: BrowserElementDescription, click: ClickKind = 'left', modifiers: Array<'shift' | 'ctrl' | 'alt' | 'meta'> = []): RecordedStep[] {
  return [...steps, {
    id: nextStepId(steps),
    title: stepTitle(element, 'click', click),
    action: {
      kind: 'click',
      selector: element.selector,
      ...(modifiers.length ? { modifiers } : {}),
      ...(element.frame ? { frame: [...element.frame] } : {}),
      ...(click === 'right' ? { button: 'right' as const } : {}),
      ...(click === 'double' ? { dblclick: true } : {})
    },
    stability: element.stability,
    ...(typeof element.matches === 'number' ? { matches: element.matches } : {})
  }]
}

/** Второй физический click панели завершает двойной клик. В записи он
 * заменяет первый шаг, иначе воспроизведение нажало бы трижды. */
export function recordPointerClick(steps: RecordedStep[], element: BrowserElementDescription, click: ClickKind, modifiers: Array<'shift' | 'ctrl' | 'alt' | 'meta'> = [], detail?: number): RecordedStep[] {
  const last = steps.at(-1)
  if (detail === 2 && click === 'left' && last?.action.kind === 'click' && !last.action.dblclick && !last.action.button && last.action.selector === element.selector && JSON.stringify(last.action.frame ?? []) === JSON.stringify(element.frame ?? []) && JSON.stringify(last.action.modifiers ?? []) === JSON.stringify(modifiers)) {
    return [...steps.slice(0, -1), { ...last, title: stepTitle(element, 'click', 'double'), action: { ...last.action, dblclick: true } }]
  }
  return recordClick(steps, element, click, modifiers)
}

/**
 * Прокрутка одним шагом, а не по одному на каждый щелчок колеса. Человек крутит
 * десяток раз подряд, и без слияния сценарий превратился бы в простыню
 * бессмысленных шагов.
 */
export function recordScroll(steps: RecordedStep[], deltaY: number, deltaX = 0): RecordedStep[] {
  const last = steps.at(-1)
  const title = (x: number, y: number) => x ? `Прокрутить: x ${x}, y ${y} px` : `Прокрутить на ${y} px`
  if (last && !last.expectText && !last.expectAbsentText && last.action.kind === 'scroll' && !last.action.selector && last.action.frame === undefined && last.action.to === undefined && (typeof last.action.dy === 'number' || typeof last.action.dx === 'number')) {
    const dy = (last.action.dy ?? 0) + deltaY, dx = (last.action.dx ?? 0) + deltaX
    if (dy === 0 && dx === 0) return steps.slice(0, -1)
    return [...steps.slice(0, -1), { ...last, title: title(dx, dy), action: { kind: 'scroll', dy, ...(dx ? { dx } : {}) } }]
  }
  if (deltaY === 0 && deltaX === 0) return steps
  return [...steps, {
    id: nextStepId(steps), title: title(deltaX, deltaY),
    action: { kind: 'scroll', dy: deltaY, ...(deltaX ? { dx: deltaX } : {}) }, stability: 'id'
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
  return expectOnStep(steps, steps.at(-1)?.id ?? '', text, absent)
}

/**
 * Ожидание на конкретном шаге. Раньше проверку можно было повесить только на
 * последний: понял на середине записи, что нужна проверка, — переписывай
 * сценарий целиком.
 */
export function expectOnStep(steps: RecordedStep[], id: string, text: string, absent = false): RecordedStep[] {
  const value = text.trim()
  if (!steps.length || !value || !steps.some((step) => step.id === id)) return steps
  const key = absent ? 'expectAbsentText' : 'expectText'
  return steps.map((step) => (step.id === id ? { ...step, [key]: value } : step))
}

/** Убрать шаг: промах мышью не должен стоить всей записи. */
export function removeStep(steps: RecordedStep[], id: string): RecordedStep[] {
  // Результаты прогона и выбранное ожидание ссылаются на id: удаление соседа
  // не должно переносить их на другой шаг.
  return steps.filter((step) => step.id !== id)
}

/** Есть ли в сценарии хоть одна проверка — иначе прогон ничего не докажет. */
export function hasAssertions(steps: RecordedStep[]): boolean {
  return steps.some((step) => Boolean(step.expectText || step.expectAbsentText))
}

/** Шаги с неоднозначным селектором: кликнут по первому из нескольких. */
export function ambiguousSteps(steps: RecordedStep[]): RecordedStep[] {
  return steps.filter((step) => typeof step.matches === 'number' && step.matches > 1)
}

/**
 * Шаги, чей селектор не находит **ничего**. Такое бывает, когда построенный
 * селектор невалиден (страница отдала `matches: 0`): шаг заведомо упадёт, а
 * предупреждение до круга 19 было только про «нашлось несколько».
 */
export function brokenSteps(steps: RecordedStep[]): RecordedStep[] {
  return steps.filter((step) => step.matches === 0)
}

export function recordType(steps: RecordedStep[], element: BrowserElementDescription, text: string): RecordedStep[] {
  return [...steps, {
    id: nextStepId(steps),
    title: stepTitle(element, 'type'),
    action: { kind: 'type', selector: element.selector, text, ...(element.frame ? { frame: [...element.frame] } : {}) },
    stability: element.stability,
    ...(typeof element.matches === 'number' ? { matches: element.matches } : {})
  }]
}

export function recordNavigate(steps: RecordedStep[], url: string): RecordedStep[] {
  return [...steps, {
    id: nextStepId(steps),
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
  const opensFirst = first?.action.kind === 'open' && first.action.frame === undefined
  const startUrl = opensFirst && first.action.kind === 'open' ? first.action.url : currentUrl
  // Первое ожидание тоже проверка. Навигация уже выполнена через startUrl,
  // поэтому оставляем её проверку отдельным ожиданием загрузки документа.
  const rest = opensFirst
    ? first.expectText || first.expectAbsentText
      ? [{ ...first, action: { kind: 'wait' as const, loadState: 'domcontentloaded' as const } }, ...steps.slice(1)]
      : steps.slice(1)
    : steps
  return {
    startUrl,
    // Идентификатор сохраняется, а не назначается заново: перенумерация здесь
    // разводила записанный шаг и сценарный, и «прогнать до этого шага» целился
    // не туда. Уникальность обеспечивает сама запись.
    steps: rest.map((step) => ({
      id: step.id,
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

/**
 * Куда положить записанный сценарий: заменить одноимённый или добавить в конец.
 *
 * Сравнение по имени работает, только если имя есть. У двух безымянных оно
 * совпадает, и второй молча заменял первый — записал два теста, остался один.
 * Безымянный поэтому всегда добавляется и получает имя по порядку.
 */
export function placeScenario(
  current: AutomatedQaScenario[],
  scenario: AutomatedQaScenario
): AutomatedQaScenario[] {
  const name = (scenario.name ?? '').trim()
  if (!name) {
    // Имя подбирается свободное, а не по длине набора: «Сценарий 2» мог уже быть
    // занят вручную, и сгенерированное имя создавало ровно тот дубль, ради
    // устранения которого эта функция и появилась.
    const taken = new Set(current.map((item) => (item.name ?? '').trim()))
    let index = current.length + 1
    while (taken.has(`Сценарий ${index}`)) index++
    return [...current, { ...scenario, name: `Сценарий ${index}` }]
  }
  const at = current.findIndex((item) => (item.name ?? '').trim() === name)
  const normalized = { ...scenario, name }
  return at >= 0 ? current.map((item, index) => (index === at ? normalized : item)) : [...current, normalized]
}

/** Загрузка сохраняет id шагов и подбирает свободный id стартовому переходу. */
export function loadScenario(scenario: AutomatedQaScenario): RecordedStep[] {
  const steps: RecordedStep[] = []
  for (const step of scenario.steps) {
    const id = step.id && !steps.some(item => item.id === step.id) ? step.id : nextStepId([...steps, ...scenario.steps])
    steps.push({ ...step, id, stability: 'testid' })
  }
  if (!scenario.startUrl) return steps
  const initial = recordNavigate(steps, scenario.startUrl).at(-1)!
  return [initial, ...steps]
}
