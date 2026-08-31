// Файлы сервера, задачи из предложений, машины настроек разговора и preview-прокси.
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isPublicAddress, previewInspectorScript, rewritePreviewBody, upstreamRequestHeaders } from './previewProxy.js'
import type { FastifyInstance } from 'fastify'
import { VoiceChatDb } from '../db/database.js'
import { setupRestHarness } from './restHarness.js'

// Обвязка одна на все rest.*.test.ts — см. restHarness.ts.
// Хук harness зарегистрирован первым, поэтому к моменту этого beforeEach
// поля уже пересозданы под текущий тест.
const harness = setupRestHarness()
const { inj, U } = harness
let app: FastifyInstance
let db: VoiceChatDb
let token: string
let dataDir: string
beforeEach(() => { ({ app, db, token, dataDir } = harness) })


describe('REST: чтение файла с диска сервера (/api/files/read)', () => {
  // Профиль CLI создаётся при первом обращении к нему; дёргаем любой роут,
  // который его трогает, а затем кладём туда «сгенерированную» картинку.
  async function seedImage(): Promise<string> {
    await inj({ method: 'GET', url: '/api/auth/status' })
    const dir = join(dataDir, 'cli-users', Buffer.from(U).toString('base64url'), '.codex', 'generated_images', 'sess')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'pic.png')
    writeFileSync(file, 'PNGDATA')
    return file
  }

  it('отдаёт картинку из профиля пользователя', async () => {
    const file = await seedImage()
    const res = await inj({ method: 'GET', url: `/api/files/read?path=${encodeURIComponent(file)}` })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { name: string; dataBase64: string }
    expect(body.name).toBe('pic.png')
    expect(Buffer.from(body.dataBase64, 'base64').toString()).toBe('PNGDATA')
  })

  it('файл вне своей области — 404', async () => {
    await seedImage()
    const outside = join(tmpdir(), `vc-outside-${Date.now()}.png`)
    writeFileSync(outside, 'NOPE')
    const res = await inj({ method: 'GET', url: `/api/files/read?path=${encodeURIComponent(outside)}` })
    expect(res.statusCode).toBe(404)
    rmSync(outside, { force: true })
  })

  it('без токена — 401 (роут под общей защитой /api)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/files/read?path=/etc/passwd' })
    expect(res.statusCode).toBe(401)
  })

  it('системный файл не отдаётся', async () => {
    const res = await inj({ method: 'GET', url: '/api/files/read?path=/etc/passwd' })
    expect(res.statusCode).toBe(404)
  })
})

describe('REST: задачи из предложений улучшений', () => {
  it('создаёт атомарно, возвращает идемпотентный результат и отклоняет повторный переход', async () => {
    const project = db.createProject(U, { name: 'P' })
    const column = db.getBoard(U, project.id)!.columns[0]!
    const source = db.createTask(U, project.id, { columnId: column.id, title: 'Source' })!
    const improvement = db.upsertTaskImprovement({
      projectId: project.id, taskId: source.id, runId: null, stepId: null, source: 'development',
      title: 'Улучшить ретраи', description: 'Подробности', fingerprint: 'rest-retry',
      evidence: ['Ошибка видима'], suggestedAction: 'create_chatai_task'
    })
    const payload = { columnId: column.id, title: 'Retry task', description: 'D', acceptanceCriteria: 'AC' }
    const first = await inj({ method: 'POST', url: `/api/improvements/${improvement.id}/create-task`, payload })
    const second = await inj({ method: 'POST', url: `/api/improvements/${improvement.id}/create-task`, payload })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ created: true, improvement: { status: 'implemented' } })
    expect(second.json()).toMatchObject({ created: false, task: { id: first.json().task.id } })
    const invalid = await inj({ method: 'PATCH', url: `/api/improvements/${improvement.id}`, payload: { status: 'accepted' } })
    expect(invalid.statusCode).toBe(409)
  })
})

describe('REST: машины настроек разговора', () => {
  it('обычный чат видит только личные машины, проектный — личные и проектные без дублей', async () => {
    db.createUser('owner', '', 'developer')
    db.createUser('outsider', '', 'developer')
    const own = db.createAgent(U, 'Личная')
    const shared = db.createAgent('owner', 'Проектная')
    const hidden = db.createAgent('outsider', 'Чужая')
    const project = db.createProject('owner', { name: 'Shared' })
    db.linkMachine('owner', project.id, shared.id)
    db.addMember('owner', project.id, U)
    const plain = db.createConversation(U, 'Обычный')

    const plainMachines = (await inj({ method: 'GET', url: `/api/conversations/${plain.id}/machines` })).json()
    expect(plainMachines.map((a: { id: string }) => a.id)).toEqual([own.id])

    const projectMachines = (await inj({ method: 'GET', url: `/api/conversations/${plain.id}/machines?projectId=${project.id}` })).json()
    expect(projectMachines.map((a: { id: string }) => a.id).sort()).toEqual([own.id, shared.id].sort())
    expect(projectMachines.filter((a: { id: string }) => a.id === own.id)).toHaveLength(1)
    expect(projectMachines.some((a: { id: string }) => a.id === hidden.id)).toBe(false)
  })

  it('не даёт неучастнику увидеть проектную машину или сохранить недоступную', async () => {
    db.createUser('owner', '', 'developer')
    const foreign = db.createAgent('owner', 'Серверная')
    const project = db.createProject('owner', { name: 'Private' })
    db.linkMachine('owner', project.id, foreign.id)
    const conversation = db.createConversation(U, 'Чат')

    const list = (await inj({ method: 'GET', url: `/api/conversations/${conversation.id}/machines?projectId=${project.id}` })).json()
    expect(list.some((a: { id: string }) => a.id === foreign.id)).toBe(false)

    const denied = await inj({
      method: 'PATCH',
      url: `/api/conversations/${conversation.id}`,
      payload: { execTarget: foreign.id }
    })
    expect(denied.statusCode).toBe(403)
    expect(db.getConversation(U, conversation.id)?.execTarget).toBeNull()
  })
})

