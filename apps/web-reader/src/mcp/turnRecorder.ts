import { randomUUID } from 'node:crypto'
import type { AutomatedQaScenario, AutomatedQaScenarioStep } from '@voicechat/shared'
import type { PreviewAction } from '@voicechat/shared'

/**
 * Запись сценария со стороны модели.
 *
 * Человек в панели записывает свой проход и получает воспроизводимые шаги —
 * ради этого Reader и делается инструментом автотестов. У модели такого не было:
 * она проходила путь ровно так же, но на выходе оставался только текст хода, из
 * которого сценарий никто не восстановит. А проходит его чаще всего именно
 * модель — в задаче канбана, где потом нужен повторяемый автотест.
 *
 * Запись живёт здесь, а не в раннере, потому что здесь известно исходное
 * действие модели (`PreviewAction`), а до раннера доезжает уже команда Chromium,
 * из которой селекторный шаг обратно не собрать.
 */

/** Сколько шагов держим: длиннее сценарий всё равно не воспроизводят. */
const MAX_STEPS = 100
/** Сколько записей держим в памяти процесса — по одной на разговор. */
const MAX_SESSIONS = 50

interface Recording {
  name?: string
  startUrl: string
  steps: AutomatedQaScenarioStep[]
  startedAt: number
  /** Сколько действий пропущено из-за потолка: молчать об этом нельзя. */
  dropped: number
}

const recordings = new Map<string, Recording>()

/** Чтение страницы шагом сценария не является: прогонять его нечего. */
const QUIET = new Set([
  'read', 'find', 'a11y', 'accessibility', 'audit', 'probe', 'errors', 'console', 'network',
  'styles', 'edits', 'screenshot', 'metrics', 'measure', 'count', 'table', 'list', 'csv',
  'source', 'formState', 'validity', 'options', 'focusOrder', 'copy', 'media', 'history', 'note'
])

export function startRecording(key: string, startUrl: string, name?: string): void {
  // Разговоров много, а процесс один: старые записи вытесняются, иначе память
  // растёт молча и навсегда.
  if (recordings.size >= MAX_SESSIONS && !recordings.has(key)) {
    const oldest = [...recordings.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt)[0]
    if (oldest) recordings.delete(oldest[0])
  }
  recordings.set(key, { startUrl, steps: [], startedAt: Date.now(), dropped: 0, ...(name ? { name } : {}) })
}

export function stopRecording(key: string): void {
  recordings.delete(key)
}

export function isRecording(key: string): boolean {
  return recordings.has(key)
}

/** Записать действие шагом. Возвращает false, если запись не идёт. */
export function recordAction(key: string, action: PreviewAction, title?: string): boolean {
  const recording = recordings.get(key)
  if (!recording) return false
  if (QUIET.has(action.kind)) return false
  if (recording.steps.length >= MAX_STEPS) { recording.dropped++; return false }
  if (action.kind === 'open' && !recording.startUrl) recording.startUrl = action.url
  recording.steps.push({ id: randomUUID().slice(0, 8), title: title ?? describeAction(action), action })
  return true
}

/**
 * Проверка прикрепляется к последнему шагу, а не становится своим шагом: в
 * сценарии «нажал — увидел» это одно событие, и прогон должен ждать текст
 * после действия, а не до следующего.
 */
export function recordExpectation(key: string, text: string, absent = false): boolean {
  const recording = recordings.get(key)
  const last = recording?.steps.at(-1)
  if (!recording || !last) return false
  if (absent) last.expectAbsentText = text
  else last.expectText = text
  return true
}

export function scenarioOf(key: string): (AutomatedQaScenario & { dropped?: number }) | null {
  const recording = recordings.get(key)
  if (!recording) return null
  return {
    ...(recording.name ? { name: recording.name } : {}),
    startUrl: recording.startUrl,
    steps: recording.steps,
    ...(recording.dropped ? { dropped: recording.dropped } : {})
  }
}

/** Человеческое имя шага: в отчёте прогона читают именно его. */
export function describeAction(action: PreviewAction): string {
  const target = 'selector' in action && action.selector ? action.selector : 'text' in action && action.text ? `«${action.text}»` : ''
  switch (action.kind) {
    case 'open': return `Открыть ${action.url}`
    case 'click': return `Нажать ${target || 'элемент'}`
    case 'type': return `Ввести текст в ${action.selector}`
    case 'fillForm': return `Заполнить форму (${action.fields.length} пол.)`
    case 'submit': return 'Отправить форму'
    case 'press': return `Нажать клавишу ${action.key}`
    case 'hotkey': return `Сочетание ${[...action.modifiers, action.key].join('+')}`
    case 'set': return `Выбрать значение в ${action.selector}`
    case 'hover': return `Навести на ${target || 'элемент'}`
    case 'scroll': return 'Прокрутить'
    case 'scrollUntil': return `Прокрутить до ${target || 'цели'}`
    case 'wait': return 'Дождаться готовности'
    case 'upload': return `Загрузить файл в ${action.selector}`
    case 'dropFile': return `Перетащить файлы в ${action.selector}`
    case 'drag': return 'Перетащить элемент'
    case 'back': return 'Назад по истории'
    case 'forward': return 'Вперёд по истории'
    case 'expect': return `Проверить страницу (${action.checks.length})`
    default: return action.kind
  }
}
