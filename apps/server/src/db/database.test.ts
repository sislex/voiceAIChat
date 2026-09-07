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

describe('conversations: окно недели и курсорная догрузка', () => {
  /** База с управляемыми часами: метка беседы — момент её создания. */
  function withClock(): { db: VoiceChatDb; at: (mark: number, title: string) => string } {
    let clock = 0
    const d = new VoiceChatDb(':memory:', { now: () => clock })
    d.identity.createUser('alice', '', 'developer')
    return { db: d, at: (mark, title) => { clock = mark; return d.chat.createConversation('alice', title).id } }
  }

  it('since отдаёт только свежие, before+limit — следующую порцию старых', () => {
    const { db: d, at } = withClock()
    const week = 1_700_000_000_000
    const ids = [
      at(week + 3, 'Свежая 1'), at(week + 2, 'Свежая 2'), at(week + 1, 'Свежая 3'),
      at(week - 1, 'Старая 1'), at(week - 2, 'Старая 2'), at(week - 3, 'Старая 3')
    ]

    const fresh = d.chat.listConversations('alice', { scope: 'chat', since: week })
    expect(fresh.map((c) => c.id)).toEqual(ids.slice(0, 3))

    const oldest = fresh[fresh.length - 1]!
    const page = d.chat.listConversations('alice', { scope: 'chat', before: { updatedAt: oldest.updatedAt, id: oldest.id }, limit: 2 })
    expect(page.map((c) => c.id)).toEqual(ids.slice(3, 5))

    const last = page[page.length - 1]!
    const tail = d.chat.listConversations('alice', { scope: 'chat', before: { updatedAt: last.updatedAt, id: last.id }, limit: 2 })
    // Порция короче лимита — дальше ничего нет.
    expect(tail.map((c) => c.id)).toEqual(ids.slice(5))
    d.close()
  })

  it('курсор различает беседы, обновлённые в одну миллисекунду', () => {
    const { db: d, at } = withClock()
    const same = 1_700_000_000_000
    const ids = [at(same, 'Первая'), at(same, 'Вторая'), at(same, 'Третья')]
    const first = d.chat.listConversations('alice', { scope: 'chat', limit: 1 })
    expect(first).toHaveLength(1)
    const next = d.chat.listConversations('alice', { scope: 'chat', before: { updatedAt: first[0]!.updatedAt, id: first[0]!.id }, limit: 5 })
    // Ни одна беседа не потерялась и не пришла дважды.
    expect([...first, ...next].map((c) => c.id).sort()).toEqual([...ids].sort())
    d.close()
  })
})

