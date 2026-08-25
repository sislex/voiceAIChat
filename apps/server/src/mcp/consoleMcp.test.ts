import { describe, it, expect, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { PtyContext } from '@voicechat/shared'
import { registerConsoleMcp } from './consoleMcp'
import type { AgentRegistry } from '../agents/registry'

const SECRET = 'test-secret'
const CONV = 'c1'

const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

interface StubOpts {
  live?: boolean
  buffer?: string
  context?: PtyContext | null
  /** Симулировать выполнение: на ptyInput дописать вывод + строку-сентинел. */
  simulate?: boolean
}

function stubRegistry(opts: StubOpts): { registry: AgentRegistry; inputs: string[]; buffer: () => string } {
  const inputs: string[] = []
  let buffer = opts.buffer ?? ''
  const registry = {
    ptyLive: () => opts.live ?? true,
    ptyBufferText: () => (opts.live ?? true ? buffer : null),
    ptyContextOf: () => opts.context ?? null,
    ptyInput: (_id: string, data: string) => {
      inputs.push(data)
      if (opts.simulate) {
        const m = data.match(/__VCEND_[0-9a-z]+_/)
        // Терминал эхом печатает введённую строку (её console_run отрезает как
        // первую строку), затем идёт вывод команды и строка-сентинел.
        if (m) buffer += `${data.replace(/\r$/, '')}\n SIMOUT_LINE\n${m[0]}0__\n`
      }
    }
  } as unknown as AgentRegistry
  return { registry, inputs, buffer: () => buffer }
}

async function makeApp(registry: AgentRegistry): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  registerConsoleMcp(app, registry, SECRET)
  await app.ready()
  return app
}

async function rpc(app: FastifyInstance, body: unknown, query = `?k=${SECRET}&conv=${CONV}`): Promise<{ statusCode: number; json: () => unknown }> {
  const res = await app.inject({ method: 'POST', url: `/mcp/console${query}`, headers: MCP_HEADERS, payload: body as object })
  return { statusCode: res.statusCode, json: () => res.json() }
}

const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }
const call = (name: string, args: Record<string, unknown> = {}): unknown => ({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } })

/** Достаёт текст из ответа tools/call. */
function resultText(json: unknown): { text: string; isError: boolean } {
  const r = (json as { result?: { content?: { text?: string }[]; isError?: boolean } }).result
  return { text: r?.content?.map((c) => c.text ?? '').join('') ?? '', isError: Boolean(r?.isError) }
}

describe('consoleMcp', () => {
  let app: FastifyInstance
  afterEach(async () => { await app.close() })

  it('неверный секрет k → 403', async () => {
    app = await makeApp(stubRegistry({}).registry)
    const res = await rpc(app, INIT, `?k=wrong&conv=${CONV}`)
    expect(res.statusCode).toBe(403)
  })

  it('tools/list содержит все console-инструменты', async () => {
    app = await makeApp(stubRegistry({}).registry)
    await rpc(app, INIT)
    const res = await rpc(app, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} })
    const names = ((res.json() as { result: { tools: { name: string }[] } }).result.tools).map((t) => t.name).sort()
    expect(names).toEqual(['console_context', 'console_input', 'console_keys', 'console_read', 'console_run'])
  })

  it('console_read отдаёт экран без ANSI', async () => {
    app = await makeApp(stubRegistry({ buffer: '\x1b[32mhello\x1b[0m world\r\n' }).registry)
    await rpc(app, INIT)
    const res = await rpc(app, call('console_read'))
    expect(resultText(res.json()).text).toContain('hello world')
  })

  it('console_context возвращает cwd/процесс/altScreen', async () => {
    app = await makeApp(stubRegistry({ context: { cwd: '/srv/app', foreground: 'nano', altScreen: true } }).registry)
    await rpc(app, INIT)
    const t = resultText((await rpc(app, call('console_context'))).json()).text
    expect(t).toContain('/srv/app')
    expect(t).toContain('nano')
    expect(t).toContain('да')
  })

  it('console_run пишет команду с сентинелом и возвращает вывод и код', async () => {
    const stub = stubRegistry({ simulate: true, buffer: '' })
    app = await makeApp(stub.registry)
    await rpc(app, INIT)
    const t = resultText((await rpc(app, call('console_run', { command: 'ls' }))).json())
    expect(stub.inputs[0]).toContain('ls ; printf')
    expect(t.text).toContain('SIMOUT_LINE')
    expect(t.text).toContain('[exit code: 0]')
  })

  it('console_run в режиме ro=1 (План) отклоняется', async () => {
    app = await makeApp(stubRegistry({ simulate: true }).registry)
    await rpc(app, INIT)
    const t = resultText((await rpc(app, call('console_run', { command: 'ls' }), `?k=${SECRET}&conv=${CONV}&ro=1`)).json())
    expect(t.isError).toBe(true)
    expect(t.text).toContain('План')
  })

  it('console_run с необратимой командой без confirm — отказ', async () => {
    app = await makeApp(stubRegistry({ simulate: true }).registry)
    await rpc(app, INIT)
    const t = resultText((await rpc(app, call('console_run', { command: 'rm -rf build' }))).json())
    expect(t.isError).toBe(true)
    expect(t.text).toContain('confirm=true')
  })

  it('инструменты при закрытой консоли — понятная ошибка', async () => {
    app = await makeApp(stubRegistry({ live: false }).registry)
    await rpc(app, INIT)
    const t = resultText((await rpc(app, call('console_read'))).json())
    expect(t.isError).toBe(true)
    expect(t.text).toContain('не открыта')
  })

  it('console_keys маппит спец-клавиши, неизвестные — ошибка', async () => {
    const stub = stubRegistry({})
    app = await makeApp(stub.registry)
    await rpc(app, INIT)
    await rpc(app, call('console_keys', { keys: ['ctrl+x', 'enter'] }))
    expect(stub.inputs[0]).toBe('\x18\r')
    const bad = resultText((await rpc(app, call('console_keys', { keys: ['flurbo'] }))).json())
    expect(bad.isError).toBe(true)
  })
})
