import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from './database'
import { DEFAULT_SETTINGS } from '@voicechat/shared'

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
    const c = db.createConversation('Поездка в Лиссабон')
    expect(c.id).toBe('id-1')
    expect(c.title).toBe('Поездка в Лиссабон')
    expect(c.messageCount).toBe(0)
    expect(c.claudeSessionId).toBeNull()

    const fetched = db.getConversation(c.id)
    expect(fetched).not.toBeNull()
    expect(fetched?.title).toBe('Поездка в Лиссабон')
  })

  it('список отсортирован по updated_at убыванию', () => {
    const a = db.createConversation('A')
    const b = db.createConversation('B')
    // Обновляем A позже → он должен всплыть наверх.
    db.addMessage(a.id, 'u1', 'привет', '10:00')
    const list = db.listConversations()
    expect(list.map((c) => c.id)).toEqual([a.id, b.id])
  })

  it('переименование меняет заголовок', () => {
    const c = db.createConversation('Старое')
    db.renameConversation(c.id, 'Новое')
    expect(db.getConversation(c.id)?.title).toBe('Новое')
  })

  it('getConversation возвращает null для несуществующего', () => {
    expect(db.getConversation('нет-такого')).toBeNull()
  })
})

describe('VoiceChatDb — сообщения', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
  })
  afterEach(() => db.close())

  it('добавляет сообщения и считает их в messageCount', () => {
    const c = db.createConversation('Чат')
    db.addMessage(c.id, 'u1', 'Привет', '14:02')
    db.addMessage(c.id, 'ai', 'Здравствуйте!', '14:02')

    const msgs = db.listMessages(c.id)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].text).toBe('Привет')
    expect(msgs[0].role).toBe('u1')
    expect(msgs[1].role).toBe('ai')

    expect(db.getConversation(c.id)?.messageCount).toBe(2)
  })

  it('сообщения возвращаются в хронологическом порядке', () => {
    const c = db.createConversation('Чат')
    db.addMessage(c.id, 'u1', 'первое', '14:00')
    db.addMessage(c.id, 'u2', 'второе', '14:01')
    db.addMessage(c.id, 'ai', 'третье', '14:02')
    expect(db.listMessages(c.id).map((m) => m.text)).toEqual(['первое', 'второе', 'третье'])
  })

  it('добавление сообщения обновляет updated_at разговора', () => {
    const c = db.createConversation('Чат')
    const before = db.getConversation(c.id)!.updatedAt
    db.addMessage(c.id, 'u1', 'x', '14:00')
    const after = db.getConversation(c.id)!.updatedAt
    expect(after).toBeGreaterThan(before)
  })
})

describe('VoiceChatDb — каскадное удаление', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
  })
  afterEach(() => db.close())

  it('удаление разговора удаляет его сообщения', () => {
    const c = db.createConversation('Чат')
    db.addMessage(c.id, 'u1', 'x', '14:00')
    db.addMessage(c.id, 'ai', 'y', '14:00')
    db.deleteConversation(c.id)
    expect(db.getConversation(c.id)).toBeNull()
    expect(db.listMessages(c.id)).toHaveLength(0)
    expect(db.listConversations()).toHaveLength(0)
  })
})

describe('VoiceChatDb — session-id Claude', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
  })
  afterEach(() => db.close())

  it('сохраняет и обнуляет session-id', () => {
    const c = db.createConversation('Чат')
    db.setClaudeSession(c.id, 'sess-abc')
    expect(db.getConversation(c.id)?.claudeSessionId).toBe('sess-abc')
    db.setClaudeSession(c.id, null)
    expect(db.getConversation(c.id)?.claudeSessionId).toBeNull()
  })
})

describe('VoiceChatDb — настройки', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
  })
  afterEach(() => db.close())

  it('без сохранённых настроек возвращает дефолты', () => {
    expect(db.getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('сохраняет и читает настройки', () => {
    db.saveSettings({
      model: 'opus-4.5',
      whisperModel: 'medium',
      diarization: false,
      voice: 'dmitri',
      micDeviceId: 'mic-123',
      autoSpeak: true
    })
    expect(db.getSettings()).toEqual({
      model: 'opus-4.5',
      whisperModel: 'medium',
      diarization: false,
      voice: 'dmitri',
      micDeviceId: 'mic-123',
      autoSpeak: true
    })
  })

  it('мержит с дефолтами при частичном/битом конфиге', () => {
    db.saveSettings({ ...DEFAULT_SETTINGS, model: 'opus-4.5' })
    const s = db.getSettings()
    expect(s.model).toBe('opus-4.5')
    expect(s.voice).toBe(DEFAULT_SETTINGS.voice)
  })
})