describe('VoiceChatDb — разговоры', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
  })
  afterEach(() => db.close())

  it('создаёт и читает разговор', () => {
    const c = db.chat.createConversation(U, 'Поездка в Лиссабон')
    expect(c.id).toBe('id-1')
    expect(c.title).toBe('Поездка в Лиссабон')
    expect(c.messageCount).toBe(0)
    expect(c.claudeSessionId).toBeNull()

    const fetched = db.chat.getConversation(U, c.id)
    expect(fetched).not.toBeNull()
    expect(fetched?.title).toBe('Поездка в Лиссабон')
  })

  it('список отсортирован по updated_at убыванию', () => {
    const a = db.chat.createConversation(U, 'A')
    const b = db.chat.createConversation(U, 'B')
    // Обновляем A позже → он должен всплыть наверх.
    db.chat.addMessage(U, a.id, 'u1', 'привет', '10:00')
    const list = db.chat.listConversations(U)
    expect(list.map((c) => c.id)).toEqual([a.id, b.id])
  })

  it('цель выполнения хранится независимо для каждого разговора', () => {
    const first = db.chat.createConversation(U, 'Первый')
    const second = db.chat.createConversation(U, 'Второй')

    db.chat.setConversationExecTarget(U, first.id, 'machine-1')

    expect(db.chat.getConversation(U, first.id)?.execTarget).toBe('machine-1')
    expect(db.chat.getConversation(U, second.id)?.execTarget).toBeNull()
  })

  it('сохраняет директорию и выбранные навыки разговора', () => {
    const conversation = db.chat.createConversation(U, 'Проект')
    db.chat.setConversationExecTarget(U, conversation.id, 'machine-1', '/repo/app', ['build', 'test'])

    expect(db.chat.getConversation(U, conversation.id)).toMatchObject({
      execTarget: 'machine-1',
      workdir: '/repo/app',
      skillNames: ['build', 'test']
    })
  })

  it('сохраняет движок и модель разговора; неизвестный движок читается как null', () => {
    const conversation = db.chat.createConversation(U, 'Проект')
    db.chat.setConversationExecTarget(U, conversation.id, null, undefined, undefined, 'codex', 'gpt-5-codex')
    expect(db.chat.getConversation(U, conversation.id)).toMatchObject({ llmProvider: 'codex', llmModel: 'gpt-5-codex' })

    db.chat.setConversationExecTarget(U, conversation.id, null, undefined, undefined, null, null)
    expect(db.chat.getConversation(U, conversation.id)).toMatchObject({ llmProvider: null, llmModel: null })

    // Прямо в БД оказался мусор (например, откат версии) — маппинг терпит.
    db.chat.setConversationExecTarget(U, conversation.id, null, undefined, undefined, 'gemini' as never, 'x')
    expect(db.chat.getConversation(U, conversation.id)?.llmProvider).toBeNull()
  })

  it('агрегирует стоимость AI-ходов по фактическим provider/model и не выдаёт неполную сумму', () => {
    const conversation = db.chat.createConversation(U, 'Стоимость')
    expect(conversation).toMatchObject({ costUsd: null, costStatus: 'unknown' })
    db.llm.upsertModelPrice({
      provider: 'claude', model: 'claude-opus', inputPerMillion: 10,
      cachedInputPerMillion: 1, cacheWritePerMillion: 20, outputPerMillion: 50,
      sourceUrl: 'test', effectiveAt: 1
    })
    db.chat.addMessage(U, conversation.id, 'ai', 'Ответ', '10:00', 'claude', {
      model: 'claude-opus', inputTokens: 1_000, cacheReadTokens: 200,
      cacheCreationTokens: 100, outputTokens: 100
    })
    expect(db.chat.getConversation(U, conversation.id)).toMatchObject({ costUsd: 0.0152, costStatus: 'known' })

    // Старый ответ без usage делает итог неполным; известную часть не показываем как полную.
    db.chat.addMessage(U, conversation.id, 'ai', 'Старый ответ', '10:01', 'claude')
    expect(db.chat.listConversations(U)[0]).toMatchObject({ costUsd: null, costStatus: 'partial' })
  })

  it('кэш стоимости переживает повторный показ списка и протухает от правки сообщений', () => {
    const conversation = db.chat.createConversation(U, 'Кэш стоимости')
    db.llm.upsertModelPrice({
      provider: 'claude', model: 'cache-model', inputPerMillion: 10,
      cachedInputPerMillion: 0, cacheWritePerMillion: 0, outputPerMillion: 0,
      sourceUrl: 'test', effectiveAt: 1
    })
    const message = db.chat.addMessage(U, conversation.id, 'ai', 'Ответ', '10:00', 'claude', { model: 'cache-model', inputTokens: 1_000, outputTokens: 0 })
    expect(db.chat.listConversations(U)[0]).toMatchObject({ costUsd: 0.01, costStatus: 'known' })
    // Повтор идёт уже по кэшу — результат обязан совпасть до копейки.
    expect(db.chat.listConversations(U)[0]).toMatchObject({ costUsd: 0.01, costStatus: 'known' })

    // Правка метаданных хода не меняет число сообщений: кэш обязан протухнуть
    // от самой записи, иначе список показывал бы старую цену.
    db.chat.updateMessageMeta(U, conversation.id, message.id, { model: 'cache-model', inputTokens: 2_000, outputTokens: 0 })
    expect(db.chat.listConversations(U)[0]).toMatchObject({ costUsd: 0.02, costStatus: 'known' })

    // Новая цена модели обесценивает посчитанное: смену ловит отметка прайса.
    db.llm.upsertModelPrice({
      provider: 'claude', model: 'cache-model', inputPerMillion: 20,
      cachedInputPerMillion: 0, cacheWritePerMillion: 0, outputPerMillion: 0,
      sourceUrl: 'test', effectiveAt: 2
    })
    expect(db.chat.listConversations(U)[0]).toMatchObject({ costUsd: 0.04, costStatus: 'known' })

    // Удаление хода тоже сбрасывает кэш.
    db.chat.deleteMessage(U, conversation.id, message.id)
    expect(db.chat.listConversations(U)[0]).toMatchObject({ costUsd: null, costStatus: 'unknown' })
  })

  it('использует модель разговора только как fallback модели, сохраняя фактический provider хода', () => {
    const conversation = db.chat.createConversation(U, 'Модели')
    db.chat.setConversationExecTarget(U, conversation.id, null, undefined, undefined, 'claude', 'same-model')
    for (const provider of ['claude', 'codex'] as const) db.llm.upsertModelPrice({
      provider, model: 'same-model', inputPerMillion: provider === 'claude' ? 1 : 2,
      cachedInputPerMillion: 0, cacheWritePerMillion: 0, outputPerMillion: 0,
      sourceUrl: 'test', effectiveAt: 1
    })
    db.chat.addMessage(U, conversation.id, 'ai', 'Claude', '10:00', 'claude', { inputTokens: 1_000, outputTokens: 0 })
    db.chat.addMessage(U, conversation.id, 'ai', 'Codex', '10:01', 'codex', { model: 'same-model', inputTokens: 1_000, outputTokens: 0 })
    expect(db.chat.getConversation(U, conversation.id)).toMatchObject({ costUsd: 0.003, costStatus: 'known' })
  })

  it('восстанавливает агрегат после открытия БД и изолирует повреждённый meta', () => {
    db.close()
    const dir = mkdtempSync(join(tmpdir(), 'vc-conversation-cost-'))
    const file = join(dir, 'voicechat.db')
    try {
      db = new VoiceChatDb(file)
      const valid = db.chat.createConversation(U, 'Валидный')
      const broken = db.chat.createConversation(U, 'Повреждённый')
      db.llm.upsertModelPrice({
        provider: 'claude', model: 'priced', inputPerMillion: 1,
        cachedInputPerMillion: 2, cacheWritePerMillion: 3, outputPerMillion: 4,
        sourceUrl: 'test', effectiveAt: 1
      })
      db.chat.addMessage(U, valid.id, 'ai', 'Сохранённый', '10:00', 'claude', {
        model: 'priced', inputTokens: 1_000, outputTokens: 500
      })
      db.chat.addMessage(U, broken.id, 'ai', 'Сломанный', '10:01', 'claude', {
        model: 'priced', inputTokens: 1, outputTokens: 1
      })
      expect(db.chat.getConversation(U, valid.id)).toMatchObject({ costUsd: 0.003, costStatus: 'known' })
      db.close()

      const raw = new Database(file)
      raw.prepare(`UPDATE messages SET meta = '{' WHERE conversation_id = ?`).run(broken.id)
      raw.close()

      db = new VoiceChatDb(file)
      const restored = new Map(db.chat.listConversations(U).map((conversation) => [conversation.id, conversation]))
      expect(restored.get(valid.id)).toMatchObject({ costUsd: 0.003, costStatus: 'known' })
      expect(restored.get(broken.id)).toMatchObject({ costUsd: null, costStatus: 'unknown' })
      expect(db.chat.searchConversations(U, 'Валидный')[0]).toMatchObject({ costUsd: 0.003, costStatus: 'known' })
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
      db = makeDb()
    }
  })

  it('сохраняет режим прав разговора; мусор в колонке читается как null', () => {
    const conversation = db.chat.createConversation(U, 'Проект')
    expect(conversation.permissionMode).toBeNull()

    db.chat.setConversationExecTarget(U, conversation.id, null, undefined, undefined, undefined, undefined, 'plan')
    expect(db.chat.getConversation(U, conversation.id)?.permissionMode).toBe('plan')

    // null — вернуться к «из общих настроек».
    db.chat.setConversationExecTarget(U, conversation.id, null, undefined, undefined, undefined, undefined, null)
    expect(db.chat.getConversation(U, conversation.id)?.permissionMode).toBeNull()

    // Прямо в БД оказался мусор (например, откат версии) — маппинг терпит.
    db.chat.setConversationExecTarget(U, conversation.id, null, undefined, undefined, undefined, undefined, 'yolo' as never)
    expect(db.chat.getConversation(U, conversation.id)?.permissionMode).toBeNull()
  })

  it('список показывает цель последнего сообщения отдельно от текущей цели чата', () => {
    const c = db.chat.createConversation(U, 'История')
    db.chat.setConversationExecTarget(U, c.id, 'machine-next')
    db.chat.addMessage(U, c.id, 'u1', 'вопрос', '10:00', undefined, undefined, 'machine-last')

    expect(db.chat.listConversations(U)[0]).toMatchObject({
      execTarget: 'machine-next',
      workdir: null,
      skillNames: [],
      lastExecTarget: 'machine-last'
    })
  })

  it('переименование меняет заголовок', () => {
    const c = db.chat.createConversation(U, 'Старое')
    db.chat.renameConversation(U, c.id, 'Новое')
    expect(db.chat.getConversation(U, c.id)?.title).toBe('Новое')
  })

  it('getConversation возвращает null для несуществующего', () => {
    expect(db.chat.getConversation(U, 'нет-такого')).toBeNull()
  })

  it('атомарно создаёт черновик с первой репликой и идемпотентно повторяет его', () => {
    const args = { role: 'u1' as const, text: 'Первая реплика', time: '10:00' }
    const first = db.chat.createConversationDraft(U, 'request-1', 'Первая реплика', null, args)
    const replay = db.chat.createConversationDraft(U, 'request-1', 'Другое название', null, args)

    expect(replay.conversation.id).toBe(first.conversation.id)
    expect(db.chat.listConversations(U)).toHaveLength(1)
    expect(first.conversation.title).toBe('Первая реплика')
    expect(first.messages).toHaveLength(1)
    expect(first.messages[0].text).toBe('Первая реплика')
  })

  it('поиск находит по названию и по тексту сообщения (регистронезависимо)', () => {
    const a = db.chat.createConversation(U, 'Поездка в Лиссабон')
    const b = db.chat.createConversation(U, 'Рецепты')
    db.chat.addMessage(U, b.id, 'u1', 'Как приготовить ПАЭЛью?', '10:00')
    const c = db.chat.createConversation(U, 'Погода')

    // по названию (другой регистр)
    expect(db.chat.searchConversations(U, 'лиссабон').map((x) => x.id)).toEqual([a.id])
    // по тексту сообщения (другой регистр)
    expect(db.chat.searchConversations(U, 'паэлью').map((x) => x.id)).toEqual([b.id])
    // пустой запрос → все
    expect(db.chat.searchConversations(U, '  ').map((x) => x.id).sort()).toEqual([a.id, b.id, c.id].sort())
    // ничего не найдено
    expect(db.chat.searchConversations(U, 'зззз')).toEqual([])
  })
})

