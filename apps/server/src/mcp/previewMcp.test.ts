// MCP «browser» и relay действий превью: доступ по секрету, трансляция действия
// клиентам пользователя, ожидание первого успеха/всех отказов/таймаута и
// сериализация результата для модели.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { ServerMessage } from '@voicechat/shared'
import {
  PREVIEW_MCP_PATH,
  PreviewActionRelay,
  registerPreviewMcp
} from './previewMcp.js'
import { createPreviewTurnTokens } from '../reader/turnToken.js'

const SECRET = 'test-secret'
const U = 'admin'
const CONV = 'conv-1'
// Токен хода подписан секретом эндпоинта: регистрировать его в процессе больше не нужно.
const TURN = createPreviewTurnTokens(SECRET).issue({ userId: U, conversationId: CONV })

const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

describe('PreviewActionRelay', () => {
  it('без подключённых клиентов сразу отвечает ошибкой', async () => {
    const relay = new PreviewActionRelay()
    const outcome = await relay.request(U, CONV, { kind: 'read' })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('не подключён')
  })

  it('первый успешный ответ выигрывает, отказ другого клиента не мешает', async () => {
    const relay = new PreviewActionRelay()
    const got: ServerMessage[] = []
    relay.subscribe(U, (m) => got.push(m))
    relay.subscribe(U, (m) => got.push(m))
    const promise = relay.request(U, CONV, { kind: 'read' }, 1_000)
    expect(got).toHaveLength(2)
    const [first] = got
    if (first.t !== 'preview.action') throw new Error('ожидался preview.action')
    expect(first.conversationId).toBe(CONV)
    relay.resolve(U, first.requestId, { ok: false, error: 'чат не активен' })
    relay.resolve(U, first.requestId, { ok: true, result: { url: 'https://a.b' } })
    const outcome = await promise
    expect(outcome).toEqual({ ok: true, result: { url: 'https://a.b' } })
    expect(got.filter((message) => message.t === 'reader.changed')).toHaveLength(2)
    expect(got.find((message) => message.t === 'reader.changed')).toEqual(
      expect.objectContaining({ t: 'reader.changed', conversationId: CONV, address: 'https://a.b', navigated: false, action: { kind: 'read' } })
    )
    expect(relay.pendingCount()).toBe(0)
  })

  it('все клиенты отказали → первая ошибка; чужой userId игнорируется', async () => {
    const relay = new PreviewActionRelay()
    let request: ServerMessage | undefined
    relay.subscribe(U, (m) => { request = m })
    const promise = relay.request(U, CONV, { kind: 'read' }, 1_000)
    if (request?.t !== 'preview.action') throw new Error('ожидался preview.action')
    relay.resolve('другой', request.requestId, { ok: true, result: { url: 'https://evil' } })
    relay.resolve(U, request.requestId, { ok: false, error: 'превью не открыто' })
    const outcome = await promise
    expect(outcome).toEqual({ ok: false, error: 'превью не открыто' })
  })

  it('молчание клиента закрывается таймаутом', async () => {
    const relay = new PreviewActionRelay()
    relay.subscribe(U, () => {})
    const outcome = await relay.request(U, CONV, { kind: 'read' }, 10)
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('не ответил')
    expect(relay.pendingCount()).toBe(0)
  })

  it('отписка убирает клиента из рассылки', async () => {
    const relay = new PreviewActionRelay()
    const off = relay.subscribe(U, () => { throw new Error('не должен получить') })
    off()
    const outcome = await relay.request(U, CONV, { kind: 'read' })
    expect(outcome.ok).toBe(false)
  })

  it('игнорирует ответ с requestId целевого запроса, но от чужого разговора', async () => {
    const relay = new PreviewActionRelay()
    let request: Extract<ServerMessage, { t: 'preview.action' }> | undefined
    relay.subscribe(U, (message) => { if (message.t === 'preview.action') request = message })
    const pending = relay.request(U, CONV, { kind: 'read' }, 1_000)
    if (!request) throw new Error('ожидался preview.action')
    relay.resolve(U, request.requestId, { ok: true, result: { url: 'https://wrong.example' } }, 'conv-other')
    expect(relay.pendingCount()).toBe(1)
    relay.resolve(U, request.requestId, { ok: true, result: { url: 'https://right.example' } }, CONV)
    await expect(pending).resolves.toEqual({ ok: true, result: { url: 'https://right.example' } })
  })
})

