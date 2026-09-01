import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { ServerMessage } from '@voicechat/shared'
import { MakeHub } from '../make/hub'
import { MakeWorkspaces } from '../make/workspace'
import { MakeTaskScopeBroker, registerMakeMcp } from './makeMcp'

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

async function setup(owner: string | null = 'ann', taskAuth?: { broker: MakeTaskScopeBroker; allowed: boolean }): Promise<void> {
  workspaces = new MakeWorkspaces(await mkdtemp(join(tmpdir(), 'vc-make-mcp-')))
  hub = new MakeHub()
  events = []
  hub.subscribe('ann', (m) => events.push(m))
  app = Fastify({ logger: false })
  registerMakeMcp(app, {
    workspaces, hub, ownerOf: () => owner,
    ...(taskAuth ? { taskScopes: taskAuth.broker, authorizeTaskSource: () => taskAuth.allowed } : {})
  }, SECRET)
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
    // Ход → снимок (roadmap-2 п.2): turns.ts кладёт этот id в meta ответа.
    expect(hub.turnSnapshot('t1')).toBe(state.snapshots[0]!.id)
    expect(hub.turnSnapshot('nope')).toBeUndefined()
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

  it('task scope публикует только list/read и отклоняет истёкший или неавторизованный scope', async () => {
    let now = 1_000
    const broker = new MakeTaskScopeBroker(100, () => now)
    await setup('ann', { broker, allowed: true })
    const token = broker.issue({ userId: 'ann', projectId: 'p1', taskId: 't1', conversationIds: [CONV] })
    const query = `?k=${SECRET}&conv=${CONV}&scope=${token}`
    expect((await rpc(INIT, query)).statusCode).toBe(200)
    const listed = (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }, query)).json() as { result?: { tools?: Array<{ name: string }> } }
    expect(listed.result?.tools?.map((tool) => tool.name)).toEqual(['make_list_files', 'make_read_file'])
    const mutation = (await rpc(call('make_write_file', { path: 'x', content: 'x' }), query)).json()
    expect(JSON.stringify(mutation)).toMatch(/not found/i)

    now += 101
    expect((await rpc(INIT, query)).statusCode).toBe(403)
    await app.close()
    const denied = new MakeTaskScopeBroker()
    await setup('ann', { broker: denied, allowed: false })
    const deniedToken = denied.issue({ userId: 'ann', projectId: 'p1', taskId: 't1', conversationIds: [CONV] })
    expect((await rpc(INIT, `?k=${SECRET}&conv=${CONV}&scope=${deniedToken}`)).statusCode).toBe(403)
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

  it('make_write_file возвращает замечания по записанному файлу: битая ссылка и ошибка компиляции', async () => {
    await app.close()
    await setup()
    const w = resultText((await rpc(call('make_write_file', { path: 'index.html', content: '<link rel="stylesheet" href="nope.css"><h1>a</h1>' }))).json())
    expect(w.text).toContain('Замечания по файлу')
    expect(w.text).toContain('nope.css')
    const ok = resultText((await rpc(call('make_write_file', { path: 'index.html', content: '<h1>a</h1>' }))).json())
    expect(ok.text).not.toContain('Замечания')
    const bad = resultText((await rpc(call('make_write_file', { path: 'src/App.tsx', content: 'export const A = () => <div>' }))).json())
    expect(bad.text).toContain('Ошибка компиляции')
  })

  it('make_apply_changes откатывает транзакцию при ошибке компиляции; make_edit_file правит фрагмент', async () => {
    await app.close()
    await setup()
    await rpc(INIT)
    const bad = resultText((await rpc(call('make_apply_changes', { files: [{ path: 'index.html', content: '<h1>tx</h1>' }, { path: 'src/App.tsx', content: 'export const A = () => <div>' }] }))).json())
    expect(bad.text).toContain('откачены')
    expect((await workspaces.read(CONV, 'index.html')).content).not.toBe('<h1>tx</h1>')
    const ok = resultText((await rpc(call('make_apply_changes', { files: [{ path: 'index.html', content: '<h1>tx</h1>' }] }))).json())
    expect(ok.text).toContain('Записано файлов: 1')
    const edited = resultText((await rpc(call('make_edit_file', { path: 'index.html', find: 'tx', replace: 'edited' }))).json())
    expect(edited.text).toContain('Заменено вхождений: 1')
    expect((await workspaces.read(CONV, 'index.html')).content).toBe('<h1>edited</h1>')
  })
})
