import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserId } from './browserId'
import {
  PREVIEW_ACTION_COMMAND_TYPE,
  PREVIEW_ACTION_LIMITS,
  PREVIEW_ACTION_RESULT_TYPE,
  isHttpUrl,
  isPreviewAction,
  isPreviewActionCommand,
  isPreviewActionResultMessage,
  isPreviewDomAction,
  previewResultJson,
  previewToolHint
} from './previewActions'

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')

afterEach(() => {
  vi.restoreAllMocks()
  if (originalCryptoDescriptor) Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor)
  else delete (globalThis as { crypto?: Crypto }).crypto
})

describe('browserId', () => {
  it('prefers native randomUUID', () => {
    const randomUUID = vi.fn(() => 'native-id')
    const getRandomValues = vi.fn()
    vi.stubGlobal('crypto', { randomUUID, getRandomValues })
    expect(browserId()).toBe('native-id')
    expect(randomUUID).toHaveBeenCalledOnce()
    expect(getRandomValues).not.toHaveBeenCalled()
  })

  it('creates a UUID-compatible value with getRandomValues', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => { bytes.fill(7); return bytes })
    vi.stubGlobal('crypto', { getRandomValues })
    expect(browserId()).toBe('07070707-0707-4707-8707-070707070707')
    expect(getRandomValues).toHaveBeenCalledOnce()
  })

  it('stays non-empty and unique without Web Crypto in the same millisecond', () => {
    vi.stubGlobal('crypto', undefined)
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const ids = [browserId(), browserId(), browserId()]
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids)).toHaveLength(ids.length)
  })
})

describe('isPreviewAction', () => {
  it('принимает все виды действий', () => {
    expect(isPreviewAction({ kind: 'open', url: 'https://example.com' })).toBe(true)
    expect(isPreviewAction({ kind: 'find', text: 'Электроника' })).toBe(true)
    expect(isPreviewAction({ kind: 'find', selector: 'nav a', limit: 5 })).toBe(true)
    expect(isPreviewAction({ kind: 'click', text: 'Электроника' })).toBe(true)
    expect(isPreviewAction({ kind: 'type', selector: '#q', text: 'ноутбук', submit: true })).toBe(true)
    expect(isPreviewAction({ kind: 'read' })).toBe(true)
    expect(isPreviewAction({ kind: 'read', selector: 'main' })).toBe(true)
  })

  it('отклоняет не-HTTP url и мусор', () => {
    expect(isPreviewAction({ kind: 'open', url: 'javascript:alert(1)' })).toBe(false)
    expect(isPreviewAction({ kind: 'open', url: 'file:///etc/passwd' })).toBe(false)
    expect(isPreviewAction({ kind: 'open', url: 'не url' })).toBe(false)
    expect(isPreviewAction({ kind: 'scroll' })).toBe(false)
    expect(isPreviewAction(null)).toBe(false)
    expect(isPreviewAction('open')).toBe(false)
  })

  it('find и click требуют text или selector', () => {
    expect(isPreviewAction({ kind: 'find' })).toBe(false)
    expect(isPreviewAction({ kind: 'click' })).toBe(false)
  })

  it('режет строки сверх лимита', () => {
    const long = 'x'.repeat(PREVIEW_ACTION_LIMITS.selector + 1)
    expect(isPreviewAction({ kind: 'read', selector: long })).toBe(false)
    expect(isPreviewAction({ kind: 'type', selector: '#q', text: 'y'.repeat(PREVIEW_ACTION_LIMITS.text + 1) })).toBe(false)
  })

  it('isPreviewDomAction не пускает open в iframe', () => {
    expect(isPreviewDomAction({ kind: 'open', url: 'https://example.com' })).toBe(false)
    expect(isPreviewDomAction({ kind: 'read' })).toBe(true)
  })
})

