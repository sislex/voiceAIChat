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

describe('относительный open и заголовок для host', () => {
  it('разрешает относительный путь от открытой страницы и отказывает без неё', async () => {
    const titles: Array<string | null> = []
    let seq = 0
    const sent: WebRecorderHostMessage[] = []
    const bridge = createReaderHostBridge({ conversationId: 'conv-1', newId: () => `id-${++seq}`, send: (m) => sent.push(m), onPageTitle: (title) => titles.push(title) })
    bridge.receive({ type, kind: 'ready', protocolVersion: WEB_RECORDER_PROTOCOL_VERSION, conversationId: null, registrationId: null, capabilities: [] })
    const registrationId = bridge.registrationId()!
    expect(await bridge.run({ kind: 'open', url: '/about' })).toMatchObject({ ok: false, error: expect.stringContaining('открытой страницы') })
    const first = bridge.run({ kind: 'open', url: 'https://shop.example/catalog/' })
    await Promise.resolve()
    bridge.receive({ type, conversationId: 'conv-1', registrationId, kind: 'page-status', status: 'ready', url: 'https://shop.example/catalog/', title: 'Каталог' })
    await first
    expect(titles).toEqual(['Каталог'])
    const relative = bridge.run({ kind: 'open', url: '../about?x=1' })
    await Promise.resolve()
    expect(sent.filter((m) => m.kind === 'set-url').at(-1)).toMatchObject({ url: 'https://shop.example/about?x=1' })
    bridge.receive({ type, conversationId: 'conv-1', registrationId, kind: 'page-status', status: 'ready', url: 'https://shop.example/about?x=1' })
    expect(await relative).toEqual({ ok: true, result: { url: 'https://shop.example/about?x=1' } })
    expect(titles).toEqual(['Каталог', null])
  })
})

describe('wait по адресу, история и вопрос о выделенном', () => {
  it('wait {url} ждёт подтверждённый адрес панели и отказывает по таймауту', async () => {
    const h = harness()
    h.ready()
    const registrationId = h.bridge.registrationId()!
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://shop.example/login' })
    const waiting = h.bridge.run({ kind: 'wait', url: 'https://shop.example/dashboard*', timeoutMs: 2000 })
    h.from(registrationId, { kind: 'page-status', status: 'loading', url: 'https://shop.example/login' })
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://shop.example/dashboard?tab=1' })
    await vi.advanceTimersByTimeAsync(200)
    expect(await waiting).toMatchObject({ ok: true, result: { page: { url: 'https://shop.example/dashboard?tab=1' } } })
    const late = h.bridge.run({ kind: 'wait', url: 'https://shop.example/never', timeoutMs: 400 })
    await vi.advanceTimersByTimeAsync(600)
    expect(await late).toMatchObject({ ok: false, error: expect.stringContaining('dashboard') })
    expect(await h.bridge.run({ kind: 'status' })).toMatchObject({ ok: true, result: { history: ['https://shop.example/dashboard?tab=1', 'https://shop.example/login'] } })
  })
  it('control переключает status.manual и уведомляет host', async () => {
    const controls: boolean[] = []
    let seq = 0
    const bridge = createReaderHostBridge({ conversationId: 'conv-1', newId: () => `id-${++seq}`, send: () => {}, onControl: (manual) => controls.push(manual) })
    bridge.receive({ type, kind: 'ready', protocolVersion: WEB_RECORDER_PROTOCOL_VERSION, conversationId: null, registrationId: null, capabilities: [] })
    bridge.receive({ type, conversationId: 'conv-1', registrationId: bridge.registrationId()!, kind: 'control', manual: true })
    expect(await bridge.run({ kind: 'status' })).toMatchObject({ ok: true, result: { manual: true } })
    bridge.receive({ type, conversationId: 'conv-1', registrationId: bridge.registrationId()!, kind: 'control', manual: false })
    expect((await bridge.run({ kind: 'status' }) as { result: { manual?: boolean } }).result.manual).toBeUndefined()
    expect(controls).toEqual([true, false])
  })
  it('сообщение ask доходит до host', () => {
    const asked: string[] = []
    let seq = 0
    const bridge = createReaderHostBridge({ conversationId: 'conv-1', newId: () => `id-${++seq}`, send: () => {}, onAsk: (text) => asked.push(text) })
    bridge.receive({ type, kind: 'ready', protocolVersion: WEB_RECORDER_PROTOCOL_VERSION, conversationId: null, registrationId: null, capabilities: [] })
    bridge.receive({ type, conversationId: 'conv-1', registrationId: bridge.registrationId()!, kind: 'ask', text: 'Что такое RFC 2606?' })
    expect(asked).toEqual(['Что такое RFC 2606?'])
  })
})

