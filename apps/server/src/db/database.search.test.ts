// Полнотекстовый поиск по сообщениям: индекс, триггеры, бэкфилл, изоляция
// владельцев и курсорная пагинация.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb

beforeEach(() => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.identity.createUser('alice', '', 'developer')
  db.identity.createUser('bob', '', 'developer')
})

afterEach(() => db.close())

/** Беседа с сообщениями пользователя (роль по умолчанию — реплика человека). */
function conv(user: string, title: string, texts: string[]): string {
  const c = db.chat.createConversation(user, title)
  for (const t of texts) db.chat.addMessage(user, c.id, 'u1', t, '12:00')
  return c.id
}

describe('searchMessages — находит и ранжирует', () => {
  it('находит по слову, отдаёт сниппет с подсветкой и мету беседы', () => {
    const id = conv('alice', 'Канбан', ['Обсудили миграцию канбана на новую схему'])

    const res = db.chat.searchMessages('alice', { q: 'миграцию' })

    expect(res.hits).toHaveLength(1)
    const hit = res.hits[0]
    expect(hit.conversationId).toBe(id)
    expect(hit.conversationTitle).toBe('Канбан')
    expect(hit.role).toBe('u1')
    expect(hit.time).toBe('12:00')
    expect(hit.projectId).toBeNull()
    expect(hit.snippet).toContain('<mark>миграцию</mark>')
    expect(res.nextCursor).toBeNull()
    expect(res.match).toBe('"миграцию"*')
  })

  it('регистр не мешает, слова ищутся через И', () => {
    conv('alice', 'Серверная', ['Стойка стояла в СЕРВЕРНОЙ комнате'])

    // unicode61 складывает регистр и для кириллицы.
    expect(db.chat.searchMessages('alice', { q: 'серверной ' }).hits).toHaveLength(1)
    expect(db.chat.searchMessages('alice', { q: 'СТОЙКА ' }).hits).toHaveLength(1)
    // Оба слова есть — находим; второго нет — не находим.
    expect(db.chat.searchMessages('alice', { q: 'стойка серверной ' }).hits).toHaveLength(1)
    expect(db.chat.searchMessages('alice', { q: 'стойка подвале ' }).hits).toHaveLength(0)
  })

  it('незакрытое последнее слово ищется как префикс', () => {
    conv('alice', 'Канбан', ['Миграция канбана'])

    expect(db.chat.searchMessages('alice', { q: 'мигра' }).hits).toHaveLength(1)
    // То же слово с разделителем на конце — уже точное совпадение.
    expect(db.chat.searchMessages('alice', { q: 'мигра ' }).hits).toHaveLength(0)
  })

  it('пустой запрос и запрос из одних спецсимволов → пустая страница без ошибки', () => {
    conv('alice', 'Канбан', ['Миграция канбана'])

    for (const q of ['', '   ', '*', '"', '-', '^)(', '()']) {
      const res = db.chat.searchMessages('alice', { q })
      expect(res.hits).toEqual([])
      expect(res.match).toBe('')
    }
    // Спецсинтаксис со словом внутри становится обычным поиском слова.
    expect(db.chat.searchMessages('alice', { q: 'NEAR(' }).hits).toEqual([])
    expect(db.chat.searchMessages('alice', { q: '"канбана"' }).hits).toHaveLength(1)
  })

  it('релевантнее сначала: сообщение с обоими словами выше', () => {
    conv('alice', 'Один', ['канбан канбан канбан миграция'])
    conv('alice', 'Два', ['просто канбан и ничего больше'])

    const res = db.chat.searchMessages('alice', { q: 'канбан миграция ' })

    expect(res.hits).toHaveLength(1)
    expect(res.hits[0].conversationTitle).toBe('Один')
  })
})

