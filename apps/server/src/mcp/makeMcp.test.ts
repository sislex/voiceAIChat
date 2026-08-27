import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { ServerMessage } from '@voicechat/shared'
import { MakeHub } from '../make/hub'
import { MakeWorkspaces } from '../make/workspace'
import { registerMakeMcp } from './makeMcp'

const SECRET = 's'
const CONV = 'conv-mcp'
const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }
const call = (name: string, args: Record<string, unknown> = {}): unknown => ({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } })

function resultText(json: unknown): { text: string; isError: boolean } {
  const r = (json as { result?: { content?: { text?: string }[]; isError?: boolean } }).result
  return { text: r?.content?.map((c) => c.text ?? '').join('') ?? '', isError: Boolean(r?.isError) }
}

let app: FastifyInstance
let workspaces: MakeWorkspaces
let hub: MakeHub
let events: ServerMessage[]

async function setup(owner: string | null = 'ann'): Promise<void> {
  workspaces = new MakeWorkspaces(await mkdtemp(join(tmpdir(), 'vc-make-mcp-')))
  hub = new MakeHub()
  events = []
  hub.subscribe('ann', (m) => events.push(m))
  app = Fastify({ logger: false })
  registerMakeMcp(app, { workspaces, hub, ownerOf: () => owner }, SECRET)
  await app.ready()
}

afterEach(async () => { await app?.close() })

async function rpc(body: unknown, query = `?k=${SECRET}&conv=${CONV}&turn=t1`): Promise<{ statusCode: number; json: () => unknown }> {
  const res = await app.inject({ method: 'POST', url: `/mcp/make${query}`, headers: MCP_HEADERS, payload: body as object })
  return { statusCode: res.statusCode, json: () => res.json() }
}

describe('makeMcp', () => {
  it('без секрета — 403, без владельца — 404', async () => {
    await setup()
    expect((await rpc(INIT, `?k=wrong&conv=${CONV}`)).statusCode).toBe(403)
    await app.close()
    await setup(null)
    expect((await rpc(INIT)).statusCode).toBe(404)
  })

  it('list создаёт заготовку; write делает снимок «до правок» один раз за ход и шлёт make.changed', async () => {
    await setup()
    expect((await rpc(INIT)).statusCode).toBe(200)
    const list = resultText((await rpc(call('make_list_files'))).json())
    expect(list.text).toContain('index.html')

    const w1 = resultText((await rpc(call('make_write_file', { path: 'index.html', content: '<h1>a</h1>' }))).json())
    expect(w1.isError).toBe(false)
    expect(w1.text).toContain('Записано: index.html')
    await rpc(call('make_write_file', { path: 'app.js', content: 'x' }))
    const state = await workspaces.state(CONV)
    expect(state.snapshots.map((s) => s.label)).toEqual(['До правок ассистента'])
    expect(events.filter((e) => e.t === 'make.changed')).toHaveLength(2)
    expect(events[0]).toMatchObject({ t: 'make.changed', conversationId: CONV, paths: ['index.html'] })

    // Новый ход — новый снимок; с note подпись содержит запрос пользователя.
    await rpc(call('make_write_file', { path: 'index.html', content: '<h1>b</h1>' }), `?k=${SECRET}&conv=${CONV}&turn=t2&note=${encodeURIComponent('сделай тёмную тему')}`)
    const snaps = await workspaces.snapshots(CONV)
    expect(snaps).toHaveLength(2)
    expect(snaps[0]!.label).toBe('До правок: «сделай тёмную тему»')
  })

  it('read/rename/delete и ошибки путей возвращаются моделью текстом, ro=1 блокирует мутации', async () => {
    await setup()
    await rpc(INIT)
    await rpc(call('make_write_file', { path: 'a.css', content: 'body{}' }))
    expect(resultText((await rpc(call('make_read_file', { path: 'a.css' }))).json()).text).toBe('body{}')
    expect(resultText((await rpc(call('make_rename_file', { from: 'a.css', to: 'css/a.css' }))).json()).text).toContain('→ css/a.css')
    expect(resultText((await rpc(call('make_delete_file', { path: 'css/a.css' }))).json()).text).toContain('Удалено')
    const bad = resultText((await rpc(call('make_read_file', { path: '../x' }))).json())
    expect(bad.isError).toBe(true)
    expect(bad.text).toMatch(/Недопустимый путь/)
    const ro = resultText((await rpc(call('make_write_file', { path: 'z.js', content: '1' }), `?k=${SECRET}&conv=${CONV}&turn=t1&ro=1`)).json())
    expect(ro.isError).toBe(true)
    expect(ro.text).toMatch(/План/)
  })

  it('make_check сообщает о проблемах и об их отсутствии', async () => {
    await setup()
    await rpc(INIT)
    await rpc(call('make_write_file', { path: 'index.html', content: '<script src="missing.js"></script>' }))
    const bad = resultText((await rpc(call('make_check'))).json())
    expect(bad.isError).toBe(true)
    expect(bad.text).toContain('missing.js')
    await rpc(call('make_write_file', { path: 'missing.js', content: '1' }))
    const ok = resultText((await rpc(call('make_check'))).json())
    expect(ok.isError).toBe(false)
  })
})
