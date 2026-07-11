import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from '../db/database'
import { createHandlers, type Handlers } from './handlers'
import { IPC_CHANNELS } from '@shared/ipc'
import { DEFAULT_SETTINGS } from '@shared/types'

function makeDb(): VoiceChatDb {
  let id = 0
  let clock = 1000
  return new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
}

describe('ipc handlers', () => {
  let db: VoiceChatDb
  let h: Handlers
  beforeEach(() => {
    db = makeDb()
    h = createHandlers(db)
  })
  afterEach(() => db.close())

  it('реализует ровно все каналы контракта', () => {
    expect(Object.keys(h).sort()).toEqual([...IPC_CHANNELS].sort())
  })

  it('app:ping → pong', async () => {
    expect(await h['app:ping']()).toBe('pong')
  })

  it('create → list → get проходят через БД', async () => {
    const created = await h['conversations:create']({ title: 'Тест' })
    expect(created.title).toBe('Тест')

    const list = await h['conversations:list']()
    expect(list.map((c) => c.id)).toContain(created.id)

    const got = await h['conversations:get']({ id: created.id })
    expect(got?.conversation.title).toBe('Тест')
    expect(got?.messages).toEqual([])
  })

  it('conversations:get возвращает null для несуществующего', async () => {
    expect(await h['conversations:get']({ id: 'нет' })).toBeNull()
  })

  it('messages:add кладёт сообщение и оно видно в get', async () => {
    const c = await h['conversations:create']({})
    const m = await h['messages:add']({
      conversationId: c.id,
      role: 'u1',
      text: 'Привет',
      time: '10:00'
    })
    expect(m.text).toBe('Привет')
    const got = await h['conversations:get']({ id: c.id })
    expect(got?.messages).toHaveLength(1)
  })

  it('rename и delete работают', async () => {
    const c = await h['conversations:create']({ title: 'Старое' })
    await h['conversations:rename']({ id: c.id, title: 'Новое' })
    expect((await h['conversations:get']({ id: c.id }))?.conversation.title).toBe('Новое')
    await h['conversations:delete']({ id: c.id })
    expect(await h['conversations:get']({ id: c.id })).toBeNull()
  })

  it('settings:get/save проходят и сериализуемы', async () => {
    expect(await h['settings:get']()).toEqual(DEFAULT_SETTINGS)
    const next = { ...DEFAULT_SETTINGS, model: 'opus' as const, diarization: false }
    await h['settings:save'](next)
    expect(await h['settings:get']()).toEqual(next)
  })

  it('stt:status по умолчанию сообщает о наличии модели', async () => {
    expect(await h['stt:status']()).toEqual({ present: true, model: DEFAULT_SETTINGS.whisperModel })
  })

  it('stt:status использует инжектированный статус', async () => {
    const custom = createHandlers(db, { sttStatus: () => ({ present: false, model: 'small' }) })
    expect(await custom['stt:status']()).toEqual({ present: false, model: 'small' })
  })

  it('tts:voices по умолчанию пуст; отдаёт инжектированные голоса', async () => {
    expect(await h['tts:voices']()).toEqual([])
    const custom = createHandlers(db, {
      listTtsVoices: async () => [{ id: 'ru_RU-irina-medium', label: 'Irina' }]
    })
    expect(await custom['tts:voices']()).toEqual([{ id: 'ru_RU-irina-medium', label: 'Irina' }])
  })

  it('tts:catalog по умолчанию недоступен; отдаёт инжектированный каталог', async () => {
    expect(await h['tts:catalog']()).toEqual({ downloadable: false, voices: [] })
    const custom = createHandlers(db, {
      ttsCatalog: () => ({
        downloadable: true,
        voices: [{ id: 'ru_RU-irina-medium', label: 'Irina', installed: true }]
      })
    })
    expect((await custom['tts:catalog']()).downloadable).toBe(true)
  })

  it('результаты сериализуемы через structured clone (пригодны для IPC)', async () => {
    const c = await h['conversations:create']({ title: 'JSON' })
    await h['messages:add']({ conversationId: c.id, role: 'ai', text: 'ответ', time: '10:00' })
    const got = await h['conversations:get']({ id: c.id })
    expect(() => structuredClone(got)).not.toThrow()
    expect(JSON.parse(JSON.stringify(got)).conversation.title).toBe('JSON')
  })
})
