import { expect, it, vi } from 'vitest'
import { AgentRegistry } from '../agents/registry.js'
import { MAX_CHAT_UPLOAD_BYTES } from '@voicechat/shared/fileStorage'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '@sislexa/identity/server/users/accounts'

it.each(['machine', 'storage'] as const)('accepts binary uploads with %s backend, limits and CSRF', async backend => {
  const dir = mkdtempSync(join(tmpdir(), 'binary-chat-'))
  const db = new VoiceChatDb(':memory:')
  const blobs = new Map<string, Uint8Array>()
  const put = vi.fn(async (id: string, bytes: Uint8Array) => { blobs.set(id, bytes) })
  const putStream = vi.fn(async (id: string, source: AsyncIterable<Uint8Array>) => {
    expect(source).not.toBeInstanceOf(Uint8Array)
    const chunks: Uint8Array[] = []
    for await (const chunk of source) chunks.push(chunk)
    blobs.set(id, Buffer.concat(chunks))
  })
  const registry = new AgentRegistry()
  const write = vi.spyOn(registry, 'fsWrite').mockResolvedValue({} as never)
  vi.spyOn(registry, 'fsMkdir').mockResolvedValue({} as never)
  vi.spyOn(registry, 'fsList').mockResolvedValue({ root: '/home/test' } as never)
  const app = await buildServer({ db, agentRegistry: registry, sessionSecret: 'binary-test',
    config: loadConfig({ VC_DATA_DIR: dir, VC_FILE_STORAGE_MODE: 'embedded', PORT: '0' }),
    storageNodes: [{ id: 'node', health: async () => ({ nodeId: 'node', capacityBytes: 60e9, usedBytes: 0, freeBytes: 60e9 }),
      put, putStream, get: async id => blobs.get(id)!, delete: async id => { blobs.delete(id) } }],
  })
  const token = signToken({ name: 'admin', role: 'admin' }, 'binary-test')
  const headers = { authorization: 'Bearer ' + token }
  const bytes = Buffer.from([0, 255, 13, 10, 42])
  const boundary = 'upload-test-boundary'
  const multipart = (data: Buffer, filename = 'note.bin') => Buffer.concat([
    Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\nContent-Type: application/octet-stream\r\n\r\n'),
    data, Buffer.from('\r\n--' + boundary + '--\r\n'),
  ])
  try {
    const c = await db.chat.createConversation('admin', 'Binary files')
    vi.spyOn(db.machines, 'listAgents').mockResolvedValue([{ id: 'machine' }] as never)
    expect((await app.inject({ method: 'PUT', url: '/api/settings', headers, payload: { chatFilesBackend: backend } })).statusCode).toBe(200)
    const query = new URLSearchParams({ conversationId: c.id, agentId: 'machine', name: 'note.bin' })
    for (const form of ['raw', 'multipart'] as const) {
      const contentType = form === 'raw' ? 'application/octet-stream' : 'multipart/form-data; boundary=' + boundary
      const payload = form === 'raw' ? bytes : multipart(bytes)
      const url = '/api/uploads?' + query
      const response = await app.inject({ method: 'POST', url, headers: { ...headers, 'content-type': contentType }, payload })
      expect(response.statusCode, response.body).toBe(200)
      expect(response.json()).toMatchObject({ name: 'note.bin', size: bytes.length, mimeType: 'application/octet-stream' })
      if (backend === 'storage') {
        expect(put).not.toHaveBeenCalled()
        expect(putStream).toHaveBeenCalled()
        expect([...blobs.values()].at(-1)).toEqual(bytes)
      } else {
        expect(write).toHaveBeenLastCalledWith('machine', expect.any(String), bytes.toString('base64'))
      }
      const cookie = 'vc_session=' + token + '; vc_csrf=proof'
      const denied = await app.inject({ method: 'POST', url, headers: { cookie, 'content-type': contentType }, payload })
      expect(denied.statusCode).toBe(403)
      const allowed = await app.inject({ method: 'POST', url, headers: { cookie, 'x-vc-csrf': 'proof', 'content-type': contentType }, payload })
      expect(allowed.statusCode, allowed.body).toBe(200)
      const oversized = Buffer.alloc(MAX_CHAT_UPLOAD_BYTES + 1)
      const large = await app.inject({ method: 'POST', url, headers: { ...headers, 'content-type': contentType },
        payload: form === 'raw' ? oversized : multipart(oversized) })
      expect(large.statusCode, large.body).toBe(413)
    }
    const missing = await app.inject({ method: 'POST', url: '/api/uploads?conversationId=' + c.id,
      headers: { ...headers, 'content-type': 'text/plain' }, payload: 'hello' })
    expect(missing.statusCode).toBe(400)
    const noName = await app.inject({ method: 'POST', url: '/api/uploads?conversationId=' + c.id + '&name=',
      headers: { ...headers, 'content-type': 'multipart/form-data; boundary=' + boundary }, payload: multipart(bytes) })
    expect(noName.statusCode).toBe(400)
    const filename = await app.inject({ method: 'POST', url: '/api/uploads?conversationId=' + c.id + '&agentId=machine',
      headers: { ...headers, 'content-type': 'multipart/form-data; boundary=' + boundary }, payload: multipart(bytes, 'from-part.bin') })
    expect(filename.statusCode, filename.body).toBe(200)
    expect(filename.json().name).toBe('from-part.bin')
    const byHeaders = await app.inject({ method: 'POST', url: '/api/uploads',
      headers: { ...headers, 'content-type': 'application/octet-stream', name: 'headers.bin', conversationid: c.id, agentid: 'machine' }, payload: bytes })
    expect(byHeaders.statusCode, byHeaders.body).toBe(200)
    expect(byHeaders.json().name).toBe('headers.bin')
    const jsonFile = await app.inject({ method: 'POST', url: '/api/uploads?' + query,
      headers: { ...headers, 'content-type': 'application/json', mimetype: 'text/plain' }, payload: '{"hello":true}' })
    expect(jsonFile.statusCode, jsonFile.body).toBe(200)
    expect(jsonFile.json()).toMatchObject({ size: 14, mimeType: 'text/plain' })
    const extra = Buffer.concat([multipart(bytes).subarray(0, -Buffer.byteLength('--' + boundary + '--\r\n')), multipart(bytes)])
    const invalid = await app.inject({ method: 'POST', url: '/api/uploads?' + query,
      headers: { ...headers, 'content-type': 'multipart/form-data; boundary=' + boundary }, payload: extra })
    expect(invalid.statusCode).toBeGreaterThanOrEqual(400)
    expect(invalid.statusCode).toBeLessThan(500)
    const count = blobs.size
    const truncated = await app.inject({ method: 'POST', url: '/api/uploads?' + query,
      headers: { ...headers, 'content-type': 'multipart/form-data; boundary=' + boundary }, payload: multipart(bytes).subarray(0, -12) })
    expect(truncated.statusCode).toBeGreaterThanOrEqual(400)
    expect(truncated.statusCode).toBeLessThan(500)
    expect(blobs.size).toBe(count)
    expect((await app.inject({ method: 'POST', url: '/api/uploads?' + query,
      headers: { 'content-type': 'text/plain' }, payload: 'hello' })).statusCode).toBe(401)
  } finally { await app.close(); await db.close(); rmSync(dir, { recursive: true, force: true }) }
}, 60_000)

