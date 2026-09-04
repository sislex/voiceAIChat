// Беседы, сообщения, настройки и полнотекстовый поиск.
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { signToken } from '../users/accounts.js'
import type { FastifyInstance } from 'fastify'
import { VoiceChatDb } from '../db/database.js'
import { AgentRegistry } from '../agents/registry.js'
import { setupRestHarness } from './restHarness.js'

// Обвязка одна на все rest.*.test.ts — см. restHarness.ts.
// Хук harness зарегистрирован первым, поэтому к моменту этого beforeEach
// поля уже пересозданы под текущий тест.
const harness = setupRestHarness()
const { inj, SECRET, U } = harness
let app: FastifyInstance
let db: VoiceChatDb
let agentRegistry: AgentRegistry
beforeEach(() => { ({ app, db, agentRegistry } = harness) })


describe('REST: conversations/messages/settings', () => {
  it('импорт desktop требует токен и идемпотентен', async () => {
    const payload = { conversations: [{ conversation: { id: 'legacy-c', title: 'Legacy', createdAt: 10, updatedAt: 20, claudeSessionId: null, execTarget: null }, messages: [{ id: 'legacy-m', conversationId: 'legacy-c', role: 'u1', text: 'hello', time: '10:00', createdAt: 15 }] }] }
    expect((await app.inject({ method: 'POST', url: '/api/migrations/desktop', payload })).statusCode).toBe(401)
    expect((await inj({ method: 'POST', url: '/api/migrations/desktop', payload })).json()).toEqual({ conversationsImported: 1, messagesImported: 1 })
    expect((await inj({ method: 'POST', url: '/api/migrations/desktop', payload })).json()).toEqual({ conversationsImported: 0, messagesImported: 0 })
  })

  it('draft endpoint атомарно создаёт проектный чат с первой репликой и повторяет ответ', async () => {
    const project = db.createProject(U, { name: 'Draft project', skills: ['ts'] })
    const payload = {
      idempotencyKey: 'draft-request-1',
      title: 'Файл README.md',
      projectId: project.id,
      message: { role: 'u1', text: '📎 README.md', time: '10:00', attachments: [{ path: '/tmp/README.md', name: 'README.md', mimeType: 'text/markdown', size: 10 }] }
    }
    const first = await inj({ method: 'POST', url: '/api/conversations/draft', payload })
    const replay = await inj({ method: 'POST', url: '/api/conversations/draft', payload })

    expect(first.statusCode).toBe(200)
    expect(replay.json().conversation.id).toBe(first.json().conversation.id)
    expect(first.json().conversation).toMatchObject({ title: 'Файл README.md', projectId: project.id, skillNames: ['ts'], messageCount: 1 })
    expect(first.json().messages).toHaveLength(1)
    expect((await inj({ method: 'GET', url: '/api/conversations' })).json()).toHaveLength(1)
  })

  it('create → list → get', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Тест' } })).json()
    expect(created.title).toBe('Тест')

    const list = (await inj({ method: 'GET', url: '/api/conversations' })).json()
    expect(list.map((c: { id: string }) => c.id)).toContain(created.id)

    const got = (await inj({ method: 'GET', url: `/api/conversations/${created.id}` })).json()
    expect(got.conversation.title).toBe('Тест')
    expect(got.messages).toEqual([])
  })

  it('404 на несуществующий разговор', async () => {
    const res = await inj({ method: 'GET', url: '/api/conversations/нет' })
    expect(res.statusCode).toBe(404)
  })

  it('возвращает авторизованный серверный снимок эффективного контекста', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Контекст' } })).json()
    const res = await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })
    expect(res.statusCode).toBe(200)
    const snapshot = res.json()
    expect(snapshot).toMatchObject({ schemaVersion: 1, conversationId: created.id })
    expect(new Date(snapshot.generatedAt).toISOString()).toBe(snapshot.generatedAt)
    expect(snapshot.freshnessWarning).toContain('момент формирования')
    const items = snapshot.groups.flatMap((group: { items: unknown[] }) => group.items)
    expect(items.length).toBeGreaterThan(10)
    for (const entry of items) expect(entry).toEqual(expect.objectContaining({ id: expect.any(String), type: expect.any(String), source: expect.any(String), scope: expect.any(String), priority: expect.any(String), configured: expect.any(Boolean), available: expect.any(Boolean), includedInNextTurn: expect.any(Boolean) }))
    expect(items.find((entry: { id: string }) => entry.id === 'current-message')).toMatchObject({ configured: false, available: false, includedInNextTurn: false })
    expect(items.find((entry: { id: string }) => entry.id === 'knowledge-mode').details.autoContextDocuments).toEqual([])
    // Тумблеры: безопасность не выключается, персонализация/kb — можно; по умолчанию всё включено.
    const byId = (id: string): { toggleable: boolean; enabled: boolean } => items.find((entry: { id: string }) => entry.id === id)
    expect(byId('platform-instructions')).toMatchObject({ toggleable: false, enabled: true })
    expect(byId('application-instructions')).toMatchObject({ toggleable: false, enabled: true })
    expect(byId('personalization').toggleable).toBe(true)
    expect(byId('knowledge-mode')).toMatchObject({ toggleable: true, enabled: true })
    // Drill-in: у пунктов есть полная детализация.
    const detailed = (id: string): { details?: Record<string, unknown> } => items.find((entry: { id: string }) => entry.id === id)
    expect(Object.keys(detailed('personalization').details ?? {})).toEqual(expect.arrayContaining(['Обращение', 'Язык ответа', 'Стиль', 'Тон', 'Текст в промпте']))
    expect(detailed('mcp-remote-bash').details).toMatchObject({ 'Инструмент': 'mcp__remote__bash', 'Изменяет данные': true })
    expect(detailed('mcp-kb-search').details).toMatchObject({ 'Инструмент': 'mcp__kb__search' })
  })

  it('Make: REST проекта, превью через cookie-путь, публикация /p/<token>/ без авторизации, чужой проект — 404', async () => {
    const conv = db.createConversation(U, 'Проект', 'make')
    const state = (await inj({ method: 'GET', url: `/api/make/${conv.id}` })).json() as { files: Array<{ path: string }>; published: unknown }
    expect(state.files.map((f) => f.path)).toContain('index.html')
    expect(state.published).toBeNull()
    // Превью без Bearer и без cookie — 401; с Bearer — отдаёт HTML с инспектором.
    const noAuth = await app.inject({ method: 'GET', url: `/api/preview/make/${conv.id}/index.html` })
    expect(noAuth.statusCode).toBe(401)
    const withAuth = await inj({ method: 'GET', url: `/api/preview/make/${conv.id}/index.html` })
    expect(withAuth.statusCode).toBe(200)
    expect(withAuth.headers['content-type']).toMatch(/text\/html/)
    expect(withAuth.body).toContain('data-vc-make-inspector')
    // Инжектируемый скрипт должен парситься: ломаный перехват консоли ломал и инспектор.
    const script = withAuth.body.match(/<script data-vc-make-inspector>([\s\S]*?)<\/script>/)![1]!
    expect(() => new Function(script)).not.toThrow()
    expect(script).toContain('vc-make.console')
    // Публикация: ссылка открывается без авторизации и без инспектора; после снятия — 404.
    const published = (await inj({ method: 'POST', url: `/api/make/${conv.id}/publish` })).json() as { published: { url: string } }
    expect(published.published.url).toMatch(/^\/p\//)
    const pub = await app.inject({ method: 'GET', url: `${published.published.url}index.html` })
    expect(pub.statusCode).toBe(200)
    expect(pub.body).not.toContain('data-vc-make-inspector')
    expect(pub.headers['x-robots-tag']).toBe('noindex')
    await inj({ method: 'DELETE', url: `/api/make/${conv.id}/publish` })
    expect((await app.inject({ method: 'GET', url: `${published.published.url}index.html` })).statusCode).toBe(404)
    // Обычный (не make) разговор для маршрутов Make — 404.
    const plain = db.createConversation(U, 'Чат')
    expect((await inj({ method: 'GET', url: `/api/make/${plain.id}` })).statusCode).toBe(404)
    // Проверка и шаблон.
    const check = (await inj({ method: 'GET', url: `/api/make/${conv.id}/check` })).json() as { issues: unknown[] }
    expect(check.issues).toEqual([])
    const templated = (await inj({ method: 'POST', url: `/api/make/${conv.id}/template`, payload: { templateId: 'landing' } })).json() as { snapshots: Array<{ label: string }> }
    expect(templated.snapshots[0]?.label).toContain('Лендинг')
    // Загрузка бинарника: base64 → байты, отдаётся превью с image/png.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])
    const uploaded = (await inj({ method: 'POST', url: `/api/make/${conv.id}/upload`, payload: { path: 'img/logo.png', dataBase64: png.toString('base64') } })).json() as { files: Array<{ path: string }> }
    expect(uploaded.files.map((f) => f.path)).toContain('img/logo.png')
    const img = await inj({ method: 'GET', url: `/api/preview/make/${conv.id}/img/logo.png` })
    expect(img.headers['content-type']).toMatch(/image\/png/)
    expect(img.rawPayload.equals(png)).toBe(true)
    // React: JSX транспилируется при отдаче, импорт без расширения дополняется; страница сториз собирается.
    await inj({ method: 'POST', url: `/api/make/${conv.id}/template`, payload: { templateId: 'react' } })
    await inj({ method: 'PUT', url: `/api/make/${conv.id}/file`, payload: { path: 'src/Extra.jsx', content: "import { Button } from './components/Button'\nexport const X = () => <Button>x</Button>" } })
    const jsx = await inj({ method: 'GET', url: `/api/preview/make/${conv.id}/src/Extra.jsx` })
    expect(jsx.headers['content-type']).toMatch(/javascript/)
    expect(jsx.body).toContain('./components/Button.jsx')
    expect(jsx.body).toContain('jsx(')
    expect(jsx.body).not.toContain('<Button>')
    const stories = (await inj({ method: 'GET', url: `/api/make/${conv.id}/stories` })).json() as { files: Array<{ path: string; title: string; stories: string[] }> }
    expect(stories.files.find((f) => f.path === 'src/components/Button.stories.jsx')).toMatchObject({ title: 'Button', stories: ['Primary', 'Secondary', 'Small'] })
    const runner = await inj({ method: 'GET', url: `/api/preview/make/${conv.id}/__stories__?file=src/components/Button.stories.jsx&story=Small` })
    expect(runner.statusCode).toBe(200)
    expect(runner.body).toContain('importmap')
    expect(runner.body).toContain('"Small"')
    // Галерея и сториз: в превью (cookie/Bearer) и на публикации без входа.
    // Auth-мок (roadmap-4 п.32): логин ставит cookie, защищённый мок читает её из запроса.
    await inj({ method: 'PUT', url: `/api/make/${conv.id}/file`, payload: { path: 'mock/api/login.POST.json', content: JSON.stringify({ $auth: { users: [{ username: 'anna', password: '1' }] } }) } })
    await inj({ method: 'PUT', url: `/api/make/${conv.id}/file`, payload: { path: 'mock/api/me.json', content: JSON.stringify({ $auth: { require: true }, $body: { role: 'admin' } }) } })
    const login = await inj({ method: 'POST', url: `/api/preview/make/${conv.id}/api/login`, payload: { username: 'anna', password: '1' } })
    expect(login.statusCode).toBe(200)
    expect(String(login.headers['set-cookie'])).toContain('vc_mock_session=anna')
    expect((await inj({ method: 'GET', url: `/api/preview/make/${conv.id}/api/me` })).statusCode).toBe(401)
    expect((await inj({ method: 'GET', url: `/api/preview/make/${conv.id}/api/me`, headers: { cookie: 'vc_mock_session=anna' } })).json()).toMatchObject({ role: 'admin', user: { username: 'anna' } })
    // Превью снимка (roadmap-4 п.37): index.html версии с <base>, чужой снимок — 404.
    const snapState = (await inj({ method: 'POST', url: `/api/make/${conv.id}/snapshots`, payload: { label: 'v1' } })).json() as { snapshots: Array<{ id: string }> }
    const snapPage = await inj({ method: 'GET', url: `/api/preview/make/${conv.id}/__snapshot__/${snapState.snapshots[0]!.id}/index.html` })
    expect(snapPage.statusCode).toBe(200)
    expect(snapPage.body).toContain(`<base href="/api/preview/make/${conv.id}/__snapshot__/${snapState.snapshots[0]!.id}/">`)
    expect((await inj({ method: 'GET', url: `/api/preview/make/${conv.id}/__snapshot__/nope/index.html` })).statusCode).toBe(404)
    const gallery = await inj({ method: 'GET', url: `/api/preview/make/${conv.id}/__gallery__` })
    expect(gallery.statusCode).toBe(200)
    expect(gallery.body).toContain('Button.stories.jsx')
    const pub2 = (await inj({ method: 'POST', url: `/api/make/${conv.id}/publish` })).json() as { published: { url: string } }
    // Комментарии зрителей (roadmap-4 п.34): выключены → 404; включены → виджет в HTML, POST → pending, GET отдаёт только одобренные.
    expect((await app.inject({ method: 'GET', url: `${pub2.published.url}__comments__` })).statusCode).toBe(404)
    await inj({ method: 'POST', url: `/api/make/${conv.id}/publish`, payload: { allowComments: true } })
    expect((await app.inject({ method: 'GET', url: `${pub2.published.url}index.html` })).body).toContain('data-vc-guest-comments')
    const guest = await app.inject({ method: 'POST', url: `${pub2.published.url}__comments__`, payload: { name: 'Зритель', text: 'Кнопка мелкая' } })
    expect(guest.statusCode).toBe(201)
    expect((await app.inject({ method: 'GET', url: `${pub2.published.url}__comments__` })).json()).toEqual({ comments: [] })
    const mine = (await inj({ method: 'GET', url: `/api/make/${conv.id}/comments` })).json() as { comments: Array<{ id: string; status?: string; guestName?: string; author: string }> }
    const pending = mine.comments.find((c) => c.status === 'pending')!
    expect(pending).toMatchObject({ author: 'guest', guestName: 'Зритель' })
    await inj({ method: 'PATCH', url: `/api/make/${conv.id}/comments/${pending.id}`, payload: { status: 'approved' } })
    expect(((await app.inject({ method: 'GET', url: `${pub2.published.url}__comments__` })).json() as { comments: unknown[] }).comments).toHaveLength(1)
    const pubGallery = await app.inject({ method: 'GET', url: `${pub2.published.url}__gallery__` })
    expect(pubGallery.statusCode).toBe(200)
    expect(pubGallery.body).toContain(`${pub2.published.url}__stories__?file=`)
    const pubStory = await app.inject({ method: 'GET', url: `${pub2.published.url}__stories__?file=src/components/Button.stories.jsx&story=Primary` })
    expect(pubStory.statusCode).toBe(200)
    expect(pubStory.body).toContain('"Primary"')
    await inj({ method: 'DELETE', url: `/api/make/${conv.id}/publish` })
    // Библиотека компонентов: экспорт из проекта, список, вставка в другой проект, удаление.
    const exp = (await inj({ method: 'POST', url: `/api/make/${conv.id}/library`, payload: { name: 'Button', paths: ['src/components/Button.jsx', 'src/components/Button.stories.jsx'] } })).json() as { item: { slug: string } }
    expect(exp.item.slug).toBe('button')
    expect(((await inj({ method: 'GET', url: '/api/make/library' })).json() as { items: unknown[] }).items).toHaveLength(1)
    const other = db.createConversation(U, 'Другой', 'make')
    const inserted = (await inj({ method: 'POST', url: `/api/make/${other.id}/library/button/insert` })).json() as { state: { files: Array<{ path: string }> } }
    expect(inserted.state.files.map((f) => f.path)).toContain('src/components/Button.stories.jsx')
    expect(((await inj({ method: 'DELETE', url: '/api/make/library/button' })).json() as { items: unknown[] }).items).toHaveLength(0)
    const search = (await inj({ method: 'GET', url: `/api/make/${conv.id}/search?q=btn--secondary` })).json() as { matches: Array<{ path: string; line: number }> }
    expect(search.matches.map((m) => m.path)).toContain('styles.css')
  })

  it('POST /messages для ответа без engine/execTarget подставляет эффективные движок и машину разговора', async () => {
    const conv = db.createConversation(U, 'Диагностика')
    db.saveSettings(U, { ...db.getSettings(U), llmProvider: 'codex' })
    const res = await inj({ method: 'POST', url: `/api/conversations/${conv.id}/messages`, payload: { role: 'ai', text: '✓ проверка', time: '10:00' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ role: 'ai', engine: 'codex', execTarget: null })
  })

  it('снимок содержит группу «Инструкции чата»; тумблер выключает инструкцию только в разговоре', async () => {
    const conv = db.createConversation(U, 'Чат')
    const groupOf = (json: { groups: Array<{ id: string; items: Array<{ id: string; enabled: boolean; includedInNextTurn: boolean; toggleable: boolean; details?: Record<string, unknown> }> }> }) => json.groups.find((g) => g.id === 'chat-instructions')!
    const first = groupOf((await inj({ method: 'GET', url: `/api/conversations/${conv.id}/context-snapshot` })).json())
    expect(first.items.map((item) => item.id)).toEqual(['instruction-console', 'instruction-explorer', 'instruction-git', 'instruction-questions', 'instruction-image', 'instruction-taskLaunch'])
    const consoleItem = first.items.find((item) => item.id === 'instruction-console')!
    expect(consoleItem).toMatchObject({ toggleable: true, enabled: true, includedInNextTurn: true })
    expect(String(consoleItem.details?.['Текст'])).toContain('```tool')

    await inj({ method: 'POST', url: `/api/conversations/${conv.id}/context/instruction-console`, payload: { enabled: false } })
    const second = groupOf((await inj({ method: 'GET', url: `/api/conversations/${conv.id}/context-snapshot` })).json())
    expect(second.items.find((item) => item.id === 'instruction-console')).toMatchObject({ enabled: false, includedInNextTurn: false })
    expect(second.items.find((item) => item.id === 'instruction-explorer')).toMatchObject({ enabled: true, includedInNextTurn: true })
  })

  it('снимок проектного чата: пункт проекта несёт точный текст, уходящий в промпт', async () => {
    const project = db.createProject(U, { name: 'Инспектор', gitUrl: 'https://example.com/repo.git', technologies: ['ts'] })
    const conv = db.createConversation(U, 'Проектный')
    db.setConversationProject(U, conv.id, project.id)
    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${conv.id}/context-snapshot` })).json()
    const item = snapshot.groups.flatMap((g: { items: { id: string; details?: Record<string, unknown> }[] }) => g.items).find((e: { id: string }) => e.id === 'project-binding')
    expect(item.details).toMatchObject({ 'ID проекта': project.id, 'Git': 'https://example.com/repo.git', 'Технологии': 'ts' })
    expect(String(item.details['Текст в промпте'])).toContain('## Контекст проекта «Инспектор»')
    expect(String(item.details['Текст в промпте'])).toContain(`ID проекта: ${project.id}`)
  })

  it('тумблер контекста: выключает пункт, отражает в снимке и отказывает выключить безопасность', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Toggle' } })).json()
    // Выключаем knowledge-mode.
    const off = await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/knowledge-mode`, payload: { enabled: false } })
    expect(off.statusCode).toBe(200)
    const kbItem = off.json().groups.flatMap((g: { items: { id: string; enabled: boolean; includedInNextTurn: boolean }[] }) => g.items).find((e: { id: string }) => e.id === 'knowledge-mode')
    expect(kbItem).toMatchObject({ enabled: false, includedInNextTurn: false })
    expect(db.getConversation(U, created.id)?.disabledContext).toContain('knowledge-mode')
    // Включаем обратно.
    const on = await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/knowledge-mode`, payload: { enabled: true } })
    expect(on.json().groups.flatMap((g: { items: { id: string; enabled: boolean }[] }) => g.items).find((e: { id: string }) => e.id === 'knowledge-mode').enabled).toBe(true)
    // Безопасность выключить нельзя.
    expect((await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/platform-instructions`, payload: { enabled: false } })).statusCode).toBe(400)
    expect(db.getConversation(U, created.id)?.disabledContext).not.toContain('platform-instructions')
  })

  it('снимок проектного чата наследует LLM проекта', async () => {
    const settings = db.getSettings(U)
    await inj({ method: 'PUT', url: '/api/settings', payload: { ...settings, llmProvider: 'claude', model: 'default' } })
    const project = db.createProject(U, { name: 'Codex project' })
    db.setCiLlmConfig('project', project.id, {
      provider: 'codex',
      model: 'gpt-5.6-sol',
      mode: 'development',
      clarifyLevel: 'few',
      clarifyMax: 3
    })
    const conversation = db.createConversation(U, 'Project context')
    db.setConversationProject(U, conversation.id, project.id)

    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${conversation.id}/context-snapshot` })).json()
    const llm = snapshot.groups.flatMap((group: { items: Array<{ id: string }> }) => group.items).find((item: { id: string }) => item.id === 'llm')

    expect(snapshot.summary).toMatchObject({ provider: 'codex', model: 'gpt-5.6-sol' })
    expect(llm).toMatchObject({
      source: 'Проект',
      description: 'codex · gpt-5.6-sol',
      explanation: 'Унаследовано из настроек проекта.'
    })
  })

  it('LLM override разговора имеет приоритет над проектом', async () => {
    const project = db.createProject(U, { name: 'Project defaults' })
    db.setCiLlmConfig('project', project.id, {
      provider: 'codex',
      model: 'gpt-5.6-sol',
      mode: 'development',
      clarifyLevel: 'few',
      clarifyMax: 3
    })
    const conversation = db.createConversation(U, 'Conversation override')
    db.setConversationProject(U, conversation.id, project.id)
    db.setConversationExecTarget(U, conversation.id, null, undefined, undefined, 'claude', 'haiku')

    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${conversation.id}/context-snapshot` })).json()
    const llm = snapshot.groups.flatMap((group: { items: Array<{ id: string }> }) => group.items).find((item: { id: string }) => item.id === 'llm')

    expect(snapshot.summary).toMatchObject({ provider: 'claude', model: 'haiku' })
    expect(llm).toMatchObject({
      source: 'Разговор',
      description: 'claude · haiku',
      explanation: 'Явное переопределение.'
    })
  })

  it('снимок непривязанного чата наследует пользовательскую LLM-пару', async () => {
    const settings = db.getSettings(U)
    await inj({ method: 'PUT', url: '/api/settings', payload: { ...settings, llmProvider: 'codex', codexModel: 'gpt-5.6-luna' } })
    const conversation = db.createConversation(U, 'Personal context')

    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${conversation.id}/context-snapshot` })).json()
    const llm = snapshot.groups.flatMap((group: { items: Array<{ id: string }> }) => group.items).find((item: { id: string }) => item.id === 'llm')

    expect(snapshot.summary).toMatchObject({ provider: 'codex', model: 'gpt-5.6-luna' })
    expect(llm).toMatchObject({
      source: 'Настройки пользователя',
      description: 'codex · gpt-5.6-luna',
      explanation: 'Унаследовано из настроек пользователя.'
    })
  })

  it('не раскрывает снимок чужого или отсутствующего разговора', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Чужой' } })).json()
    db.createUser('other', 'password', 'developer')
    const other = signToken({ name: 'other', role: 'developer' }, SECRET)
    const hidden = await app.inject({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot`, headers: { authorization: `Bearer ${other}` } })
    expect(hidden.statusCode).toBe(404)
    expect((await inj({ method: 'GET', url: '/api/conversations/missing/context-snapshot' })).statusCode).toBe(404)
  })

  it('поиск /conversations/search находит по названию (статик-роут не конфликтует с :id)', async () => {
    await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Лиссабон' } })
    await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Погода' } })
    const res = await inj({ method: 'GET', url: '/api/conversations/search?q=лисс' })
    expect(res.statusCode).toBe(200)
    const found = res.json()
    expect(found.map((c: { title: string }) => c.title)).toEqual(['Лиссабон'])
  })

  it('чат задачи в «Готово» уходит из списка, но открывается по ссылке и из карточки', async () => {
    const project = db.createProject(U, { name: 'P' })
    const board = db.getBoard(U, project.id)!
    const done = board.columns.find((c) => c.semanticType === 'done')!
    const task = db.createTask(U, project.id, { columnId: board.columns[0]!.id, title: 'Скролл' })!
    const chat = db.openOrCreateTaskChat(U, project.id, task.id)!
    const ids = async (url: string): Promise<string[]> =>
      (await inj({ method: 'GET', url })).json().map((c: { id: string }) => c.id)

    const context = `scope=kanban&projectId=${encodeURIComponent(project.id)}`
    expect(await ids(`/api/conversations?${context}`)).toContain(chat.id)
    db.moveTask(U, project.id, task.id, { columnId: done.id })
    expect(await ids(`/api/conversations?${context}`)).not.toContain(chat.id)
    expect(await ids(`/api/conversations?${context}&includeCompleted=1`)).toContain(chat.id)
    expect(await ids(`/api/conversations/search?${context}&q=${encodeURIComponent('Скролл')}`)).not.toContain(chat.id)
    expect(await ids(`/api/conversations/search?${context}&q=${encodeURIComponent('Скролл')}&includeCompleted=1`)).toContain(chat.id)

    const cancelled = board.columns.find((c) => c.semanticType === 'cancelled')!
    db.moveTask(U, project.id, task.id, { columnId: cancelled.id })
    expect(await ids(`/api/conversations?${context}`)).not.toContain(chat.id)
    expect(await ids(`/api/conversations?${context}&includeCompleted=1`)).not.toContain(chat.id)
    expect(await ids(`/api/conversations/search?${context}&q=${encodeURIComponent('Скролл')}&includeCompleted=1`)).not.toContain(chat.id)

    // Прямая ссылка и кнопка «Открыть чат» на карточке работают как раньше.
    expect((await inj({ method: 'GET', url: `/api/conversations/${chat.id}?${context}` })).json().conversation.id).toBe(chat.id)
    const fromCard = await inj({ method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/chat` })
    expect(fromCard.json().id).toBe(chat.id)
  })

  it('cc: projects/sessions/transcript из ~/.claude/projects (VC_CC_DIR)', async () => {
    const ccDir = mkdtempSync(join(tmpdir(), 'cc-rest-'))
    const proj = join(ccDir, '-Users-x-demo')
    mkdirSync(proj, { recursive: true })
    writeFileSync(
      join(proj, 'sess.jsonl'),
      [
        JSON.stringify({ type: 'user', cwd: '/Users/x/demo', message: { content: 'Помоги с фичей' } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Готово' }] } })
      ].join('\n')
    )
    const prev = process.env.VC_CC_DIR
    process.env.VC_CC_DIR = ccDir
    try {
      const projects = (await inj({ method: 'GET', url: '/api/cc/projects' })).json()
      const demo = projects.find((p: { name: string }) => p.name === 'demo')
      expect(demo?.path).toBe('/Users/x/demo')

      const sessions = (
        await inj({ method: 'GET', url: `/api/cc/projects/${demo.slug}/sessions` })
      ).json()
      expect(sessions[0].title).toBe('Помоги с фичей')

      const body = (
        await inj({ method: 'GET', url: `/api/cc/projects/${demo.slug}/sessions/sess` })
      ).json()
      expect(body.items.map((i: { kind: string }) => i.kind)).toEqual(['user', 'assistant'])
      expect(body.usage).toBeDefined()
    } finally {
      if (prev === undefined) delete process.env.VC_CC_DIR
      else process.env.VC_CC_DIR = prev
      rmSync(ccDir, { recursive: true, force: true })
    }
  })

  it('cc:resume создаёт разговор с импортом истории и привязкой session-id', async () => {
    const ccDir = mkdtempSync(join(tmpdir(), 'cc-resume-'))
    const proj = join(ccDir, '-Users-x-demo')
    mkdirSync(proj, { recursive: true })
    writeFileSync(
      join(proj, 'sess-42.jsonl'),
      [
        JSON.stringify({ type: 'user', cwd: '/Users/x/demo', message: { content: 'Почини баг' } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Готово' }] } })
      ].join('\n')
    )
    const prev = process.env.VC_CC_DIR
    process.env.VC_CC_DIR = ccDir
    try {
      const res = await inj({
        method: 'POST',
        url: '/api/cc/resume',
        payload: { slug: '-Users-x-demo', id: 'sess-42' }
      })
      expect(res.statusCode).toBe(200)
      const { conversation, messages } = res.json()
      // История импортирована в ленту.
      expect(messages.map((m: { role: string; text: string }) => [m.role, m.text])).toEqual([
        ['u1', 'Почини баг'],
        ['ai', 'Готово']
      ])
      // Разговор привязан к session-id → следующий ход пойдёт через --resume.
      expect(db.getConversation(U, conversation.id)?.claudeSessionId).toBe('sess-42')
    } finally {
      if (prev === undefined) delete process.env.VC_CC_DIR
      else process.env.VC_CC_DIR = prev
      rmSync(ccDir, { recursive: true, force: true })
    }
  })

  it('cc:resume без slug/id → 400', async () => {
    const res = await inj({ method: 'POST', url: '/api/cc/resume', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('добавление сообщения видно в get', async () => {
    const c = (await inj({ method: 'POST', url: '/api/conversations', payload: {} })).json()
    const m = (
      await inj({
        method: 'POST',
        url: `/api/conversations/${c.id}/messages`,
        payload: { role: 'u1', text: 'Привет', time: '10:00' }
      })
    ).json()
    expect(m.text).toBe('Привет')
    const got = (await inj({ method: 'GET', url: `/api/conversations/${c.id}` })).json()
    expect(got.messages).toHaveLength(1)
  })

  it('повторный POST с messageId возвращает исходное сообщение без дубля и изменения payload', async () => {
    const c = (await inj({ method: 'POST', url: '/api/conversations', payload: {} })).json()
    const url = `/api/conversations/${c.id}/messages`
    const first = (await inj({
      method: 'POST',
      url,
      payload: { messageId: 'client-message-1', role: 'u1', text: 'Исходный', time: '10:00' }
    })).json()
    const replay = (await inj({
      method: 'POST',
      url,
      payload: { messageId: 'client-message-1', role: 'u1', text: 'Дубликат', time: '11:00' }
    })).json()

    expect(replay).toEqual(first)
    expect(replay.text).toBe('Исходный')
    const got = (await inj({ method: 'GET', url: `/api/conversations/${c.id}` })).json()
    expect(got.messages).toHaveLength(1)
  })

  it('обновляет и сохраняет состояние списка task-launch в meta сообщения', async () => {
    const c = (await inj({ method: 'POST', url: '/api/conversations', payload: {} })).json()
    const m = (await inj({
      method: 'POST',
      url: `/api/conversations/${c.id}/messages`,
      payload: {
        role: 'ai',
        text: 'Выберите.',
        time: '10:00',
        meta: { taskLaunches: [
          { id: 'task-launch-1', title: 'Первая', description: 'Описание', acceptanceCriteria: 'Критерий' },
          { id: 'task-launch-2', title: 'Вторая', description: 'Описание', acceptanceCriteria: 'Критерий' }
        ] }
      }
    })).json()
    const meta = { ...m.meta, taskLaunches: m.meta.taskLaunches.map((item: { id: string }) => item.id === 'task-launch-2' ? { ...item, status: 'created' } : item) }
    const patched = await inj({ method: 'PATCH', url: `/api/conversations/${c.id}/messages/${m.id}`, payload: { meta } })
    expect(patched.statusCode).toBe(200)
    const got = (await inj({ method: 'GET', url: `/api/conversations/${c.id}` })).json()
    expect(got.messages[0].meta.taskLaunches[1].status).toBe('created')
    expect(got.messages[0].meta.taskLaunches[0].status).toBeUndefined()
  })

  it('удаление сообщения убирает его из истории', async () => {
    const c = (await inj({ method: 'POST', url: '/api/conversations', payload: {} })).json()
    const m = (
      await inj({
        method: 'POST',
        url: `/api/conversations/${c.id}/messages`,
        payload: { role: 'u1', text: 'удалить меня', time: '10:00' }
      })
    ).json()
    const del = await inj({
      method: 'DELETE',
      url: `/api/conversations/${c.id}/messages/${m.id}`
    })
    expect(del.statusCode).toBe(200)
    const got = (await inj({ method: 'GET', url: `/api/conversations/${c.id}` })).json()
    expect(got.messages).toHaveLength(0)
  })

  it('удаление сообщения сбрасывает сессию Claude (модель забывает удалённое)', async () => {
    const c = (await inj({ method: 'POST', url: '/api/conversations', payload: {} })).json()
    const m = (
      await inj({
        method: 'POST',
        url: `/api/conversations/${c.id}/messages`,
        payload: { role: 'u1', text: 'секрет', time: '10:00' }
      })
    ).json()
    db.setClaudeSession(U, c.id, 'sess-abc')
    expect(db.getConversation(U, c.id)?.claudeSessionId).toBe('sess-abc')

    await inj({ method: 'DELETE', url: `/api/conversations/${c.id}/messages/${m.id}` })
    expect(db.getConversation(U, c.id)?.claudeSessionId).toBeNull()
  })

  it('список моделей содержит все поддерживаемые', async () => {
    const res = await inj({ method: 'GET', url: '/api/stt/models' })
    const models = res.json() as Array<{ model: string; present: boolean; sizeBytes: number }>
    expect(models.map((m) => m.model).sort()).toEqual(['large-v3-turbo', 'medium', 'small'])
    for (const m of models) expect(typeof m.sizeBytes).toBe('number')
  })

  it('удаление модели/голоса отвечает ok (без файла — идемпотентно)', async () => {
    const m = await inj({ method: 'DELETE', url: '/api/stt/models/small' })
    expect(m.statusCode).toBe(200)
    const v = await inj({ method: 'DELETE', url: '/api/tts/voices/ru_RU-irina-medium' })
    expect(v.statusCode).toBe(200)
  })

  it('загрузка вложения возвращает id и имя', async () => {
    const res = await inj({
      method: 'POST',
      url: '/api/uploads',
      payload: { name: 'заметка.txt', dataBase64: Buffer.from('привет').toString('base64') }
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(typeof body.id).toBe('string')
    expect(body.id.length).toBeGreaterThan(0)
    expect(body.name).toBe('заметка.txt')
  })

  it('rename и delete', async () => {
    const c = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Старое' } })).json()
    await inj({ method: 'PATCH', url: `/api/conversations/${c.id}`, payload: { title: 'Новое' } })
    let got = await inj({ method: 'GET', url: `/api/conversations/${c.id}` })
    expect(got.json().conversation.title).toBe('Новое')
    await inj({ method: 'DELETE', url: `/api/conversations/${c.id}` })
    got = await inj({ method: 'GET', url: `/api/conversations/${c.id}` })
    expect(got.statusCode).toBe(404)
  })

  it('settings get/save', async () => {
    const def = (await inj({ method: 'GET', url: '/api/settings' })).json()
    expect(def.model).toBeDefined()
    const next = { ...def, diarization: false, voice: 'ru_RU-dmitri-medium' }
    await inj({ method: 'PUT', url: '/api/settings', payload: next })
    const saved = (await inj({ method: 'GET', url: '/api/settings' })).json()
    expect(saved.diarization).toBe(false)
    expect(saved.voice).toBe('ru_RU-dmitri-medium')
  })

  // Частичное тело — патч: клиент со старой сборкой (или не догрузивший
  // настройки) не должен стирать поля, о которых он не знает.
  it('settings put применяет патч, а не заменяет запись целиком', async () => {
    const def = (await inj({ method: 'GET', url: '/api/settings' })).json()
    await inj({ method: 'PUT', url: '/api/settings', payload: { ...def, theme: 'dark', codexModel: 'gpt-5.4', autoSpeak: true } })

    const patched = (await inj({ method: 'PUT', url: '/api/settings', payload: { autoSpeak: false } })).json()

    expect(patched).toMatchObject({ theme: 'dark', codexModel: 'gpt-5.4', autoSpeak: false })
    expect((await inj({ method: 'GET', url: '/api/settings' })).json()).toMatchObject({ theme: 'dark', codexModel: 'gpt-5.4' })
  })

  it('settings put отбрасывает мусорные значения, а не сохраняет их', async () => {
    const def = (await inj({ method: 'GET', url: '/api/settings' })).json()
    await inj({ method: 'PUT', url: '/api/settings', payload: { ...def, theme: 'dark' } })

    const saved = (await inj({ method: 'PUT', url: '/api/settings', payload: { theme: 'неон', llmProvider: 'gemini', hack: true } })).json()

    expect(saved).toMatchObject({ theme: 'dark', llmProvider: def.llmProvider })
    expect(saved).not.toHaveProperty('hack')
  })

  // Машина могла исчезнуть мимо UI: висячий id и в чат идёт целью выполнения,
  // и в настройках выглядит выбранной машиной по умолчанию.
  it('settings get забывает ссылки на исчезнувшие машины', async () => {
    const agent = (await inj({ method: 'POST', url: '/api/agents', payload: { name: 'Ноутбук' } })).json()
    await inj({ method: 'PUT', url: '/api/settings', payload: { defaultAgentId: agent.id, execTarget: agent.id } })
    expect((await inj({ method: 'GET', url: '/api/settings' })).json()).toMatchObject({ defaultAgentId: agent.id })

    db.deleteAgent(U, agent.id) // удаление мимо REST — как чистка или другой сеанс

    expect((await inj({ method: 'GET', url: '/api/settings' })).json()).toMatchObject({ defaultAgentId: null, execTarget: null })
  })

  it('нормализует персонализацию и отвергает невозможную дату', async () => {
    const def = (await inj({ method: 'GET', url: '/api/settings' })).json()
    const invalid = await inj({ method: 'PUT', url: '/api/settings', payload: { ...def, personalization: { ...def.personalization, birthDay: 31, birthMonth: 2 } } })
    expect(invalid.statusCode).toBe(400)
    const saved = await inj({ method: 'PUT', url: '/api/settings', payload: { ...def, personalization: { ...def.personalization, preferredName: '  Алексей   Р. ', birthYear: 1990, responseLanguage: 'ru', responseStyle: 'brief', tone: 'friendly' } } })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().personalization).toMatchObject({ preferredName: 'Алексей Р.', birthYear: 1990, responseLanguage: 'ru', responseStyle: 'brief', tone: 'friendly' })
  })

  it('агенты: create → list (offline) → delete', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'MacBook' } })
    ).json()
    expect(created.name).toBe('MacBook')
    expect(typeof created.token).toBe('string')

    const list = (await inj({ method: 'GET', url: '/api/agents' })).json()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: created.id, name: 'MacBook', online: false })

    const del = await inj({ method: 'DELETE', url: `/api/agents/${created.id}` })
    expect(del.statusCode).toBe(200)
    expect((await inj({ method: 'GET', url: '/api/agents' })).json()).toHaveLength(0)
  })

  it('агенты: удаление снимает машину и с цели выполнения, и с дефолта', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'MacBook' } })
    ).json()
    const before = (await inj({ method: 'GET', url: '/api/settings' })).json()
    await inj({
      method: 'PUT',
      url: '/api/settings',
      payload: { ...before, execTarget: created.id, defaultAgentId: created.id }
    })

    await inj({ method: 'DELETE', url: `/api/agents/${created.id}` })

    const after = (await inj({ method: 'GET', url: '/api/settings' })).json()
    expect(after.execTarget).toBeNull()
    // Дефолт подставляется в новые разговоры: висячий id уводил бы ход на машину,
    // которой больше нет.
    expect(after.defaultAgentId).toBeNull()
  })

  it('агенты: POST без имени → 400', async () => {
    const res = await inj({ method: 'POST', url: '/api/agents', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('агенты: список содержит политику; setPolicy сохраняет', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })
    ).json()
    const list = (await inj({ method: 'GET', url: '/api/agents' })).json()
    expect(list[0].policy.allowNetwork).toBe(true)

    const policy = {
      allowedDirs: ['/tmp'],
      allowNetwork: false,
      allowWrite: false,
      denyPatterns: ['sudo'],
      allowPatterns: [],
      skills: []
    }
    const res = await inj({
      method: 'POST',
      url: `/api/agents/${created.id}/policy`,
      payload: { policy }
    })
    expect(res.statusCode).toBe(200)
    const after = (await inj({ method: 'GET', url: '/api/agents' })).json()
    expect(after[0].policy.allowNetwork).toBe(false)
    expect(after[0].policy.allowedDirs).toEqual(['/tmp'])
  })

  it('агенты: перевыпуск токена возвращает новый токен', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })
    ).json()
    const res = await inj({ method: 'POST', url: `/api/agents/${created.id}/token` })
    expect(res.statusCode).toBe(200)
    expect(typeof res.json().token).toBe('string')
    expect(res.json().token).not.toBe(created.token)
  })

  it('скачивание: GET /api/agents/app и /api/app/desktop без .dmg → 404', async () => {
    // В тестах autodiscover артефактов отключён (VITEST), VC_*_APP не заданы.
    const agent = await inj({ method: 'GET', url: '/api/agents/app' })
    expect(agent.statusCode).toBe(404)
    expect(agent.json().error).toContain('не собрано')
    const desktop = await inj({ method: 'GET', url: '/api/app/desktop' })
    expect(desktop.statusCode).toBe(404)
  })

  it('скачивание: GET /api/agents/script отдаёт JS-бандл (attachment)', async () => {
    const res = await inj({ method: 'GET', url: '/api/agents/script' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('javascript')
    expect(res.headers['content-disposition']).toContain('voicechat-agent.cjs')
    expect(res.body.startsWith('#!')).toBe(true)
  }, 30_000)

  it('установщик Termux: GET /api/agents/install-android.sh публичен и отдаёт bash', async () => {
    // Без токена — должен быть доступен (curl с телефона до логина).
    const res = await app.inject({ method: 'GET', url: '/api/agents/install-android.sh' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('shellscript')
    expect(res.body.startsWith('#!')).toBe(true)
    expect(res.body).toContain('/api/agents/script')
  })

  it('установщик Windows: GET /api/agents/install-windows.ps1 публичен и отдаёт PowerShell', async () => {
    // Без токена — команду запускают на машине до какого-либо логина.
    const res = await app.inject({ method: 'GET', url: '/api/agents/install-windows.ps1' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('powershell')
    expect(res.body).toContain('/api/agents/script')
    expect(res.body).toContain('nodejs.org')
  })

  it('установщики Linux и macOS публичны, отдают bash и разные скрипты', async () => {
    const lin = await app.inject({ method: 'GET', url: '/api/agents/install-linux.sh' })
    const mac = await app.inject({ method: 'GET', url: '/api/agents/install-macos.sh' })
    for (const res of [lin, mac]) {
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('shellscript')
      expect(res.body).toContain('/api/agents/script')
      expect(res.body).toContain('[ "$major" -lt 22 ]') // строгая проверка Node 22+
    }
    expect(lin.body).toContain('systemctl --user')
    expect(mac.body).toContain('LaunchAgents')
    expect(lin.body).not.toBe(mac.body)
  })

  it('обновление офлайн-машины отклоняется с понятной причиной', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'Офлайн' } })
    ).json()
    const res = await inj({ method: 'POST', url: `/api/agents/${created.id}/update` })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toContain('не в сети')
  })

  it('обновление отклоняется, если сервер виден как localhost (команда ушла бы в саму машину)', async () => {
    // app.inject ходит с Host: localhost — ровно тот случай, когда база непригодна.
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'Локальная' } })
    ).json()
    const res = await inj({ method: 'POST', url: `/api/agents/${created.id}/update` })
    // Машина офлайн → 409 про сеть; проверяем, что до сборки команды дело не дошло
    // молча: в обоих случаях это 409 с объяснением, а не «ok».
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBeTruthy()
  })

  it('обновление чужой машины — 404', async () => {
    const res = await inj({ method: 'POST', url: '/api/agents/нет-такой/update' })
    expect(res.statusCode).toBe(404)
  })

  it('обновление без токена — 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/agents/x/update' })
    expect(res.statusCode).toBe(401)
  })

  it('удаление агента сбрасывает execTarget на сервер', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })
    ).json()
    const def = (await inj({ method: 'GET', url: '/api/settings' })).json()
    await inj({ method: 'PUT', url: '/api/settings', payload: { ...def, execTarget: created.id } })
    await inj({ method: 'DELETE', url: `/api/agents/${created.id}` })
    const saved = (await inj({ method: 'GET', url: '/api/settings' })).json()
    expect(saved.execTarget).toBeNull()
  })

  it('предпросмотр промпта повторяет текст хода и слушается тумблеров', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Промпт' } })).json()
    const settings = (await inj({ method: 'GET', url: '/api/settings' })).json()
    await inj({ method: 'PUT', url: '/api/settings', payload: { ...settings, personalization: { ...settings.personalization, preferredName: 'Алексей', responseLanguage: 'ru', responseStyle: 'brief' } } })
    const snap = async (): Promise<{
      promptPreview: { blocks: Array<{ itemIds: string[]; text: string; chars: number; approxTokens: number }>; text: string; chars: number; approxTokens: number; omitted: string[] }
      groups: Array<{ items: Array<{ id: string; size?: { chars: number; approxTokens: number } | null }> }>
    }> => (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()

    const before = await snap()
    // Карточка описывает предпочтения словами, а не печатает сырое поле («normal»).
    const card = before.groups.flatMap((group) => group.items).find((entry) => entry.id === 'personalization') as unknown as { description: string }
    expect(card.description).toContain('обращение «Алексей»')
    expect(card.description).toContain('стиль кратко')
    const personalization = before.promptPreview.blocks.find((block) => block.itemIds.includes('personalization'))
    expect(personalization?.text).toContain('Обращение к пользователю: Алексей.')
    expect(personalization?.text).toContain('Стиль ответа: кратко.')
    expect(before.promptPreview.text).toContain('## Персонализация пользователя')
    expect(before.promptPreview.chars).toBe(before.promptPreview.text.length)
    expect(before.promptPreview.approxTokens).toBe(Math.ceil(before.promptPreview.text.length / 4))
    expect(before.promptPreview.omitted.join(' ')).toContain('Правила платформы')
    // Размер вклада виден и на самом пункте — иначе непонятно, кто занял место.
    const item = before.groups.flatMap((group) => group.items).find((entry) => entry.id === 'personalization')
    expect(item?.size).toEqual({ chars: personalization?.chars, approxTokens: personalization?.approxTokens })

    // Выключенный пункт исчезает и из предпросмотра: панель обещает ровно то,
    // что уйдёт модели, а не «что настроено».
    const off = await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/personalization`, payload: { enabled: false } })
    expect(off.statusCode).toBe(200)
    const after = await snap()
    expect(after.promptPreview.blocks.some((block) => block.itemIds.includes('personalization'))).toBe(false)
    expect(after.promptPreview.text).not.toContain('Алексей')
  })

  it('история: размер при пересборке и правда про сессию движка (resume)', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'История' } })).json()
    await inj({ method: 'POST', url: `/api/conversations/${created.id}/messages`, payload: { role: 'user', text: 'Первый вопрос про сборку', time: '10:00' } })
    const item = async (): Promise<{ description: string; explanation: string; size?: { chars: number; approxTokens: number } | null; details?: Record<string, unknown> }> => {
      const snap = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
      return snap.groups.flatMap((g: { items: unknown[] }) => g.items).find((e: { id: string }) => e.id === 'conversation-history')
    }

    const withoutSession = await item()
    expect(withoutSession.description).toMatch(/1 сообщений, ≈\d+ токенов/)
    expect(withoutSession.explanation).toContain('пересобирается в промпт целиком')
    expect(withoutSession.size?.chars).toBeGreaterThan(0)

    // Живая сессия движка: история уже у модели, в промпт она не пересобирается.
    db.setClaudeSession(U, created.id, 'claude:sess-1')
    const withSession = await item()
    expect(withSession.description).toContain('уже в сессии движка')
    expect(withSession.explanation).toContain('resume')
    expect(withSession.size ?? null).toBeNull()
    expect(withSession.details?.['Сессия движка']).toBe('есть (resume)')

    // Сессия другого движка чужой разговор не «продолжает»: у codex своя.
    db.setClaudeSession(U, created.id, 'codex:sess-2')
    expect((await item()).explanation).toContain('пересобирается в промпт целиком')
  })

  it('цепочка AGENTS.md читается с машины по просьбе: от общей к конкретной, без шума о ненайденных', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Цепочка' } })).json()

    // Без рабочей директории читать негде — так и сказано, без похода на машину.
    const noWorkdir = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/agents-chain` })).json()
    expect(noWorkdir).toMatchObject({ files: [], unavailable: expect.stringContaining('Рабочая директория') })

    // Директория есть, машины нет — вторая честная причина.
    const settings = (await inj({ method: 'GET', url: '/api/settings' })).json()
    await inj({ method: 'PUT', url: '/api/settings', payload: { ...settings, workdir: '/Users/me/work/project' } })
    const noMachine = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/agents-chain` })).json()
    expect(noMachine).toMatchObject({ workdir: '/Users/me/work/project', files: [], unavailable: expect.stringContaining('Машина недоступна') })

    // С машиной: два файла из пяти каталогов цепочки, остальные просто нет.
    // Файловые операции машины подменяем на инстансе реестра — своего сокета
    // этому тесту не нужно, проверяется сборка цепочки, а не транспорт.
    const machine = db.createAgent(U, 'Мак')
    const remoteFiles = new Map<string, string>([
      ['/Users/me/AGENTS.md', Buffer.from('# Общие правила').toString('base64')],
      ['/Users/me/work/project/AGENTS.md', Buffer.from('# Правила проекта').toString('base64')]
    ])
    agentRegistry.isOnline = ((id: string) => id === machine.id) as typeof agentRegistry.isOnline
    agentRegistry.fsRead = (async (_id: string, path: string) => {
      const dataBase64 = remoteFiles.get(path)
      if (!dataBase64) throw new Error('ENOENT not found')
      return { root: '/', cwd: path, dataBase64 }
    }) as typeof agentRegistry.fsRead
    await inj({ method: 'PATCH', url: `/api/conversations/${created.id}`, payload: { execTarget: machine.id } })
    const chain = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/agents-chain` })).json()
    expect(chain.machineName).toBe('Мак')
    expect(chain.files.map((f: { path: string }) => f.path)).toEqual([
      '/Users/me/AGENTS.md', '/Users/me/work/project/AGENTS.md'
    ])
    expect(chain.files[0]).toMatchObject({ text: '# Общие правила', chars: '# Общие правила'.length })
    expect(chain.unavailable).toBeUndefined()
  })

  it('снимок отдаёт факт прошлого хода и предупреждения о несогласованности', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Факт' } })).json()
    const snap = async (): Promise<{
      lastTurn: { prompt: string; chars: number; approxTokens: number; resumed: boolean; attachments: number; kbSections: string[]; model: string } | null
      warnings: Array<{ itemId: string | null; level: string; text: string }>
    }> => (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()

    // Ходов не было — факта нет, и выдумывать его снимок не должен.
    expect((await snap()).lastTurn).toBeNull()

    await inj({ method: 'POST', url: `/api/conversations/${created.id}/messages`, payload: {
      role: 'ai', text: 'Готово', time: '10:00',
      meta: { request: { provider: 'claude', model: 'opus', prompt: 'Системный блок\n\nВопрос', promptChars: 22, resumed: true, permissionMode: 'plan', attachments: ['/tmp/a.png'], kbContext: { confidence: 'high', sections: [{ title: 'Соглашения' }] } } }
    } })
    const withTurn = await snap()
    expect(withTurn.lastTurn).toMatchObject({
      model: 'opus', prompt: 'Системный блок\n\nВопрос', chars: 22, approxTokens: Math.ceil(22 / 4),
      resumed: true, attachments: 1, kbSections: ['Соглашения']
    })

    // Выключенная база знаний при режиме «Авто» — расхождение, о котором надо знать.
    await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/knowledge-mode`, payload: { enabled: false } })
    const warned = await snap()
    expect(warned.warnings.some((w) => w.itemId === 'knowledge-mode' && w.text.includes('тумблер сильнее'))).toBe(true)

    // Выключенная инструкция чата предупреждает и про исчезновение её блока в ответе.
    const settings = (await inj({ method: 'GET', url: '/api/settings' })).json()
    const consoleInstruction = settings.chatInstructions.find((entry: { kind?: string }) => entry.kind === 'console')
    await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/instruction-${encodeURIComponent(consoleInstruction.id)}`, payload: { enabled: false } })
    const instructionWarn = (await snap()).warnings.find((w) => w.text.includes('Инструкций чата выключено'))
    expect(instructionWarn).toMatchObject({ level: 'notice' })
    // Проблемы идут раньше замечаний: сначала то, что почти наверняка не так.
    const levels = (await snap()).warnings.map((w) => w.level)
    expect(levels).toEqual([...levels].sort((a, b) => (a === b ? 0 : a === 'problem' ? -1 : 1)))
  })

  it('дефолтный пресет контекста применяется к новым разговорам', async () => {
    const settings = (await inj({ method: 'GET', url: '/api/settings' })).json()
    await inj({ method: 'PUT', url: '/api/settings', payload: {
      ...settings,
      contextPresets: [{ id: 'p-min', name: 'Минимальный', disabled: ['personalization', 'knowledge-mode', 'platform-instructions'] }],
      defaultContextPresetId: 'p-min'
    } })

    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Новый с пресетом' } })).json()
    // Пункт безопасности из пресета отфильтрован: выключить его нельзя нигде.
    expect(created.disabledContext.sort()).toEqual(['knowledge-mode', 'personalization'])
    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
    const platform = snapshot.groups.flatMap((group: { items: Array<{ id: string; enabled: boolean }> }) => group.items)
      .find((item: { id: string }) => item.id === 'platform-instructions')
    expect(platform.enabled).toBe(true)

    // Без дефолта новые чаты начинаются с полным контекстом.
    await inj({ method: 'PUT', url: '/api/settings', payload: { ...settings, defaultContextPresetId: null } })
    const plain = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Обычный' } })).json()
    expect(plain.disabledContext).toEqual([])
  })

  it('админ видит и правит контекст чужого чата, обычный пользователь — нет', async () => {
    // Чужой разговор: владелец — другой пользователь.
    db.createUser('marina', 'pass', 'developer')
    const foreign = db.createConversation('marina', 'Чат Марины')

    // Админ (текущий токен) видит снимок с пометкой «чужой» и владельцем.
    const asAdmin = await inj({ method: 'GET', url: `/api/conversations/${foreign.id}/context-snapshot` })
    expect(asAdmin.statusCode).toBe(200)
    expect(asAdmin.json()).toMatchObject({ owner: 'marina', foreign: true, viewerRole: 'admin' })

    // И может выключить источник — в журнале остаётся, кто именно это сделал.
    const toggled = await inj({ method: 'POST', url: `/api/conversations/${foreign.id}/context/personalization`, payload: { enabled: false } })
    expect(toggled.statusCode).toBe(200)
    expect(toggled.json().changes[0]).toMatchObject({ actor: U, itemId: 'personalization', enabled: false })
    // Правка легла в чужой разговор, а не в свой.
    expect(db.getConversation('marina', foreign.id)?.disabledContext).toEqual(['personalization'])

    // Обычному пользователю чужой разговор неотличим от несуществующего.
    const marinaToken = signToken({ name: 'marina', role: 'developer' }, SECRET)
    const asDeveloper = await app.inject({
      method: 'GET',
      url: `/api/conversations/${(await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Мой' } })).json().id}/context-snapshot`,
      headers: { authorization: `Bearer ${marinaToken}` }
    })
    expect(asDeveloper.statusCode).toBe(404)
  })

  it('политика машины и «вслепую» видны в снимке', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Политика' } })).json()
    const machine = db.createAgent(U, 'Мак с политикой')
    db.setAgentPolicy(U, machine.id, {
      ...db.listAgents(U).find((item) => item.id === machine.id)!.policy,
      allowedDirs: ['/Users/me/work'],
      denyPatterns: ['rm -rf'],
      allowWrite: false,
      allowNetwork: false
    })
    agentRegistry.isOnline = ((id: string) => id === machine.id) as typeof agentRegistry.isOnline
    await inj({ method: 'PATCH', url: `/api/conversations/${created.id}`, payload: { execTarget: machine.id } })

    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
    const machineItem = snapshot.groups.flatMap((group: { items: Array<{ id: string; details?: Record<string, unknown> }> }) => group.items)
      .find((item: { id: string }) => item.id === 'machine')
    // Политика ограничивает модель сильнее режима прав — она должна быть видна.
    expect(machineItem.details).toMatchObject({
      'Разрешённые каталоги': '/Users/me/work',
      'Запрещённые паттерны команд': 'rm -rf',
      'Правка файлов': 'запрещена',
      'Сеть': 'запрещена'
    })
    // Список MCP движка приезжает полем (в тестах CLI нет — значит пусто).
    expect(Array.isArray(snapshot.cliMcpServers)).toBe(true)
  })

  it('выключенные проект, БЗ и персонализация вместе дают предупреждение «вслепую»', async () => {
    const project = db.createProject(U, { name: 'Проект контекста' })
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Вслепую', projectId: project.id } })).json()
    for (const itemId of ['personalization', 'project-binding', 'knowledge-mode']) {
      await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/${itemId}`, payload: { enabled: false } })
    }
    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
    const blind = snapshot.warnings.find((entry: { text: string }) => entry.text.includes('только история разговора'))
    expect(blind).toMatchObject({ level: 'problem' })
  })

  it('статус индекса базы знаний виден в пункте, а множество инструкций замечено', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'БЗ' } })).json()
    const item = async (): Promise<{ available: boolean; explanation: string; details?: Record<string, unknown> }> => {
      const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
      return snapshot.groups.flatMap((group: { items: unknown[] }) => group.items).find((entry: { id: string }) => entry.id === 'knowledge-mode')
    }
    // Тестовый сервер поднимается без индекса БЗ: снимок это переживает и не
    // выдаёт «доступно», когда искать негде.
    const kb = await item()
    expect(typeof kb.available).toBe('boolean')
    expect(kb.details).toBeDefined()

    // Больше десяти включённых постоянных подсказок — замечание, не запрет.
    const settings = (await inj({ method: 'GET', url: '/api/settings' })).json()
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `bulk-${index}`, title: `Подсказка ${index}`, description: '', enabled: true, text: `Правило ${index}.`
    }))
    await inj({ method: 'PUT', url: '/api/settings', payload: { ...settings, chatInstructions: many } })
    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
    expect(snapshot.warnings.some((entry: { text: string }) => entry.text.includes('Инструкций чата включено 12'))).toBe(true)

    // Выключенные тумблером в счёт не идут: замечание про то, что реально уходит.
    await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/instruction-bulk-0`, payload: { enabled: false } })
    await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/instruction-bulk-1`, payload: { enabled: false } })
    const after = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
    expect(after.warnings.some((entry: { text: string }) => entry.text.includes('Инструкций чата включено'))).toBe(false)
  })

  it('сравнение контекста двух разговоров показывает разницу и ничего не меняет', async () => {
    const here = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Здесь' } })).json()
    const there = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Там' } })).json()
    await inj({ method: 'POST', url: `/api/conversations/${here.id}/context/personalization`, payload: { enabled: false } })
    await inj({ method: 'POST', url: `/api/conversations/${there.id}/context/knowledge-mode`, payload: { enabled: false } })
    await inj({ method: 'PATCH', url: `/api/conversations/${there.id}`, payload: { execTarget: null, llmProvider: 'codex', llmModel: 'gpt-5.6-luna' } })

    const diff = (await inj({ method: 'GET', url: `/api/conversations/${here.id}/context-diff/${there.id}` })).json()
    expect(diff.otherTitle).toBe('Там')
    expect(diff.onlyHere.map((entry: { itemId: string }) => entry.itemId)).toEqual(['personalization'])
    expect(diff.onlyThere.map((entry: { itemId: string }) => entry.itemId)).toEqual(['knowledge-mode'])
    expect(diff.settings).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Движок', here: 'claude', there: 'codex' })
    ]))

    // Сравнение — только чтение: наборы обоих разговоров остались прежними.
    const disabledOf = async (id: string): Promise<string[]> => {
      const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${id}/context-snapshot` })).json()
      return snapshot.groups.flatMap((group: { items: Array<{ id: string; enabled: boolean }> }) => group.items)
        .filter((item: { enabled: boolean }) => !item.enabled).map((item: { id: string }) => item.id)
    }
    expect(await disabledOf(here.id)).toEqual(['personalization'])
    expect(await disabledOf(there.id)).toEqual(['knowledge-mode'])

    // Чужой или несуществующий разговор — 404.
    expect((await inj({ method: 'GET', url: `/api/conversations/${here.id}/context-diff/нет-такого` })).statusCode).toBe(404)
  })

  it('выключенные инструменты приезжают списком, а группы знают свой размер', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Инструменты' } })).json()
    await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/mcp-kb-search`, payload: { enabled: false } })
    await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/mcp-remote-bash`, payload: { enabled: false } })

    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
    // Ровно тот список, что уйдёт исполнителю: ответ на «что модель не сможет».
    expect(snapshot.disallowedTools).toEqual(['mcp__kb__search', 'mcp__remote__bash'])
    // Размер группы инструкций считается по блокам, а не суммой пунктов:
    // склеенная подсказка принадлежит двум пунктам и удвоила бы сумму.
    const instructions = snapshot.groups.find((group: { id: string }) => group.id === 'chat-instructions')
    expect(instructions.size.chars).toBeGreaterThan(0)
    const blocksChars = snapshot.promptPreview.blocks
      .filter((block: { itemIds: string[] }) => block.itemIds.every((id) => id.startsWith('instruction-')))
      .reduce((total: number, block: { chars: number }) => total + block.chars, 0)
    expect(instructions.size.chars).toBe(blocksChars)
  })

  it('дубликат текста инструкций замечен, а «где выключена» различает настройки и чат', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Инструкции' } })).json()
    const settings = (await inj({ method: 'GET', url: '/api/settings' })).json()
    const own = { id: 'own-1', title: 'Своя первая', description: '', enabled: true, text: 'Отвечай по-русски.' }
    const twin = { id: 'own-2', title: 'Своя вторая', description: '', enabled: true, text: 'Отвечай по-русски.' }
    const off = { id: 'own-3', title: 'Выключенная в настройках', description: '', enabled: false, text: 'Не должна попасть.' }
    await inj({ method: 'PUT', url: '/api/settings', payload: { ...settings, chatInstructions: [...settings.chatInstructions, own, twin, off] } })

    const snap = async (): Promise<{
      warnings: Array<{ text: string }>
      groups: Array<{ items: Array<{ id: string; details?: Record<string, unknown> }> }>
    }> => (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()

    const withTwins = await snap()
    expect(withTwins.warnings.some((entry) => entry.text.includes('Своя первая, Своя вторая'))).toBe(true)

    const detailsOf = (snapshot: Awaited<ReturnType<typeof snap>>, id: string): Record<string, unknown> =>
      snapshot.groups.flatMap((group) => group.items).find((item) => item.id === id)!.details!
    // Выключенная в общих настройках и выключенная тумблером — разные ответы.
    expect(detailsOf(withTwins, 'instruction-own-3')['Где выключена']).toBe('в общих настройках (во всех чатах)')
    expect(detailsOf(withTwins, 'instruction-own-1')['Где выключена']).toBe('—')
    await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/instruction-own-1`, payload: { enabled: false } })
    expect(detailsOf(await snap(), 'instruction-own-1')['Где выключена']).toBe('только в этом разговоре')

    // Порядок и размер — рядом с текстом: их спрашивают, когда промпт распух.
    const details = detailsOf(await snap(), 'instruction-own-2')
    expect(String(details['Порядок в промпте'])).toMatch(/^\d+ из \d+$/)
    expect(details['Символов в тексте']).toBe('Отвечай по-русски.'.length)
  })

  it('пустой контекст предупреждает, а история ходов несёт стоимость', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Пусто' } })).json()
    const snap = async (): Promise<{
      warnings: Array<{ text: string; level: string }>
      turnSizes: Array<{ costUsd: number | null; approxTokens: number }>
      promptPreview: { blocks: unknown[] }
    }> => (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()

    // Пока блоки есть — предупреждения о пустоте нет.
    expect((await snap()).warnings.some((entry) => entry.text.includes('Своих блоков сервер не добавит'))).toBe(false)

    // Выключаем всё выключаемое: это законный режим, но о нём надо сказать.
    const items = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
      .groups.flatMap((group: { items: Array<{ id: string; toggleable: boolean }> }) => group.items)
      .filter((item: { toggleable: boolean }) => item.toggleable)
    for (const item of items) {
      await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/${encodeURIComponent(item.id)}`, payload: { enabled: false } })
    }
    const empty = await snap()
    expect(empty.promptPreview.blocks).toHaveLength(0)
    expect(empty.warnings.some((entry) => entry.text.includes('Своих блоков сервер не добавит'))).toBe(true)

    // У хода с известной моделью в истории есть и оценка стоимости.
    await inj({ method: 'POST', url: `/api/conversations/${created.id}/messages`, payload: {
      role: 'ai', text: 'Готово', time: '10:00',
      meta: { request: { provider: 'claude', model: 'sonnet', prompt: 'x'.repeat(800), promptChars: 800, resumed: false } }
    } })
    const sized = (await snap()).turnSizes[0]!
    expect(sized.approxTokens).toBe(200)
    expect(sized.costUsd).not.toBeNull()
  })

  it('копирование контекста переносит выключения другого разговора и не пускает чужой', async () => {
    const source = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Образец' } })).json()
    const target = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Цель' } })).json()
    await inj({ method: 'POST', url: `/api/conversations/${source.id}/context/personalization`, payload: { enabled: false } })
    await inj({ method: 'POST', url: `/api/conversations/${source.id}/context/knowledge-mode`, payload: { enabled: false } })
    // В цели заранее выключено другое — копирование приводит набор к образцу,
    // а не просто добавляет: иначе «скопировать» означало бы «объединить».
    await inj({ method: 'POST', url: `/api/conversations/${target.id}/context/mcp-kb-search`, payload: { enabled: false } })

    const copied = await inj({ method: 'POST', url: `/api/conversations/${target.id}/context-copy`, payload: { fromConversationId: source.id } })
    expect(copied.statusCode).toBe(200)
    const disabled = (copied.json().groups as Array<{ items: Array<{ id: string; enabled: boolean }> }>)
      .flatMap((group) => group.items).filter((item) => !item.enabled).map((item) => item.id).sort()
    expect(disabled).toEqual(['knowledge-mode', 'personalization'])

    // Журнал видит обе стороны операции: и выключения, и возврат.
    const changes = copied.json().changes as Array<{ itemId: string; enabled: boolean }>
    expect(changes.some((entry) => entry.itemId === 'mcp-kb-search' && entry.enabled)).toBe(true)

    // Сам себе источником быть не может, чужой разговор — 404.
    expect((await inj({ method: 'POST', url: `/api/conversations/${target.id}/context-copy`, payload: { fromConversationId: target.id } })).statusCode).toBe(400)
    expect((await inj({ method: 'POST', url: `/api/conversations/${target.id}/context-copy`, payload: { fromConversationId: 'нет-такого' } })).statusCode).toBe(404)
  })

  it('снимок отдаёт имена вложений, историю размеров и оценку стоимости', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Размеры' } })).json()
    const turn = (chars: number, model: string, at: string) => inj({ method: 'POST', url: `/api/conversations/${created.id}/messages`, payload: {
      role: 'ai', text: 'Готово', time: at,
      meta: { request: { provider: 'claude', model, prompt: 'x'.repeat(chars), promptChars: chars, resumed: false, attachments: ['/tmp/uploads/схема.png'] } }
    } })
    await turn(400, 'sonnet', '10:00')
    await turn(1200, 'sonnet', '10:05')

    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
    // Имена, а не только количество.
    expect(snapshot.lastTurn.attachmentNames).toEqual(['схема.png'])
    // История новыми сверху: виден рост промпта.
    expect(snapshot.turnSizes.map((entry: { chars: number }) => entry.chars)).toEqual([1200, 400])
    expect(snapshot.turnSizes[0]).toMatchObject({ model: 'sonnet', approxTokens: 300, resumed: false })
    // Стоимость постоянной части: у известной модели число, а не выдумка.
    expect(typeof snapshot.promptPreview.costUsd === 'number' || snapshot.promptPreview.costUsd === null).toBe(true)
  })

  it('чат задачи с макетом показывает read-only источники make_design', async () => {
    // Свежая фича хода (turns.ts, buildTaskMakeSources по task_designs): чат
    // задачи читает файлы привязанного Make-макета. Инспектор обязан это
    // показывать — иначе «что сможет модель» снова отвечает неполно.
    const project = db.createProject(U, { name: 'Проект макета' })
    const board = db.getBoard(U, project.id)!
    const task = db.createTask(U, project.id, { columnId: board.columns[0]!.id, title: 'По макету' })!
    const makeChat = db.createConversation(U, 'Макет', 'make', project.id)!
    db.linkTaskDesign(U, project.id, task.id, { conversationId: makeChat.id })
    const chat = db.openOrCreateTaskChat(U, project.id, task.id)!

    const item = async (id: string): Promise<{ available: boolean; toggleable: boolean; lockReason?: string | null } | undefined> => {
      const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${chat.id}/context-snapshot` })).json()
      return snapshot.groups
        .flatMap((group: { items: Array<{ id: string; available: boolean; toggleable: boolean; lockReason?: string | null }> }) => group.items)
        .find((entry: { id: string }) => entry.id === id)
    }
    const design = await item('mcp-make-design')
    expect(design?.available).toBe(true)
    // Тумблера нет: источник даёт привязка задачи, ход disabledContext не читает.
    expect(design?.toggleable).toBe(false)
    expect(design?.lockReason).toBe('kind')
    expect((await inj({ method: 'POST', url: `/api/conversations/${chat.id}/context/mcp-make-design`, payload: { enabled: false } })).statusCode).toBe(400)

    // Обычный чат без задачи честно говорит, что источник появится в чате задачи.
    const plain = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Обычный' } })).json()
    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${plain.id}/context-snapshot` })).json()
    const plainDesign = snapshot.groups.flatMap((group: { items: Array<{ id: string; available: boolean }> }) => group.items).find((entry: { id: string }) => entry.id === 'mcp-make-design')
    expect(plainDesign?.available).toBe(false)
  })

  it('в режиме планирования инструменты вида чата честно обещают только чтение', async () => {
    // Ход подключает консоль, Make и канбан с &ro=1 в режиме «Только
    // планирование» (turns.ts): чтение работает, запись отклоняется. Пункт
    // инструмента обязан сказать это до отправки, а не обещать полный доступ.
    const make = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Витрина', assistantKind: 'make' } })).json()
    const makeItem = async (): Promise<{ explanation: string; details?: Record<string, unknown> }> => {
      const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${make.id}/context-snapshot` })).json()
      return snapshot.groups.flatMap((group: { items: Array<{ id: string }> }) => group.items).find((item: { id: string }) => item.id === 'mcp-make-files')
    }
    // Make-чат без машины у админа идёт в выбранном режиме — по умолчанию не план.
    const before = await makeItem()
    expect(before.details?.['В режиме планирования']).toBe('только чтение')

    await inj({ method: 'PATCH', url: `/api/conversations/${make.id}`, payload: { execTarget: null, permissionMode: 'plan' } })
    const after = await makeItem()
    expect(after.explanation).toContain('только на чтение — запись отклоняется')
  })

  it('перечисляет хинты CLI в «чего в тексте нет» с размерами из shared', async () => {
    // Исполнитель приклеивает к промпту свои системные хинты (БЗ, превью, Make,
    // канбан). Их условия сервер знает, тексты части хинтов лежат в shared —
    // «полный просмотр» обязан хотя бы назвать их и размер.
    const plain = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Обычный' } })).json()
    const omittedOf = async (id: string): Promise<string[]> =>
      (await inj({ method: 'GET', url: `/api/conversations/${id}/context-snapshot` })).json().promptPreview.omitted
    const plainOmitted = await omittedOf(plain.id)
    expect(plainOmitted.some((line) => line.includes('Хинт CLI про инструменты базы знаний') && line.includes('токенов'))).toBe(true)
    expect(plainOmitted.some((line) => line.includes('Хинт CLI про браузер превью'))).toBe(true)
    expect(plainOmitted.some((line) => line.includes('shell-команды этому ходу запрещены'))).toBe(true)
    // Хинт Make в обычном чате не обещается.
    expect(plainOmitted.some((line) => line.includes('ассистента Make'))).toBe(false)

    const make = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Витрина', assistantKind: 'make' } })).json()
    const makeOmitted = await omittedOf(make.id)
    expect(makeOmitted.some((line) => line.includes('Хинт CLI ассистента Make') && line.includes('токенов'))).toBe(true)
    expect(makeOmitted.some((line) => line.includes('браузер превью'))).toBe(false)
  })

  it('называет движок-исполнитель и предупреждает о его замене', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Исполнитель' } })).json()
    const snap = async (): Promise<{ details?: Record<string, unknown>; warnings: Array<{ text: string }> }> => {
      const value = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
      return {
        details: value.groups.flatMap((group: { items: Array<{ id: string; details?: Record<string, unknown> }> }) => group.items).find((item: { id: string }) => item.id === 'llm')?.details,
        warnings: value.warnings
      }
    }
    // Реестра исполнителей нет — честный ответ «встроенный запуск», без замен.
    const before = await snap()
    expect(before.details?.['Исполнитель']).toBe('встроенный запуск CLI на сервере')
    expect(before.warnings.some((entry) => entry.text.includes('движок-исполнитель'))).toBe(false)

    // Закрепляем движок, недоступный роли admin, — ход молча взял бы другой
    // раннер, и снимок обязан предупредить об этом до отправки.
    const engine = db.createLlmEngine({ name: 'Только тестировщики', kind: 'claude', baseUrl: 'http://runner', token: 't', enabled: true, allowedRoles: ['tester'], isDefault: false })
    db.setConversationExecTarget(U, created.id, null, null, undefined, null, null, null, engine.id)
    const after = await snap()
    expect(after.details?.['Замена движка']).toBeTruthy()
    expect(after.warnings.some((entry) => entry.text.includes('Закреплённый движок-исполнитель недоступен'))).toBe(true)
  })

  it('движок показывается с учётом прав пользователя, а модель — алиасом меню', async () => {
    // Ход берёт первый разрешённый движок, если выбранный пользователю закрыт
    // (`turns.ts`: permittedProvider). Снимок обязан показывать то же, иначе
    // инспектор обещает codex человеку, у которого он запрещён.
    // Права — deny-list: запись с modelId '*' закрывает движок целиком.
    db.createUser('dev-access', 'password', 'developer')
    const token = signToken({ name: 'dev-access', role: 'developer' }, SECRET)
    const conv = db.createConversation('dev-access', 'Без codex')!
    db.setConversationExecTarget('dev-access', conv.id, null, null, undefined, 'codex', 'gpt-5.6-sol', null)
    db.setUserLlmAccess('dev-access', [{ provider: 'codex', modelId: '*' }])

    const snap = async (): Promise<{ provider: string; model: string }> =>
      (await app.inject({ method: 'GET', url: `/api/conversations/${conv.id}/context-snapshot`, headers: { authorization: `Bearer ${token}` } })).json().summary
    expect((await snap()).provider).toBe('claude')

    // Модель приводится к алиасу меню тем же кодом, что в ходе: сохранённое
    // старое значение «opus» исполнитель резолвит в «opus[1m]», и показывать
    // сырое значение значит называть не ту модель.
    db.setConversationExecTarget('dev-access', conv.id, null, null, undefined, 'claude', 'opus', null)
    expect((await snap()).model).toBe('opus[1m]')
  })

  it('в Make-чате без машины режим не понижается, но встроенные инструменты запрещены', async () => {
    // Ход (`turns.ts`, makeOnlyExecution) не переводит Make-чат в «План» без
    // машины: инструменты make_* машины не требуют, а plan-режим CLI их глушит.
    // Вместо понижения запрещаются встроенные инструменты. Снимок обязан
    // говорить то же — иначе обычный пользователь читает «Только планирование»,
    // а ход правит файлы проекта.
    db.createUser('dev-make', 'password', 'developer')
    const token = signToken({ name: 'dev-make', role: 'developer' }, SECRET)
    const conv = db.createConversation('dev-make', 'Витрина', 'make')!
    db.setConversationExecTarget('dev-make', conv.id, null, null, undefined, null, null, 'acceptEdits')
    const snapshot = (await app.inject({ method: 'GET', url: `/api/conversations/${conv.id}/context-snapshot`, headers: { authorization: `Bearer ${token}` } })).json()
    expect(snapshot.summary.permissionMode.value).not.toBe('plan')
    // Встроенные инструменты в списке запрещённых — модель их не получит.
    expect(snapshot.disallowedTools).toContain('Bash')
    expect(snapshot.disallowedTools).toContain('Write')
  })

  it('база знаний объявляет эффект инструментов, а не блока промпта', async () => {
    // `knowledge-mode` не убирает статический блок: автоконтекст БЗ зависит от
    // текста сообщения. Зато он гасит инструменты mcp__kb__*, и объявленный
    // эффект должен говорить именно это — иначе инвариант проверяет не то.
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'БЗ' } })).json()
    const item = async (): Promise<{ effect?: string | null }> => {
      const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
      return snapshot.groups
        .flatMap((group: { items: Array<{ id: string; effect?: string | null }> }) => group.items)
        .find((entry: { id: string }) => entry.id === 'knowledge-mode')
    }
    expect((await item()).effect).toBe('tool')

    await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/knowledge-mode`, payload: { enabled: false } })
    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
    // Выключенная БЗ = инструменты kb недоступны модели.
    const kbTools = snapshot.groups
      .flatMap((group: { items: Array<{ id: string; includedInNextTurn: boolean }> }) => group.items)
      .filter((entry: { id: string }) => entry.id.startsWith('mcp-kb-'))
    expect(kbTools.every((tool: { includedInNextTurn: boolean }) => !tool.includedInNextTurn)).toBe(true)
  })

  it('список выключаемых пунктов зафиксирован: новый тумблер требует решения', async () => {
    // «Фальшивый тумблер» ловится не поведением, а составом: пункт, который ход
    // не читает, всё равно попадает в disabledContext и выглядит рабочим.
    // Поэтому набор выключаемого зафиксирован здесь; расширяя его, надо сначала
    // научить ход (`turns.ts`) читать новый id — иначе тумблер будет врать.
    const project = db.createProject(U, { name: 'Состав тумблеров' })
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Состав', projectId: project.id } })).json()
    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
    const ids = snapshot.groups
      .flatMap((group: { items: Array<{ id: string; toggleable: boolean }> }) => group.items)
      .filter((item: { toggleable: boolean }) => item.toggleable)
      .map((item: { id: string }) => item.id)
      .sort()
    expect(ids).toEqual([
      'instruction-console', 'instruction-explorer', 'instruction-git', 'instruction-image', 'instruction-questions', 'instruction-taskLaunch',
      'knowledge-mode',
      'mcp-kb-document', 'mcp-kb-search', 'mcp-kb-topics',
      'mcp-remote-bash', 'mcp-remote-edit', 'mcp-remote-machines', 'mcp-remote-read',
      'personalization', 'project-binding', 'task-context'
    ])
  })

  it('каждый тумблер снимка делает ровно то, что объявил', async () => {
    // Инвариант против «фальшивых тумблеров»: пункт объявлен выключаемым, а его
    // выключение ни на что не влияет, потому что ход про этот id не знает.
    // Ровно так однажды появился тумблер у автопилота ассистента: проверять
    // `includedInNextTurn` бесполезно — он пересчитывается для любого пункта.
    const project = db.createProject(U, { name: 'Проект инварианта' })
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Все тумблеры', projectId: project.id } })).json()
    const snapshotOf = async (): Promise<{ items: Array<{ id: string; toggleable: boolean; enabled: boolean; available: boolean; includedInNextTurn: boolean; effect?: string | null }>; blocks: string[]; disallowed: string[] }> => {
      const value = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
      return {
        items: value.groups.flatMap((group: { items: Array<{ id: string; toggleable: boolean; enabled: boolean; available: boolean; includedInNextTurn: boolean; effect?: string | null }> }) => group.items),
        blocks: (value.promptPreview.blocks as Array<{ title: string; itemIds: string[] }>).flatMap((block) => block.itemIds),
        disallowed: value.disallowedTools as string[]
      }
    }
    const before = await snapshotOf()
    const toggleable = before.items.filter((item) => item.toggleable && item.enabled)
    expect(toggleable.length).toBeGreaterThan(3)
    // Выключаемый пункт обязан объявить свой эффект — иначе непонятно, что
    // вообще проверять, и фальшивый тумблер снова пройдёт незамеченным.
    expect(toggleable.every((item) => item.effect)).toBe(true)

    for (const item of toggleable) {
      await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/${item.id}`, payload: { enabled: false } })
      const after = await snapshotOf()
      if (item.effect === 'tool') {
        // Инструмент отнимается двумя способами: явным запретом
        // (`--disallowedTools` у инструментов машины) или неподключением
        // сервера вовсе (так работает выключенная база знаний). Инвариант
        // принимает оба — важно, что модель его больше не получит.
        const forbidden = after.disallowed.length > before.disallowed.length
        const wasIncluded = before.items.filter((entry) => entry.effect === 'tool' && entry.includedInNextTurn).map((entry) => entry.id)
        const nowIncluded = new Set(after.items.filter((entry) => entry.includedInNextTurn).map((entry) => entry.id))
        const lost = wasIncluded.some((id) => !nowIncluded.has(id))
        expect(forbidden || lost, `тумблер «${item.id}» не отнял инструмент ни запретом, ни отключением`).toBe(true)
      } else if (item.effect === 'prompt-block' && before.blocks.includes(item.id)) {
        // Пункт может быть настроен, но пуст (персонализация без полей): тогда
        // блока нет и выключать нечего. Если блок есть — он обязан исчезнуть.
        expect(after.blocks.includes(item.id), `тумблер «${item.id}» не убрал блок промпта`).toBe(false)
      }
      await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/${item.id}`, payload: { enabled: true } })
    }
  })

  it('показывает автопилот ассистента и следует за его переключением', async () => {
    const project = db.createProject(U, { name: 'Проект автопилота' })
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'С доской', projectId: project.id } })).json()
    const autonomyItem = async (): Promise<{ title: string; details?: Record<string, unknown> } | undefined> => {
      const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
      return snapshot.groups
        .flatMap((group: { items: Array<{ id: string; title: string; details?: Record<string, unknown> }> }) => group.items)
        .find((item: { id: string }) => item.id === 'assistant-autonomy')
    }
    // По умолчанию автопилот включён — так же читает и сам kanban-MCP.
    expect((await autonomyItem())?.title).toContain('изменения без подтверждения')

    await inj({ method: 'POST', url: `/api/conversations/${created.id}/assistant-autonomy`, payload: { autonomy: 'confirm' } })
    const after = await autonomyItem()
    expect(after?.title).toContain('каждое изменение спрашивается')
    expect(after?.details?.['Значение']).toBe('confirm')
  })

  it('в чате без проекта автопилота нет: доски у него не бывает', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Без проекта' } })).json()
    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
    const items = snapshot.groups.flatMap((group: { items: Array<{ id: string }> }) => group.items)
    expect(items.some((item: { id: string }) => item.id === 'assistant-autonomy')).toBe(false)
  })

  it('перечисляет инструменты, которые даёт вид чата, и не даёт их выключить', async () => {
    const plain = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Обычный' } })).json()
    const make = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Витрина', assistantKind: 'make' } })).json()
    const tools = async (id: string): Promise<Record<string, { available: boolean; toggleable: boolean; lockReason?: string | null }>> => {
      const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${id}/context-snapshot` })).json()
      const items = snapshot.groups.flatMap((group: { items: Array<{ id: string; available: boolean; toggleable: boolean; lockReason?: string | null }> }) => group.items)
      return Object.fromEntries(items.filter((item: { id: string }) => item.id.startsWith('mcp-'))
        .map((item: { id: string; available: boolean; toggleable: boolean; lockReason?: string | null }) => [item.id, item]))
    }

    const plainTools = await tools(plain.id)
    // В обычном чате модель ходит браузером превью, но не правит файлы Make.
    expect(plainTools['mcp-browser-preview']?.available).toBe(true)
    expect(plainTools['mcp-make-files']?.available).toBe(false)
    expect(plainTools['mcp-console-pty']?.available).toBe(false)

    const makeTools = await tools(make.id)
    // В Make наоборот: файлы проекта — да, браузер превью — нет.
    expect(makeTools['mcp-make-files']?.available).toBe(true)
    expect(makeTools['mcp-browser-preview']?.available).toBe(false)

    // Тумблера у них нет: набор решает вид чата, а не настройки разговора.
    expect(plainTools['mcp-browser-preview']?.toggleable).toBe(false)
    expect(plainTools['mcp-browser-preview']?.lockReason).toBe('kind')
    const attempt = await inj({ method: 'POST', url: `/api/conversations/${plain.id}/context/mcp-browser-preview`, payload: { enabled: false } })
    expect(attempt.statusCode).toBe(400)
  })

  it('в живой сессии движка предупреждает о повторе настроек каждым ходом', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Живая сессия' } })).json()
    const repeats = async (): Promise<boolean> => {
      const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
      return (snapshot.warnings as Array<{ text: string }>).some((entry) => entry.text.includes('уходят заново в каждом ходе'))
    }
    // Пока постоянная часть маленькая, повтор не стоит разговора.
    expect(await repeats()).toBe(false)

    // Длинная инструкция + живая сессия: история не пересылается, а настройки —
    // да, каждым ходом, и модель их уже получила.
    const current = (await inj({ method: 'GET', url: '/api/settings' })).json() as Record<string, unknown>
    await inj({ method: 'PUT', url: '/api/settings', payload: { ...current,
      chatInstructions: [{ id: 'custom-long', title: 'Длинная', text: 'и'.repeat(6000), enabled: true }] } })
    expect(await repeats()).toBe(false) // сессии ещё нет — повторять нечего

    db.setClaudeSession(U, created.id, 'claude:sess-1')
    expect(await repeats()).toBe(true)
  })

  it('контекст Make попадает в предпросмотр и выключается тумблером', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Витрина', assistantKind: 'make' } })).json()
    const snap = async (): Promise<{ blocks: Array<{ title: string; text: string }>; omitted: string[]; item?: { enabled: boolean; includedInNextTurn: boolean } }> => {
      const value = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
      return {
        blocks: value.promptPreview.blocks,
        omitted: value.promptPreview.omitted,
        item: value.groups
          .flatMap((group: { items: Array<{ id: string; enabled: boolean; includedInNextTurn: boolean }> }) => group.items)
          .find((entry: { id: string }) => entry.id === 'make-context')
      }
    }
    const before = await snap()
    // Пункт есть всегда, а блок — только когда мастерская что-то отдала. В
    // тестовом сервере `makeContext` не подключён, поэтому проверяем пункт и
    // честное описание, а не выдуманный текст.
    expect(before.item).toBeDefined()
    expect(before.blocks.some((block) => block.title === 'Контекст проекта Make')).toBe(false)
    // Динамика хода перечислена прямо: человек видит её следы в ответах.
    expect(before.omitted.some((line) => line.includes('Режим Make'))).toBe(true)

    await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/make-context`, payload: { enabled: false } })
    expect((await snap()).item?.enabled).toBe(false)
  })

  it('контекст задачи попадает в предпросмотр и выключается отдельным тумблером', async () => {
    const project = db.createProject(U, { name: 'Проект задач' })
    const board = db.getBoard(U, project.id)!
    const task = db.createTask(U, project.id, { columnId: board.columns[0]!.id, title: 'Починить гейт' })!
    db.updateTask(U, project.id, task.id, { description: 'Гейт красный', acceptanceCriteria: 'Зелёный гейт' })
    const chat = db.openOrCreateTaskChat(U, project.id, task.id)!

    const snap = async (): Promise<{ blocks: Array<{ title: string; text: string }>; item: { enabled: boolean; includedInNextTurn: boolean } }> => {
      const value = (await inj({ method: 'GET', url: `/api/conversations/${chat.id}/context-snapshot` })).json()
      return {
        blocks: value.promptPreview.blocks,
        item: value.groups
          .flatMap((group: { items: Array<{ id: string; enabled: boolean; includedInNextTurn: boolean }> }) => group.items)
          .find((entry: { id: string }) => entry.id === 'task-context')
      }
    }
    const before = await snap()
    const taskBlock = before.blocks.find((block) => block.title === 'Контекст задачи')
    // Тот же текст, что уходит в ход: постановка, а не одно название проекта.
    expect(taskBlock?.text).toContain('Починить гейт')
    expect(taskBlock?.text).toContain('Критерии приёмки: Зелёный гейт')
    expect(before.item.includedInNextTurn).toBe(true)

    // Тумблер настоящий: блок исчезает из предпросмотра, как исчезнет из хода.
    await inj({ method: 'POST', url: `/api/conversations/${chat.id}/context/task-context`, payload: { enabled: false } })
    const after = await snap()
    expect(after.blocks.some((block) => block.title === 'Контекст задачи')).toBe(false)
    expect(after.item.enabled).toBe(false)
  })

  it('предпросмотр не показывает инструкции, которых в чате этого вида не будет', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Консоль', assistantKind: 'console-reader' } })).json()
    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
    // «Открывать терминал в чате» включена в настройках, но в консоли терминал
    // уже открыт справа — подсказка туда не уходит, и блока быть не должно.
    const titles = (snapshot.promptPreview.blocks as Array<{ title: string }>).map((block) => block.title)
    expect(titles.some((title) => title.includes('терминал'))).toBe(false)
    // И об этом сказано прямо, а не молчанием.
    expect((snapshot.warnings as Array<{ text: string }>).some((entry) => entry.text.includes('В чате этого вида не применяются инструкции'))).toBe(true)
  })

  it('переименование чата не пишет записи в журнал контекста', async () => {
    // Журнал настроек пишется на PATCH разговора. Если он пишет все четыре
    // настройки независимо от тела запроса, то простое переименование даёт
    // четыре записи «изменил → из общих настроек» — шум, из-за которого журнал
    // перестаёт быть полезным.
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Было' } })).json()
    await inj({ method: 'PATCH', url: `/api/conversations/${created.id}`, payload: { title: 'Стало' } })
    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
    expect(snapshot.changes).toEqual([])
  })

  it('журнал контекста пишет смену настроек разговора, а не только тумблеры', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Журнал настроек' } })).json()
    await inj({ method: 'PATCH', url: `/api/conversations/${created.id}`, payload: { execTarget: 'none', permissionMode: 'plan', kbContextMode: 'manual' } })

    const changes = (): Promise<Array<{ itemId: string; actor: string; value?: string }>> =>
      inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` }).then((res) => res.json().changes)
    const first = await changes()
    expect(first.find((entry) => entry.itemId === 'permission-mode')?.value).toBe('plan')
    expect(first.find((entry) => entry.itemId === 'knowledge-mode')?.value).toBe('manual')
    expect(first.every((entry) => entry.actor === 'admin')).toBe(true)

    // Повторное сохранение той же формы журнал не растит: событие пишется на
    // фактическое изменение, иначе каждый заход в настройки давал бы строку.
    await inj({ method: 'PATCH', url: `/api/conversations/${created.id}`, payload: { execTarget: 'none', permissionMode: 'plan', kbContextMode: 'manual' } })
    expect((await changes()).length).toBe(first.length)

    // Новое значение — новая строка.
    await inj({ method: 'PATCH', url: `/api/conversations/${created.id}`, payload: { execTarget: 'none', permissionMode: 'acceptEdits', kbContextMode: 'manual' } })
    expect((await changes()).find((entry) => entry.itemId === 'permission-mode')?.value).toBe('acceptEdits')
  })

  it('считает итог хода вместе с историей и цену на других моделях', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Итог' } })).json()
    // Пара сообщений: история — то, что пересобирается в промпт без resume.
    for (const text of ['Первый вопрос про гейт', 'Ответ модели про гейт']) {
      await inj({ method: 'POST', url: `/api/conversations/${created.id}/messages`, payload: { role: text.startsWith('Первый') ? 'user' : 'ai', text, time: '10:00' } })
    }
    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
    const preview = snapshot.promptPreview
    // Итог = постоянная часть + история; история отдельно видна в том же поле.
    expect(preview.turnTotal.resumed).toBe(false)
    expect(preview.turnTotal.historyChars).toBeGreaterThan(0)
    expect(preview.turnTotal.chars).toBe(preview.chars + preview.turnTotal.historyChars)
    // Цена других моделей — только там, где прайс известен; своя модель в список
    // не попадает.
    expect(Array.isArray(preview.costByModel)).toBe(true)
    expect(preview.costByModel.every((entry: { model: string; costUsd: number }) => entry.model !== snapshot.summary.model && entry.costUsd > 0)).toBe(true)
  })

  it('предупреждает, когда история занимает больше, чем все настройки', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Длинная история' } })).json()
    const historyWarning = async (): Promise<boolean> => {
      const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
      return (snapshot.warnings as Array<{ text: string }>).some((entry) => entry.text.includes('История разговора занимает'))
    }
    expect(await historyWarning()).toBe(false)

    // Пять длинных сообщений: история перевешивает постоянную часть.
    for (let index = 0; index < 5; index += 1) {
      await inj({ method: 'POST', url: `/api/conversations/${created.id}/messages`, payload: { role: 'user', text: 'с'.repeat(2000), time: '10:00' } })
    }
    expect(await historyWarning()).toBe(true)
  })

  it('предупреждает, когда постоянная часть выросла против прошлых ходов', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Рост' } })).json()
    const turn = (chars: number, at: string) => inj({ method: 'POST', url: `/api/conversations/${created.id}/messages`, payload: {
      role: 'ai', text: 'Готово', time: at,
      meta: { request: { provider: 'claude', model: 'sonnet', prompt: 'x'.repeat(chars), promptChars: chars, resumed: false } }
    } })
    // Три обычных хода по ≈1000 токенов: на их фоне базовая постоянная часть
    // мала, и порог роста молчит.
    await turn(4000, '10:00'); await turn(4000, '10:05'); await turn(4000, '10:10')

    const growth = (snapshot: { warnings: Array<{ text: string }> }): boolean =>
      snapshot.warnings.some((entry) => entry.text.includes('Постоянная часть выросла'))
    // Пока своих блоков почти нет — расти нечему.
    expect(growth((await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json())).toBe(false)

    // Длинная инструкция чата — та самая правка, из-за которой каждый ход
    // становится дороже: предупреждение должно появиться сразу, не дожидаясь
    // абсолютного порога в четыре тысячи токенов.
    const current = (await inj({ method: 'GET', url: '/api/settings' })).json() as Record<string, unknown>
    await inj({ method: 'PUT', url: '/api/settings', payload: { ...current,
      chatInstructions: [{ id: 'custom-1', title: 'Длинная', text: 'и'.repeat(7000), enabled: true }] } })
    const after = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
    expect(growth(after)).toBe(true)
    expect(after.warnings.find((entry: { text: string }) => entry.text.includes('Постоянная часть выросла')).text).toContain('за последние 3 ход(ов)')
  })
})

describe('REST: GET /api/search — полнотекстовый поиск по сообщениям', () => {
  /** Беседа с сообщениями пользователя (по умолчанию — admin из токена). */
  const seed = (user: string, title: string, texts: string[]): string => {
    const conv = db.createConversation(user, title)
    for (const t of texts) db.addMessage(user, conv.id, 'u1', t, '12:00')
    return conv.id
  }

  it('без токена → 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/search?q=миграция' })).statusCode).toBe(401)
  })

  it('отдаёт ранжированные результаты со сниппетом и курсором', async () => {
    const id = seed(U, 'Канбан', [
      'Обсудили миграцию канбана и схему БД',
      'Ещё раз про миграцию',
      'Совсем про другое'
    ])

    const first = await inj({ method: 'GET', url: '/api/search?q=миграцию%20&limit=1' })
    expect(first.statusCode).toBe(200)
    const page1 = first.json()
    expect(page1.hits).toHaveLength(1)
    expect(page1.hits[0].conversationId).toBe(id)
    expect(page1.hits[0].conversationTitle).toBe('Канбан')
    expect(page1.hits[0].snippet).toContain('<mark>')
    expect(typeof page1.nextCursor).toBe('string')

    const second = await inj({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent('миграцию ')}&limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`
    })
    const page2 = second.json()
    expect(page2.hits).toHaveLength(1)
    expect(page2.hits[0].messageId).not.toBe(page1.hits[0].messageId)
  })

  it('не выдаёт сообщения другого пользователя', async () => {
    db.createUser('mallory', '', 'developer')
    const theirs = seed('mallory', 'Чужая беседа', ['чужой секрет про миграцию'])
    seed(U, 'Своя беседа', ['свой текст про миграцию'])

    const all = await inj({ method: 'GET', url: '/api/search?q=миграцию%20' })
    expect(all.json().hits.map((h: { conversationTitle: string }) => h.conversationTitle)).toEqual(['Своя беседа'])

    // Явная чужая беседа — тоже пусто, а не 403/500: чужого просто «не существует».
    const direct = await inj({ method: 'GET', url: `/api/search?q=миграцию%20&conversationId=${theirs}` })
    expect(direct.statusCode).toBe(200)
    expect(direct.json().hits).toEqual([])
  })

  it('сужает по проекту, projectId=none — только беседы без проекта', async () => {
    const project = db.createProject(U, { name: 'Проект' })
    const inProject = seed(U, 'С проектом', ['миграция схемы'])
    db.setConversationProject(U, inProject, project.id)
    seed(U, 'Без проекта', ['миграция схемы'])

    const byProject = await inj({ method: 'GET', url: `/api/search?q=миграция%20&projectId=${project.id}` })
    expect(byProject.json().hits.map((h: { conversationTitle: string }) => h.conversationTitle)).toEqual(['С проектом'])

    const none = await inj({ method: 'GET', url: '/api/search?q=миграция%20&projectId=none' })
    expect(none.json().hits.map((h: { conversationTitle: string }) => h.conversationTitle)).toEqual(['Без проекта'])
  })

  it('пробел в конце запроса приезжает и как «+» (URLSearchParams)', async () => {
    seed(U, 'Канбан', ['миграция канбана'])

    // «мигра» — префикс, находит; «мигра+» — слово закончено, не находит.
    expect((await inj({ method: 'GET', url: '/api/search?q=мигра' })).json().hits).toHaveLength(1)
    expect((await inj({ method: 'GET', url: '/api/search?q=мигра+' })).json().hits).toHaveLength(0)
  })

  it('спецсимволы и мусорные параметры не дают 500', async () => {
    seed(U, 'Канбан', ['миграция канбана'])

    const bad = ['', '*', '"', '-', 'NEAR(', '^)(', '%%%', 'a".."b', '\\\\', '(((']
    for (const q of bad) {
      const res = await inj({ method: 'GET', url: `/api/search?q=${encodeURIComponent(q)}` })
      expect(res.statusCode, `q=${JSON.stringify(q)}`).toBe(200)
      expect(Array.isArray(res.json().hits)).toBe(true)
    }
    // Мусор в limit/cursor тоже не ошибка.
    const res = await inj({ method: 'GET', url: '/api/search?q=миграция%20&limit=abc&cursor=%00%01' })
    expect(res.statusCode).toBe(200)
    expect(res.json().hits).toHaveLength(1)
  })
  it('журнал контекста пишет изменения (не нажатия) и попадает в снимок', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Журнал' } })).json()
    const changes = async (): Promise<Array<{ actor: string; itemId: string; enabled: boolean }>> =>
      (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json().changes

    expect(await changes()).toEqual([])
    await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/personalization`, payload: { enabled: false } })
    expect(await changes()).toMatchObject([{ actor: U, itemId: 'personalization', enabled: false }])

    // Повторное то же значение — не изменение: журнал не должен пухнуть от кликов.
    await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/personalization`, payload: { enabled: false } })
    expect(await changes()).toHaveLength(1)

    // Возврат пишется отдельной записью, новые сверху.
    await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/personalization`, payload: { enabled: true } })
    const list = await changes()
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ itemId: 'personalization', enabled: true })

    // Пункт безопасности выключить нельзя — и в журнал он не попадает.
    await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/platform-instructions`, payload: { enabled: false } })
    expect(await changes()).toHaveLength(2)
  })

  it('крупная постоянная часть промпта даёт замечание о размере', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Размер' } })).json()
    const settings = (await inj({ method: 'GET', url: '/api/settings' })).json()
    const size = async (): Promise<{ approxTokens: number; warnings: Array<{ text: string }> }> => {
      const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })).json()
      return { approxTokens: snapshot.promptPreview.approxTokens, warnings: snapshot.warnings }
    }
    // Штатный набор инструкций — без замечания.
    const before = await size()
    expect(before.approxTokens).toBeLessThan(4000)
    expect(before.warnings.some((entry) => entry.text.includes('токенов — это много'))).toBe(false)

    await inj({ method: 'PUT', url: '/api/settings', payload: {
      ...settings,
      chatInstructions: [...settings.chatInstructions, { id: 'huge', title: 'Огромная', description: '', enabled: true, text: 'т'.repeat(20_000) }]
    } })
    const after = await size()
    expect(after.approxTokens).toBeGreaterThan(4000)
    expect(after.warnings.some((entry) => entry.text.includes('токенов — это много'))).toBe(true)
  })
})