describe('смена сайта и итоги проверок', () => {
  it('open отмечает crossSite при смене host; status считает проверки', async () => {
    const h = harness()
    h.ready()
    const registrationId = h.bridge.registrationId()!
    const first = h.bridge.run({ kind: 'open', url: 'https://shop.example/' })
    await Promise.resolve()
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://shop.example/' })
    expect(await first).toMatchObject({ ok: true, result: { url: 'https://shop.example/' } })
    expect(((await first).result as { crossSite?: boolean }).crossSite).toBeUndefined()
    const second = h.bridge.run({ kind: 'open', url: 'https://pay.example/checkout' })
    await Promise.resolve()
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://pay.example/checkout' })
    expect(await second).toMatchObject({ ok: true, result: { crossSite: true } })
    await h.bridge.run({ kind: 'check', url: 'https://pay.example/*' })
    expect(await h.bridge.run({ kind: 'status' })).toMatchObject({ ok: true, result: { checks: { passed: 1, failed: 0 } } })
  })
})

describe('report', () => {
  it('собирает историю, проверки и число действий', async () => {
    const h = harness()
    h.ready()
    const registrationId = h.bridge.registrationId()!
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://shop.example/' })
    const checking = h.bridge.run({ kind: 'check', text: 'Войти' })
    await Promise.resolve()
    const command = h.sent.filter((m) => m.kind === 'command').at(-1) as { requestId: string }
    h.from(registrationId, { kind: 'result', requestId: command.requestId, ok: true, result: { page: { url: 'https://shop.example/', title: '' }, pass: true, summary: '«Войти» видно', expected: { state: 'visible' }, actual: { count: 1, visible: 1 } } })
    await checking
    await h.bridge.run({ kind: 'check', url: 'https://other.example/*' })
    const report = await h.bridge.run({ kind: 'report' })
    expect(report).toMatchObject({ ok: true, result: { history: ['https://shop.example/'], passed: 1, failed: 1, actions: 1, checks: [{ summary: '«Войти» видно', pass: true }, { pass: false }] } })
  })
})

describe('sequence как чек-лист', () => {
  it('continueOnError проходит все шаги и перечисляет провалы', async () => {
    const h = harness()
    h.ready()
    const registrationId = h.bridge.registrationId()!
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://shop.example/' })
    const running = h.bridge.run({ kind: 'sequence', continueOnError: true, steps: [{ kind: 'check', text: 'Войти' }, { kind: 'check', text: 'Корзина' }] })
    await Promise.resolve()
    const first = h.sent.filter((m) => m.kind === 'command').at(-1) as { requestId: string }
    h.from(registrationId, { kind: 'result', requestId: first.requestId, ok: false, error: 'не видно' })
    await Promise.resolve(); await Promise.resolve()
    const second = h.sent.filter((m) => m.kind === 'command').at(-1) as { requestId: string }
    expect(second.requestId).not.toBe(first.requestId)
    h.from(registrationId, { kind: 'result', requestId: second.requestId, ok: true, result: { page: { url: 'https://shop.example/', title: '' }, pass: true, summary: '«Корзина» видно' } })
    const outcome = await running
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe('Шаг 1 из 2 (check): не видно')
    expect(outcome.result).toMatchObject({ completed: 1, total: 2, steps: [{ kind: 'check', ok: false }, { kind: 'check', ok: true, summary: '«Корзина» видно' }] })
  })
})

describe('waitFor у действий и lastAction', () => {
  it('click с waitFor ждёт текст после успеха; status помнит последнее действие', async () => {
    const h = harness()
    h.ready()
    const registrationId = h.bridge.registrationId()!
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://shop.example/' })
    const clicking = h.bridge.run({ kind: 'click', text: 'Далее', waitFor: 'Шаг 2' })
    await Promise.resolve()
    const click = h.sent.filter((m) => m.kind === 'command').at(-1) as { requestId: string; action: { kind: string; waitFor?: string } }
    expect(click.action.kind).toBe('click')
    expect(click.action.waitFor).toBeUndefined()
    h.from(registrationId, { kind: 'result', requestId: click.requestId, ok: true, result: { page: { url: 'https://shop.example/', title: '' }, clicked: { selector: 'button', tag: 'button', text: 'Далее' } } })
    await Promise.resolve(); await Promise.resolve()
    const wait = h.sent.filter((m) => m.kind === 'command').at(-1) as { requestId: string; action: { kind: string; text?: string } }
    expect(wait.action).toMatchObject({ kind: 'wait', text: 'Шаг 2' })
    h.from(registrationId, { kind: 'result', requestId: wait.requestId, ok: true, result: { page: { url: 'https://shop.example/', title: '' }, waitedMs: 10 } })
    expect(await clicking).toMatchObject({ ok: true, result: { clicked: { text: 'Далее' }, waited: { text: 'Шаг 2', found: true } } })
    expect(await h.bridge.run({ kind: 'status' })).toMatchObject({ ok: true, result: { lastAction: { kind: 'wait', ok: true } } })
  })
})

