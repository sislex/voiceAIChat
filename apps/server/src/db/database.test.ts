import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VoiceChatDb, hashAgentToken } from './database'
import { DEFAULT_SETTINGS } from '@voicechat/shared'

/** Владелец данных по умолчанию в тестах. */
const U = 'admin'

function makeDb(): VoiceChatDb {
  let idCounter = 0
  let clock = 1_000
  return new VoiceChatDb(':memory:', {
    newId: () => `id-${++idCounter}`,
    now: () => (clock += 10)
  })
}

describe('VoiceChatDb — разговоры', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
  })
  afterEach(() => db.close())

  it('создаёт и читает разговор', () => {
    const c = db.createConversation(U, 'Поездка в Лиссабон')
    expect(c.id).toBe('id-1')
    expect(c.title).toBe('Поездка в Лиссабон')
    expect(c.messageCount).toBe(0)
    expect(c.claudeSessionId).toBeNull()

    const fetched = db.getConversation(U, c.id)
    expect(fetched).not.toBeNull()
    expect(fetched?.title).toBe('Поездка в Лиссабон')
  })

  it('список отсортирован по updated_at убыванию', () => {
    const a = db.createConversation(U, 'A')
    const b = db.createConversation(U, 'B')
    // Обновляем A позже → он должен всплыть наверх.
    db.addMessage(U, a.id, 'u1', 'привет', '10:00')
    const list = db.listConversations(U)
    expect(list.map((c) => c.id)).toEqual([a.id, b.id])
  })

  it('цель выполнения хранится независимо для каждого разговора', () => {
    const first = db.createConversation(U, 'Первый')
    const second = db.createConversation(U, 'Второй')

    db.setConversationExecTarget(U, first.id, 'machine-1')

    expect(db.getConversation(U, first.id)?.execTarget).toBe('machine-1')
    expect(db.getConversation(U, second.id)?.execTarget).toBeNull()
  })

  it('сохраняет директорию и выбранные навыки разговора', () => {
    const conversation = db.createConversation(U, 'Проект')
    db.setConversationExecTarget(U, conversation.id, 'machine-1', '/repo/app', ['build', 'test'])

    expect(db.getConversation(U, conversation.id)).toMatchObject({
      execTarget: 'machine-1',
      workdir: '/repo/app',
      skillNames: ['build', 'test']
    })
  })

  it('сохраняет движок и модель разговора; неизвестный движок читается как null', () => {
    const conversation = db.createConversation(U, 'Проект')
    db.setConversationExecTarget(U, conversation.id, null, undefined, undefined, 'codex', 'gpt-5-codex')
    expect(db.getConversation(U, conversation.id)).toMatchObject({ llmProvider: 'codex', llmModel: 'gpt-5-codex' })

    db.setConversationExecTarget(U, conversation.id, null, undefined, undefined, null, null)
    expect(db.getConversation(U, conversation.id)).toMatchObject({ llmProvider: null, llmModel: null })

    // Прямо в БД оказался мусор (например, откат версии) — маппинг терпит.
    db.setConversationExecTarget(U, conversation.id, null, undefined, undefined, 'gemini' as never, 'x')
    expect(db.getConversation(U, conversation.id)?.llmProvider).toBeNull()
  })

  it('сохраняет режим прав разговора; мусор в колонке читается как null', () => {
    const conversation = db.createConversation(U, 'Проект')
    expect(conversation.permissionMode).toBeNull()

    db.setConversationExecTarget(U, conversation.id, null, undefined, undefined, undefined, undefined, 'plan')
    expect(db.getConversation(U, conversation.id)?.permissionMode).toBe('plan')

    // null — вернуться к «из общих настроек».
    db.setConversationExecTarget(U, conversation.id, null, undefined, undefined, undefined, undefined, null)
    expect(db.getConversation(U, conversation.id)?.permissionMode).toBeNull()

    // Прямо в БД оказался мусор (например, откат версии) — маппинг терпит.
    db.setConversationExecTarget(U, conversation.id, null, undefined, undefined, undefined, undefined, 'yolo' as never)
    expect(db.getConversation(U, conversation.id)?.permissionMode).toBeNull()
  })

  it('список показывает цель последнего сообщения отдельно от текущей цели чата', () => {
    const c = db.createConversation(U, 'История')
    db.setConversationExecTarget(U, c.id, 'machine-next')
    db.addMessage(U, c.id, 'u1', 'вопрос', '10:00', undefined, undefined, 'machine-last')

    expect(db.listConversations(U)[0]).toMatchObject({
      execTarget: 'machine-next',
      workdir: null,
      skillNames: [],
      lastExecTarget: 'machine-last'
    })
  })

  it('переименование меняет заголовок', () => {
    const c = db.createConversation(U, 'Старое')
    db.renameConversation(U, c.id, 'Новое')
    expect(db.getConversation(U, c.id)?.title).toBe('Новое')
  })

  it('getConversation возвращает null для несуществующего', () => {
    expect(db.getConversation(U, 'нет-такого')).toBeNull()
  })

  it('поиск находит по названию и по тексту сообщения (регистронезависимо)', () => {
    const a = db.createConversation(U, 'Поездка в Лиссабон')
    const b = db.createConversation(U, 'Рецепты')
    db.addMessage(U, b.id, 'u1', 'Как приготовить ПАЭЛью?', '10:00')
    const c = db.createConversation(U, 'Погода')

    // по названию (другой регистр)
    expect(db.searchConversations(U, 'лиссабон').map((x) => x.id)).toEqual([a.id])
    // по тексту сообщения (другой регистр)
    expect(db.searchConversations(U, 'паэлью').map((x) => x.id)).toEqual([b.id])
    // пустой запрос → все
    expect(db.searchConversations(U, '  ').map((x) => x.id).sort()).toEqual([a.id, b.id, c.id].sort())
    // ничего не найдено
    expect(db.searchConversations(U, 'зззз')).toEqual([])
  })
})

