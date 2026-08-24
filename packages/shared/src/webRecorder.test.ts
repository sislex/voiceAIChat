import { describe, expect, it } from 'vitest'
import {
  WEB_RECORDER_MESSAGE_TYPE,
  WEB_RECORDER_PROTOCOL_VERSION,
  isWebRecorderClientMessage,
  isWebRecorderHostMessage
} from './webRecorder'

const type = WEB_RECORDER_MESSAGE_TYPE
const ids = { conversationId: 'conv-1', registrationId: 'reg-1' }

describe('webRecorder host message validator', () => {
  it('принимает все формы host → Reader', () => {
    expect(isWebRecorderHostMessage({ type, ...ids, kind: 'init', protocolVersion: WEB_RECORDER_PROTOCOL_VERSION, previewUrl: 'https://example.test/', capabilities: ['open'] })).toBe(true)
    expect(isWebRecorderHostMessage({ type, ...ids, kind: 'init', protocolVersion: WEB_RECORDER_PROTOCOL_VERSION, previewUrl: null, capabilities: [] })).toBe(true)
    expect(isWebRecorderHostMessage({ type, ...ids, kind: 'set-url', url: null })).toBe(true)
    expect(isWebRecorderHostMessage({ type, ...ids, kind: 'command', requestId: 'r1', action: { kind: 'read' } })).toBe(true)
    expect(isWebRecorderHostMessage({ type, ...ids, kind: 'inspector-state', enabled: true })).toBe(true)
    expect(isWebRecorderHostMessage({ type, ...ids, kind: 'recording-state', enabled: false })).toBe(true)
    expect(isWebRecorderHostMessage({ type, ...ids, kind: 'diagnostics-start', active: true })).toBe(true)
    expect(isWebRecorderHostMessage({ type, ...ids, kind: 'dispose' })).toBe(true)
  })

  it('отклоняет чужой конверт, пустые ID, старую версию и невалидное действие', () => {
    expect(isWebRecorderHostMessage({ type: 'evil', ...ids, kind: 'dispose' })).toBe(false)
    expect(isWebRecorderHostMessage({ type, kind: 'dispose', conversationId: '', registrationId: 'reg-1' })).toBe(false)
    expect(isWebRecorderHostMessage({ type, ...ids, kind: 'init', protocolVersion: 1, previewUrl: null, capabilities: [] })).toBe(false)
    expect(isWebRecorderHostMessage({ type, ...ids, kind: 'set-url', url: 'javascript:alert(1)' })).toBe(false)
    expect(isWebRecorderHostMessage({ type, ...ids, kind: 'command', requestId: 'r1', action: { kind: 'open', url: 'https://x.test/' } })).toBe(false)
    expect(isWebRecorderHostMessage({ type, ...ids, kind: 'command', requestId: 'r1', action: { kind: 'exec' } })).toBe(false)
    expect(isWebRecorderHostMessage(null)).toBe(false)
  })
})

describe('webRecorder client message validator', () => {
  it('ready допускает пустые ID только при совпадении версии протокола', () => {
    expect(isWebRecorderClientMessage({ type, kind: 'ready', protocolVersion: WEB_RECORDER_PROTOCOL_VERSION, conversationId: null, registrationId: null, capabilities: ['read'] })).toBe(true)
    expect(isWebRecorderClientMessage({ type, kind: 'ready', protocolVersion: WEB_RECORDER_PROTOCOL_VERSION, conversationId: 'c', registrationId: 'r', capabilities: [] })).toBe(true)
    expect(isWebRecorderClientMessage({ type, kind: 'ready', protocolVersion: 1, conversationId: null, registrationId: null, capabilities: [] })).toBe(false)
    expect(isWebRecorderClientMessage({ type, kind: 'ready', protocolVersion: WEB_RECORDER_PROTOCOL_VERSION, conversationId: null, registrationId: null, capabilities: 'read' })).toBe(false)
  })

  it('принимает адресованные формы Reader → host', () => {
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'page-status', status: 'loading', url: 'https://example.test/' })).toBe(true)
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'result', requestId: 'r1', ok: true, result: { url: 'https://example.test/' } })).toBe(true)
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'result', requestId: 'r1', ok: false, error: 'нет страницы' })).toBe(true)
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'save-url', url: null })).toBe(true)
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'recording-step', step: { kind: 'click', selector: '#buy', text: 'Купить', sensitive: false } })).toBe(true)
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'diagnostics-progress', requestId: 'r1', action: 'read', ok: true, durationMs: 12 })).toBe(true)
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'diagnostics-complete', total: 3 })).toBe(true)
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'disposed' })).toBe(true)
  })

  it('отклоняет сообщение без ID, неизвестный статус и переполненный result', () => {
    expect(isWebRecorderClientMessage({ type, kind: 'page-status', status: 'ready', url: null, conversationId: 'c', registrationId: '' })).toBe(false)
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'page-status', status: 'crashed', url: null })).toBe(false)
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'result', requestId: 'r1', ok: true, result: { text: 'x'.repeat(40_000) } })).toBe(false)
  })

  it('секретный шаг сценария не может нести значение поля', () => {
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'recording-step', step: { kind: 'type', selector: '#password', text: '', sensitive: true } })).toBe(true)
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'recording-step', step: { kind: 'type', selector: '#password', text: 'hunter2', sensitive: true } })).toBe(false)
  })

it('area-screenshot валидирует data-URL картинки, rect и pageUrl', () => {
    const shot = { dataUrl: 'data:image/png;base64,AAAA', rect: { x: 10, y: 20, width: 300, height: 200 }, pageUrl: 'https://example.test/page' }
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'area-screenshot', shot })).toBe(true)
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'area-screenshot', shot: { ...shot, dataUrl: 'javascript:x' } })).toBe(false)
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'area-screenshot', shot: { ...shot, dataUrl: 'data:image/png;base64,' + 'A'.repeat(2_100_000) } })).toBe(false)
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'area-screenshot', shot: { ...shot, rect: { x: 0, y: 0, width: 0, height: 10 } } })).toBe(false)
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'area-screenshot', shot: { ...shot, pageUrl: 'ftp://x' } })).toBe(false)
  })

  it('submit допустим только у type-шага', () => {
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'recording-step', step: { kind: 'type', selector: '#password', text: '', sensitive: true, submit: true } })).toBe(true)
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'recording-step', step: { kind: 'click', selector: '#enter', text: 'Войти', sensitive: false, submit: true } })).toBe(false)
    expect(isWebRecorderClientMessage({ type, ...ids, kind: 'recording-step', step: { kind: 'type', selector: '#q', text: 'x', sensitive: false, submit: 'yes' } })).toBe(false)
  })
})
