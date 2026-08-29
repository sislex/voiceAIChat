// MCP «browser» и relay действий превью: доступ по секрету, трансляция действия
// клиентам пользователя, ожидание первого успеха/всех отказов/таймаута и
// сериализация результата для модели.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { ServerMessage } from '@voicechat/shared'
import {
  PREVIEW_MCP_PATH,
  PreviewActionRelay,
  previewToolBroker,
  registerPreviewMcp
} from './previewMcp.js'

const SECRET = 'test-secret'
const TURN = 'turn-token'
const U = 'admin'
const CONV = 'conv-1'

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

  async function makeApp(context?: import('./previewMcp').PreviewTurnContext): Promise<void> {
    app = Fastify({ logger: false })
    relay = new PreviewActionRelay()
    relay.subscribe(U, (m) => {
      if (m.t === 'preview.action') client(m)
    })
    registerPreviewMcp(app, { secret: SECRET, relay, timeoutMs: 500, ...(context ? { context } : {}) })
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
    previewToolBroker.register(TURN, { userId: U, conversationId: CONV })
  })
  afterEach(async () => {
    previewToolBroker.unregister(TURN)
    await app.close()
    expect(previewToolBroker.size()).toBe(0)
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
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(['a11y', 'back', 'click', 'console', 'drag', 'edits', 'environment', 'errors', 'evaluate', 'find', 'forward', 'hover', 'network', 'open', 'press', 'read', 'reset-session', 'screenshot', 'scroll', 'set', 'test-users', 'type', 'upload', 'viewport', 'wait'])
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
      machineOf: () => null,
      testUsersOf: () => [],
      environmentsOf: () => [{ taskId: 't1', branch: 'CHAT-1', state: 'running', healthy: true, appUrl: 'http://agent-1.machine.internal:18123/', storybookUrl: null }],
      clearCookies: (_entry, host) => { clears.push(host); return 2 }
    })
    const environments = await call('environment')
    expect(JSON.parse(environments.text)).toEqual([{ taskId: 't1', branch: 'CHAT-1', state: 'running', healthy: true, appUrl: 'http://agent-1.machine.internal:18123/', storybookUrl: null }])
    const reset = await call('reset-session', { host: 'agent-1.machine.internal' })
    expect(reset.text).toContain('Сброшено cookie: 2')
    expect(clears).toEqual(['agent-1.machine.internal'])
  })

  it('environment без окружений объясняет, как их поднять', async () => {
    await makeApp({ machineOf: () => null, testUsersOf: () => [], environmentsOf: () => [], clearCookies: () => 0 })
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
    await makeApp({ machineOf: () => 'agent-7', testUsersOf: () => [] })
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
    await makeApp({ machineOf: () => null, testUsersOf: () => [] })
    let touched = false
    client = () => { touched = true }
    const result = await call('open', { url: 'http://machine.internal:5173/' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('нет доступной машины')
    expect(touched).toBe(false)
  })

  it('test-users возвращает тестовые учётки проекта разговора', async () => {
    await makeApp({
      machineOf: () => null,
      testUsersOf: (entry) => (entry.conversationId === CONV ? [{ name: 'tester', password: 'test-pass', role: 'admin' }] : [])
    })
    const result = await call('test-users')
    expect(JSON.parse(result.text)).toEqual([{ name: 'tester', password: 'test-pass', role: 'admin' }])
    expect(result.isError).not.toBe(true)
  })

  it('test-users без заведённых учёток объясняет, где их завести', async () => {
    await makeApp({ machineOf: () => null, testUsersOf: () => [] })
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
      machineOf: () => null,
      testUsersOf: () => [],
      gateEvaluate: (_entry, _code, value) => value ? { allowed: true } : { allowed: false, needsConfirmation: true, reason: 'опасный код' }
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