describe('VoiceChatDb — изоляция по пользователю', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
  })
  afterEach(() => db.close())

  it('разговоры и сообщения одного пользователя не видны другому', () => {
    const a = db.createConversation('admin', 'A-разговор')
    db.addMessage('admin', a.id, 'u1', 'секрет админа', '10:00')
    const u = db.createConversation('user', 'U-разговор')

    // Списки не пересекаются.
    expect(db.listConversations('admin').map((c) => c.id)).toEqual([a.id])
    expect(db.listConversations('user').map((c) => c.id)).toEqual([u.id])
    // Чужой разговор не читается по id.
    expect(db.getConversation('user', a.id)).toBeNull()
    expect(db.listMessages('user', a.id)).toEqual([])
    // Поиск не находит чужого.
    expect(db.searchConversations('user', 'секрет')).toEqual([])
  })

  it('нельзя добавить сообщение в чужой разговор', () => {
    const a = db.createConversation('admin', 'A')
    expect(() => db.addMessage('user', a.id, 'u1', 'вторжение', '10:00')).toThrow()
  })

  it('настройки раздельны у пользователей', () => {
    db.saveSettings('admin', { ...DEFAULT_SETTINGS, model: 'opus[1m]' })
    db.saveSettings('user', { ...DEFAULT_SETTINGS, model: 'sonnet' })
    expect(db.getSettings('admin').model).toBe('opus[1m]')
    expect(db.getSettings('user').model).toBe('sonnet')
  })

  it('машины-агенты раздельны у пользователей', () => {
    const a = db.createAgent('admin', 'AdminBox')
    db.createAgent('user', 'UserBox')
    expect(db.listAgents('admin').map((x) => x.name)).toEqual(['AdminBox'])
    expect(db.listAgents('user').map((x) => x.name)).toEqual(['UserBox'])
    // Чужого агента нельзя удалить.
    db.deleteAgent('user', a.id)
    expect(db.listAgents('admin').map((x) => x.name)).toEqual(['AdminBox'])
  })
})

