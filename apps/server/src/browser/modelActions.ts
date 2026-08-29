// Мост между инструментами модели и изолированным Chromium.
//
// Инструменты `mcp__browser__*` описаны в терминах `PreviewAction` (селекторы и
// текст) и по умолчанию исполняются в браузере пользователя через
// PreviewActionRelay. Для разговоров `playwright-reader` страница живёт не у
// пользователя, а в Chromium раннера, поэтому те же действия переводятся в
// `BrowserCommand` и выполняются сервером. Без этого моста модель Playwright
// Reader не видела вовсе: до неё доходил только пользовательский REST-путь.

import type { PreviewAction } from '@voicechat/shared'
import type { BrowserCommand } from '@voicechat/shared'

/** Действие модели, переведённое в команду раннера, либо причина, почему нельзя. */
export type ModelActionPlan =
  | { kind: 'command'; command: BrowserCommand }
  | { kind: 'unsupported'; reason: string }

/**
 * Перевод действия. Селекторные действия ложатся на команду `selector`,
 * навигация и прокрутка — на существующие. Остальное честно отклоняется: лучше
 * сказать модели «здесь этого нет», чем молча выполнить не то.
 */
export function planModelAction(action: PreviewAction): ModelActionPlan {
  switch (action.kind) {
    case 'open':
      return { kind: 'command', command: { type: 'navigate', url: action.url } }
    case 'back':
      return { kind: 'command', command: { type: 'back' } }
    case 'forward':
      return { kind: 'command', command: { type: 'forward' } }
    case 'click':
      return {
        kind: 'command',
        command: {
          type: 'selector',
          action: {
            kind: 'click',
            ...(action.selector ? { selector: action.selector } : {}),
            ...(action.text ? { text: action.text } : {}),
            ...(action.button === 'right' ? { button: 'right' as const } : {}),
            ...(action.dblclick ? { clickCount: 2 as const } : {})
          }
        }
      }
    case 'type':
      return {
        kind: 'command',
        command: { type: 'selector', action: { kind: 'type', selector: action.selector, text: action.text, ...(action.submit ? { submit: true } : {}) } }
      }
    case 'read':
      return { kind: 'command', command: { type: 'selector', action: { kind: 'read', ...(action.selector ? { selector: action.selector } : {}) } } }
    case 'find':
      return {
        kind: 'command',
        command: {
          type: 'selector',
          action: { kind: 'find', ...(action.selector ? { selector: action.selector } : {}), ...(action.text ? { text: action.text } : {}), ...(typeof action.limit === 'number' ? { limit: action.limit } : {}) }
        }
      }
    case 'wait':
      return {
        kind: 'command',
        command: {
          type: 'selector',
          action: { kind: 'wait', ...(action.selector ? { selector: action.selector } : {}), ...(action.text ? { text: action.text } : {}), ...(typeof action.timeoutMs === 'number' ? { timeoutMs: action.timeoutMs } : {}) }
        }
      }
    case 'scroll': {
      // У раннера прокрутка колесом; `to: top|bottom` переводим в крупный шаг.
      const dy = action.to === 'top' ? -10_000 : action.to === 'bottom' ? 10_000 : action.dy ?? 400
      return { kind: 'command', command: { type: 'input', action: { type: 'wheel', deltaX: 0, deltaY: dy } } }
    }
    case 'press':
      return { kind: 'command', command: { type: 'input', action: { type: 'press', key: action.key } } }
    default:
      return { kind: 'unsupported', reason: `Действие «${action.kind}» в Playwright Reader пока не поддерживается: страница живёт в изолированном Chromium, а не в превью пользователя.` }
  }
}