describe('VoiceChatDb — изоляция по пользователю', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
  })
  afterEach(() => db.close())

  it('разговоры и сообщения одного пользователя не видны другому', () => {
    const a = db.chat.createConversation('admin', 'A-разговор')
    db.chat.addMessage('admin', a.id, 'u1', 'секрет админа', '10:00')
    const u = db.chat.createConversation('user', 'U-разговор')

    // Списки не пересекаются.
    expect(db.chat.listConversations('admin').map((c) => c.id)).toEqual([a.id])
    expect(db.chat.listConversations('user').map((c) => c.id)).toEqual([u.id])
    // Чужой разговор не читается по id.
    expect(db.chat.getConversation('user', a.id)).toBeNull()
    expect(db.chat.listMessages('user', a.id)).toEqual([])
    // Поиск не находит чужого.
    expect(db.chat.searchConversations('user', 'секрет')).toEqual([])
  })

  it('нельзя добавить сообщение в чужой разговор', () => {
    const a = db.chat.createConversation('admin', 'A')
    expect(() => db.chat.addMessage('user', a.id, 'u1', 'вторжение', '10:00')).toThrow()
  })

  it('настройки раздельны у пользователей', () => {
    db.settings.saveSettings('admin', { ...DEFAULT_SETTINGS, model: 'opus[1m]' })
    db.settings.saveSettings('user', { ...DEFAULT_SETTINGS, model: 'sonnet' })
    expect(db.settings.getSettings('admin').model).toBe('opus[1m]')
    expect(db.settings.getSettings('user').model).toBe('sonnet')
  })

  it('машины-агенты раздельны у пользователей', () => {
    const a = db.machines.createAgent('admin', 'AdminBox')
    db.machines.createAgent('user', 'UserBox')
    expect(db.machines.listAgents('admin').map((x) => x.name)).toEqual(['AdminBox'])
    expect(db.machines.listAgents('user').map((x) => x.name)).toEqual(['UserBox'])
    // Чужого агента нельзя удалить.
    db.machines.deleteAgent('user', a.id)
    expect(db.machines.listAgents('admin').map((x) => x.name)).toEqual(['AdminBox'])
  })
})

describe('VoiceChatDb — сообщения', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
  })
  afterEach(() => db.close())

  it('добавляет сообщения и считает их в messageCount', () => {
    const c = db.chat.createConversation(U, 'Чат')
    db.chat.addMessage(U, c.id, 'u1', 'Привет', '14:02')
    db.chat.addMessage(U, c.id, 'ai', 'Здравствуйте!', '14:02')

    const msgs = db.chat.listMessages(U, c.id)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].text).toBe('Привет')
    expect(msgs[0].role).toBe('u1')
    expect(msgs[1].role).toBe('ai')

    expect(db.chat.getConversation(U, c.id)?.messageCount).toBe(2)
  })

  it('сохраняет и читает meta ответа (токены/детали запроса)', () => {
    const c = db.chat.createConversation(U, 'Чат')
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
    db.chat.addMessage(U, c.id, 'ai', 'ответ', '14:02', 'claude', meta)
    const [m] = db.chat.listMessages(U, c.id)
    expect(m.meta).toEqual(meta)
    expect(m.engine).toBe('claude')
  })

  it('без meta сообщение не содержит поля meta', () => {
    const c = db.chat.createConversation(U, 'Чат')
    db.chat.addMessage(U, c.id, 'u1', 'вопрос', '14:00')
    expect(db.chat.listMessages(U, c.id)[0].meta).toBeUndefined()
  })

  it('сообщения возвращаются в хронологическом порядке', () => {
    const c = db.chat.createConversation(U, 'Чат')
    db.chat.addMessage(U, c.id, 'u1', 'первое', '14:00')
    db.chat.addMessage(U, c.id, 'u2', 'второе', '14:01')
    db.chat.addMessage(U, c.id, 'ai', 'третье', '14:02')
    expect(db.chat.listMessages(U, c.id).map((m) => m.text)).toEqual(['первое', 'второе', 'третье'])
  })

  it('добавление сообщения обновляет updated_at разговора', () => {
    const c = db.chat.createConversation(U, 'Чат')
    const before = db.chat.getConversation(U, c.id)!.updatedAt
    db.chat.addMessage(U, c.id, 'u1', 'x', '14:00')
    const after = db.chat.getConversation(U, c.id)!.updatedAt
    expect(after).toBeGreaterThan(before)
  })

  it('запекает движок в сообщение (engine) и читает обратно; без движка — поле отсутствует', () => {
    const c = db.chat.createConversation(U, 'Чат')
    db.chat.addMessage(U, c.id, 'u1', 'вопрос', '14:00')
    db.chat.addMessage(U, c.id, 'ai', 'ответ codex', '14:01', 'codex')
    db.chat.addMessage(U, c.id, 'ai', 'ответ claude', '14:02', 'claude')
    const msgs = db.chat.listMessages(U, c.id)
    expect(msgs[0].engine).toBeUndefined() // реплика пользователя
    expect(msgs[1].engine).toBe('codex')
    expect(msgs[2].engine).toBe('claude')
  })
})