describe('VoiceChatDb — сообщения', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
  })
  afterEach(() => db.close())

  it('добавляет сообщения и считает их в messageCount', () => {
    const c = db.createConversation(U, 'Чат')
    db.addMessage(U, c.id, 'u1', 'Привет', '14:02')
    db.addMessage(U, c.id, 'ai', 'Здравствуйте!', '14:02')

    const msgs = db.listMessages(U, c.id)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].text).toBe('Привет')
    expect(msgs[0].role).toBe('u1')
    expect(msgs[1].role).toBe('ai')

    expect(db.getConversation(U, c.id)?.messageCount).toBe(2)
  })

  it('сохраняет и читает meta ответа (токены/детали запроса)', () => {
    const c = db.createConversation(U, 'Чат')
    const meta = {
      durationMs: 4200,
      inputTokens: 1500,
      outputTokens: 300,
      model: 'sonnet',
      request: {
        provider: 'claude' as const,
        model: 'sonnet',
        prompt: 'привет',
        promptChars: 6,
        resumed: false,
        tools: ['Bash', 'Read']
      }
    }
    db.addMessage(U, c.id, 'ai', 'ответ', '14:02', 'claude', meta)
    const [m] = db.listMessages(U, c.id)
    expect(m.meta).toEqual(meta)
    expect(m.engine).toBe('claude')
  })

  it('без meta сообщение не содержит поля meta', () => {
    const c = db.createConversation(U, 'Чат')
    db.addMessage(U, c.id, 'u1', 'вопрос', '14:00')
    expect(db.listMessages(U, c.id)[0].meta).toBeUndefined()
  })

  it('сообщения возвращаются в хронологическом порядке', () => {
    const c = db.createConversation(U, 'Чат')
    db.addMessage(U, c.id, 'u1', 'первое', '14:00')
    db.addMessage(U, c.id, 'u2', 'второе', '14:01')
    db.addMessage(U, c.id, 'ai', 'третье', '14:02')
    expect(db.listMessages(U, c.id).map((m) => m.text)).toEqual(['первое', 'второе', 'третье'])
  })

  it('добавление сообщения обновляет updated_at разговора', () => {
    const c = db.createConversation(U, 'Чат')
    const before = db.getConversation(U, c.id)!.updatedAt
    db.addMessage(U, c.id, 'u1', 'x', '14:00')
    const after = db.getConversation(U, c.id)!.updatedAt
    expect(after).toBeGreaterThan(before)
  })

  it('запекает движок в сообщение (engine) и читает обратно; без движка — поле отсутствует', () => {
    const c = db.createConversation(U, 'Чат')
    db.addMessage(U, c.id, 'u1', 'вопрос', '14:00')
    db.addMessage(U, c.id, 'ai', 'ответ codex', '14:01', 'codex')
    db.addMessage(U, c.id, 'ai', 'ответ claude', '14:02', 'claude')
    const msgs = db.listMessages(U, c.id)
    expect(msgs[0].engine).toBeUndefined() // реплика пользователя
    expect(msgs[1].engine).toBe('codex')
    expect(msgs[2].engine).toBe('claude')
  })
})