describe('check адреса и заголовка', () => {
  it('проверяет url и title мостом без страницы', async () => {
    const h = harness()
    h.ready()
    const registrationId = h.bridge.registrationId()!
    expect(await h.bridge.run({ kind: 'check', url: 'https://shop.example/*' })).toMatchObject({ ok: true, result: { pass: false, summary: 'Страница не открыта' } })
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://shop.example/cabinet', title: 'Личный кабинет' })
    expect(await h.bridge.run({ kind: 'check', url: 'https://shop.example/cab*', title: 'кабинет' })).toMatchObject({ ok: true, result: { pass: true } })
    expect(await h.bridge.run({ kind: 'check', title: 'Корзина' })).toMatchObject({ ok: true, result: { pass: false, summary: expect.stringContaining('не содержит') } })
  })
})

describe('sequence и pending', () => {
  it('выполняет шаги по очереди, сообщает прогресс и останавливается на первой ошибке', async () => {
    const progress: Array<{ done: number; total: number } | null> = []
    let seq = 0
    const sent: WebRecorderHostMessage[] = []
    const bridge = createReaderHostBridge({ conversationId: 'conv-1', newId: () => `id-${++seq}`, send: (m) => sent.push(m), onSequenceProgress: (p) => progress.push(p ? { done: p.done, total: p.total } : null) })
    bridge.receive({ type, kind: 'ready', protocolVersion: WEB_RECORDER_PROTOCOL_VERSION, conversationId: null, registrationId: null, capabilities: [] })
    const registrationId = bridge.registrationId()!
    bridge.receive({ type, conversationId: 'conv-1', registrationId, kind: 'page-status', status: 'ready', url: 'https://shop.example/' })
    const running = bridge.run({ kind: 'sequence', steps: [{ kind: 'click', text: 'Войти' }, { kind: 'check', text: 'Кабинет' }, { kind: 'read' }] })
    await Promise.resolve()
    const first = sent.filter((m) => m.kind === 'command').at(-1) as { requestId: string }
    expect(await bridge.run({ kind: 'status' })).toMatchObject({ ok: true, result: { pending: 1 } })
    bridge.receive({ type, conversationId: 'conv-1', registrationId, kind: 'result', requestId: first.requestId, ok: true, result: { page: { url: 'https://shop.example/', title: 'Магазин' }, clicked: { selector: 'a', tag: 'a', text: 'Войти' } } })
    await Promise.resolve(); await Promise.resolve()
    const second = sent.filter((m) => m.kind === 'command').at(-1) as { requestId: string }
    expect(second.requestId).not.toBe(first.requestId)
    bridge.receive({ type, conversationId: 'conv-1', registrationId, kind: 'result', requestId: second.requestId, ok: false, error: 'Элемент не найден' })
    const outcome = await running
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('Шаг 2 из 3 (check)')
    expect(outcome.result).toMatchObject({ completed: 1, total: 3, steps: [{ kind: 'click', ok: true }, { kind: 'check', ok: false, error: 'Элемент не найден' }] })
    expect(progress).toEqual([{ done: 0, total: 3 }, { done: 1, total: 3 }, null])
    expect(sent.filter((m) => m.kind === 'command')).toHaveLength(2)
  })
})

describe('open waitFor и viewport', () => {
  it('open с waitFor ждёт текст после готовности и сообщает итог; status несёт viewport', async () => {
    const h = harness()
    h.ready()
    const registrationId = h.bridge.registrationId()!
    const opening = h.bridge.run({ kind: 'open', url: 'https://shop.example/', waitFor: 'Каталог' })
    await Promise.resolve()
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://shop.example/', title: 'Магазин', viewport: { width: 390, height: 700 } })
    await Promise.resolve()
    const command = h.sent.find((m) => m.kind === 'command' && (m.action as { kind: string }).kind === 'wait') as { requestId: string } | undefined
    expect(command).toBeTruthy()
    h.from(registrationId, { kind: 'result', requestId: command!.requestId, ok: true, result: { page: { url: 'https://shop.example/', title: 'Магазин' }, waitedMs: 30 } })
    expect(await opening).toMatchObject({ ok: true, result: { url: 'https://shop.example/', title: 'Магазин', waited: { text: 'Каталог', found: true } } })
    expect(await h.bridge.run({ kind: 'status' })).toMatchObject({ ok: true, result: { viewport: { width: 390, height: 700 } } })
  })
})

