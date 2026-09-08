// Те же пользовательские запросы проходят embedded и remote. В remote каталог
// студии физически отдельный: тест не может случайно пройти за счёт общего store.
import { createServer } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildImageStudioServer } from '@voicechat/image-studio/standalone'
import { imageBlock, INTERNAL_IMAGE_STUDIO_CORE_PATH, INTERNAL_IMAGE_STUDIO_GENERATE_PATH, INTERNAL_IMAGE_STUDIO_SERVICE_PATH } from '@voicechat/shared'
import type { LlmClient, LlmRequest, LlmStreamHandlers } from '../claude/types.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { buildServer } from '../server.js'
import { signToken } from '../users/accounts.js'
import { createRemoteImageStudio } from './remote.js'

const SECRET = 'studio-session-secret'
const INTERNAL = 'studio-internal-token'
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('fixture')])
const auth = { authorization: `Bearer ${signToken({ name: 'ann', role: 'developer' }, SECRET)}` }

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { const port = (server.address() as { port: number }).port; server.close(() => resolve(port)) })
  })
}

describe.each(['embedded', 'remote'] as const)('студия картинок: %s', (mode) => {
  let dir: string
  let db: VoiceChatDb
  let core: FastifyInstance
  let studio: FastifyInstance | undefined
  let coreUrl: string
  let studioUrl: string
  let conv: string
  let foreign: string
  let plain: string
  let generatedPath: string
  let holdNext = false
  let cancelCalls = 0
  const requests: LlmRequest[] = []
  const client = {
    send(req: LlmRequest, handlers: LlmStreamHandlers) {
      requests.push(req)
      if (holdNext) { holdNext = false; return { cancel: () => { cancelCalls++ } } }
      generatedPath = join(req.cwd!, 'from-runner.png')
      writeFileSync(generatedPath, PNG)
      queueMicrotask(() => { void handlers.onDone(imageBlock({ path: generatedPath })) })
      return { cancel() {} }
    }
  } as unknown as LlmClient

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vc-studio-remote-'))
    db = new VoiceChatDb(':memory:')
    await db.identity.createUser('ann', 'password-1', 'developer')
    await db.identity.createUser('bob', 'password-2', 'developer')
    conv = (await db.chat.createConversation('ann', 'Картинки 1', 'images'))!.id
    foreign = (await db.chat.createConversation('bob', 'Чужая студия', 'images'))!.id
    plain = (await db.chat.createConversation('ann', 'Чат'))!.id
    const studioPort = await freePort()
    studioUrl = `http://127.0.0.1:${studioPort}`
    core = await buildServer({
      config: loadConfig({ PORT: '0', VC_DATA_DIR: join(dir, 'core'), VC_MODELS_DIR: join(dir, 'models'), VC_PIPER_VOICES_DIR: join(dir, 'voices'),
        VC_IMAGE_STUDIO_MODE: mode, VC_IMAGE_STUDIO_URL: studioUrl, VC_INTERNAL_TOKEN: INTERNAL }),
      db, codex: client, sessionSecret: SECRET
    })
    coreUrl = await core.listen({ host: '127.0.0.1', port: 0 })
    if (mode === 'remote') {
      studio = (await buildImageStudioServer({ config: { host: '127.0.0.1', port: studioPort, dataDir: join(dir, 'studio'), coreUrl, internalToken: INTERNAL, version: 'test' } })).app
      await studio.listen({ host: '127.0.0.1', port: studioPort })
    } else studioUrl = coreUrl
  }, 60_000)

  afterAll(async () => {
    await studio?.close()
    await core?.close()
    await db?.close()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  const api = (suffix: string) => `${coreUrl}/api/image-studio/${conv}/${suffix}`
  const post = (url: string, body: unknown = {}) => fetch(url, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) })

  it('закрывает API и внутренний RPC, различает владельца, чужую студию и обычный чат', async () => {
    expect((await fetch(api('files'))).status).toBe(401)
    for (const id of [foreign, plain, 'missing']) {
      expect((await fetch(`${coreUrl}/api/image-studio/${id}/files`, { headers: auth })).status).toBe(404)
    }
    for (const path of [INTERNAL_IMAGE_STUDIO_CORE_PATH, INTERNAL_IMAGE_STUDIO_GENERATE_PATH]) {
      expect((await post(`${coreUrl}${path}`, {})).status).toBe(401)
    }
    if (mode === 'remote') {
      expect((await fetch(`${studioUrl}/api/image-studio/${conv}/files`)).status).toBe(401)
      expect((await post(`${studioUrl}${INTERNAL_IMAGE_STUDIO_SERVICE_PATH}`)).status).toBe(401)
      expect(await (await fetch(`${studioUrl}/v1/health`)).json()).toEqual({ ok: true, service: 'image-studio', version: 'test' })
    }
  })

  it('сохраняет лимит загрузки 12 МБ через прокси, байты файла, переименование и корзину', async () => {
    const large = Buffer.alloc(12 * 1024 * 1024); PNG.copy(large)
    const upload = await post(api('file'), { path: 'large.png', dataBase64: large.toString('base64') })
    expect(upload.status).toBe(200)
    const read = await fetch(api('file?path=large.png'), { headers: auth })
    expect(Buffer.from(await read.arrayBuffer()).equals(large)).toBe(true)
    expect((await post(api('rename'), { from: 'large.png', to: 'renamed.png' })).status).toBe(200)
    expect((await fetch(api('file?path=renamed.png'), { method: 'DELETE', headers: { ...auth, 'content-type': 'application/json' } })).status).toBe(200)
    expect((await post(api('restore'), { name: 'renamed.png' })).status).toBe(200)
    if (mode === 'remote') expect(existsSync(join(dir, 'core', 'image-studio'))).toBe(false)
  })

  it('генерирует с референсом, правит новым файлом и переименовывает разговор через ядро', async () => {
    const generated = await post(api('generate'), { prompt: 'синий кот', references: ['renamed.png'], name: 'cat.png' })
    expect(generated.status).toBe(200)
    expect((await generated.json()).file.path).toBe('cat.png')
    expect(requests.at(-1)?.attachments?.[0]?.dataBase64.length).toBe(16 * 1024 * 1024)
    expect((await db.chat.getConversation('ann', conv))?.title).toBe('Картинки: синий кот')
    const edited = await post(api('edit'), { path: 'cat.png', prompt: 'добавь шляпу' })
    expect(edited.status).toBe(200)
    expect((await edited.json()).file).toMatchObject({ path: 'cat-2.png', source: 'cat.png' })
    expect(requests.at(-1)?.attachments?.[0]?.dataBase64).toBe(PNG.toString('base64'))
  })

  it('отмена через API останавливает LLM у ядра и освобождает слот разговора', async () => {
    const count = requests.length
    holdNext = true
    const running = post(api('generate'), { prompt: 'долго' })
    await vi.waitFor(() => expect(requests.length).toBe(count + 1))
    expect((await post(api('generate'), { prompt: 'параллельно' })).status).toBe(409)
    expect(await (await post(api('cancel'))).json()).toEqual({ cancelled: true })
    expect((await running).status).toBe(410)
    await vi.waitFor(() => expect(cancelCalls).toBe(1))
    expect(await (await fetch(api('run'), { headers: auth })).json()).toEqual({ active: false })
    expect((await post(api('generate'), { prompt: 'снова' })).status).toBe(200)
  })

  it('проверяет cookie и CSRF также при прямом обращении к студии', async () => {
    const login = await fetch(`${coreUrl}/api/session/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'ann', password: 'password-1' }) })
    const cookies = login.headers.getSetCookie().map((c) => c.split(';')[0]!)
    const cookie = cookies.join('; ')
    const csrf = cookies.find((c) => c.startsWith('vc_csrf='))!.slice('vc_csrf='.length)
    const url = `${studioUrl}/api/image-studio/${conv}`
    expect((await fetch(`${url}/files`, { headers: { cookie } })).status).toBe(200)
    const write = (extra: Record<string, string>) => fetch(`${url}/file`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...extra }, body: JSON.stringify({ path: 'cookie.png', dataBase64: PNG.toString('base64') }) })
    expect((await write({})).status).toBe(403)
    expect((await write({ 'x-vc-csrf': csrf })).status).toBe(200)
  })

  it('публичная галерея и пароль работают через прежний /g, cookie и ETag проходят прокси', async () => {
    const publication = await post(api('publish'), { password: 'secret' })
    const { url } = await publication.json() as { url: string }
    expect((await fetch(`${coreUrl}${url}`)).status).toBe(401)
    const gate = await fetch(`${coreUrl}${url}__auth__`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=secret', redirect: 'manual' })
    expect(gate.status).toBe(302)
    const cookie = gate.headers.getSetCookie().map((c) => c.split(';')[0]!).join('; ')
    expect((await fetch(`${coreUrl}${url}`, { headers: { cookie } })).status).toBe(200)
    const read = await fetch(`${coreUrl}${url}file?path=cat.png`, { headers: { cookie } })
    expect(read.status).toBe(200)
    expect((await fetch(`${coreUrl}${url}file?path=cat.png`, { headers: { cookie, 'if-none-match': read.headers.get('etag')! } })).status).toBe(304)
    expect((await fetch(api('publish'), { method: 'DELETE', headers: auth })).status).toBe(200)
    expect((await fetch(`${coreUrl}${url}`)).status).toBe(404)
  })

  if (mode === 'remote') it('контекст и захват результата чата работают по RPC без доступа ядра к каталогу студии', async () => {
    const service = createRemoteImageStudio({ studioUrl, token: INTERNAL })
    expect(await service.promptContext(conv)).toContain('cat.png')
    await service.captureImages('ann', conv, imageBlock({ path: generatedPath }))
    expect(await service.promptContext(conv)).toContain('from-runner.png')
    await service.captureImages('bob', conv, imageBlock({ path: generatedPath }))
    expect(await service.promptContext(conv)).not.toContain('from-runner-2.png')
    expect(existsSync(join(dir, 'core', 'image-studio'))).toBe(false)
  })

  if (mode === 'remote') it('перезапуск отменяет активный LLM, сохраняет файлы и возвращает рабочий API', async () => {
    const count = requests.length
    const cancelled = cancelCalls
    holdNext = true
    const running = post(api('generate'), { prompt: 'перезапуск' })
    await vi.waitFor(() => expect(requests.length).toBe(count + 1))
    await studio!.close()
    // Fastify может закрыть сокет раньше ответа отмены; прокси тогда возвращает 503.
    expect([410, 503]).toContain((await running).status)
    await vi.waitFor(() => expect(cancelCalls).toBe(cancelled + 1))
    // Ядро остаётся доступным, а отключённая студия даёт диагностируемую 503.
    const offline = await fetch(api('files'), { headers: auth })
    expect(offline.status).toBe(503)
    expect(await offline.json()).toEqual({ error: 'image_studio_unavailable' })
    const port = Number(new URL(studioUrl).port)
    studio = (await buildImageStudioServer({ config: { host: '127.0.0.1', port, dataDir: join(dir, 'studio'), coreUrl, internalToken: INTERNAL, version: 'test' } })).app
    await studio.listen({ host: '127.0.0.1', port })
    expect(await (await fetch(api('run'), { headers: auth })).json()).toEqual({ active: false })
    const read = await fetch(api('file?path=cat.png'), { headers: auth })
    expect(Buffer.from(await read.arrayBuffer()).equals(PNG)).toBe(true)
    expect((await post(api('generate'), { prompt: 'после перезапуска' })).status).toBe(200)
  })
})