describe('VoiceChatDb — миграция и очистка legacy', () => {
  it('ALTER добавляет engine/user_id и удаляет строки без владельца', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-mig-'))
    const file = join(dir, 'legacy.db')
    // Готовим «старую» однопользовательскую БД: без engine и без user_id.
    const raw = new Database(file)
    raw.exec(`CREATE TABLE conversations (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, claude_session_id TEXT)`)
    raw.exec(`CREATE TABLE messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
      text TEXT NOT NULL, time TEXT NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE)`)
    raw.exec(`CREATE TABLE agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_seen INTEGER, policy TEXT)`)
    raw.prepare(`INSERT INTO conversations (id,title,created_at,updated_at) VALUES (?,?,?,?)`)
      .run('c1', 'старый', 1, 1)
    raw.prepare(
      `INSERT INTO messages (id, conversation_id, role, text, time, created_at) VALUES (?,?,?,?,?,?)`
    ).run('m1', 'c1', 'ai', 'старый ответ', '10:00', 1)
    raw.prepare(`INSERT INTO agents (id,name,token_hash,created_at) VALUES (?,?,?,?)`)
      .run('a1', 'oldbox', 'hash', 1)
    raw.close()
    // Открываем через VoiceChatDb → migrate() добавляет колонки и чистит legacy.
    const db = new VoiceChatDb(file)
    const cols = (db as unknown as { db: Database.Database }).db
      .prepare(`PRAGMA table_info(messages)`)
      .all() as Array<{ name: string }>
    expect(cols.some((c) => c.name === 'engine')).toBe(true)
    // Legacy без владельца — удалены (чистый старт многопользовательского режима).
    expect(db.listConversations('admin')).toHaveLength(0)
    expect(db.listMessages('admin', 'c1')).toHaveLength(0)
    expect(db.listAgents('admin')).toHaveLength(0)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('VoiceChatDb — каскадное удаление', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
  })
  afterEach(() => db.close())

  it('удаление разговора удаляет его сообщения', () => {
    const c = db.createConversation(U, 'Чат')
    db.addMessage(U, c.id, 'u1', 'x', '14:00')
    db.addMessage(U, c.id, 'ai', 'y', '14:00')
    db.deleteConversation(U, c.id)
    expect(db.getConversation(U, c.id)).toBeNull()
    expect(db.listMessages(U, c.id)).toHaveLength(0)
    expect(db.listConversations(U)).toHaveLength(0)
  })
})

describe('VoiceChatDb — session-id Claude', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
  })
  afterEach(() => db.close())

  it('сохраняет и обнуляет session-id', () => {
    const c = db.createConversation(U, 'Чат')
    db.setClaudeSession(U, c.id, 'sess-abc')
    expect(db.getConversation(U, c.id)?.claudeSessionId).toBe('sess-abc')
    db.setClaudeSession(U, c.id, null)
    expect(db.getConversation(U, c.id)?.claudeSessionId).toBeNull()
  })
})

describe('VoiceChatDb — настройки', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
  })
  afterEach(() => db.close())

  it('без сохранённых настроек возвращает дефолты', () => {
    expect(db.getSettings(U)).toEqual(DEFAULT_SETTINGS)
  })

  it('сохраняет и читает настройки', () => {
    db.saveSettings(U, {
      ...DEFAULT_SETTINGS,
      model: 'opus[1m]',
      whisperModel: 'medium',
      diarization: false,
      voice: 'dmitri',
      micDeviceId: 'mic-123',
      autoSpeak: true,
      showConsole: true,
      theme: 'dark',
      onboarded: true,
      permissionMode: 'plan',
      workdir: '/tmp/proj',
      bargeIn: true,
      handsFree: true,
      execTarget: 'agent-1',
      llmProvider: 'claude',
      codexModel: '',
      defaultAgentId: null
    })
    expect(db.getSettings(U)).toEqual({
      model: 'opus[1m]',
      whisperModel: 'medium',
      diarization: false,
      voice: 'dmitri',
      micDeviceId: 'mic-123',
      autoSpeak: true,
      showConsole: true,
      theme: 'dark',
      onboarded: true,
      permissionMode: 'plan',
      workdir: '/tmp/proj',
      bargeIn: true,
      handsFree: true,
      execTarget: 'agent-1',
      llmEngineId: null,
      llmProvider: 'claude',
      codexModel: '',
      defaultAgentId: null,
      aiAssistProvider: 'claude',
      aiAssistModel: 'haiku',
      aiAssistPrompts: DEFAULT_SETTINGS.aiAssistPrompts
    })
  })

  it('мержит с дефолтами при частичном/битом конфиге', () => {
    db.saveSettings(U, { ...DEFAULT_SETTINGS, model: 'opus[1m]' })
    const s = db.getSettings(U)
    expect(s.model).toBe('opus[1m]')
    expect(s.voice).toBe(DEFAULT_SETTINGS.voice)
  })
})

