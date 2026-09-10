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

import { isBrowserFramePath } from './browserFrames'
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
  if (action.frame !== undefined) {
    if (!isBrowserFramePath(action.frame)) return { kind: 'unsupported', reason: 'frame: нужен селектор iframe или цепочка из 1–8 селекторов.' }
    const { frame, ...unscoped } = action
    const plan = planModelAction(unscoped)
    if (plan.kind === 'command' && (plan.command.type === 'navigate' || plan.command.type === 'selector' || (plan.command.type === 'inspect' && ['evaluate', 'styles'].includes(plan.command.action.kind)))) {
      return { kind: 'command', command: { ...plan.command, frame } }
    }
    return { kind: 'unsupported', reason: 'Это действие не поддерживает frame. Для press укажи selector, для drag — два селектора; координаты относятся к всей странице.' }
  }
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
            ...(action.dblclick ? { clickCount: 2 as const } : {}),
            ...(action.modifiers?.length ? { modifiers: action.modifiers.map((value) => ({ shift: 'Shift', ctrl: 'Control', alt: 'Alt', meta: 'Meta' } as const)[value]) } : {})
          }
        }
      }
    case 'type':
      return {
        kind: 'command',
        command: { type: 'selector', action: { kind: 'type', selector: action.selector, text: action.text, ...(action.submit ? { submit: true } : {}) } }
      }
    case 'read':
      return { kind: 'command', command: { type: 'selector', action: { kind: 'read', ...(action.selector ? { selector: action.selector } : {}), ...(action.limit !== undefined ? { limit: action.limit } : {}), ...(action.offset !== undefined ? { offset: action.offset } : {}) } } }
    case 'find':
      return {
        kind: 'command',
        command: {
          type: 'selector',
          action: { kind: 'find', ...(action.selector ? { selector: action.selector } : {}), ...(action.text ? { text: action.text } : {}), ...(typeof action.limit === 'number' ? { limit: action.limit } : {}), ...(action.visibleOnly !== undefined ? { visibleOnly: action.visibleOnly } : {}) }
        }
      }
    case 'wait': {
      const { diagnostic: _diagnostic, ...wait } = action
      return { kind: 'command', command: { type: 'selector', action: wait } }
    }
    case 'scroll': {
      // Контейнер и край страницы нельзя выразить фиксированным шагом колеса.
      return { kind: 'command', command: { type: 'selector', action: { kind: 'scroll', ...(action.selector ? { selector: action.selector } : {}), ...(action.to ? { to: action.to } : {}), ...(action.dy !== undefined ? { dy: action.dy } : {}), ...(action.dx !== undefined ? { dx: action.dx } : {}) } } }
    }
    case 'press':
      return action.selector
        ? { kind: 'command', command: { type: 'selector', action: { kind: 'press', selector: action.selector, key: action.key } } }
        : { kind: 'command', command: { type: 'input', action: { type: 'press', key: action.key } } }
    case 'console': {
      const { kind: _kind, diagnostic: _diagnostic, frame: _frame, ...options } = action
      return { kind: 'command', command: { type: 'inspect', action: { kind: 'console', ...options, regex: false } } }
    }
    case 'errors':
      return { kind: 'command', command: { type: 'inspect', action: { kind: 'console', level: 'error', ...(action.clear ? { clear: true } : {}) } } }
    case 'network': {
      const { kind: _kind, diagnostic: _diagnostic, frame: _frame, ...options } = action
      return { kind: 'command', command: { type: 'inspect', action: { kind: 'network', ...options } } }
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
      // Высота уже выбрана человеком или предыдущей командой; меняется только ширина.
      return { kind: 'command', command: { type: 'resize', viewport: { width: Math.max(320, Math.min(action.width || DEFAULT_VIEWPORT.width, 2560)) } } }
    case 'drag': {
      const from = action.from.selector, to = action.to.selector
      if (from && to) return { kind: 'command', command: { type: 'selector', action: { kind: 'drag', from, to } } }
      const { x: x1, y: y1 } = action.from, { x: x2, y: y2 } = action.to
      if (!from && !to && [x1, y1, x2, y2].every((value) => typeof value === 'number' && Number.isFinite(value))) {
        return { kind: 'command', command: { type: 'input', action: { type: 'drag', from: { x: x1!, y: y1! }, to: { x: x2!, y: y2! } } } }
      }
      return { kind: 'unsupported', reason: 'Укажи оба края перетаскивания селекторами или оба координатами x/y.' }
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
