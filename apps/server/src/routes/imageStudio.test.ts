// Студия картинок: галерея, загрузка, генерация и правка по промпту.
// Генератор — фейк: важен контракт роутов (доступ, имена, квоты, новые файлы
// при правке), а не сам вызов LLM.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { VoiceChatDb } from '../db/database.js'
import { ImageStudioStore } from '../images/studio.js'
import { registerImageStudioRoutes } from './imageStudio.js'

const U = 'admin'
let app: FastifyInstance
let db: VoiceChatDb
let store: ImageStudioStore
let dir: string
let convId: string
let generated: Array<{ prompt: string; hasSource: boolean }>

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'img-routes-'))
  db = new VoiceChatDb(':memory:')
  db.createUser(U, '', 'admin')
  store = new ImageStudioStore(dir)
  convId = db.createConversation(U, 'Студия', 'images')!.id
  generated = []
  app = Fastify()
  app.decorateRequest('user', null)
  app.addHook('preHandler', async (req) => { (req as unknown as { user: { name: string } }).user = { name: U } })
  registerImageStudioRoutes(app, {
    db, store,
    generator: () => async ({ prompt, source }) => {
      generated.push({ prompt, hasSource: Boolean(source) })
      return Buffer.from(`png:${prompt}`)
    }
  })
  await app.ready()
})
afterEach(async () => {
  await app.close()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('студия картинок: роуты', () => {
  it('галерея: загрузка, чтение с mime, переименование, удаление', async () => {
    const up = await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/file`, payload: { path: 'логотип.png', dataBase64: Buffer.from('img').toString('base64') } })
    expect(up.statusCode).toBe(200)
    expect(up.json().map((file: { path: string }) => file.path)).toEqual(['логотип.png'])

    const read = await app.inject({ method: 'GET', url: `/api/image-studio/${convId}/file?path=${encodeURIComponent('логотип.png')}` })
    expect(read.headers['content-type']).toContain('image/png')
    expect(read.body).toBe('img')

    await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/rename`, payload: { from: 'логотип.png', to: 'лого.png' } })
    const del = await app.inject({ method: 'DELETE', url: `/api/image-studio/${convId}/file?path=${encodeURIComponent('лого.png')}` })
    expect(del.json()).toEqual([])
  })

  it('generate рисует по промпту и не затирает существующие имена', async () => {
    await store.writeBuffer(convId, 'изображение.png', Buffer.from('старое'))
    const res = await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/generate`, payload: { prompt: 'кот в очках' } })
    expect(res.statusCode).toBe(200)
    // Имя по умолчанию занято — новая картинка получила суффикс, старая цела.
    expect(res.json().file.path).toBe('изображение-2.png')
    expect((await store.readBuffer(convId, 'изображение.png'))!.toString()).toBe('старое')
    expect(generated).toEqual([{ prompt: 'кот в очках', hasSource: false }])
  })

  it('edit правит по промпту в новый файл, оригинал не трогается', async () => {
    await store.writeBuffer(convId, 'кот.png', Buffer.from('оригинал'))
    const res = await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/edit`, payload: { path: 'кот.png', prompt: 'добавь шляпу' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().file.path).toBe('кот-2.png')
    expect((await store.readBuffer(convId, 'кот.png'))!.toString()).toBe('оригинал')
    expect(generated).toEqual([{ prompt: 'добавь шляпу', hasSource: true }])
  })

  it('пустой промпт — 400 словами; обычный чат — 404', async () => {
    expect((await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/generate`, payload: { prompt: '  ' } })).statusCode).toBe(400)
    const plain = db.createConversation(U, 'Обычный')!.id
    expect((await app.inject({ method: 'GET', url: `/api/image-studio/${plain}/files` })).statusCode).toBe(404)
  })
})