describe('VoiceChatDb — агенты', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
  })
  afterEach(() => db.close())

  it('создаёт агента, отдаёт токен один раз и хранит только хэш', () => {
    const created = db.createAgent(U, 'MacBook')
    expect(created.name).toBe('MacBook')
    expect(created.token).toMatch(/^[0-9a-f]{48}$/)

    const found = db.findAgentByTokenHash(hashAgentToken(created.token))
    expect(found?.id).toBe(created.id)
    expect(found?.name).toBe('MacBook')
    expect(found?.userId).toBe(U)
    // Неверный токен не находится.
    expect(db.findAgentByTokenHash(hashAgentToken('другой'))).toBeNull()
  })

  it('list и delete', () => {
    const a = db.createAgent(U, 'A')
    const b = db.createAgent(U, 'B')
    expect(db.listAgents(U).map((x) => x.name)).toEqual(['A', 'B'])
    db.deleteAgent(U, a.id)
    expect(db.listAgents(U).map((x) => x.id)).toEqual([b.id])
  })

  it('touchAgent обновляет last_seen', () => {
    const a = db.createAgent(U, 'A')
    expect(db.listAgents(U)[0].lastSeen).toBeNull()
    db.touchAgent(a.id)
    expect(db.listAgents(U)[0].lastSeen).not.toBeNull()
  })

  it('новый агент имеет дефолтную политику', () => {
    db.createAgent(U, 'A')
    const p = db.listAgents(U)[0].policy
    expect(p.allowNetwork).toBe(true)
    expect(p.allowWrite).toBe(true)
    expect(p.allowedDirs).toEqual([])
  })

  it('setAgentPolicy сохраняет и читается', () => {
    const a = db.createAgent(U, 'A')
    db.setAgentPolicy(U, a.id, {
      allowedDirs: ['/tmp'],
      allowNetwork: false,
      allowWrite: false,
      denyPatterns: ['sudo'],
      allowPatterns: [],
      skills: [{ name: 'build', command: 'npm run build' }]
    })
    const p = db.listAgents(U)[0].policy
    expect(p.allowNetwork).toBe(false)
    expect(p.allowedDirs).toEqual(['/tmp'])
    expect(p.skills[0]).toEqual({ name: 'build', command: 'npm run build' })
  })

  it('regenerateAgentToken делает старый токен недействительным', () => {
    const created = db.createAgent(U, 'A')
    const oldHash = hashAgentToken(created.token)
    expect(db.findAgentByTokenHash(oldHash)?.id).toBe(created.id)
    const { token } = db.regenerateAgentToken(U, created.id)
    expect(db.findAgentByTokenHash(oldHash)).toBeNull()
    expect(db.findAgentByTokenHash(hashAgentToken(token))?.id).toBe(created.id)
  })
})

describe('VoiceChatDb — импорт desktop', () => {
  it('сохраняет id/даты и повторно ничего не дублирует', () => {
    const db = makeDb()
    const bundle = { conversations: [{ conversation: { id: 'legacy-c', title: 'Старый чат', createdAt: 100, updatedAt: 200, claudeSessionId: 'sess', execTarget: null }, messages: [{ id: 'legacy-m', conversationId: 'legacy-c', role: 'u1' as const, text: 'привет', time: '10:00', createdAt: 150 }] }] }
    expect(db.importDesktopData('alice', bundle)).toEqual({ conversationsImported: 1, messagesImported: 1 })
    expect(db.importDesktopData('alice', bundle)).toEqual({ conversationsImported: 0, messagesImported: 0 })
    expect(db.getConversation('alice', 'legacy-c')).toMatchObject({ title: 'Старый чат', createdAt: 100, updatedAt: 200 })
    expect(db.listMessages('alice', 'legacy-c')[0]).toMatchObject({ id: 'legacy-m', createdAt: 150 })
    expect(db.getConversation('bob', 'legacy-c')).toBeNull()
    db.close()
  })
})