describe('isHttpUrl', () => {
  it('только http/https', () => {
    expect(isHttpUrl('http://a.b')).toBe(true)
    expect(isHttpUrl('https://a.b/path?x=1')).toBe(true)
    expect(isHttpUrl('ftp://a.b')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
  })
})

describe('конверты команд и результатов', () => {
  it('команда: тип, requestId и DOM-действие', () => {
    expect(
      isPreviewActionCommand({ type: PREVIEW_ACTION_COMMAND_TYPE, requestId: 'r1', action: { kind: 'read' } })
    ).toBe(true)
    expect(
      isPreviewActionCommand({ type: PREVIEW_ACTION_COMMAND_TYPE, requestId: 'r1', action: { kind: 'open', url: 'https://a.b' } })
    ).toBe(false)
    expect(isPreviewActionCommand({ type: 'other', requestId: 'r1', action: { kind: 'read' } })).toBe(false)
  })

  it('результат: ok/ошибка и кап размера', () => {
    expect(
      isPreviewActionResultMessage({ type: PREVIEW_ACTION_RESULT_TYPE, requestId: 'r1', ok: true, result: { url: 'https://a.b' } })
    ).toBe(true)
    expect(
      isPreviewActionResultMessage({ type: PREVIEW_ACTION_RESULT_TYPE, requestId: 'r1', ok: false, error: 'элемент не найден' })
    ).toBe(true)
    expect(isPreviewActionResultMessage({ type: PREVIEW_ACTION_RESULT_TYPE, requestId: 'r1', ok: 'да' })).toBe(false)
    const fat = { page: { url: 'https://a.b', title: '' }, text: 'x'.repeat(PREVIEW_ACTION_LIMITS.resultJson) }
    expect(isPreviewActionResultMessage({ type: PREVIEW_ACTION_RESULT_TYPE, requestId: 'r1', ok: true, result: fat })).toBe(false)
  })
})

describe('previewResultJson', () => {
  it('возвращает JSON в пределах капа и null сверх него', () => {
    expect(previewResultJson({ url: 'https://a.b' })).toBe('{"url":"https://a.b"}')
    expect(
      previewResultJson({
        page: { url: 'https://a.b', title: '' },
        headings: [],
        links: [],
        buttons: [],
        inputs: [],
        text: 'x'.repeat(PREVIEW_ACTION_LIMITS.resultJson)
      })
    ).toBeNull()
  })
})

describe('previewToolHint', () => {
  it('называет инструменты и ограничение активной страницей', () => {
    const hint = previewToolHint()
    for (const tool of ['open', 'read', 'find', 'click', 'type']) expect(hint).toContain(tool)
    expect(hint).toContain('mcp__browser__')
    expect(hint).toContain('активного чата')
  })
})

describe('isPreviewAction: hover, scroll, press', () => {
  it('hover требует text или selector', () => {
    expect(isPreviewAction({ kind: 'hover', text: 'Меню' })).toBe(true)
    expect(isPreviewAction({ kind: 'hover', selector: '.menu' })).toBe(true)
    expect(isPreviewAction({ kind: 'hover' })).toBe(false)
  })

  it('scroll требует to или dy и валидирует значения', () => {
    expect(isPreviewAction({ kind: 'scroll', to: 'bottom' })).toBe(true)
    expect(isPreviewAction({ kind: 'scroll', dy: -300, selector: '.feed' })).toBe(true)
    expect(isPreviewAction({ kind: 'scroll' })).toBe(false)
    expect(isPreviewAction({ kind: 'scroll', to: 'middle' })).toBe(false)
    expect(isPreviewAction({ kind: 'scroll', dy: Number.NaN })).toBe(false)
  })

  it('press требует непустой key разумной длины', () => {
    expect(isPreviewAction({ kind: 'press', key: 'Escape' })).toBe(true)
    expect(isPreviewAction({ kind: 'press', key: 'Enter', selector: '#q' })).toBe(true)
    expect(isPreviewAction({ kind: 'press', key: '' })).toBe(false)
    expect(isPreviewAction({ kind: 'press', key: 'x'.repeat(40) })).toBe(false)
  })
})

describe('isPreviewAction: screenshot и кап результата снимка', () => {
  it('screenshot допускает selector, явный rect или пустые аргументы', () => {
    expect(isPreviewAction({ kind: 'screenshot' })).toBe(true)
    expect(isPreviewAction({ kind: 'screenshot', selector: '#hero' })).toBe(true)
    expect(isPreviewAction({ kind: 'screenshot', rect: { x: 10, y: 20, width: 300, height: 200 } })).toBe(true)
    expect(isPreviewAction({ kind: 'screenshot', rect: { x: 0, y: 0, width: 0, height: 10 } })).toBe(false)
    expect(isPreviewAction({ kind: 'screenshot', rect: { x: Number.NaN, y: 0, width: 10, height: 10 } })).toBe(false)
  })

  it('результат со снимком проходит расширенный кап, обычный — нет', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(120_000)
    expect(isPreviewActionResultMessage({ type: PREVIEW_ACTION_RESULT_TYPE, requestId: 'r1', ok: true, result: { page: { url: '', title: '' }, rect: { x: 0, y: 0, width: 1, height: 1 }, dataUrl: big } })).toBe(true)
    expect(isPreviewActionResultMessage({ type: PREVIEW_ACTION_RESULT_TYPE, requestId: 'r1', ok: true, result: { text: 'A'.repeat(120_000) } })).toBe(false)
  })
})