describe('REST: preview proxy', () => {
  it('блокирует loopback и приватные сети до запроса', async () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fe80::1', 'fc00::1']) expect(isPublicAddress(address)).toBe(false)
    expect(isPublicAddress('8.8.8.8')).toBe(true)
    expect((await inj({ method: 'GET', url: '/api/preview?url=http%3A%2F%2F127.0.0.1%2F' })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/preview?url=https%3A%2F%2Fexample.com' })).statusCode).toBe(401)
  })

  it('переписывает HTML-ссылки и убирает frame-ancestors CSP', () => {
    const html = '<meta http-equiv="Content-Security-Policy" content="frame-ancestors none"><a href="/next">next</a><img src="image.png"><script src="/app.js"></script>'
    const result = rewritePreviewBody(Buffer.from(html), 'text/html', new URL('https://site.example/base/')).toString()
    expect(result).not.toContain('Content-Security-Policy')
    expect(result).toContain('/api/preview?url=https%3A%2F%2Fsite.example%2Fnext')
    expect(result).toContain('/api/preview?url=https%3A%2F%2Fsite.example%2Fbase%2Fimage.png')
    expect(result).toContain('id="voicechat-preview-inspector"')
    expect(result.indexOf('voicechat-preview-inspector')).toBeLessThan(result.indexOf('</body>') === -1 ? result.length : result.indexOf('</body>'))
  })

  it('переписывает url() в <style>-блоках и inline style-атрибутах', () => {
    const html = '<style>.a{background:url("/bg.png")}</style><div style="background-image:url(img/x.png)">x</div>'
    const result = rewritePreviewBody(Buffer.from(html), 'text/html', new URL('https://site.example/base/')).toString()
    expect(result).toContain('url("/api/preview?url=https%3A%2F%2Fsite.example%2Fbg.png")')
    expect(result).toContain('url(/api/preview?url=https%3A%2F%2Fsite.example%2Fbase%2Fimg%2Fx.png)')
  })

  it('не пропускает наружу cookie и Authorization ChatAI, а Authorization страницы возвращает апстриму', () => {
    const headers = upstreamRequestHeaders({
      host: 'chat.example',
      cookie: 'vc_preview_session=secret',
      authorization: 'Bearer chatai-token',
      'x-preview-authorization': 'Bearer site-token',
      'content-type': 'application/json',
      'x-api-key': 'k',
      'sec-fetch-mode': 'cors',
      'accept-encoding': 'gzip',
      'x-forwarded-for': '1.2.3.4'
    })
    expect(headers).toEqual({ authorization: 'Bearer site-token', 'content-type': 'application/json', 'x-api-key': 'k' })
  })

  it('тело любого content-type принимается сырым, SSRF-граница действует и для POST', async () => {
    // Невалидный JSON не должен падать на парсере — тело уходит апстриму как есть,
    // а до апстрима запрос к приватному адресу не доходит (403, не 400/415).
    const json = await inj({ method: 'POST', url: '/api/preview?url=http%3A%2F%2F127.0.0.1%2F', payload: '{"broken', headers: { 'content-type': 'application/json' } })
    expect(json.statusCode).toBe(403)
    const beacon = await inj({ method: 'POST', url: '/api/preview?url=http%3A%2F%2F192.168.1.1%2F', payload: 'beacon-body', headers: { 'content-type': 'text/plain' } })
    expect(beacon.statusCode).toBe(403)
  })

  it('инспектор строит уникальный selector, сериализует стили и ограничивает payload', () => {
    const script = previewInspectorScript()
    expect(script).toContain('document.querySelectorAll(candidate).length===1')
    expect(script).toContain(':nth-of-type(')
    expect(script).toContain('outerHTML:el.outerHTML.slice(0,HTML_LIMIT)')
    expect(script).toContain("text:(el.innerText||el.textContent||'').trim().slice(0,TEXT_LIMIT)")
    expect(script).toContain('gridTemplateColumns:s.gridTemplateColumns')
    expect(script).toContain("document.addEventListener('click',click,true)")
    expect(script).toContain('e.stopImmediatePropagation()')
    expect(script).toContain('e.source!==parent||e.origin!==location.origin')
  })
})