describe('VoiceChatDb — пользователи и админ-данные', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
  })
  afterEach(() => db.close())

  it('ensureAdmin создаёт admin один раз', () => {
    db.ensureAdmin()
    db.ensureAdmin()
    expect(db.listUsers().map((u) => u.name)).toEqual(['admin'])
    expect(db.getUser('admin')?.role).toBe('admin')
  })

  it('createUser/getUser/verifyUserPassword/блокировка/удаление', () => {
    db.createUser('bob', 'pw', 'user')
    expect(db.getUser('bob')).toMatchObject({ name: 'bob', role: 'user', blocked: false })
    expect(db.verifyUserPassword('bob', 'pw')?.name).toBe('bob')
    expect(db.verifyUserPassword('bob', 'x')).toBeNull()
    db.setUserBlocked('bob', true)
    expect(db.getUser('bob')?.blocked).toBe(true)
    db.deleteUser('bob')
    expect(db.getUser('bob')).toBeNull()
  })

  it('deleteUserData стирает разговоры/агентов/настройки и учётку', () => {
    db.createUser('bob', '', 'user')
    const c = db.createConversation('bob', 'Чат')
    db.addMessage('bob', c.id, 'u1', 'привет', '10:00')
    db.createAgent('bob', 'BobBox')
    db.saveSettings('bob', { ...DEFAULT_SETTINGS, model: 'sonnet' })

    db.deleteUserData('bob')
    expect(db.getUser('bob')).toBeNull()
    expect(db.listConversations('bob')).toEqual([])
    expect(db.listAgents('bob')).toEqual([])
    // Настройки вернулись к дефолту (строка удалена).
    expect(db.getSettings('bob').model).toBe(DEFAULT_SETTINGS.model)
  })

  it('usageReport суммирует токены ai-сообщений по моделям', () => {
    const c = db.createConversation('bob', 'Чат')
    const meta = (model: string, inTok: number, outTok: number) => ({
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd: 0.01,
      model
    })
    db.addMessage('bob', c.id, 'u1', 'вопрос', '10:00')
    db.addMessage('bob', c.id, 'ai', 'ответ1', '10:01', 'claude', meta('opus', 100, 20))
    db.addMessage('bob', c.id, 'ai', 'ответ2', '10:02', 'claude', meta('opus', 50, 10))
    db.addMessage('bob', c.id, 'ai', 'ответ3', '10:03', 'claude', meta('sonnet', 30, 5))

    const rep = db.usageReport('bob', 'day')
    expect(rep.totals.inputTokens).toBe(180)
    expect(rep.totals.outputTokens).toBe(35)
    expect(rep.totals.messages).toBe(3)
    const opus = rep.byModel.find((m) => m.model === 'opus')!
    expect(opus.inputTokens).toBe(150)
    expect(opus.outputTokens).toBe(30)
    // Изоляция: у другого пользователя пусто.
    expect(db.usageReport('alice', 'day').totals.messages).toBe(0)
  })

  it('usageReport фильтрует разговор и оценивает Codex по таблице цен БД', () => {
    const priced = db.createConversation('bob', 'Codex')
    const other = db.createConversation('bob', 'Другой чат')
    db.addMessage('bob', priced.id, 'ai', 'ответ', '10:01', 'codex', {
      model: 'gpt-5.4', inputTokens: 1_000_000, cacheReadTokens: 200_000, outputTokens: 100_000
    })
    db.addMessage('bob', other.id, 'ai', 'ответ', '10:02', 'codex', {
      model: 'unknown-codex', inputTokens: 9_000_000, outputTokens: 9_000_000
    })

    const report = db.usageReport('bob', 'day', undefined, undefined, priced.id)
    expect(report.conversationId).toBe(priced.id)
    expect(report.totals.messages).toBe(1)
    // Standard: (800k × $2.50 + 200k × $0.25 + 100k × $15) / 1M.
    expect(report.totals.costUsd).toBe(0)
    expect(report.totals.costFromPrices).toBeCloseTo(3.55, 6)
    expect(report.byConversation).toHaveLength(2)
    const unknown = report.byConversation.find((row) => row.conversationId === other.id)
    // Неизвестную Codex-модель не оцениваем по похожему семейству и помечаем,
    // что $0 — только известная часть агрегата, а не цена ответа.
    expect(unknown?.costUsd).toBe(0)
    expect(unknown?.costIncomplete).toBe(true)
  })
})