describe('searchMessages — фильтры и пагинация', () => {
  it('сужает по проекту и по беседе', () => {
    const p = db.projects.createProject('alice', { name: 'Проект' })
    const inProject = conv('alice', 'С проектом', ['миграция схемы'])
    db.chat.setConversationProject('alice', inProject, p.id)
    const noProject = conv('alice', 'Без проекта', ['миграция схемы'])

    expect(db.chat.searchMessages('alice', { q: 'миграция ' }).hits).toHaveLength(2)
    const byProject = db.chat.searchMessages('alice', { q: 'миграция ', projectId: p.id })
    expect(byProject.hits.map((h) => h.conversationId)).toEqual([inProject])
    // null — только беседы без проекта.
    const noneOnly = db.chat.searchMessages('alice', { q: 'миграция ', projectId: null })
    expect(noneOnly.hits.map((h) => h.conversationId)).toEqual([noProject])
    const byConv = db.chat.searchMessages('alice', { q: 'миграция ', conversationId: noProject })
    expect(byConv.hits.map((h) => h.conversationId)).toEqual([noProject])
  })

  it('исключает cancelled-чаты до пагинации, даже при явном conversationId', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const board = db.tasks.getBoard('alice', p.id)!
    const work = board.columns.find((c) => c.semanticType === 'development')!
    const cancelled = board.columns.find((c) => c.semanticType === 'cancelled')!
    const hiddenTask = db.tasks.createTask('alice', p.id, { columnId: work.id, title: 'Скрытая' })!
    const hiddenChat = db.chat.openOrCreateTaskChat('alice', p.id, hiddenTask.id)!
    db.chat.addMessage('alice', hiddenChat.id, 'u0', 'миграция скрытая', '10:00')
    const visible = conv('alice', 'Видимая', ['миграция видимая'])
    db.tasks.moveTask('alice', p.id, hiddenTask.id, { columnId: cancelled.id })

    const first = db.chat.searchMessages('alice', { q: 'миграция ', limit: 1 })
    expect(first.hits.map((hit) => hit.conversationId)).toEqual([visible])
    expect(db.chat.searchMessages('alice', { q: 'миграция ', limit: 1, cursor: first.nextCursor }).hits).toEqual([])
    expect(db.chat.searchMessages('alice', { q: 'миграция ', conversationId: hiddenChat.id }).hits).toEqual([])
    expect(db.chat.listMessages('alice', hiddenChat.id).map((message) => message.text)).toEqual(['миграция скрытая'])
  })

  it('курсор отдаёт следующую страницу без повторов и пропусков', () => {
    const id = conv(
      'alice',
      'Много',
      Array.from({ length: 7 }, (_, i) => `сообщение про миграцию номер ${i}`)
    )

    const seen: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 5; page++) {
      const res = db.chat.searchMessages('alice', { q: 'миграцию ', limit: 3, cursor })
      seen.push(...res.hits.map((h) => h.messageId))
      cursor = res.nextCursor
      if (!cursor) break
    }

    expect(new Set(seen).size).toBe(7)
    expect(db.chat.listMessages('alice', id).every((m) => seen.includes(m.id))).toBe(true)
  })

  it('limit ограничен сверху и снизу', () => {
    conv('alice', 'Много', Array.from({ length: 60 }, (_, i) => `миграция ${i}`))

    expect(db.chat.searchMessages('alice', { q: 'миграция ', limit: 1000 }).hits).toHaveLength(50)
    expect(db.chat.searchMessages('alice', { q: 'миграция ', limit: 0 }).hits).toHaveLength(20)
    expect(db.chat.searchMessages('alice', { q: 'миграция ', limit: Number.NaN }).hits).toHaveLength(20)
  })

  it('битый курсор не ломает поиск — просто первая страница', () => {
    conv('alice', 'Много', ['миграция раз', 'миграция два'])

    const res = db.chat.searchMessages('alice', { q: 'миграция ', cursor: 'не-курсор' })

    expect(res.hits).toHaveLength(2)
  })
})

describe('searchMessages — изоляция владельцев', () => {
  it('не выдаёт сообщения другого пользователя ни при каких параметрах', () => {
    const mine = conv('alice', 'Моя беседа', ['секрет алисы про миграцию'])
    const theirs = conv('bob', 'Беседа Боба', ['секрет боба про миграцию'])

    const alice = db.chat.searchMessages('alice', { q: 'миграцию ' })
    expect(alice.hits.map((h) => h.conversationId)).toEqual([mine])

    // Явное указание чужой беседы не помогает.
    expect(db.chat.searchMessages('alice', { q: 'миграцию ', conversationId: theirs }).hits).toEqual([])
    // Как и попытка добраться курсором с чужой страницы.
    const bob = db.chat.searchMessages('bob', { q: 'миграцию ', limit: 1 })
    expect(bob.hits.map((h) => h.conversationId)).toEqual([theirs])
    expect(db.chat.searchMessages('alice', { q: 'миграцию ', cursor: bob.nextCursor }).hits.every((h) => h.conversationId === mine)).toBe(true)
    // И проект чужого пользователя тоже ничего не даёт.
    const p = db.projects.createProject('bob', { name: 'Проект Боба' })
    db.chat.setConversationProject('bob', theirs, p.id)
    expect(db.chat.searchMessages('alice', { q: 'миграцию ', projectId: p.id }).hits).toEqual([])
  })
})