describe('VoiceChatDb — миграция и очистка legacy', () => {
  it('одноразовая очистка удаляет только однозначный пустой ручной черновик', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-empty-drafts-'))
    const file = join(dir, 'data.db')
    const seed = new VoiceChatDb(file)
    const abandoned = seed.chat.createConversation(U)
    const renamed = seed.chat.createConversation(U, 'Переименованный')
    const webReader = seed.chat.createConversation(U, 'Новый разговор', 'web-recorder')
    const resumed = seed.chat.createConversation(U)
    seed.chat.setClaudeSession(U, resumed.id, 'session-1')
    seed.close()

    const raw = new Database(file)
    raw.prepare(`DELETE FROM schema_migrations WHERE name = 'cleanup-empty-manual-drafts-v1'`).run()
    raw.close()

    const migrated = new VoiceChatDb(file)
    expect(migrated.chat.getConversation(U, abandoned.id)).toBeNull()
    expect(migrated.chat.getConversation(U, renamed.id)).not.toBeNull()
    expect(migrated.chat.getConversation(U, webReader.id)).not.toBeNull()
    expect(migrated.chat.getConversation(U, resumed.id)).not.toBeNull()
    migrated.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('CHECK по scope без images пересобирается и пускает студию картинок', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-scope-check-'))
    const file = join(dir, 'data.db')
    const seed = new VoiceChatDb(file)
    const kept = seed.chat.createConversation(U, 'Обычный')
    seed.close()

    // Возвращаем таблице «старый» CHECK без 'images' — как в БД, созданных
    // из schema.ts до появления студии.
    const raw = new Database(file)
    const ddl = (raw.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='conversations'`).get() as { sql: string }).sql
    const oldDdl = ddl
      .replace(/scope IN \([^)]*\)/, `scope IN ('chat','kanban','make','console','playwright-reader','web-reader')`)
      .replace(/^CREATE TABLE ("conversations"|conversations)/, 'CREATE TABLE conversations_old')
    raw.exec('PRAGMA foreign_keys=OFF')
    // В БД тех времён не было и триггеров кэша стоимости: с ними RENAME не пройдёт.
    for (const suffix of ['ins', 'upd', 'del']) raw.exec(`DROP TRIGGER IF EXISTS trg_messages_cost_dirty_${suffix}`)
    raw.exec(oldDdl)
    raw.exec(`INSERT INTO conversations_old SELECT * FROM conversations`)
    raw.exec(`DROP TABLE conversations`)
    raw.exec(`ALTER TABLE conversations_old RENAME TO conversations`)
    raw.close()

    const migrated = new VoiceChatDb(file)
    const studio = migrated.chat.createConversation(U, 'Картинки 1', 'images')
    expect(studio.scope).toBe('images')
    expect(studio.assistantKind).toBe('images')
    expect(migrated.chat.getConversation(U, kept.id)?.title).toBe('Обычный')
    migrated.close()
    rmSync(dir, { recursive: true, force: true })
  })

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
    expect(db.chat.listConversations('admin')).toHaveLength(0)
    expect(db.chat.listMessages('admin', 'c1')).toHaveLength(0)
    expect(db.machines.listAgents('admin')).toHaveLength(0)
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
    const c = db.chat.createConversation(U, 'Чат')
    db.chat.addMessage(U, c.id, 'u1', 'x', '14:00')
    db.chat.addMessage(U, c.id, 'ai', 'y', '14:00')
    db.chat.deleteConversation(U, c.id)
    expect(db.chat.getConversation(U, c.id)).toBeNull()
    expect(db.chat.listMessages(U, c.id)).toHaveLength(0)
    expect(db.chat.listConversations(U)).toHaveLength(0)
  })
})

describe('VoiceChatDb — session-id Claude', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
  })
  afterEach(() => db.close())

  it('сохраняет и обнуляет session-id', () => {
    const c = db.chat.createConversation(U, 'Чат')
    db.chat.setClaudeSession(U, c.id, 'sess-abc')
    expect(db.chat.getConversation(U, c.id)?.claudeSessionId).toBe('sess-abc')
    db.chat.setClaudeSession(U, c.id, null)
    expect(db.chat.getConversation(U, c.id)?.claudeSessionId).toBeNull()
  })
})

describe('VoiceChatDb — настройки', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
  })
  afterEach(() => db.close())

  it('без сохранённых настроек возвращает дефолты', () => {
    expect(db.settings.getSettings(U)).toEqual(DEFAULT_SETTINGS)
  })

  it('сохраняет и читает настройки', () => {
    db.settings.saveSettings(U, {
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
    expect(db.settings.getSettings(U)).toEqual({
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
      aiAssistPrompts: DEFAULT_SETTINGS.aiAssistPrompts,
      generatedFilesTtlDays: 30,
      personalization: DEFAULT_SETTINGS.personalization,
      // Новых полей в сохранённом конфиге нет — безопасные значения включены по умолчанию.
      chatInstructions: DEFAULT_SETTINGS.chatInstructions,
      loginNewDeviceEmails: true,
      contextPresets: [],
      defaultContextPresetId: null
    })
  })

  it('сохраняет зелёную тему между чтениями настроек', () => {
    db.settings.saveSettings(U, { ...DEFAULT_SETTINGS, theme: 'green' })
    expect(db.settings.getSettings(U).theme).toBe('green')
  })

  it('мержит с дефолтами при частичном/битом конфиге', () => {
    db.settings.saveSettings(U, { ...DEFAULT_SETTINGS, model: 'opus[1m]' })
    const s = db.settings.getSettings(U)
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
    const created = db.machines.createAgent(U, 'MacBook')
    expect(created.name).toBe('MacBook')
    expect(created.token).toMatch(/^[0-9a-f]{48}$/)

    const found = db.machines.findAgentByTokenHash(hashAgentToken(created.token))
    expect(found?.id).toBe(created.id)
    expect(found?.name).toBe('MacBook')
    expect(found?.userId).toBe(U)
    // Неверный токен не находится.
    expect(db.machines.findAgentByTokenHash(hashAgentToken('другой'))).toBeNull()
  })

  it('list и delete', () => {
    const a = db.machines.createAgent(U, 'A')
    const b = db.machines.createAgent(U, 'B')
    expect(db.machines.listAgents(U).map((x) => x.name)).toEqual(['A', 'B'])
    db.machines.deleteAgent(U, a.id)
    expect(db.machines.listAgents(U).map((x) => x.id)).toEqual([b.id])
  })

  it('touchAgent обновляет last_seen', () => {
    const a = db.machines.createAgent(U, 'A')
    expect(db.machines.listAgents(U)[0].lastSeen).toBeNull()
    db.machines.touchAgent(a.id)
    expect(db.machines.listAgents(U)[0].lastSeen).not.toBeNull()
  })

  it('новый агент имеет дефолтную политику', () => {
    db.machines.createAgent(U, 'A')
    const p = db.machines.listAgents(U)[0].policy
    expect(p.allowNetwork).toBe(true)
    expect(p.allowWrite).toBe(true)
    expect(p.allowedDirs).toEqual([])
  })

  it('setAgentPolicy сохраняет и читается', () => {
    const a = db.machines.createAgent(U, 'A')
    db.machines.setAgentPolicy(U, a.id, {
      allowedDirs: ['/tmp'],
      allowNetwork: false,
      allowWrite: false,
      denyPatterns: ['sudo'],
      allowPatterns: [],
      skills: [{ name: 'build', command: 'npm run build' }]
    })
    const p = db.machines.listAgents(U)[0].policy
    expect(p.allowNetwork).toBe(false)
    expect(p.allowedDirs).toEqual(['/tmp'])
    expect(p.skills[0]).toEqual({ name: 'build', command: 'npm run build' })
  })

  it('regenerateAgentToken делает старый токен недействительным', () => {
    const created = db.machines.createAgent(U, 'A')
    const oldHash = hashAgentToken(created.token)
    expect(db.machines.findAgentByTokenHash(oldHash)?.id).toBe(created.id)
    const { token } = db.machines.regenerateAgentToken(U, created.id)
    expect(db.machines.findAgentByTokenHash(oldHash)).toBeNull()
    expect(db.machines.findAgentByTokenHash(hashAgentToken(token))?.id).toBe(created.id)
  })
})

describe('VoiceChatDb — импорт desktop', () => {
  it('сохраняет id/даты и повторно ничего не дублирует', () => {
    const db = makeDb()
    const bundle = { conversations: [{ conversation: { id: 'legacy-c', title: 'Старый чат', createdAt: 100, updatedAt: 200, claudeSessionId: 'sess', execTarget: null }, messages: [{ id: 'legacy-m', conversationId: 'legacy-c', role: 'u1' as const, text: 'привет', time: '10:00', createdAt: 150 }] }] }
    expect(db.chat.importDesktopData('alice', bundle)).toEqual({ conversationsImported: 1, messagesImported: 1 })
    expect(db.chat.importDesktopData('alice', bundle)).toEqual({ conversationsImported: 0, messagesImported: 0 })
    expect(db.chat.getConversation('alice', 'legacy-c')).toMatchObject({ title: 'Старый чат', createdAt: 100, updatedAt: 200 })
    expect(db.chat.listMessages('alice', 'legacy-c')[0]).toMatchObject({ id: 'legacy-m', createdAt: 150 })
    expect(db.chat.getConversation('bob', 'legacy-c')).toBeNull()
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
    db.identity.ensureAdmin()
    db.identity.ensureAdmin()
    expect(db.identity.listUsers().map((u) => u.name)).toEqual(['admin'])
    expect(db.identity.getUser('admin')?.role).toBe('admin')
  })

  it('createUser/getUser/verifyUserPassword/блокировка/удаление', () => {
    db.identity.createUser('bob', 'pw', 'developer')
    expect(db.identity.getUser('bob')).toMatchObject({ name: 'bob', role: 'developer', blocked: false })
    expect(db.identity.verifyUserPassword('bob', 'pw')?.name).toBe('bob')
    expect(db.identity.verifyUserPassword('bob', 'x')).toBeNull()
    db.identity.setUserBlocked('bob', true)
    expect(db.identity.getUser('bob')?.blocked).toBe(true)
    db.identity.deleteUser('bob')
    expect(db.identity.getUser('bob')).toBeNull()
  })

  it('deleteUserData стирает разговоры/агентов/настройки и учётку', () => {
    db.identity.createUser('bob', '', 'developer')
    const c = db.chat.createConversation('bob', 'Чат')
    db.chat.addMessage('bob', c.id, 'u1', 'привет', '10:00')
    db.machines.createAgent('bob', 'BobBox')
    db.settings.saveSettings('bob', { ...DEFAULT_SETTINGS, model: 'sonnet' })

    db.identity.deleteUserData('bob')
    expect(db.identity.getUser('bob')).toBeNull()
    expect(db.chat.listConversations('bob')).toEqual([])
    expect(db.machines.listAgents('bob')).toEqual([])
    // Настройки вернулись к дефолту (строка удалена).
    expect(db.settings.getSettings('bob').model).toBe(DEFAULT_SETTINGS.model)
  })

  it('usageReport считает прерванные ходы: доли «успешных» в системе нет', () => {
    db.identity.createUser('bob', '', 'developer')
    const c = db.chat.createConversation('bob', 'Чат')
    db.chat.addMessage('bob', c.id, 'ai', 'ответ', '10:01', 'claude', { inputTokens: 10, outputTokens: 2, model: 'opus' })
    db.chat.addMessage('bob', c.id, 'ai', 'обрыв', '10:02', 'claude', { inputTokens: 5, outputTokens: 1, model: 'opus', interrupted: true })
    expect(db.chat.usageReport('bob', 'day').totals.messages).toBe(2)
    expect(db.chat.usageReport('bob', 'day').totals.interrupted).toBe(1)
    expect(db.chat.usageSummary().find((u) => u.name === 'bob')?.totals.interrupted).toBe(1)
  })

  it('sessionActivity и conversationCounts отдают агрегаты одним проходом', () => {
    db.chat.createConversation('bob', 'Первый')
    db.chat.createConversation('bob', 'Второй')
    expect(db.chat.conversationCounts().get('bob')).toBe(2)
    // Без живых сессий пользователя в карте активности нет — «активен сейчас» ложным не станет.
    expect(db.identity.sessionActivity().get('bob')).toBeUndefined()
  })

  it('usageReport суммирует токены ai-сообщений по моделям', () => {
    const c = db.chat.createConversation('bob', 'Чат')
    const meta = (model: string, inTok: number, outTok: number) => ({
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd: 0.01,
      model
    })
    db.chat.addMessage('bob', c.id, 'u1', 'вопрос', '10:00')
    db.chat.addMessage('bob', c.id, 'ai', 'ответ1', '10:01', 'claude', meta('opus', 100, 20))
    db.chat.addMessage('bob', c.id, 'ai', 'ответ2', '10:02', 'claude', meta('opus', 50, 10))
    db.chat.addMessage('bob', c.id, 'ai', 'ответ3', '10:03', 'claude', meta('sonnet', 30, 5))

    const rep = db.chat.usageReport('bob', 'day')
    expect(rep.totals.inputTokens).toBe(180)
    expect(rep.totals.outputTokens).toBe(35)
    expect(rep.totals.messages).toBe(3)
    const opus = rep.byModel.find((m) => m.model === 'opus')!
    expect(opus.inputTokens).toBe(150)
    expect(opus.outputTokens).toBe(30)
    // Изоляция: у другого пользователя пусто.
    expect(db.chat.usageReport('alice', 'day').totals.messages).toBe(0)
  })

  it('usageReport фильтрует разговор и оценивает Codex по таблице цен БД', () => {
    const priced = db.chat.createConversation('bob', 'Codex')
    const other = db.chat.createConversation('bob', 'Другой чат')
    db.chat.addMessage('bob', priced.id, 'ai', 'ответ', '10:01', 'codex', {
      model: 'gpt-5.4', inputTokens: 1_000_000, cacheReadTokens: 200_000, outputTokens: 100_000
    })
    db.chat.addMessage('bob', other.id, 'ai', 'ответ', '10:02', 'codex', {
      model: 'unknown-codex', inputTokens: 9_000_000, outputTokens: 9_000_000
    })

    const report = db.chat.usageReport('bob', 'day', undefined, undefined, priced.id)
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
    db.identity.createUser('kb-user', '', 'developer')
    const conversation = db.chat.createConversation('kb-user', 'KB')
    expect(conversation.kbContextMode).toBe('auto')
    expect(db.chat.setConversationKbContextMode('kb-user', conversation.id, 'manual')?.kbContextMode).toBe('manual')
    expect(db.chat.setConversationKbContextMode('kb-user', conversation.id, 'off')?.kbContextMode).toBe('off')
    db.close()
  })
})


describe('VoiceChatDb — резолв исполнителя LLM', () => {
  it('выбирает запрошенный доступный и заменяет закрытый на default роли', () => {
    const db = makeDb()
    const def = db.llm.createLlmEngine({ name: 'Рабочий', kind: 'claude', baseUrl: 'http://work', token: '', enabled: true, allowedRoles: ['admin', 'developer'], isDefault: true })
    const personal = db.llm.createLlmEngine({ name: 'Личный', kind: 'claude', baseUrl: 'http://personal', token: '', enabled: true, allowedRoles: ['admin'], isDefault: false })
    expect(db.llm.resolveLlmEngine(personal.id, 'claude', 'admin')).toMatchObject({ engine: { id: personal.id }, substituted: false })
    expect(db.llm.resolveLlmEngine(personal.id, 'claude', 'developer')).toMatchObject({ engine: { id: def.id }, substituted: true })
    expect(db.llm.listLlmEnginesForRole('developer').map((engine) => engine.id)).toEqual([def.id])
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
        assistant_kind TEXT,
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
    const insert = raw.prepare(`INSERT INTO conversations (id, title, created_at, updated_at, user_id, skill_names, kb_context_mode, assistant_kind, project_id, status) VALUES (?, ?, 1, 2, 'admin', '[]', 'auto', ?, ?, 'developing')`)
    insert.run('c1', 'legacy', null, null)
    insert.run('c2', 'make', 'make', null)
    insert.run('c3', 'console', 'console-reader', null)
    insert.run('c4', 'web', 'web-recorder', null)
    insert.run('c5', 'unknown', 'future-kind', null)
    insert.run('c6', 'kanban-invalid', 'kanban', null)
    insert.run('c7', 'kanban-valid', 'kanban', 'p1')
    raw.close()
    const db = new VoiceChatDb(file)
    try {
      expect(db.chat.getConversation('admin', 'c1')).toMatchObject({ title: 'legacy', scope: 'chat' })
      expect(db.chat.getConversation('admin', 'c2')?.scope).toBe('make')
      expect(db.chat.getConversation('admin', 'c3')?.scope).toBe('console')
      expect(db.chat.getConversation('admin', 'c4')?.scope).toBe('web-reader')
      expect(db.chat.getConversation('admin', 'c5')?.scope).toBe('chat')
      expect(db.chat.getConversation('admin', 'c6')?.scope).toBe('chat')
      expect(db.chat.getConversation('admin', 'c7')?.scope).toBe('kanban')
      expect(db.chat.listConversations('admin', { scope: 'make' }).map((item) => item.id)).toEqual(['c2'])
      expect(db.chat.listConversations('admin', { scope: 'kanban', projectId: 'p1' }).map((item) => item.id)).toEqual(['c7'])
      expect(db.chat.listConversations('admin', { scope: 'kanban', projectId: 'p2' })).toEqual([])
      expect(db.llm.listLlmEngines()).toEqual([])
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('снимает с Make-чатов привязку к машине и каталог, а «none» и чужие чаты не трогает', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-db-make-machine-'))
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
        assistant_kind TEXT,
        status TEXT NOT NULL DEFAULT 'developing'
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL,
        time TEXT NOT NULL, created_at INTEGER NOT NULL, engine TEXT, meta TEXT, exec_target TEXT
      );
      CREATE TABLE speakers (conversation_id TEXT NOT NULL, speaker_id INTEGER NOT NULL, label TEXT NOT NULL, PRIMARY KEY (conversation_id, speaker_id));
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER, policy TEXT, user_id TEXT);
      CREATE TABLE users (name TEXT PRIMARY KEY, password_hash TEXT NOT NULL, role TEXT NOT NULL, blocked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    `)
    raw.prepare(`INSERT INTO users (name, password_hash, role, blocked, created_at) VALUES ('admin', 'x', 'admin', 0, 1)`).run()
    const insert = raw.prepare(`INSERT INTO conversations (id, title, created_at, updated_at, user_id, skill_names, kb_context_mode, assistant_kind, exec_target, workdir, status) VALUES (?, ?, 1, 2, 'admin', '[]', 'auto', ?, ?, ?, 'developing')`)
    insert.run('m1', 'make с машиной', 'make', 'agent-1', '/Users/dev/ChatAI/projects/p1/worktree')
    insert.run('m2', 'make без машины', 'make', 'none', null)
    insert.run('c1', 'обычный чат', null, 'agent-1', '/repo')
    raw.close()

    const db = new VoiceChatDb(file)
    try {
      // Привязка Make-чата снята: ход её всё равно игнорирует, а панель показывала
      // машину и каталог, которых нет в работе.
      expect(db.chat.getConversation('admin', 'm1')).toMatchObject({ execTarget: null, workdir: null })
      // Явное «без машины» — осознанный выбор пользователя, он сохраняется.
      expect(db.chat.getConversation('admin', 'm2')?.execTarget).toBe('none')
      // Обычный чат работает на машине: его привязка не трогается.
      expect(db.chat.getConversation('admin', 'c1')).toMatchObject({ execTarget: 'agent-1', workdir: '/repo' })

      // Повторно назначить машину Make-чату нельзя и через API.
      const machine = db.machines.createAgent('admin', 'Ноутбук')
      db.chat.setConversationExecTarget('admin', 'm1', machine.id, '/repo')
      expect(db.chat.getConversation('admin', 'm1')).toMatchObject({ execTarget: null, workdir: null })
      // Прочие настройки того же вызова сохраняются.
      db.chat.setConversationExecTarget('admin', 'm1', machine.id, '/repo', undefined, undefined, undefined, 'plan')
      expect(db.chat.getConversation('admin', 'm1')).toMatchObject({ execTarget: null, permissionMode: 'plan' })
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('VoiceChatDb — хранилища машин', () => {
  it('keeps stable storage ids and portable chat bindings', () => {
    const db = makeDb()
    db.identity.createUser(U, '', 'admin')
    const machine = db.machines.createAgent(U, 'MacBook')
    const first = db.machines.saveMachineStorage(U, machine.id, '/Users/admin/ChatAI/', 1)
    const replay = db.machines.saveMachineStorage(U, machine.id, '/Users/admin/ChatAI', 1)
    expect(replay.id).toBe(first.id)
    expect(db.machines.listMachineStorages(U, machine.id)).toEqual([first])

    const conversation = db.chat.createConversation(U, 'Storage')
    const binding = db.machines.saveChatStorageBinding(U, {
      conversationId: conversation.id,
      machineId: machine.id,
      storageId: first.id,
      relativePath: 'chats/chat-1/'
    })
    expect(binding.relativePath).toBe('chats/chat-1')
    expect(db.machines.getChatStorageBinding(U, conversation.id)).toEqual(binding)
    expect(() => db.machines.saveChatStorageBinding(U, { ...binding, relativePath: '../outside' })).toThrow()
    db.close()
  })

  it('атомарно удаляет машину с RESTRICT-связями и сбрасывает логические цели', () => {
    const db = makeDb()
    db.identity.createUser(U, '', 'admin')
    const machine = db.machines.createAgent(U, 'MacBook')
    const storage = db.machines.saveMachineStorage(U, machine.id, '/Users/admin/ChatAI', 1)
    const conversation = db.chat.createConversation(U, 'Storage')
    const project = db.projects.createProject(U, { name: 'Project' })
    db.machines.linkMachine(U, project.id, machine.id, storage.id)
    db.projects.setProjectDefaultMachine(U, project.id, machine.id)
    db.machines.saveChatStorageBinding(U, {
      conversationId: conversation.id,
      machineId: machine.id,
      storageId: storage.id,
      relativePath: 'chats/chat-1'
    })
    db.settings.saveSettings(U, { ...DEFAULT_SETTINGS, execTarget: machine.id, defaultAgentId: machine.id })

    const raw = (db as unknown as { db: Database.Database }).db
    raw.prepare(`UPDATE conversations SET exec_target=? WHERE id=?`).run(machine.id, conversation.id)
    raw.prepare(
      `INSERT INTO conversation_workspaces
       (conversation_id,project_id,machine_id,storage_id,mode,base_sha,branch,repository_path,state,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(conversation.id, project.id, machine.id, storage.id, 'task', 'abc', 'CHAT-395', '/repo/task', 'active', 1)

    expect(db.machines.deleteAgent(U, machine.id)).toBe(true)
    expect(db.machines.deleteAgent(U, machine.id)).toBe(false)
    expect(db.machines.listAgents(U)).toEqual([])
    expect(db.machines.listMachineStorages(U, machine.id)).toEqual([])
    expect(db.machines.getChatStorageBinding(U, conversation.id)).toBeNull()
    expect(db.chat.getConversation(U, conversation.id)).toMatchObject({ id: conversation.id, execTarget: null })
    expect(db.projects.getProject(U, project.id)).toMatchObject({ id: project.id, defaultAgentId: null, machines: [] })
    expect(db.settings.getSettings(U)).toMatchObject({ execTarget: null, defaultAgentId: null })
    expect(raw.prepare(`SELECT 1 FROM conversation_workspaces WHERE conversation_id=?`).get(conversation.id)).toBeUndefined()
    expect(raw.prepare(`PRAGMA foreign_key_check`).all()).toEqual([])
    db.close()
  })

  it('откатывает очистку связей, если финальное удаление машины падает', () => {
    const db = makeDb()
    db.identity.createUser(U, '', 'admin')
    const machine = db.machines.createAgent(U, 'MacBook')
    const storage = db.machines.saveMachineStorage(U, machine.id, '/Users/admin/ChatAI', 1)
    const conversation = db.chat.createConversation(U, 'Storage')
    db.machines.saveChatStorageBinding(U, {
      conversationId: conversation.id,
      machineId: machine.id,
      storageId: storage.id,
      relativePath: 'chats/chat-1'
    })
    const raw = (db as unknown as { db: Database.Database }).db
    raw.exec(`CREATE TRIGGER fail_agent_delete BEFORE DELETE ON agents BEGIN SELECT RAISE(ABORT, 'forced'); END`)

    expect(() => db.machines.deleteAgent(U, machine.id)).toThrow('forced')
    expect(db.machines.listAgents(U)).toHaveLength(1)
    expect(db.machines.listMachineStorages(U, machine.id)).toHaveLength(1)
    expect(db.machines.getChatStorageBinding(U, conversation.id)).not.toBeNull()
    expect(raw.prepare(`PRAGMA foreign_key_check`).all()).toEqual([])
    db.close()
  })
})

describe('VoiceChatDb — персистентная очередь ходов', () => {
  it('дедуплицирует повторную доставку, сохраняет порядок и переживает restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'voicechat-queue-'))
    const file = join(dir, 'db.sqlite')
    let db = new VoiceChatDb(file)
    db.identity.createUser(U, '', 'admin')
    const conversation = db.chat.createConversation(U, 'queue')
    const first = db.chat.addMessage(U, conversation.id, 'u1', 'Первый', '10:00')
    const second = db.chat.addMessage(U, conversation.id, 'u1', 'Второй', '10:01')
    db.chat.enqueueTurn(U, conversation.id, first.id, { segments: [{ speakerId: 1, text: 'Первый' }], attachments: ['a1'] })
    db.chat.enqueueTurn(U, conversation.id, first.id, { segments: [{ speakerId: 1, text: 'ДУБЛЬ' }] })
    db.chat.enqueueTurn(U, conversation.id, second.id, { segments: [{ speakerId: 1, text: 'Второй' }] })
    expect(db.chat.listQueuedTurns(U, conversation.id).map((item) => item.text)).toEqual(['Первый', 'Второй'])
    expect(db.chat.listMessages(U, conversation.id)).toEqual([])
    db.close()

    db = new VoiceChatDb(file)
    expect(db.chat.listQueuedTurns(U, conversation.id)).toMatchObject([
      { messageId: first.id, position: 1, attachments: ['a1'] },
      { messageId: second.id, position: 2 }
    ])
    expect(db.chat.listMessages(U, conversation.id)).toEqual([])
    const dispatched = db.chat.takeQueuedTurn(U, conversation.id)
    expect(dispatched?.message.id).toBe(first.id)
    expect(db.chat.listMessages(U, conversation.id).map((message) => message.id)).toEqual([first.id])
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('редактирует на месте, удаляет без возможности последующего запуска и хранит паузу', () => {
    const db = makeDb()
    db.identity.createUser(U, '', 'admin')
    const conversation = db.chat.createConversation(U, 'queue')
    const message = db.chat.addMessage(U, conversation.id, 'u1', 'Старый', '10:00')
    const [queued] = db.chat.enqueueTurn(U, conversation.id, message.id, { segments: [{ speakerId: 1, text: 'Старый' }] })
    db.chat.updateQueuedTurn(U, conversation.id, queued.id, 'Новый', { segments: [{ speakerId: 1, text: 'Новый' }] })
    expect(db.chat.listQueuedTurns(U, conversation.id)).toMatchObject([{ id: queued.id, text: 'Новый', position: 1 }])
    db.chat.setTurnQueuePaused(U, conversation.id, true)
    expect(db.chat.isTurnQueuePaused(U, conversation.id)).toBe(true)
    db.chat.deleteQueuedTurn(U, conversation.id, queued.id)
    expect(db.chat.takeQueuedTurn(U, conversation.id)).toBeNull()
    expect(db.chat.listMessages(U, conversation.id)).toEqual([])
    db.close()
  })

  it('повышает приоритет атомарно и сохраняет текст с вложениями', () => {
    const db = makeDb()
    db.identity.createUser(U, '', 'admin')
    const conversation = db.chat.createConversation(U, 'queue')
    const first = db.chat.addMessage(U, conversation.id, 'u1', 'Первый', '10:00')
    const second = db.chat.addMessage(U, conversation.id, 'u1', 'Второй', '10:01', undefined, undefined, undefined, [
      { uploadId: 'a1', path: '/tmp/image.png', name: 'image.png', mimeType: 'image/png', size: 10 }
    ])
    db.chat.enqueueTurn(U, conversation.id, first.id, { segments: [{ speakerId: 1, text: first.text }] })
    const queued = db.chat.enqueueTurn(U, conversation.id, second.id, { segments: [{ speakerId: 1, text: second.text }], attachments: ['a1'] })[1]

    db.chat.updateQueuedTurn(U, conversation.id, queued.id, 'Исправленный', { segments: [{ speakerId: 1, text: 'Исправленный' }], attachments: ['a1'] })
    db.chat.prioritizeQueuedTurn(U, conversation.id, queued.id)
    db.chat.prioritizeQueuedTurn(U, conversation.id, queued.id)

    expect(db.chat.listQueuedTurns(U, conversation.id)).toMatchObject([
      { id: queued.id, messageId: second.id, text: 'Исправленный', position: 1, attachments: ['a1'], attachmentDetails: [{ name: 'image.png', mimeType: 'image/png' }] },
      { messageId: first.id, position: 2 }
    ])
    db.close()
  })
})


describe('блокировка после неудачных входов (auth-roadmap п.3)', () => {
  it('5 неудач → замок на 15 минут, 10 → blocked/auto; сброс и ручная разблокировка чистят счётчик', () => {
    const db = makeDb()
    db.identity.createUser('locky', 'x', 'developer')
    for (let i = 0; i < 4; i++) db.identity.recordLoginFailure('locky')
    expect(db.identity.getUser('locky')!.lockedUntil).toBeNull()
    const fifth = db.identity.recordLoginFailure('locky')!
    expect(fifth.lockedUntil).toBeGreaterThan(Date.now())
    expect(db.identity.getUser('locky')!.lockedUntil).toBe(fifth.lockedUntil)
    db.identity.resetLoginFailures('locky')
    expect(db.identity.getUser('locky')).toMatchObject({ failedLogins: 0, lockedUntil: null })
    for (let i = 0; i < 10; i++) db.identity.recordLoginFailure('locky')
    expect(db.identity.getUser('locky')).toMatchObject({ blocked: true, lockReason: 'auto' })
    db.identity.setUserBlocked('locky', false)
    expect(db.identity.getUser('locky')).toMatchObject({ blocked: false, failedLogins: 0, lockReason: null })
    expect(db.identity.recordLoginFailure('ghost')).toBeNull()
    db.close()
  })
})

describe('обслуживание учёток (auth-roadmap п.18)', () => {
  it('blockInactiveUsers блокирует давно не входивших (кроме admin) с причиной inactive; pruneInvites чистит истёкшие', () => {
    const db = makeDb()
    db.identity.createUser('old', 'x', 'developer')
    db.identity.createUser('fresh', 'x', 'developer')
    db.identity.markLogin('fresh')
    // created_at у тестовых часов маленькое → «давно»; у fresh есть свежий вход.
    const blocked = db.identity.blockInactiveUsers(30)
    expect(blocked).toEqual(['old'])
    expect(db.identity.getUser('old')).toMatchObject({ blocked: true, lockReason: 'inactive' })
    expect(db.identity.getUser('fresh')!.blocked).toBe(false)
    db.identity.createInvite({ token: 'expired', role: 'tester', createdBy: 'admin', ttlMs: -8 * 24 * 60 * 60_000, maxUses: 1 })
    db.identity.createInvite({ token: 'alive', role: 'tester', createdBy: 'admin', ttlMs: 60_000, maxUses: 1 })
    expect(db.identity.pruneInvites()).toBe(1)
    expect(db.identity.getInvite('alive')).not.toBeNull()
    db.close()
  })
})

// «Поле появилось в релизе» и «человек выбрал такое значение» должны быть
// различимы: иначе смена дефолта в следующем релизе молча переедет всем, кто
// ничего не менял. Поэтому чтение дозаполняет запись один раз.
describe('VoiceChatDb — дефолты настроек фиксируются в записи', () => {
  it('дозаполняет отсутствующие поля и не трогает выбранные', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-settings-defaults-'))
    const file = join(dir, 'settings.db')
    const db = new VoiceChatDb(file)
    const raw = new Database(file)
    // Запись «старого релиза»: только тема, остальных полей ещё не существовало.
    raw.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run('app:ann', JSON.stringify({ theme: 'dark' }))

    const read = db.settings.getSettings('ann')

    expect(read.theme).toBe('dark')
    const stored = JSON.parse((raw.prepare(`SELECT value FROM settings WHERE key = ?`).get('app:ann') as { value: string }).value)
    expect(stored).toMatchObject({ theme: 'dark', llmProvider: 'claude', permissionMode: 'bypassPermissions' })
    raw.close()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