describe('VoiceChatDb — режим базы знаний разговора', () => {
  it('по умолчанию auto и сохраняет manual/off', () => {
    const db = new VoiceChatDb(':memory:')
    db.createUser('kb-user', '', 'user')
    const conversation = db.createConversation('kb-user', 'KB')
    expect(conversation.kbContextMode).toBe('auto')
    expect(db.setConversationKbContextMode('kb-user', conversation.id, 'manual')?.kbContextMode).toBe('manual')
    expect(db.setConversationKbContextMode('kb-user', conversation.id, 'off')?.kbContextMode).toBe('off')
    db.close()
  })
})


describe('VoiceChatDb — резолв исполнителя LLM', () => {
  it('выбирает запрошенный доступный и заменяет закрытый на default роли', () => {
    const db = makeDb()
    const def = db.createLlmEngine({ name: 'Рабочий', kind: 'claude', baseUrl: 'http://work', token: '', enabled: true, allowedRoles: ['admin', 'user'], isDefault: true })
    const personal = db.createLlmEngine({ name: 'Личный', kind: 'claude', baseUrl: 'http://personal', token: '', enabled: true, allowedRoles: ['admin'], isDefault: false })
    expect(db.resolveLlmEngine(personal.id, 'claude', 'admin')).toMatchObject({ engine: { id: personal.id }, substituted: false })
    expect(db.resolveLlmEngine(personal.id, 'claude', 'user')).toMatchObject({ engine: { id: def.id }, substituted: true })
    expect(db.listLlmEnginesForRole('user').map((engine) => engine.id)).toEqual([def.id])
    db.close()
  })
})


describe('VoiceChatDb — миграции', () => {
  it('добавляет llm_engines в существующую БД без потери разговоров', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-db-migrate-'))
    const file = join(dir, 'voicechat.db')
    const raw = new Database(file)
    raw.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        claude_session_id TEXT,
        user_id TEXT,
        exec_target TEXT,
        workdir TEXT,
        skill_names TEXT NOT NULL DEFAULT '[]',
        llm_provider TEXT,
        llm_model TEXT,
        permission_mode TEXT,
        kb_context_mode TEXT NOT NULL DEFAULT 'auto',
        project_id TEXT,
        task_id TEXT,
        status TEXT NOT NULL DEFAULT 'developing'
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        time TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        engine TEXT,
        meta TEXT,
        exec_target TEXT
      );
      CREATE TABLE speakers (
        conversation_id TEXT NOT NULL,
        speaker_id INTEGER NOT NULL,
        label TEXT NOT NULL,
        PRIMARY KEY (conversation_id, speaker_id)
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen INTEGER,
        policy TEXT,
        user_id TEXT
      );
      CREATE TABLE users (
        name TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        blocked INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `)
    raw.prepare(`INSERT INTO users (name, password_hash, role, blocked, created_at) VALUES ('admin', 'x', 'admin', 0, 1)`).run()
    raw.prepare(`INSERT INTO conversations (id, title, created_at, updated_at, user_id, skill_names, kb_context_mode, status) VALUES ('c1', 'legacy', 1, 2, 'admin', '[]', 'auto', 'developing')`).run()
    raw.close()
    const db = new VoiceChatDb(file)
    try {
      expect(db.getConversation('admin', 'c1')?.title).toBe('legacy')
      expect(db.listLlmEngines()).toEqual([])
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