describe('isPreviewAction: errors, wait, back, edits', () => {
  it('валидирует новые действия и их границы', () => {
    expect(isPreviewAction({ kind: 'errors' })).toBe(true)
    expect(isPreviewAction({ kind: 'errors', clear: true })).toBe(true)
    expect(isPreviewAction({ kind: 'errors', clear: 'yes' })).toBe(false)
    expect(isPreviewAction({ kind: 'wait', selector: '#x' })).toBe(true)
    expect(isPreviewAction({ kind: 'wait', text: 'Готово', timeoutMs: 3000 })).toBe(true)
    expect(isPreviewAction({ kind: 'wait' })).toBe(false)
    expect(isPreviewAction({ kind: 'wait', selector: '#x', timeoutMs: 60_000 })).toBe(false)
    expect(isPreviewAction({ kind: 'back' })).toBe(true)
    expect(isPreviewAction({ kind: 'edits' })).toBe(true)
  })
})

describe('isPreviewAction: network, console, evaluate', () => {
  it('журналы принимают фильтры и ограничивают limit', () => {
    expect(isPreviewAction({ kind: 'network' })).toBe(true)
    expect(isPreviewAction({ kind: 'network', filter: '/api/', clear: true, limit: 20 })).toBe(true)
    expect(isPreviewAction({ kind: 'network', limit: PREVIEW_ACTION_LIMITS.logMax + 1 })).toBe(false)
    expect(isPreviewAction({ kind: 'console', pattern: '[App]', level: 'warn' })).toBe(true)
    expect(isPreviewAction({ kind: 'console', level: 'debug' })).toBe(false)
  })

  it('evaluate требует код в пределах капа', () => {
    expect(isPreviewAction({ kind: 'evaluate', code: '2 + 2' })).toBe(true)
    expect(isPreviewAction({ kind: 'evaluate' })).toBe(false)
    expect(isPreviewAction({ kind: 'evaluate', code: 'x'.repeat(PREVIEW_ACTION_LIMITS.evaluateCode + 1) })).toBe(false)
  })
})

describe('isPreviewAction: drag, set, upload, viewport, a11y, forward', () => {
  it('drag требует selector или координаты у обеих точек', () => {
    expect(isPreviewAction({ kind: 'drag', from: { selector: '#card' }, to: { x: 10, y: 20 } })).toBe(true)
    expect(isPreviewAction({ kind: 'drag', from: {}, to: { selector: '#col' } })).toBe(false)
    expect(isPreviewAction({ kind: 'drag', from: { x: 1 }, to: { selector: '#col' } })).toBe(false)
  })

  it('set требует value или checked', () => {
    expect(isPreviewAction({ kind: 'set', selector: 'select', value: 'ru' })).toBe(true)
    expect(isPreviewAction({ kind: 'set', selector: '#agree', checked: true })).toBe(true)
    expect(isPreviewAction({ kind: 'set', selector: 'select' })).toBe(false)
  })

  it('upload валидирует имя и кап base64', () => {
    expect(isPreviewAction({ kind: 'upload', selector: 'input[type=file]', name: 'a.txt', base64: 'aGk=' })).toBe(true)
    expect(isPreviewAction({ kind: 'upload', selector: 'input', name: '', base64: 'aGk=' })).toBe(false)
    expect(isPreviewAction({ kind: 'upload', selector: 'input', name: 'a.bin', base64: 'x'.repeat(PREVIEW_ACTION_LIMITS.uploadBase64 + 1) })).toBe(false)
  })

  it('viewport — конечная неотрицательная ширина', () => {
    expect(isPreviewAction({ kind: 'viewport', width: 375 })).toBe(true)
    expect(isPreviewAction({ kind: 'viewport', width: 0 })).toBe(true)
    expect(isPreviewAction({ kind: 'viewport', width: -1 })).toBe(false)
    expect(isPreviewAction({ kind: 'viewport' })).toBe(false)
  })

  it('a11y и forward валидны без аргументов', () => {
    expect(isPreviewAction({ kind: 'a11y' })).toBe(true)
    expect(isPreviewAction({ kind: 'a11y', selector: 'main', limit: 50 })).toBe(true)
    expect(isPreviewAction({ kind: 'forward' })).toBe(true)
  })

  it('click с расширениями: кнопка, двойной, модификаторы', () => {
    expect(isPreviewAction({ kind: 'click', selector: '#a', button: 'right' })).toBe(true)
    expect(isPreviewAction({ kind: 'click', selector: '#a', dblclick: true, modifiers: ['shift', 'meta'] })).toBe(true)
    expect(isPreviewAction({ kind: 'click', selector: '#a', button: 'middle' })).toBe(false)
    expect(isPreviewAction({ kind: 'click', selector: '#a', modifiers: ['hyper'] })).toBe(false)
  })
})
