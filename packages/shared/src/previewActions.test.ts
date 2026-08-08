import { describe, expect, it } from 'vitest'
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
