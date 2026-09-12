import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { registerImageStudioMcp } from './mcp.js'
import { ImageStudioStore } from './studio.js'

const SECRET = 'secret'
const CONVERSATION = 'images-1'
const HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }
const call = (name: string, args: Record<string, unknown> = {}): object => ({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } })

let app: FastifyInstance
let store: ImageStudioStore
let directory: string

function textOf(value: unknown): string {
  return ((value as { result?: { content?: Array<{ text?: string }> } }).result?.content ?? []).map((item) => item.text ?? '').join('')
}

async function rpc(payload: object, query = `?k=${SECRET}&conv=${CONVERSATION}&user=ann`) {
  return app.inject({ method: 'POST', url: `/mcp/image-studio${query}`, headers: HEADERS, payload })
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'image-studio-mcp-'))
  store = new ImageStudioStore(directory)
  app = Fastify()
  registerImageStudioMcp(app, {
    store,
    core: { conversation: async (userId, id) => userId === 'ann' && id === CONVERSATION ? { id, title: 'Studio', assistantKind: 'images' } : null },
    generator: async () => async ({ source, targetSize }) => source ?? sharp({ create: { width: targetSize?.width ?? 2, height: targetSize?.height ?? 2, channels: 4, background: '#ff0000ff' } }).png().toBuffer()
  }, SECRET)
  await app.ready()
})

afterEach(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }) })

describe('Image Studio MCP', () => {
  it('authenticates the scoped conversation and publishes all tools', async () => {
    expect((await rpc(INIT, `?k=wrong&conv=${CONVERSATION}&user=ann`)).statusCode).toBe(403)
    expect((await rpc(INIT, `?k=${SECRET}&conv=${CONVERSATION}&user=eve`)).statusCode).toBe(404)
    expect((await rpc(INIT)).statusCode).toBe(200)
    const listed = (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} })).json() as { result?: { tools?: Array<{ name: string }> } }
    expect(listed.result?.tools?.map((tool) => tool.name)).toEqual([
      'image_list', 'image_open', 'image_find_objects', 'image_generate', 'image_edit', 'image_retouch', 'image_extract', 'image_place', 'image_restore', 'image_rename', 'image_delete'
    ])
  })

  it('opens pixels and preserves a non-destructive restore node', async () => {
    const first = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#ff0000ff' } }).png().toBuffer()
    const second = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#00ff00ff' } }).png().toBuffer()
    await store.writeBuffer(CONVERSATION, 'портрет.png', first)
    await store.setMeta(CONVERSATION, 'портрет.png', { operation: 'upload' })
    await store.writeBuffer(CONVERSATION, 'портрет-2.png', second)
    await store.setMeta(CONVERSATION, 'портрет-2.png', { source: 'портрет.png', operation: 'edit' })

    const opened = (await rpc(call('image_open', { path: 'портрет.png' }))).json() as { result?: { content?: Array<{ type: string }> } }
    expect(opened.result?.content?.map((item) => item.type)).toEqual(['text', 'image'])
    expect(textOf((await rpc(call('image_restore', { currentPath: 'портрет-2.png', targetPath: 'портрет.png' }))).json())).toContain('сохранены')
    const files = await store.list(CONVERSATION)
    expect(files.find((file) => file.operation === 'restore')).toMatchObject({ source: 'портрет-2.png', restoredFrom: 'портрет.png' })
    expect(files.map((file) => file.path)).toEqual(expect.arrayContaining(['портрет.png', 'портрет-2.png']))
  })

  it('extracts an object and blocks mutations in plan mode', async () => {
    const image = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ffffffff' } })
      .composite([{ input: Buffer.from('<svg width="8" height="8"><rect x="2" y="2" width="4" height="4" fill="black"/></svg>') }]).png().toBuffer()
    await store.writeBuffer(CONVERSATION, 'человек.png', image)
    expect(textOf((await rpc(call('image_find_objects', { path: 'человек.png' }))).json())).toContain('"width": 4')
    const extracted = (await rpc(call('image_extract', { path: 'человек.png', selection: { kind: 'wand', x: 3, y: 3 } }))).json()
    expect(textOf(extracted)).toContain('Объект сохранён')
    const blocked = (await rpc(call('image_delete', { path: 'человек.png' }), `?k=${SECRET}&conv=${CONVERSATION}&user=ann&ro=1`)).json() as { result?: { isError?: boolean } }
    expect(blocked.result?.isError).toBe(true)
    expect(textOf(blocked)).toContain('План')
  })
})
