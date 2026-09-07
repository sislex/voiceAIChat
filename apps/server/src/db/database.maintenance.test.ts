// Методы обслуживания БД, которых не касался ни один тест.
//
// Найдены не чтением кода, а счётчиком вызовов в отчёте покрытия: из 609 функций
// `database.ts` 45 не вызывались ни разу. Здесь закрыты те из них, у которых
// есть настоящая логика и заметная цена ошибки — отложенная уборка managed-
// разговоров, журнал тревог машины, привязка workspace и смена роли.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb
let clock: number

beforeEach(async () => {
  let id = 0
  clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  await db.identity.createUser('alice', '', 'developer')
  await db.identity.createUser('bob', '', 'developer')
})
afterEach(() => db.close())

const SHA = 'a'.repeat(40)

/** Managed-разговор: без привязки к хранилищу он в цели уборки не попадает. */
async function managedConversation(user = 'alice') {
  const agent = await db.machines.createAgent(user, 'machine-' + user)
  const storage = await db.machines.saveMachineStorage(user, agent.id, '/storage', 1)
  const conversation = await db.chat.createConversation(user, 'Разговор')
  await db.machines.saveChatStorageBinding(user, {
    conversationId: conversation.id, machineId: agent.id, storageId: storage.id, relativePath: 'chat/1'
  })
  return conversation
}

describe('отложенная уборка generated: цели прохода', () => {
  it('managed-разговор без прошлых сбоев — цель прохода', async () => {
    const conversation = await managedConversation()
    expect(await db.machines.listGeneratedCleanupTargets()).toEqual([{ userId: 'alice', conversationId: conversation.id }])
  })

  it('разговор без привязки к хранилищу целью не является', async () => {
    await db.chat.createConversation('alice', 'Обычный')
    expect(await db.machines.listGeneratedCleanupTargets()).toEqual([])
  })

  it('отложенная цель не берётся, пока не наступил срок', async () => {
    const conversation = await managedConversation()
    await db.machines.deferGeneratedCleanup('alice', conversation.id, 'машина недоступна', 10_000)
    expect(await db.machines.listGeneratedCleanupTargets(9_999)).toEqual([])
    expect(await db.machines.listGeneratedCleanupTargets(10_000)).toEqual([{ userId: 'alice', conversationId: conversation.id }])
  })

  it('набор целей идемпотентен: повторный вызов даёт то же самое', async () => {
    await managedConversation(); await managedConversation('bob')
    const first = await db.machines.listGeneratedCleanupTargets()
    expect(await db.machines.listGeneratedCleanupTargets()).toEqual(first)
    expect(first).toHaveLength(2)
  })
})

describe('отложенная уборка generated: счётчик попыток', () => {
  it('первый сбой заводит запись с одной попыткой', async () => {
    const conversation = await managedConversation()
    await db.machines.deferGeneratedCleanup('alice', conversation.id, 'ошибка', 5_000)
    expect(await db.machines.getGeneratedCleanupRetry(conversation.id)).toMatchObject({ attempts: 1, lastError: 'ошибка', nextAttemptAt: 5_000 })
  })

  it('повторный сбой наращивает счётчик, а не заводит вторую запись', async () => {
    // Иначе экспоненциальная отсрочка никогда бы не росла.
    const conversation = await managedConversation()
    await db.machines.deferGeneratedCleanup('alice', conversation.id, 'раз', 5_000)
    await db.machines.deferGeneratedCleanup('alice', conversation.id, 'два', 20_000)
    expect(await db.machines.getGeneratedCleanupRetry(conversation.id)).toMatchObject({ attempts: 2, lastError: 'два', nextAttemptAt: 20_000 })
  })

  it('длинная ошибка обрезается до 500 символов — журнал не раздувается', async () => {
    const conversation = await managedConversation()
    await db.machines.deferGeneratedCleanup('alice', conversation.id, 'я'.repeat(2_000), 1)
    expect((await db.machines.getGeneratedCleanupRetry(conversation.id))!.lastError).toHaveLength(500)
  })

  it('успешная уборка снимает отсрочку', async () => {
    const conversation = await managedConversation()
    await db.machines.deferGeneratedCleanup('alice', conversation.id, 'ошибка', 50_000)
    await db.machines.completeGeneratedCleanup(conversation.id)
    expect(await db.machines.getGeneratedCleanupRetry(conversation.id)).toBeNull()
    expect(await db.machines.listGeneratedCleanupTargets(0)).toHaveLength(1)
  })

  it('у разговора без сбоев записи об отсрочке нет', async () => {
    const conversation = await managedConversation()
    expect(await db.machines.getGeneratedCleanupRetry(conversation.id)).toBeNull()
  })
})