describe('previewMcp — инструменты browser', () => {
  let app: FastifyInstance
  let relay: PreviewActionRelay
  /** Автоответчик «клиента»: получает preview.action и отвечает через relay. */
  let client: (m: Extract<ServerMessage, { t: 'preview.action' }>) => void

  async function makeApp(
    context?: import('./previewMcp').PreviewTurnContext,
    extra?: Partial<Parameters<typeof registerPreviewMcp>[1]>
  ): Promise<void> {
    app = Fastify({ logger: false })
    relay = new PreviewActionRelay()
    relay.subscribe(U, (m) => {
      if (m.t === 'preview.action') client(m)
    })
    registerPreviewMcp(app, { secret: SECRET, relay, timeoutMs: 500, ...(context ? { context } : {}), ...(extra ?? {}) })
    await app.ready()
  }

  async function call(name: string, args: Record<string, unknown> = {}, query = `?k=${SECRET}&turn=${TURN}`): Promise<{ text: string; isError?: boolean }> {
    const res = await app.inject({
      method: 'POST',
      url: `${PREVIEW_MCP_PATH}${query}`,
      headers: MCP_HEADERS,
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
    })
    const body = res.json() as { result: { content: Array<{ text: string }>; isError?: boolean } }
    return { text: body.result.content.map((c) => c.text).join('\n'), isError: body.result.isError }
  }

  beforeEach(() => {
    client = (m) => relay.resolve(U, m.requestId, { ok: true, result: { url: 'https://a.b' } })
  })
  afterEach(async () => {
    await app.close()
  })

  it('неверный секрет → 403', async () => {
    await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: `${PREVIEW_MCP_PATH}?k=wrong&turn=${TURN}`,
      headers: MCP_HEADERS,
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize' }
    })
    expect(res.statusCode).toBe(403)
  })

  it('tools/list показывает все инструменты браузера', async () => {
    await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: `${PREVIEW_MCP_PATH}?k=${SECRET}&turn=${TURN}`,
      headers: MCP_HEADERS,
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    })
    const body = res.json() as { result: { tools: Array<{ name: string }> } }
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(['a11y', 'back', 'click', 'close-tab', 'console', 'dialogs', 'drag', 'edits', 'environment', 'errors', 'evaluate', 'find', 'forward', 'frames', 'handle-dialog', 'hover', 'network', 'new-tab', 'open', 'press', 'read', 'reload', 'reset-session', 'screenshot', 'scroll', 'select-tab', 'set', 'stop-loading', 'styles', 'tabs', 'test-users', 'type', 'upload', 'viewport', 'wait'])
  })

  it.each([
    ['open', { url: 'https://example.test/' }], ['read', {}], ['find', { text: 'Письмо' }],
    ['click', { selector: '#button' }], ['type', { selector: '#field', text: 'Запись' }],
    ['hover', { selector: '#menu' }], ['scroll', { to: 'bottom' }], ['scroll', { dx: 250, selector: '#pane' }], ['press', { selector: '#field', key: 'Enter' }],
    ['wait', { selector: '#ready' }], ['set', { selector: '#check', checked: true }],
    ['upload', { selector: '#file', name: 'empty.txt', base64: '' }], ['a11y', {}],
    ['drag', { from: { selector: '#from' }, to: { selector: '#to' } }],
    ['evaluate', { code: 'document.title' }], ['styles', { selector: '#field', properties: ['color'] }]
  ])('%s сохраняет цепочку frame до исполнителя Chromium', async (name, args) => {
    await app.close()
    const execute = vi.fn(async () => ({ ok: true, result: { ok: true } }))
    await makeApp(undefined, { browserExecutor: execute })
    expect((await call(name as string, { ...args, frame: ['#preview', '#child'] })).isError).not.toBe(true)
    expect(execute).toHaveBeenCalledWith(U, CONV, { kind: name, ...args, frame: ['#preview', '#child'] })
  })

  it('frame не уходит в relay Web Reader и неверная цепочка не выполняется', async () => {
    await makeApp()
    const observed = vi.fn()
    client = observed
    expect(await call('read', { frame: '#preview' })).toMatchObject({ isError: true, text: expect.stringContaining('Playwright Reader') })
    expect(await call('read', { frame: [] })).toMatchObject({ isError: true })
    expect(observed).not.toHaveBeenCalled()
  })

  it('снимок передаёт frame и сообщает усечение в тексте модели', async () => {
    await app.close()
    const screenshot = vi.fn(async () => ({ ok: true, result: { dataUrl: 'data:image/png;base64,AA==', frame: { path: ['#preview'], url: 'https://child.test/', title: 'Документ' }, clipped: true } }))
    await makeApp(undefined, { browserScreenshot: screenshot })
    const result = await call('screenshot', { frame: ['#preview'], selector: 'body' })
    expect(result.isError).not.toBe(true)
    expect(result.text).toContain('https://child.test/')
    expect(result.text).toContain('только видимая часть')
    expect(screenshot).toHaveBeenCalledWith(U, CONV, { frame: ['#preview'], selector: 'body' })
  })

  it.each([
    ['read', { selector: 'main', limit: 100, offset: 4000 }],
    ['find', { selector: 'button', limit: 1, visibleOnly: true }]
  ])('%s передаёт параметры чтения и поиска в Chromium', async (name, args) => {
    const execute = vi.fn(async () => ({ ok: true, result: { ok: true, text: 'Прочитано' } }))
    await makeApp(undefined, { browserExecutor: execute })
    expect((await call(name as string, args as Record<string, unknown>)).isError).not.toBe(true)
    expect(execute).toHaveBeenCalledWith(U, CONV, { kind: name, ...args as Record<string, unknown> })
  })

  it.each([
    { selector: '#status', text: 'Готово' }, { selector: '#spinner', state: 'hidden' },
    { selector: '#send', enabled: true }, { selector: '#field', editable: true },
    { selector: '#check', checked: false }, { selector: '#field', value: '' },
    { selector: '.row', count: 0 }, { url: '**/ready' },
    { loadState: 'load' }, { predicate: 'window.appReady' }
  ])('условие ожидания %j передаётся в Chromium', async (options) => {
    const execute = vi.fn(async () => ({ ok: true, result: { ok: true, waitedMs: 12 } }))
    await makeApp(undefined, { browserExecutor: execute })
    expect((await call('wait', { ...options, timeoutMs: 30000 })).isError).not.toBe(true)
    expect(execute).toHaveBeenCalledWith(U, CONV, { kind: 'wait', ...options, timeoutMs: 30000 })
  })

  it('расширенный wait не превращается в прежний поиск iframe', async () => {
    const forwarded = vi.fn()
    await makeApp(undefined, { browserExecutor: async () => null })
    client = forwarded
    const result = await call('wait', { selector: '#spinner', state: 'hidden' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Playwright Reader')
    expect(forwarded).not.toHaveBeenCalled()
  })

  it('wait отклоняет противоречивые условия без вызова браузера', async () => {
    const execute = vi.fn(async () => null)
    await makeApp(undefined, { browserExecutor: execute })
    expect((await call('wait', { selector: '.row', count: 0, state: 'visible' })).isError).toBe(true)
    expect(execute).not.toHaveBeenCalled()
  })

  it('predicate не обходит проектную политику evaluate', async () => {
    const execute = vi.fn(async () => ({ ok: true, result: { ok: true, waitedMs: 1 } }))
    const gate = vi.fn(async (_entry: unknown, code: string) => ({ allowed: code === 'window.appReady', needsConfirmation: code !== 'window.appReady' }))
    await makeApp({ machineOf: async () => null, testUsersOf: async () => [], gateEvaluate: gate }, { browserExecutor: execute })
    expect((await call('wait', { predicate: 'document.body.remove()' })).isError).toBe(true)
    expect(execute).not.toHaveBeenCalled()
    expect((await call('wait', { predicate: 'window.appReady' })).isError).not.toBe(true)
    expect(gate).toHaveBeenLastCalledWith(expect.objectContaining({ userId: U, conversationId: CONV }), 'window.appReady', false)
  })

  it.each([
    ['frames', {}, { type: 'frames' }],
    ['tabs', {}, { type: 'status' }],
    ['new-tab', { url: 'https://example.com/' }, { type: 'newTab', url: 'https://example.com/' }],
    ['select-tab', { tabId: 't2' }, { type: 'selectTab', tabId: 't2' }],
    ['close-tab', { tabId: 't2' }, { type: 'closeTab', tabId: 't2' }],
    ['reload', {}, { type: 'reload' }],
    ['stop-loading', {}, { type: 'stop' }]
  ])('%s управляет Chromium от имени текущего разговора', async (name, args, command) => {
    const control = vi.fn(async () => ({ ok: true, result: { id: CONV, conversationId: CONV, incarnation: 'inc', state: 'ready' as const, tabs: [], activeTabId: 't2', viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }, currentUrl: null, title: null } }))
    await makeApp(undefined, { browserControl: control })
    const result = await call(name as string, args as Record<string, unknown>)
    expect(result.isError).not.toBe(true)
    expect(result.text).toContain('t2')
    expect(control).toHaveBeenCalledWith(U, CONV, command)
  })

  it('управление вкладками не уходит в iframe и не вызывается без токена хода', async () => {
    const control = vi.fn(async () => null)
    const forwarded = vi.fn()
    await makeApp(undefined, { browserControl: control })
    client = forwarded
    expect((await call('tabs', {}, `?k=${SECRET}&turn=invalid`)).isError).toBe(true)
    expect(control).not.toHaveBeenCalled()
    expect(await call('tabs')).toMatchObject({ isError: true, text: expect.stringContaining('Playwright Reader') })
    expect(forwarded).not.toHaveBeenCalled()
  })

  it('новая вкладка применяет доступный machine.internal и отвергает неверные URL', async () => {
    const control = vi.fn(async () => ({ ok: true }))
    await makeApp({ machineOf: async () => 'agent-7', testUsersOf: async () => [] }, { browserControl: control })
    expect((await call('new-tab', { url: 'http://machine.internal:5173/#/make' })).isError).not.toBe(true)
    expect(control).toHaveBeenCalledWith(U, CONV, { type: 'newTab', url: 'http://agent-7.machine.internal:5173/#/make' })
    control.mockClear()
    expect((await call('new-tab', { url: 'file:///tmp/data' })).isError).toBe(true)
    expect(control).not.toHaveBeenCalled()
  })

  it('errors, wait, back и edits доходят до клиента как действия', async () => {
    await makeApp()
    const seen: unknown[] = []
    client = (m) => {
      seen.push(m.action)
      relay.resolve(U, m.requestId, { ok: true, result: { page: { url: 'https://a.b', title: '' }, errors: [], total: 0 } })
    }
    await call('errors', { clear: true })
    await call('wait', { selector: '#late', timeoutMs: 2000 })
    await call('back')
    await call('edits')
    expect(seen).toEqual([
      { kind: 'errors', clear: true },
      { kind: 'wait', selector: '#late', timeoutMs: 2000 },
      { kind: 'back' },
      { kind: 'edits' }
    ])
  })

  it('environment отдаёт окружения проекта, reset-session чистит cookie через контекст', async () => {
    const clears: Array<string | undefined> = []
    await makeApp({
      machineOf: async () => null,
      testUsersOf: async () => [],
      environmentsOf: async () => [{ taskId: 't1', branch: 'CHAT-1', state: 'running', healthy: true, appUrl: 'http://agent-1.machine.internal:18123/', storybookUrl: null }],
      clearCookies: (_entry, host) => { clears.push(host); return 2 }
    })
    const environments = await call('environment')
    expect(JSON.parse(environments.text)).toEqual([{ taskId: 't1', branch: 'CHAT-1', state: 'running', healthy: true, appUrl: 'http://agent-1.machine.internal:18123/', storybookUrl: null }])
    const reset = await call('reset-session', { host: 'agent-1.machine.internal' })
    expect(reset.text).toContain('Сброшено cookie: 2')
    expect(clears).toEqual(['agent-1.machine.internal'])
  })

  it('dialogs возвращает диалог конкретной вкладки без контекста прокси', async () => {
    const result = { ok: true as const, dialogs: [{ id: 'd', tabId: 't', type: 'prompt' as const, message: 'Имя', defaultValue: 'Черновик', openedAt: 1 }], total: 1 }
    const control = vi.fn(async () => ({ ok: true, result }))
    await makeApp(undefined, { browserControl: control })
    expect(JSON.parse((await call('dialogs', { tabId: 't' })).text)).toEqual(result)
    expect(control).toHaveBeenCalledWith(U, CONV, { type: 'dialogs', tabId: 't' })
  })

  it.each([true, false])('handle-dialog передаёт явный ответ %s', async accept => {
    const result = { id: 'c', conversationId: 'c', currentUrl: null, title: null, incarnation: 'i', state: 'ready' as const, activeTabId: '', tabs: [], viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }, dialogs: [] }
    const control = vi.fn(async () => ({ ok: true, result }))
    await makeApp(undefined, { browserControl: control })
    const args = { dialogId: 'd', accept, ...(accept ? { promptText: '' } : {}) }
    expect((await call('handle-dialog', args)).isError).not.toBe(true)
    expect(control).toHaveBeenCalledWith(U, CONV, { type: 'handleDialog', ...args })
  })

  it.each(['dialogs', 'handle-dialog'])('старый раннер не подтверждает %s общим ready', async name => {
    await makeApp(undefined, { browserControl: vi.fn(async () => ({ ok: true, result: { state: 'ready' } })) as never })
    expect((await call(name, name === 'dialogs' ? {} : { dialogId: 'd', accept: true })).isError).toBe(true)
  })

  it.each([{ dialogId: 'd', accept: false, promptText: 'ignored' }, { dialogId: 'd' }, { dialogId: '', accept: true }, { dialogId: 'd', accept: 'true' }, { dialogId: 'd', accept: true, promptText: 'x'.repeat(20001) }])('невалидный ответ не отправляется в браузер', async args => {
    const control = vi.fn(async () => null)
    await makeApp(undefined, { browserControl: control })
    expect((await call('handle-dialog', args)).isError).toBe(true)
    expect(control).not.toHaveBeenCalled()
  })

  it('reset-session очищает Chromium и jar прокси после подтверждённого успеха', async () => {
    const result = { ok: true, clearedCookies: 3, clearedOrigins: ['https://mail.example.com'] }
    const control = vi.fn(async () => ({ ok: true, result }))
    const clearCookies = vi.fn(() => 2)
    await makeApp({ machineOf: async () => null, testUsersOf: async () => [], clearCookies }, { browserControl: control })
    expect((await call('reset-session', { host: 'MAIL.EXAMPLE.COM' })).isError).not.toBe(true)
    expect(control).toHaveBeenCalledWith(U, CONV, { type: 'clearSiteData', scope: 'all', host: 'mail.example.com' })
    expect(clearCookies).toHaveBeenCalledWith(expect.objectContaining({ userId: U, conversationId: CONV }), 'mail.example.com')
  })

  it('reset-session доступен нативному Reader без контекста Web Reader', async () => {
    const result = { ok: true, clearedCookies: 0, clearedOrigins: [] }
    const control = vi.fn(async () => ({ ok: true, result }))
    await makeApp(undefined, { browserControl: control })
    expect(JSON.parse((await call('reset-session')).text)).toEqual(result)
    expect(control).toHaveBeenCalledWith(U, CONV, { type: 'clearSiteData', scope: 'all' })
  })

  it.each([{ ok: false, error: 'CDP недоступен' }, { ok: true, result: { state: 'ready' } }])('ошибка нативной очистки не выдаётся за успех jar: %j', async outcome => {
    const clearCookies = vi.fn(() => 2)
    await makeApp({ machineOf: async () => null, testUsersOf: async () => [], clearCookies }, { browserControl: vi.fn(async () => outcome) as never })
    expect((await call('reset-session')).isError).toBe(true)
    expect(clearCookies).not.toHaveBeenCalled()
  })

  it('ошибочный host не вызывает очистку ни в Chromium, ни в jar', async () => {
    const clearCookies = vi.fn(() => 2)
    const control = vi.fn(async () => null)
    await makeApp({ machineOf: async () => null, testUsersOf: async () => [], clearCookies }, { browserControl: control })
    expect((await call('reset-session', { host: 'https://mail.example.com' })).isError).toBe(true)
    expect(control).not.toHaveBeenCalled()
    expect(clearCookies).not.toHaveBeenCalled()
  })

  it('environment без окружений объясняет, как их поднять', async () => {
    await makeApp({ machineOf: async () => null, testUsersOf: async () => [], environmentsOf: async () => [], clearCookies: () => 0 })
    const result = await call('environment')
    expect(result.text).toContain('карточки задачи')
  })

  it('screenshot возвращает модели картинку image-контентом с координатами', async () => {
    await makeApp()
    let seen: unknown
    client = (m) => {
      seen = m.action
      relay.resolve(U, m.requestId, { ok: true, result: { page: { url: 'https://a.b', title: '' }, rect: { x: 4, y: 8, width: 320, height: 200 }, dataUrl: 'data:image/png;base64,QUJD' } })
    }
    const res = await app.inject({
      method: 'POST',
      url: `${PREVIEW_MCP_PATH}?k=${SECRET}&turn=${TURN}`,
      headers: MCP_HEADERS,
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'screenshot', arguments: { selector: '#hero' } } }
    })
    expect(seen).toEqual({ kind: 'screenshot', selector: '#hero' })
    const body = res.json() as { result: { content: Array<{ type: string; data?: string; mimeType?: string; text?: string }>; isError?: boolean } }
    expect(body.result.isError).not.toBe(true)
    expect(body.result.content[0]).toMatchObject({ type: 'image', data: 'QUJD', mimeType: 'image/png' })
    expect(body.result.content[1]?.text).toContain('320×200')
  })

  it('screenshot без картинки в ответе — ошибка, отказ клиента доходит как текст', async () => {
    await makeApp()
    client = (m) => relay.resolve(U, m.requestId, { ok: false, error: 'Страница ещё загружается.' })
    const result = await call('screenshot', {})
    expect(result.isError).toBe(true)
    expect(result.text).toContain('загружается')
  })

  it('hover/scroll/press доходят до клиента как действия', async () => {
    await makeApp()
    const seen: unknown[] = []
    client = (m) => {
      seen.push(m.action)
      relay.resolve(U, m.requestId, { ok: true, result: { page: { url: 'https://a.b', title: '' }, pressed: { key: 'Escape', selector: 'body' } } })
    }
    await call('hover', { text: 'Меню' })
    await call('scroll', { to: 'bottom' })
    await call('press', { key: 'Escape' })
    expect(seen).toEqual([
      { kind: 'hover', text: 'Меню' },
      { kind: 'scroll', to: 'bottom' },
      { kind: 'press', key: 'Escape' }
    ])
  })

  it('scroll без to и dy — ошибка аргументов без похода к клиенту', async () => {
    await makeApp()
    let touched = false
    client = () => { touched = true }
    const result = await call('scroll', {})
    expect(result.isError).toBe(true)
    expect(touched).toBe(false)
  })

  it('open разворачивает алиас machine.internal в машину разговора', async () => {
    await makeApp({ machineOf: async () => 'agent-7', testUsersOf: async () => [] })
    let seen: unknown
    client = (m) => {
      seen = m.action
      relay.resolve(U, m.requestId, { ok: true, result: { url: 'http://agent-7.machine.internal:5173/' } })
    }
    const result = await call('open', { url: 'http://machine.internal:5173/' })
    expect(seen).toEqual({ kind: 'open', url: 'http://agent-7.machine.internal:5173/' })
    expect(result.isError).not.toBe(true)
  })

  it('алиас machine.internal без машины разговора — понятная ошибка без похода к клиенту', async () => {
    await makeApp({ machineOf: async () => null, testUsersOf: async () => [] })
    let touched = false
    client = () => { touched = true }
    const result = await call('open', { url: 'http://machine.internal:5173/' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('нет доступной машины')
    expect(touched).toBe(false)
  })

  it('test-users возвращает тестовые учётки проекта разговора', async () => {
    await makeApp({
      machineOf: async () => null,
      testUsersOf: async (entry) => (entry.conversationId === CONV ? [{ name: 'tester', password: 'test-pass', role: 'admin' }] : [])
    })
    const result = await call('test-users')
    expect(JSON.parse(result.text)).toEqual([{ name: 'tester', password: 'test-pass', role: 'admin' }])
    expect(result.isError).not.toBe(true)
  })

  it('test-users без заведённых учёток объясняет, где их завести', async () => {
    await makeApp({ machineOf: async () => null, testUsersOf: async () => [] })
    const result = await call('test-users')
    expect(result.text).toContain('настройках проекта')
  })

  it('open транслирует действие клиенту и возвращает его результат', async () => {
    await makeApp()
    let seen: unknown
    client = (m) => {
      seen = m.action
      relay.resolve(U, m.requestId, { ok: true, result: { url: 'https://shop.example' } })
    }
    const result = await call('open', { url: 'https://shop.example' })
    expect(seen).toEqual({ kind: 'open', url: 'https://shop.example' })
    expect(JSON.parse(result.text)).toEqual({ url: 'https://shop.example' })
    expect(result.isError).not.toBe(true)
  })

  it('open отклоняет не-HTTP схему без похода к клиенту', async () => {
    await makeApp()
    let called = false
    client = () => { called = true }
    const result = await call('open', { url: 'javascript:alert(1)' })
    expect(result.isError).toBe(true)
    expect(called).toBe(false)
  })

  it('find без text и selector — ошибка аргументов', async () => {
    await makeApp()
    const result = await call('find', {})
    expect(result.isError).toBe(true)
    expect(result.text).toContain('text или selector')
  })

  it('click передаёт text, ошибка клиента доходит до модели', async () => {
    await makeApp()
    client = (m) => relay.resolve(U, m.requestId, { ok: false, error: 'Элемент не найден: Электроника' })
    const result = await call('click', { text: 'Электроника' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Элемент не найден')
  })

  it('без токена хода инструменты не работают', async () => {
    await makeApp()
    const result = await call('read', {}, `?k=${SECRET}&turn=чужой`)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Контекст хода недоступен')
  })

  it('type с submit доходит до клиента как действие type', async () => {
    await makeApp()
    let seen: unknown
    client = (m) => {
      seen = m.action
      relay.resolve(U, m.requestId, {
        ok: true,
        result: { page: { url: 'https://a.b', title: '' }, typed: { selector: '#q', tag: 'input', text: '' }, submitted: true }
      })
    }
    const result = await call('type', { selector: '#q', text: 'ноутбук', submit: true })
    expect(seen).toEqual({ kind: 'type', selector: '#q', text: 'ноутбук', submit: true })
    expect(JSON.parse(result.text).submitted).toBe(true)
  })

  it('evaluate проходит гейт и требует явное подтверждение', async () => {
    let confirmed = false
    await makeApp({
      machineOf: async () => null,
      testUsersOf: async () => [],
      gateEvaluate: async (_entry, _code, value) => value ? { allowed: true } : { allowed: false, needsConfirmation: true, reason: 'опасный код' }
    })
    client = (message) => { confirmed = true; relay.resolve(U, message.requestId, { ok: true, result: { page: { url: 'https://a.b', title: 'A' }, value: '1' } }) }
    const denied = await call('evaluate', { code: 'document.body.remove()' })
    expect(denied.isError).toBe(true)
    expect(denied.text).toContain('подтверждение')
    expect(confirmed).toBe(false)
    const allowed = await call('evaluate', { code: 'document.body.remove()', confirm: true })
    expect(allowed.isError).not.toBe(true)
    expect(confirmed).toBe(true)
  })

  it('network/console/evaluate/forward/a11y доходят до клиента как действия', async () => {
    await makeApp()
    const seen: unknown[] = []
    client = (m) => {
      seen.push(m.action)
      relay.resolve(U, m.requestId, { ok: true, result: { page: { url: 'https://a.b', title: '' }, value: '4' } })
    }
    await call('network', { filter: '/api/', limit: 20 })
    await call('console', { pattern: '[App]', level: 'warn', clear: true })
    await call('evaluate', { code: '2 + 2' })
    await call('forward')
    await call('a11y', { selector: 'main', limit: 50 })
    expect(seen).toEqual([
      { kind: 'network', filter: '/api/', limit: 20 },
      { kind: 'console', pattern: '[App]', level: 'warn', clear: true },
      { kind: 'evaluate', code: '2 + 2' },
      { kind: 'forward' },
      { kind: 'a11y', selector: 'main', limit: 50 }
    ])
  })

  it('drag/set/upload/viewport и click с модификаторами собирают действие целиком', async () => {
    await makeApp()
    const seen: unknown[] = []
    client = (m) => {
      seen.push(m.action)
      relay.resolve(U, m.requestId, { ok: true, result: { width: 375 } })
    }
    await call('drag', { from: { selector: '#card' }, to: { x: 10, y: 20 } })
    await call('set', { selector: '#lang', value: 'ru' })
    await call('upload', { selector: '#attach', name: 'a.txt', base64: 'aGk=', mimeType: 'text/plain' })
    await call('viewport', { width: 375 })
    await call('click', { selector: '#row', button: 'right', modifiers: ['shift'] })
    expect(seen).toEqual([
      { kind: 'drag', from: { selector: '#card' }, to: { x: 10, y: 20 } },
      { kind: 'set', selector: '#lang', value: 'ru' },
      { kind: 'upload', selector: '#attach', name: 'a.txt', base64: 'aGk=', mimeType: 'text/plain' },
      { kind: 'viewport', width: 375 },
      { kind: 'click', selector: '#row', button: 'right', modifiers: ['shift'] }
    ])
  })

  it('drag без точки и set без значения — ошибка аргументов без похода к клиенту', async () => {
    await makeApp()
    let touched = false
    client = () => { touched = true }
    const drag = await call('drag', { from: {}, to: { selector: '#col' } })
    expect(drag.isError).toBe(true)
    const set = await call('set', { selector: '#lang' })
    expect(set.isError).toBe(true)
    expect(touched).toBe(false)
  })
})

// Снимок в Playwright Reader (круг 9). До него `screenshot` был единственным
// инструментом со своим транспортом: он звал relay напрямую, минуя
// browserExecutor, поэтому в разговоре с изолированным Chromium запрос уходил в
// браузер пользователя, где страницы этого разговора нет. Модель оставалась без
// вида страницы — ровно того, ради чего Playwright и брали.
describe('previewMcp — снимок из изолированного Chromium', () => {
  let app: FastifyInstance
  let relay: PreviewActionRelay
  const PNG = 'iVBORw0KGgo='

  async function call(name: string, args: Record<string, unknown> = {}): Promise<{ image?: { data: string }; text: string; isError?: boolean }> {
    const res = await app.inject({
      method: 'POST', url: `${PREVIEW_MCP_PATH}?k=${SECRET}&turn=${TURN}`, headers: MCP_HEADERS,
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
    })
    const body = res.json() as { result: { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean } }
    const image = body.result.content.find((item) => item.type === 'image') as { data: string } | undefined
    return {
      ...(image ? { image } : {}),
      text: body.result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n'),
      ...(body.result.isError ? { isError: true } : {})
    }
  }

  afterEach(async () => { await app.close() })

  it.each([
    { rect: { x: 40, y: 900, width: 160, height: 90 } },
    { fullPage: true },
    { animations: 'disabled' },
    { timeoutMs: 100 }
  ])('параметры снимка %j доходят до Chromium без потерь', async (args) => {
    app = Fastify({ logger: false })
    relay = new PreviewActionRelay()
    const capture = vi.fn(async () => ({ ok: true, result: { dataUrl: `data:image/png;base64,${PNG}` } }))
    registerPreviewMcp(app, { secret: SECRET, relay, browserScreenshot: capture })
    await app.ready()
    expect((await call('screenshot', args)).isError).not.toBe(true)
    expect(capture).toHaveBeenCalledWith(U, CONV, args)
  })

  it('конфликт selector/rect возвращает ошибку вместо другого снимка', async () => {
    app = Fastify({ logger: false })
    relay = new PreviewActionRelay()
    const capture = vi.fn(async () => ({ ok: true, result: { dataUrl: `data:image/png;base64,${PNG}` } }))
    registerPreviewMcp(app, { secret: SECRET, relay, browserScreenshot: capture })
    await app.ready()
    expect((await call('screenshot', { selector: '.card', rect: { x: 0, y: 0, width: 20, height: 20 } })).isError).toBe(true)
    expect(capture).not.toHaveBeenCalled()
  })

  it('режим fullPage не подменяется обычным снимком iframe', async () => {
    app = Fastify({ logger: false })
    relay = new PreviewActionRelay()
    const forward = vi.spyOn(relay, 'request')
    registerPreviewMcp(app, { secret: SECRET, relay, browserScreenshot: async () => null })
    await app.ready()
    expect(await call('screenshot', { fullPage: true })).toMatchObject({ isError: true, text: expect.stringContaining('Playwright Reader') })
    expect(forward).not.toHaveBeenCalled()
  })

  it('снимок берётся у раннера, а не у браузера пользователя', async () => {
    app = Fastify({ logger: false })
    relay = new PreviewActionRelay()
    const relaySpy = vi.spyOn(relay, 'request')
    registerPreviewMcp(app, {
      secret: SECRET, relay, timeoutMs: 500,
      browserScreenshot: async () => ({ ok: true, result: { page: { url: 'http://x', title: 'X' }, rect: { x: 0, y: 0, width: 1280, height: 800 }, dataUrl: `data:image/png;base64,${PNG}` } })
    })
    await app.ready()
    const result = await call('screenshot')
    expect(result.image?.data).toBe(PNG)
    expect(result.text).toContain('http://x')
    expect(result.text).toContain('X')
    expect(relaySpy).not.toHaveBeenCalled()
  })

  it('селектор доходит до раннера — снимается узел, а не вьюпорт', async () => {
    // Круг 10: до этого селектор игнорировался, отдавался вьюпорт с оговоркой.
    const seen: Array<{ selector?: string }> = []
    app = Fastify({ logger: false })
    relay = new PreviewActionRelay()
    registerPreviewMcp(app, {
      secret: SECRET, relay, timeoutMs: 500,
      browserScreenshot: async (_u, _c, args) => {
        seen.push(args)
        return { ok: true, result: { page: { url: 'http://x', title: 'X' }, rect: { x: 0, y: 0, width: 390, height: 844 }, dataUrl: `data:image/png;base64,${PNG}` } }
      }
    })
    await app.ready()
    const result = await call('screenshot', { selector: '.card' })
    expect(seen).toEqual([{ selector: '.card' }])
    expect(result.text).not.toContain('вьюпорт')
  })

  it('обычный разговор по-прежнему идёт в браузер пользователя', async () => {
    app = Fastify({ logger: false })
    relay = new PreviewActionRelay()
    relay.subscribe(U, (m) => {
      if (m.t === 'preview.action') relay.resolve(U, m.requestId, { ok: true, result: { page: { url: 'http://x', title: 'X' }, rect: { x: 1, y: 2, width: 3, height: 4 }, dataUrl: `data:image/png;base64,${PNG}` } })
    })
    // browserScreenshot вернул null — «этот разговор не про изолированный браузер».
    registerPreviewMcp(app, { secret: SECRET, relay, timeoutMs: 500, browserScreenshot: async () => null })
    await app.ready()
    const result = await call('screenshot')
    expect(result.image?.data).toBe(PNG)
    expect(result.text).not.toContain('вьюпорт')
  })
})