describe('messages_fts — синхронизация триггерами', () => {
  it('новое сообщение попадает в индекс', () => {
    const id = conv('alice', 'Беседа', ['первое'])
    expect(db.chat.searchMessages('alice', { q: 'добавленное ' }).hits).toHaveLength(0)

    db.chat.addMessage('alice', id, 'ai', 'добавленное сообщение', '12:01')

    expect(db.chat.searchMessages('alice', { q: 'добавленное ' }).hits).toHaveLength(1)
  })

  it('изменённый текст находится по новому слову и не находится по старому', () => {
    // Сервер сам сообщения не правит (правка = удаление + новое), но триггер на
    // UPDATE обязан работать: иначе прямая правка текста тихо разошлась бы с индексом.
    const dir = mkdtempSync(join(tmpdir(), 'vc-fts-upd-'))
    const file = join(dir, 'db.sqlite')
    const owner = new VoiceChatDb(file)
    owner.identity.createUser('alice', '', 'developer')
    const c = owner.chat.createConversation('alice', 'Беседа')
    const m = owner.chat.addMessage('alice', c.id, 'u1', 'старое слово', '12:00')

    const raw = new Database(file)
    raw.prepare(`UPDATE messages SET text = ? WHERE id = ?`).run('новое слово', m.id)
    raw.close()

    expect(owner.chat.searchMessages('alice', { q: 'старое ' }).hits).toHaveLength(0)
    expect(owner.chat.searchMessages('alice', { q: 'новое ' }).hits).toHaveLength(1)
    owner.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('удалённое сообщение исчезает из индекса — и точечно, и каскадом', () => {
    const id = conv('alice', 'Беседа', ['удаляемое слово', 'остающееся слово'])
    const [first] = db.chat.listMessages('alice', id)

    db.chat.deleteMessage('alice', id, first.id)
    expect(db.chat.searchMessages('alice', { q: 'удаляемое ' }).hits).toHaveLength(0)
    expect(db.chat.searchMessages('alice', { q: 'остающееся ' }).hits).toHaveLength(1)

    // Каскад от беседы тоже проходит через триггер AFTER DELETE.
    db.chat.deleteConversation('alice', id)
    expect(db.chat.searchMessages('alice', { q: 'остающееся ' }).hits).toHaveLength(0)
  })
})

describe('messages_fts — миграция и бэкфилл', () => {
  const dirs: string[] = []
  const tmpDb = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-fts-'))
    dirs.push(dir)
    return join(dir, 'db.sqlite')
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('старая база без индекса бэкфиллится порциями, повторный старт ничего не ломает', () => {
    const file = tmpDb()
    const first = new VoiceChatDb(file)
    first.identity.createUser('alice', '', 'developer')
    const c = first.chat.createConversation('alice', 'История')
    for (let i = 0; i < 12; i++) first.chat.addMessage('alice', c.id, 'u1', `история про миграцию ${i}`, '12:00')
    first.close()

    // Имитируем боевую базу до фичи: индекса и триггеров нет.
    const raw = new Database(file)
    raw.exec(`DROP TABLE messages_fts; DROP TRIGGER messages_fts_ai; DROP TRIGGER messages_fts_ad;
              DROP TRIGGER messages_fts_au; DELETE FROM fts_state`)
    raw.close()

    const migrated = new VoiceChatDb(file)
    // Порциями: за одну порцию индексируем не всё, старт не ждёт всю историю.
    const step = migrated.chat.backfillMessagesFts(5)
    expect(step).toEqual({ indexed: 5, done: false })
    migrated.chat.ensureMessagesIndexed()
    expect(migrated.chat.searchMessages('alice', { q: 'миграцию ', limit: 50 }).hits).toHaveLength(12)
    migrated.close()

    // Повторный старт: индекс уже готов, бэкфилл не дублирует записи.
    const again = new VoiceChatDb(file)
    expect(again.chat.backfillMessagesFts()).toEqual({ indexed: 0, done: true })
    const res = again.chat.searchMessages('alice', { q: 'миграцию ', limit: 50 })
    expect(res.hits).toHaveLength(12)
    expect(new Set(res.hits.map((h) => h.messageId)).size).toBe(12)
    again.close()
  })

  it('потерянное состояние бэкфилла пересобирает индекс, а не удваивает его', () => {
    const file = tmpDb()
    const first = new VoiceChatDb(file)
    first.identity.createUser('alice', '', 'developer')
    const c = first.chat.createConversation('alice', 'История')
    first.chat.addMessage('alice', c.id, 'u1', 'единственная миграция', '12:00')
    first.close()

    const raw = new Database(file)
    raw.exec(`DELETE FROM fts_state`) // индекс на месте, состояние потеряно
    raw.close()

    const again = new VoiceChatDb(file)
    again.chat.ensureMessagesIndexed()
    expect(again.chat.searchMessages('alice', { q: 'миграция ' }).hits).toHaveLength(1)
    again.close()
  })

  it('сообщения, добавленные во время бэкфилла, не дублируются в индексе', () => {
    const file = tmpDb()
    const first = new VoiceChatDb(file)
    first.identity.createUser('alice', '', 'developer')
    const c = first.chat.createConversation('alice', 'История')
    for (let i = 0; i < 6; i++) first.chat.addMessage('alice', c.id, 'u1', `миграция ${i}`, '12:00')
    first.close()

    const raw = new Database(file)
    raw.exec(`DROP TABLE messages_fts; DROP TRIGGER messages_fts_ai; DROP TRIGGER messages_fts_ad;
              DROP TRIGGER messages_fts_au; DELETE FROM fts_state`)
    raw.close()

    const migrated = new VoiceChatDb(file)
    migrated.chat.backfillMessagesFts(2) // бэкфилл начат, но не закончен
    migrated.chat.addMessage('alice', c.id, 'u1', 'миграция свежая', '12:01')
    migrated.chat.ensureMessagesIndexed()

    const res = migrated.chat.searchMessages('alice', { q: 'миграция ', limit: 50 })
    expect(res.hits).toHaveLength(7)
    expect(new Set(res.hits.map((h) => h.messageId)).size).toBe(7)
    migrated.close()
  })
})