describe('status и outline', () => {
  it('status отвечает без страницы и после готовности, open несёт outline', async () => {
    const h = harness()
    expect(await h.bridge.run({ kind: 'status' })).toEqual({ ok: true, result: { connected: false, pageStatus: 'empty', page: null } })
    h.ready()
    const registrationId = h.bridge.registrationId()!
    expect(await h.bridge.run({ kind: 'status' })).toMatchObject({ ok: true, result: { connected: true, pageStatus: 'empty', page: null } })
    const open = h.bridge.run({ kind: 'open', url: 'https://shop.example/' })
    await Promise.resolve()
    const outline = { headings: ['Магазин'], links: 12, buttons: 3, inputs: 1 }
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://shop.example/', title: 'Магазин', outline })
    expect(await open).toEqual({ ok: true, result: { url: 'https://shop.example/', title: 'Магазин', outline } })
    expect(await h.bridge.run({ kind: 'status' })).toMatchObject({ ok: true, result: { connected: true, pageStatus: 'ready', page: { url: 'https://shop.example/', title: 'Магазин' }, history: ['https://shop.example/'], lastAction: { kind: 'open', ok: true } } })
    h.from(registrationId, { kind: 'page-status', status: 'error', url: 'https://shop.example/', error: 'Сайт недоступен' })
    expect(await h.bridge.run({ kind: 'status' })).toMatchObject({ ok: true, result: { pageStatus: 'error', error: 'Сайт недоступен' } })
  })
})

describe('open отвечает заголовком страницы', () => {
  it('готовая страница с title попадает в результат open, без title — только url', async () => {
    const h = harness()
    h.ready()
    const registrationId = h.bridge.registrationId()!
    const titled = h.bridge.run({ kind: 'open', url: 'https://shop.example/' })
    await Promise.resolve()
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://shop.example/', title: 'Магазин' })
    expect(await titled).toEqual({ ok: true, result: { url: 'https://shop.example/', title: 'Магазин' } })
    const untitled = h.bridge.run({ kind: 'open', url: 'https://blank.example/' })
    await Promise.resolve()
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://blank.example/' })
    // Другой host, чем у предыдущей страницы: мост отмечает смену сайта.
    expect(await untitled).toEqual({ ok: true, result: { url: 'https://blank.example/', crossSite: true } })
    const redirected = h.bridge.run({ kind: 'open', url: 'https://blank.example/old' })
    await Promise.resolve()
    h.from(registrationId, { kind: 'page-status', status: 'ready', url: 'https://blank.example/new' })
    expect(await redirected).toEqual({ ok: true, result: { url: 'https://blank.example/new', redirected: true } })
  })
})

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
    await expect(pending).resolves.toEqual({ ok: true, result: { url: 'https://shop.example/account', redirected: true } })
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

it('back {to} возвращает на страницу этого сеанса по заголовку, а незнакомую называет честно (круг 17)', async () => {
  const h = harness(); h.ready(); const id = h.bridge.registrationId()!
  const first = h.bridge.run({ kind: 'open', url: 'https://shop.example/search?q=наушники' })
  await Promise.resolve()
  h.from(id, { kind: 'page-status', status: 'ready', url: 'https://shop.example/search?q=наушники', title: 'Поиск: наушники' })
  await first
  const second = h.bridge.run({ kind: 'open', url: 'https://shop.example/item/7' })
  await Promise.resolve()
  h.from(id, { kind: 'page-status', status: 'ready', url: 'https://shop.example/item/7', title: 'Наушники Pro' })
  await second
  h.sent.length = 0
  const back = h.bridge.run({ kind: 'back', to: 'Поиск' })
  await Promise.resolve()
  expect(h.sent.some(message => message.kind === 'set-url' && message.url === 'https://shop.example/search?q=наушники')).toBe(true)
  h.from(id, { kind: 'page-status', status: 'ready', url: 'https://shop.example/search?q=наушники', title: 'Поиск: наушники' })
  await expect(back).resolves.toMatchObject({ ok: true })
  await expect(h.bridge.run({ kind: 'back', to: 'корзина' })).resolves.toMatchObject({ ok: false, error: expect.stringContaining('не было в этом сеансе') })
  h.bridge.dispose()
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