it('round trips both chat backends and preserves storage history through a Core restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'storage-chat-'))
  const blobs = new Map<string, Uint8Array>()
  const nodes = [{id:'node', health: async () => ({nodeId:'node', capacityBytes:60e9, usedBytes:0, freeBytes:60e9}),
    put: async (id: string, bytes: Uint8Array) => {blobs.set(id, bytes)}, get: async (id: string) => blobs.get(id)!,
    delete: async (id: string) => {blobs.delete(id)} }]
  const config = loadConfig({VC_DATA_DIR:dir, VC_FILE_STORAGE_MODE:'embedded', PORT:'0'})
  let db = new VoiceChatDb(join(dir, 'core.sqlite'))
  let app = await buildServer({config, db, storageNodes:nodes, sessionSecret:'storage-test'})
  const headers = {authorization:'Bearer ' + signToken({name:'admin', role:'admin'}, 'storage-test')}
  const call = (method: 'GET'|'POST'|'PUT', url: string, payload?: object) => app.inject({method, url, headers, payload})
  try {
    expect((await app.inject('/api/storage/usage')).statusCode).toBe(401)
    const c = (await call('POST', '/api/conversations', {title:'Files'})).json()
    const upload = {name:'note.txt', mimeType:'text/plain', conversationId:c.id, dataBase64:Buffer.from('hello').toString('base64')}
    const machine = (await call('POST', '/api/uploads', upload)).json()
    expect(machine.storage).toBeUndefined()
    expect((await call('GET', '/api/files/read?path=' + encodeURIComponent(machine.path))).statusCode).toBe(200)
    const setting = await call('PUT', '/api/settings', {chatFilesBackend:'storage'})
    expect(setting.json().chatFilesBackend).toBe('storage')
    const responses = await Promise.all(Array.from({length: 3}, () => call('POST', '/api/uploads', upload)))
    for (const result of responses) expect(result.statusCode, result.body).toBe(200)
    expect(new Set(responses.map(result => result.json().storage.spaceId)).size).toBe(1)
    const response = responses[0]
    expect(response.statusCode, response.body).toBe(200)
    const stored = response.json()
    expect(stored.storage).toMatchObject({spaceId: expect.any(String), path: expect.any(String)})
    const fileUrl = '/api/storage/spaces/' + stored.storage.spaceId + '/file?path=' + encodeURIComponent(stored.storage.path)
    expect((await call('GET', fileUrl)).body).toBe('hello')
    const message = await call('POST', '/api/conversations/' + c.id + '/messages', {
      role:'user', text:'Attached', time:'12:00', attachments:[{...stored, uploadId:stored.id}],
    })
    expect(message.statusCode, message.body).toBe(200)
    await app.close(); await db.close()
    db = new VoiceChatDb(join(dir, 'core.sqlite'))
    app = await buildServer({config, db, storageNodes:nodes, sessionSecret:'storage-test'})
    expect((await call('GET', fileUrl)).body).toBe('hello')
    const messages = await db.chat.listMessages('admin', c.id)
    expect(messages.some(m => m.attachments?.some(a => a.storage?.spaceId === stored.storage.spaceId))).toBe(true)
    const spaces = (await call('GET', '/api/storage/spaces')).json()
    expect(spaces.filter((s: {kind:string; ref:string}) => s.kind === 'chat' && s.ref === c.id)).toHaveLength(1)
  } finally {await app.close(); await db.close(); rmSync(dir, {recursive:true, force:true})}
}, 60_000)

