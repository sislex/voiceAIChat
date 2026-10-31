import { expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '@sislexa/identity/server/users/accounts'

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