describe('журнал тревог машины', () => {
  it('события отдаются свежими вперёд', async () => {
    await db.machines.logMachineEvent({ machineId: 'm1', userId: 'alice', state: 'offline', at: 100, offlineForMs: 0 })
    await db.machines.logMachineEvent({ machineId: 'm1', userId: 'alice', state: 'online', at: 200, offlineForMs: 100 })
    expect((await db.machines.listMachineEvents('m1')).map((e) => e.state)).toEqual(['online', 'offline'])
  })

  it('журнал одной машины не смешивается с чужим', async () => {
    await db.machines.logMachineEvent({ machineId: 'm1', userId: 'alice', state: 'offline', at: 100, offlineForMs: 0 })
    await db.machines.logMachineEvent({ machineId: 'm2', userId: 'bob', state: 'offline', at: 100, offlineForMs: 0 })
    expect(await db.machines.listMachineEvents('m1')).toHaveLength(1)
    expect((await db.machines.listMachineEvents('m1'))[0].machineId).toBe('m1')
  })

  it('поля события сохраняются целиком', async () => {
    await db.machines.logMachineEvent({ machineId: 'm1', userId: 'alice', state: 'online', at: 1234, offlineForMs: 56_000 })
    expect((await db.machines.listMachineEvents('m1'))[0]).toMatchObject({ machineId: 'm1', userId: 'alice', state: 'online', at: 1234, offlineForMs: 56_000 })
  })

  it('лимит ограничен снизу единицей и сверху пятьюстами', async () => {
    for (let i = 0; i < 12; i++) await db.machines.logMachineEvent({ machineId: 'm1', userId: 'alice', state: 'offline', at: i, offlineForMs: 0 })
    expect(await db.machines.listMachineEvents('m1', 5)).toHaveLength(5)
    // Ноль и отрицательное не должны означать «отдать пусто» — минимум одна запись.
    expect(await db.machines.listMachineEvents('m1', 0)).toHaveLength(1)
    expect(await db.machines.listMachineEvents('m1', -10)).toHaveLength(1)
    expect(await db.machines.listMachineEvents('m1', 100_000)).toHaveLength(12)
  })

  it('у машины без событий журнал пуст', async () => {
    expect(await db.machines.listMachineEvents('нет-такой')).toEqual([])
  })
})

describe('workspace разговора', () => {
  // Привязка держится внешними ключами на разговор, проект, машину и хранилище —
  // все четыре заводятся по-настоящему, иначе SQLite отвергает вставку.
  let ids: { conversationId: string; projectId: string; machineId: string; storageId: string }

  beforeEach(async () => {
    const agent = await db.machines.createAgent('alice', 'machine')
    const storage = await db.machines.saveMachineStorage('alice', agent.id, '/storage', 1)
    const project = await db.projects.createProject('alice', { name: 'Проект' })
    const conversation = await db.chat.createConversation('alice', 'Разговор')
    ids = { conversationId: conversation.id, projectId: project.id, machineId: agent.id, storageId: storage.id }
  })

  const binding = (over: Partial<Parameters<VoiceChatDb['chat']['saveConversationWorkspace']>[0]> = {}) => ({
    ...ids,
    mode: 'chat_workspace' as const, baseSha: SHA, branch: 'work', repositoryPath: '/repo',
    state: 'ready' as const, ...over
  })

  it('сохраняет привязку и отдаёт её обратно как WorkspaceView', async () => {
    // Наружу отдаётся именно view: машина и хранилище остаются внутри БД,
    // клиенту нужны режим, ветка, путь и состояние.
    const saved = await db.chat.saveConversationWorkspace(binding())
    expect(saved).toEqual({
      mode: 'chat_workspace', baseSha: SHA, branch: 'work', path: '/repo',
      readOnly: false, state: 'ready', diagnostic: null
    })
    expect(await db.chat.getConversationWorkspace(ids.conversationId)).toEqual(saved)
  })

  it('повторное сохранение обновляет запись на месте, а не плодит вторую', async () => {
    await db.chat.saveConversationWorkspace(binding())
    const updated = await db.chat.saveConversationWorkspace(binding({ branch: 'other', state: 'blocked', diagnostic: 'сломалось' }))
    expect(updated).toMatchObject({ branch: 'other', state: 'blocked', diagnostic: 'сломалось' })
  })

  it('некорректный baseSha отвергается — иначе привязка указывала бы в никуда', async () => {
    await expect(async () => await db.chat.saveConversationWorkspace(binding({ baseSha: 'коротко' }))).rejects.toThrow(/baseSha/)
    await expect(async () => await db.chat.saveConversationWorkspace(binding({ baseSha: 'z'.repeat(40) }))).rejects.toThrow(/baseSha/)
    expect(await db.chat.getConversationWorkspace(ids.conversationId)).toBeNull()
  })

  it('sha в верхнем регистре принимается', async () => {
    await (async () => await db.chat.saveConversationWorkspace(binding({ baseSha: SHA.toUpperCase() })))()
  })

  it('очистка сообщает, была ли запись', async () => {
    await db.chat.saveConversationWorkspace(binding())
    expect(await db.chat.clearConversationWorkspace(ids.conversationId)).toBe(true)
    expect(await db.chat.clearConversationWorkspace(ids.conversationId)).toBe(false)
    expect(await db.chat.getConversationWorkspace(ids.conversationId)).toBeNull()
  })
})

describe('смена роли и чистка токенов', () => {
  it('setUserRole меняет роль и возвращает обновлённого пользователя', async () => {
    expect(await db.identity.setUserRole('alice', 'admin')).toMatchObject({ name: 'alice', role: 'admin' })
    expect((await db.identity.getUser('alice'))!.role).toBe('admin')
  })

  it('setUserRole для несуществующего пользователя возвращает null и никого не создаёт', async () => {
    expect(await db.identity.setUserRole('нет-такого', 'admin')).toBeNull()
    expect(await db.identity.getUser('нет-такого')).toBeNull()
  })

  it('pruneEmailVerifications удаляет только истёкшие и сообщает их число', async () => {
    await db.identity.createEmailVerification({ token: 'токен-свежий', name: 'carol', email: 'fresh@example.com', password: 'p', ttlMs: 60_000 })
    await db.identity.createEmailVerification({ token: 'токен-старый', name: 'dave', email: 'stale@example.com', password: 'p', ttlMs: -1 })
    expect(await db.identity.pruneEmailVerifications()).toBe(1)
    // Повторный проход удалять больше нечего.
    expect(await db.identity.pruneEmailVerifications()).toBe(0)
  })
})
