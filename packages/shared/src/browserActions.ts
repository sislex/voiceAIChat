// Перевод действия в команду изолированного Chromium.
//
// Живёт в shared, потому что нужен трём сторонам: этапу Automated QA на сервере,
// панели Playwright Reader и пробе `scripts/reader-probe.mjs`. Пока перевод
// лежал в `apps/server`, проба разбирала шаги своим кодом — и отстала: круг 15
// научил записывать прокрутку, этап её исполнял, а проба отвечала «действие не
// исполняет». Один сценарий обязан исполняться одинаково везде.
//
// Изначальное назначение — мост между инструментами модели и Chromium:
//
// Инструменты `mcp__browser__*` описаны в терминах `PreviewAction` (селекторы и
// текст) и по умолчанию исполняются в браузере пользователя через
// PreviewActionRelay. Для разговоров `playwright-reader` страница живёт не у
// пользователя, а в Chromium раннера, поэтому те же действия переводятся в
// `BrowserCommand` и выполняются сервером. Без этого моста модель Playwright
// Reader не видела вовсе: до неё доходил только пользовательский REST-путь.

import type { PreviewAction } from './previewActions'
import type { BrowserCommand } from './types'

/** Вьюпорт раннера по умолчанию: модель просит только ширину. */
const DEFAULT_VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 }

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
    case 'console':
      return {
        kind: 'command',
        command: {
          type: 'inspect',
          action: {
            kind: 'console',
            ...(action.level ? { level: action.level } : {}),
            ...(action.pattern ? { pattern: action.pattern } : {}),
            ...(typeof action.limit === 'number' ? { limit: action.limit } : {}),
            ...(action.clear ? { clear: true } : {})
          }
        }
      }
    case 'errors':
      // «Ошибки страницы» — тот же журнал консоли, отфильтрованный по уровню.
      return { kind: 'command', command: { type: 'inspect', action: { kind: 'console', level: 'error', ...(action.clear ? { clear: true } : {}) } } }
    case 'network':
      return {
        kind: 'command',
        command: {
          type: 'inspect',
          action: {
            kind: 'network',
            ...(action.filter ? { filter: action.filter } : {}),
            ...(typeof action.limit === 'number' ? { limit: action.limit } : {}),
            ...(action.clear ? { clear: true } : {})
          }
        }
      }
    case 'styles':
      return {
        kind: 'command',
        command: { type: 'inspect', action: { kind: 'styles', selector: action.selector, ...(action.properties ? { properties: action.properties } : {}) } }
      }
    case 'evaluate':
      // Гейт политики и подтверждение опасного кода стоят выше, на самом
      // MCP-инструменте, — до выбора транспорта. Здесь дублировать нечего.
      return { kind: 'command', command: { type: 'inspect', action: { kind: 'evaluate', code: action.code } } }
    case 'hover':
      return {
        kind: 'command',
        command: { type: 'selector', action: { kind: 'hover', ...(action.selector ? { selector: action.selector } : {}), ...(action.text ? { text: action.text } : {}) } }
      }
    case 'set':
      return {
        kind: 'command',
        command: {
          type: 'selector',
          action: { kind: 'set', selector: action.selector, ...(typeof action.value === 'string' ? { value: action.value } : {}), ...(typeof action.checked === 'boolean' ? { checked: action.checked } : {}) }
        }
      }
    case 'a11y':
      return {
        kind: 'command',
        command: { type: 'selector', action: { kind: 'a11y', ...(action.selector ? { selector: action.selector } : {}), ...(typeof action.limit === 'number' ? { limit: action.limit } : {}) } }
      }
    case 'viewport':
      // У раннера свой вьюпорт: ширину задаёт resize, высоту держим прежней —
      // модель просит именно ширину, как в превью.
      return { kind: 'command', command: { type: 'resize', viewport: { ...DEFAULT_VIEWPORT, width: Math.max(320, Math.min(action.width || DEFAULT_VIEWPORT.width, 2560)) } } }
    case 'drag': {
      // Раннер тянет локатор к локатору; координатное перетаскивание у него не
      // выражается, и подменять его «примерно тем же» хуже, чем отказать.
      const from = action.from.selector, to = action.to.selector
      if (!from || !to) return { kind: 'unsupported', reason: 'Перетаскивание в изолированном Chromium задаётся селекторами: укажи from.selector и to.selector, координаты здесь не применимы.' }
      return { kind: 'command', command: { type: 'selector', action: { kind: 'drag', from, to } } }
    }
    case 'screenshot':
      // Снимок отдаётся картинкой и обрабатывается инструментом отдельно —
      // сюда попадать не должен.
      return { kind: 'unsupported', reason: 'Снимок запрашивается инструментом screenshot напрямую.' }
    case 'edits':
      return { kind: 'unsupported', reason: 'Правки edit-режима копит прокси веб-превью; у изолированного Chromium этого режима нет вовсе, поэтому и сохранённых правок быть не может.' }
    case 'upload':
      return {
        kind: 'command',
        command: { type: 'selector', action: { kind: 'upload', selector: action.selector, name: action.name, base64: action.base64, ...(action.mimeType ? { mimeType: action.mimeType } : {}) } }
      }
    default:
      return { kind: 'unsupported', reason: `Действие «${(action as { kind: string }).kind}» в Playwright Reader пока не поддерживается.` }
  }
}
