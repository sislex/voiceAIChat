import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WEB_RECORDER_MESSAGE_TYPE, WEB_RECORDER_PROTOCOL_VERSION, type WebRecorderHostMessage } from '@shared/webRecorder'
import { createReaderHostBridge, type ReaderHostRegistration } from './hostBridge'

const type = WEB_RECORDER_MESSAGE_TYPE

function harness(overrides: { conversationId?: string } = {}) {
  let seq = 0
  const sent: WebRecorderHostMessage[] = []
  const saves: Array<string | null> = []
  const registrations: (ReaderHostRegistration | null)[] = []
  const bridge = createReaderHostBridge({
    conversationId: overrides.conversationId ?? 'conv-1',
    newId: () => `id-${++seq}`,
    send: (message) => sent.push(message),
    capabilities: ['mcp-actions'],
    onSaveUrl: url => saves.push(url),
    onRegistration: (registration) => registrations.push(registration)
  })
  const ready = (ids: { conversationId?: string | null; registrationId?: string | null } = {}) =>
    bridge.receive({ type, kind: 'ready', protocolVersion: WEB_RECORDER_PROTOCOL_VERSION, conversationId: ids.conversationId ?? null, registrationId: ids.registrationId ?? null, capabilities: ['read'] })
  const from = (registrationId: string, message: object) =>
    bridge.receive({ type, conversationId: 'conv-1', registrationId, ...message })
  return { bridge, sent, registrations, ready, from, saves }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('handshake и регистрация', () => {
  it('на ready создаёт регистрацию и отвечает init с previewUrl и версией', () => {
    const h = harness()
    expect(h.bridge.getStatus()).toBe('booting')
    h.bridge.setUrl('https://shop.example/')
    h.ready()
    const registrationId = h.bridge.registrationId()!
    expect(registrationId).toBeTruthy()
    const init = h.sent.find((m) => m.kind === 'init')!
    expect(init).toMatchObject({ protocolVersion: WEB_RECORDER_PROTOCOL_VERSION, conversationId: 'conv-1', registrationId, previewUrl: 'https://shop.example/', capabilities: ['mcp-actions'] })
    expect(h.registrations.at(-1)).toMatchObject({ conversationId: 'conv-1', registrationId, capabilities: ['read'] })
  })

  it('повторный ready той же регистрации идемпотентно повторяет init без ротации', () => {
    const h = harness()
    h.ready()
    const registrationId = h.bridge.registrationId()!
    h.ready({ conversationId: 'conv-1', registrationId })
    expect(h.bridge.registrationId()).toBe(registrationId)
    expect(h.sent.filter((m) => m.kind === 'init')).toHaveLength(2)
    expect(h.registrations).toHaveLength(1)
  })

  it('ready нового boot (reload/HMR) ротирует регистрацию и отклоняет pending старой', async () => {
    const h = harness()
    h.ready()
    const first = h.bridge.registrationId()!
    h.from(first, { kind: 'page-status', status: 'ready', url: 'https://shop.example/' })
    const pending = h.bridge.run({ kind: 'read' })
    h.ready() // Reader перезагрузился: registrationId в ready снова null
    const second = h.bridge.registrationId()!
    expect(second).not.toBe(first)
    await expect(pending).resolves.toMatchObject({ ok: false, error: expect.stringContaining('перезагружен') })
    expect(h.registrations.filter(Boolean)).toHaveLength(2)
  })

  it('игнорирует ready с несовпадающей версией протокола и невалидные сообщения', () => {
    const h = harness()
    h.bridge.receive({ type, kind: 'ready', protocolVersion: 1, conversationId: null, registrationId: null, capabilities: [] })
    h.bridge.receive({ type: 'evil', kind: 'ready' })
    h.bridge.receive(null)
    expect(h.bridge.registrationId()).toBeNull()
    expect(h.sent).toHaveLength(0)
  })
})

describe('изоляция разговоров и регистраций', () => {
  it('результат старой регистрации после ротации не доставляется', async () => {
    const h = harness()
    h.ready()
    const first = h.bridge.registrationId()!
    h.from(first, { kind: 'page-status', status: 'ready', url: 'https://shop.example/' })
    const read = h.bridge.run({ kind: 'read' })
    const command = h.sent.find((m) => m.kind === 'command')!
    h.ready() // ротация
    const late = { type, conversationId: 'conv-1', registrationId: first, kind: 'result', requestId: command.kind === 'command' ? command.requestId : '', ok: true, result: { text: 'старый iframe' } }
    h.bridge.receive(late)
    await expect(read).resolves.toMatchObject({ ok: false }) // отклонён ротацией, а не поздним результатом
  })

  it('сообщение с чужим conversationId игнорируется', () => {
    const h = harness()
    h.ready()
    const registrationId = h.bridge.registrationId()!
    const saves: unknown[] = []
    // save-url чужого разговора не должен дойти
    h.bridge.receive({ type, conversationId: 'other-conv', registrationId, kind: 'save-url', url: null })
    expect(saves).toHaveLength(0)
    expect(h.bridge.getStatus()).toBe('ready')
  })

  it('page-status от несуществующей регистрации не меняет состояние', () => {
    const h = harness()
    h.ready()
    h.from('stale-registration', { kind: 'page-status', status: 'error', url: null, error: 'boom' })
    expect(h.bridge.getStatus()).toBe('ready')
  })
})

describe('очередь команд и автомат страницы', () => {
  it('open резолвится только после page-ready, а read из очереди уходит следом', async () => {
    const h = harness()
    h.ready()
    const registrationId = h.bridge.registrationId()!
    const open = h.bridge.run({ kind: 'open', url: 'https://shop.example/' })
    const read = h.bridge.run({ kind: 'read' })
    expect(h.bridge.getStatus()).toBe('page-loading')
    expect(h.sent.some((m) => m.kind === 'command')).toBe(false)
    await vi.advanceTimersByTimeAsync(0) // queueMicrotask второго set-url
    expect(h.sent.filter((m) => m.kind === 'set-url').map((m) => m.kind === 'set-url' ? m.url : null)).toEqual([null, 'https://shop.example/'])
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://shop.example/' })
    await expect(open).resolves.toEqual({ ok: true, result: { url: 'https://shop.example/' } })
    expect(h.bridge.getStatus()).toBe('page-ready')
    const command = h.sent.find((m) => m.kind === 'command')!
    expect(command).toMatchObject({ action: { kind: 'read' }, conversationId: 'conv-1', registrationId })
    h.from(registrationId, { kind: 'result', requestId: command.kind === 'command' ? command.requestId : '', ok: true, result: { text: 'hi' } })
    await expect(read).resolves.toMatchObject({ ok: true, result: { text: 'hi' } })
  })

  it('DOM-команда без открытой страницы получает строго определённую ошибку', async () => {
    const h = harness()
    h.ready()
    await expect(h.bridge.run({ kind: 'read' })).resolves.toMatchObject({ ok: false, error: expect.stringContaining('сначала вызови open') })
  })

  it('после page-loading новая команда ждёт готовности нового документа', async () => {
    const h = harness()
    h.ready()
    const registrationId = h.bridge.registrationId()!
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://shop.example/' })
    h.from(registrationId, { kind: 'page-status', status: 'loading', url: 'https://next.example/' })
    expect(h.bridge.getStatus()).toBe('page-loading')
    const read = h.bridge.run({ kind: 'read' })
    expect(h.sent.some((m) => m.kind === 'command')).toBe(false)
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://next.example/' })
    const command = h.sent.find((m) => m.kind === 'command')!
    h.from(registrationId, { kind: 'result', requestId: command.kind === 'command' ? command.requestId : '', ok: true, result: { text: 'next' } })
    await expect(read).resolves.toMatchObject({ ok: true })
  })

  it('ошибка страницы отклоняет очередь, таймаут закрывает молчащий запрос', async () => {
    const h = harness()
    h.ready()
    const registrationId = h.bridge.registrationId()!
    h.bridge.setUrl('https://broken.example/')
    const pending = h.bridge.run({ kind: 'read' })
    h.from(registrationId, { kind: 'page-status', status: 'error', url: 'https://broken.example/', error: 'DNS lookup failed' })
    await expect(pending).resolves.toMatchObject({ ok: false, error: expect.stringContaining('DNS') })
    expect(h.bridge.getStatus()).toBe('error')

    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://broken.example/' })
    const silent = h.bridge.run({ kind: 'read' })
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(silent).resolves.toMatchObject({ ok: false, error: expect.stringContaining('не ответил') })
  })
})

describe('dispose', () => {
  it('dispose шлёт сообщение, закрывает pending и снимает регистрацию', async () => {
    const h = harness()
    h.ready()
    const registrationId = h.bridge.registrationId()!
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://shop.example/' })
    const pending = h.bridge.run({ kind: 'read' })
    h.bridge.dispose()
    await expect(pending).resolves.toMatchObject({ ok: false, error: expect.stringContaining('закрыта') })
    expect(h.sent.at(-1)).toMatchObject({ kind: 'dispose', registrationId })
    expect(h.registrations.at(-1)).toBeNull()
    expect(h.bridge.getStatus()).toBe('disposed')
    await expect(h.bridge.run({ kind: 'read' })).resolves.toMatchObject({ ok: false, error: expect.stringContaining('закрыта') })
  })

  it('после dispose входящие сообщения игнорируются и не воскрешают регистрацию', () => {
    const h = harness()
    h.ready()
    h.bridge.dispose()
    h.ready()
    expect(h.bridge.registrationId()).toBeNull()
  })
})

describe('снимок области', () => {
  it('area-screenshot доходит до callback только с актуальными ID', () => {
    let seq = 0
    const shots: unknown[] = []
    const bridge = createReaderHostBridge({
      conversationId: 'conv-1',
      newId: () => `id-${++seq}`,
      send: () => undefined,
      onAreaScreenshot: (shot) => shots.push(shot)
    })
    bridge.receive({ type: WEB_RECORDER_MESSAGE_TYPE, kind: 'ready', protocolVersion: WEB_RECORDER_PROTOCOL_VERSION, conversationId: null, registrationId: null, capabilities: ['read'] })
    const registrationId = bridge.registrationId()!
    const shot = { dataUrl: 'data:image/png;base64,AAAA', rect: { x: 1, y: 2, width: 30, height: 40 }, pageUrl: 'https://example.test/' }
    bridge.receive({ type: WEB_RECORDER_MESSAGE_TYPE, conversationId: 'conv-1', registrationId: 'stale', kind: 'area-screenshot', shot })
    expect(shots).toHaveLength(0)
    bridge.receive({ type: WEB_RECORDER_MESSAGE_TYPE, conversationId: 'conv-1', registrationId, kind: 'area-screenshot', shot })
    expect(shots).toEqual([shot])
  })
})

describe('диагностика и запись', () => {
  it('регистрация умеет begin/endDiagnostics, мост шлёт inspector/recording-state', () => {
    const h = harness()
    h.ready()
    const registration = h.registrations.at(-1)!
    registration.beginDiagnostics()
    registration.endDiagnostics()
    h.bridge.setInspector(true)
    h.bridge.setRecording(true)
    expect(h.sent.filter((m) => m.kind === 'diagnostics-start').map((m) => m.kind === 'diagnostics-start' ? m.active : null)).toEqual([true, false])
    expect(h.sent.some((m) => m.kind === 'inspector-state' && m.enabled)).toBe(true)
    expect(h.sent.some((m) => m.kind === 'recording-state' && m.enabled)).toBe(true)
  })
})

describe('host: адрес живой страницы и сохранение навигации', () => {
  it('сохраняет новый URL ровно один раз и использует его при повторном init', () => {
    const h = harness()
    h.bridge.setUrl('https://shop.example/'); h.ready()
    const registrationId = h.bridge.registrationId()!
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://shop.example/next' })
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://shop.example/next' })
    expect(h.saves).toEqual(['https://shop.example/next'])
    h.ready({ conversationId: 'conv-1', registrationId })
    expect(h.sent.at(-1)).toMatchObject({ kind: 'init', previewUrl: 'https://shop.example/next' })
  })
  it('open возвращает конечный адрес после redirect', async () => {
    const h = harness(); h.ready()
    const pending = h.bridge.run({ kind: 'open', url: 'https://shop.example/login' })
    h.from(h.bridge.registrationId()!, { kind: 'page-status', status: 'ready', url: 'https://shop.example/account' })
    await expect(pending).resolves.toEqual({ ok: true, result: { url: 'https://shop.example/account' } })
    h.bridge.dispose()
  })
  it('подтверждение ручного open не дублирует сохранение URL', () => {
    const h = harness(); h.ready()
    const registrationId = h.bridge.registrationId()!
    h.from(registrationId, { kind: 'save-url', url: 'https://shop.example/' })
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://shop.example/' })
    expect(h.saves).toEqual(['https://shop.example/'])
  })
})

describe('команды при смене страницы и регистрации', () => {
  it.each(['empty', 'loading', 'error'] as const)('viewport исполняется при состоянии %s без готового документа', async status => {
    const h = harness(); h.ready(); const id = h.bridge.registrationId()!
    h.from(id, { kind: 'page-status', status, url: status === 'empty' ? null : 'https://example.test/', ...(status === 'error' ? { error: 'offline' } : {}) })
    const result = h.bridge.run({ kind: 'viewport', width: 375 })
    const command = h.sent.find(message => message.kind === 'command')!
    expect(command).toMatchObject({ kind: 'command', action: { kind: 'viewport', width: 375 } })
    if (command.kind === 'command') h.from(id, { kind: 'result', requestId: command.requestId, ok: true, result: { width: 375 } })
    await expect(result).resolves.toMatchObject({ ok: true }); h.bridge.dispose()
  })
  it('следующий open отменяет прежний open и его очередь DOM', async () => {
    const h = harness(); h.ready()
    const old = h.bridge.run({ kind: 'open', url: 'https://first.test/' })
    const stale = h.bridge.run({ kind: 'click', selector: '#danger' })
    const next = h.bridge.run({ kind: 'open', url: 'https://second.test/' })
    await expect(old).resolves.toMatchObject({ ok: false }); await expect(stale).resolves.toMatchObject({ ok: false })
    await vi.advanceTimersByTimeAsync(0)
    h.from(h.bridge.registrationId()!, { kind: 'page-status', status: 'ready', url: 'https://second.test/' })
    await expect(next).resolves.toMatchObject({ ok: true, result: { url: 'https://second.test/' } })
    expect(h.sent.filter(message => message.kind === 'command')).toHaveLength(0)
    expect(h.sent.filter(message => message.kind === 'set-url' && message.url)).toEqual([expect.objectContaining({ url: 'https://second.test/' })]); h.bridge.dispose()
  })
  it('dispose не оставляет микрозадачу open, способную оживить iframe', async () => {
    const h = harness(); h.ready(); const pending = h.bridge.run({ kind: 'open', url: 'https://late.test/' })
    h.bridge.dispose(); const count = h.sent.length
    await vi.advanceTimersByTimeAsync(0)
    expect(h.sent).toHaveLength(count); await expect(pending).resolves.toMatchObject({ ok: false })
  })
  it('очистка страницы немедленно отклоняет pending', async () => {
    const h = harness(); h.ready(); h.bridge.setUrl('https://example.test/')
    const pending = h.bridge.run({ kind: 'read' }); h.bridge.setUrl(null)
    await expect(pending).resolves.toMatchObject({ ok: false, error: expect.stringContaining('закрыта') }); h.bridge.dispose()
  })
  it('смена адреса не переносит ожидающий click на другой документ', async () => {
    const h = harness(); h.ready(); h.bridge.setUrl('https://first.test/')
    const pending = h.bridge.run({ kind: 'click', selector: '#confirm' }); h.bridge.setUrl('https://second.test/')
    h.from(h.bridge.registrationId()!, { kind: 'page-status', status: 'ready', url: 'https://second.test/' })
    await expect(pending).resolves.toMatchObject({ ok: false }); expect(h.sent.some(message => message.kind === 'command')).toBe(false); h.bridge.dispose()
  })
  it('сохранённый handle старой регистрации не исполняет новые команды', async () => {
    const h = harness(); h.ready(); const old = h.registrations.at(-1)!; h.ready()
    h.from(h.bridge.registrationId()!, { kind: 'page-status', status: 'ready', url: 'https://example.test/' })
    await expect(old.run({ kind: 'click', selector: '#confirm' })).resolves.toMatchObject({ ok: false, error: expect.stringContaining('устарела') })
    const count = h.sent.length; old.beginDiagnostics(); expect(h.sent).toHaveLength(count); h.bridge.dispose()
  })
  it('ready с ID другого разговора не меняет регистрацию', () => {
    const h = harness(); h.ready(); const id = h.bridge.registrationId()!
    h.ready({ conversationId: 'another-conversation', registrationId: id })
    h.ready({ conversationId: 'another-conversation', registrationId: 'other-boot' })
    expect(h.sent.filter(message => message.kind === 'init')).toHaveLength(1); expect(h.bridge.registrationId()).toBe(id); h.bridge.dispose()
  })
  it('ошибка postMessage даёт результат модели и закрывает pending', async () => {
    let seq = 0, broken = false
    const bridge = createReaderHostBridge({ conversationId: 'conv-1', newId: () => String(++seq), send: () => { if (broken) throw new Error('transport closed') } })
    bridge.receive({ type, kind: 'ready', protocolVersion: WEB_RECORDER_PROTOCOL_VERSION, conversationId: null, registrationId: null, capabilities: [] })
    broken = true
    await expect(bridge.run({ kind: 'open', url: 'https://example.test/' })).resolves.toMatchObject({ ok: false, error: expect.stringContaining('передать') })
    expect(vi.getTimerCount()).toBe(0); expect(() => bridge.dispose()).not.toThrow()
  })
  it('disposed от Reader снимает регистрацию и ожидания host', async () => {
    const h = harness(); h.ready(); const id = h.bridge.registrationId()!; h.bridge.setUrl('https://example.test/')
    const pending = h.bridge.run({ kind: 'read' }); h.from(id, { kind: 'disposed' })
    await expect(pending).resolves.toMatchObject({ ok: false }); expect(h.bridge.getStatus()).toBe('disposed'); expect(h.registrations.at(-1)).toBeNull()
  })
  it('запрошенные host режимы восстанавливаются после перезагрузки shell', () => {
    const h = harness(); h.bridge.setInspector(true); h.bridge.setRecording(true); h.ready(); h.sent.length = 0; h.ready()
    expect(h.sent).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'inspector-state', enabled: true }), expect.objectContaining({ kind: 'recording-state', enabled: true })])); h.bridge.dispose()
  })
})

it('промежуточный empty от reset open не отказывает следующему read', async () => {
  const h = harness(); h.ready(); const id = h.bridge.registrationId()!
  const open = h.bridge.run({ kind: 'open', url: 'https://example.test/' })
  h.from(id, { kind: 'page-status', status: 'empty', url: null })
  expect(h.bridge.getStatus()).toBe('page-loading')
  const read = h.bridge.run({ kind: 'read' }); h.bridge.dispose()
  await expect(open).resolves.toMatchObject({ ok: false }); await expect(read).resolves.toMatchObject({ error: expect.stringContaining('закрыта') })
})
it('ручной адрес Reader отменяет очередь прежнего model open', async () => {
  const h = harness(); h.ready(); const id = h.bridge.registrationId()!
  const open = h.bridge.run({ kind: 'open', url: 'https://model.test/' })
  h.from(id, { kind: 'save-url', url: 'https://manual.test/' })
  await expect(open).resolves.toMatchObject({ ok: false }); await vi.advanceTimersByTimeAsync(0)
  expect(h.sent.some(message => message.kind === 'set-url' && message.url === 'https://model.test/')).toBe(false); h.bridge.dispose()
})
