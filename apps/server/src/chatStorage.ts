// Управляемое хранилище разговора на машине: привязка чата к каталогу ChatAI выбранной машины и
// разрешение путей (`attachments`, `generated`, `artifacts`). Знание о хранилищах чата — общее для ядра
// (вложения, ретушь, публикация, очистка сгенерированного) и модуля машин (полный лог долгой команды
// из чата кладётся в `artifacts/commands`), поэтому живёт отдельно от `server.ts` и работает поверх
// порта `MachinesService` — одинаково во встроенном и отдельном процессе машин.
import type { ChatStorageBinding } from '@voicechat/shared'
import { ensureDefaultChatBinding } from './agents/defaultStorage.js'
import type { VoiceChatDb } from './db/database.js'
import type { MachinesService } from './machines/service.js'
import { resolveManagedChatStorage, type ResolvedManagedChatStorage } from './uploads.js'

export interface ManagedChatStorageDeps {
  db: VoiceChatDb
  machines: Pick<MachinesService, 'isOnline' | 'waitForOnline' | 'fsRead' | 'fsWrite' | 'fsMkdir' | 'platformOf' | 'telemetryOf' | 'policyOf'>
  log: (message: string, extra?: Record<string, unknown>) => void
}

export interface ManagedChatStorage {
  /** Привязать чат к каталогу ChatAI машины (создаётся при необходимости). */
  ensureChatStorage(userId: string, conversationId: string, machineId: string): Promise<ChatStorageBinding | null>
  /** Пути хранилища разговора; чат без привязки сначала привязывается к машине разговора, если она в сети. */
  managedChatStorage(userId: string, conversationId: string): Promise<ResolvedManagedChatStorage | null>
}

export function createManagedChatStorage(deps: ManagedChatStorageDeps): ManagedChatStorage {
  const { db, machines } = deps
  const defaultStorageDeps = { db, registry: machines, log: deps.log }
  const ensureChatStorage = async (userId: string, conversationId: string, machineId: string): Promise<ChatStorageBinding | null> =>
    await ensureDefaultChatBinding(defaultStorageDeps, userId, conversationId, machineId)
  const managedChatStorage = async (userId: string, conversationId: string): Promise<ResolvedManagedChatStorage | null> => {
    if (!await db.machines.getChatStorageBinding(userId, conversationId)) {
      const machine = await db.chat.resolveConversationMachine(userId, conversationId, { isOnline: (id) => machines.isOnline(id) })
      if (machine?.agentId && machine.source !== 'disabled') await ensureChatStorage(userId, conversationId, machine.agentId)
    }
    return resolveManagedChatStorage(userId, conversationId, {
      getBinding: async (uid, id) => await db.machines.getChatStorageBinding(uid, id),
      listStorages: async (uid, machineId) => await db.machines.listMachineStorages(uid, machineId),
      ownsMachine: async (uid, machineId) => (await db.machines.listAgents(uid)).some((agent) => agent.id === machineId),
      isOnline: (machineId) => machines.isOnline(machineId),
      waitOnline: (machineId) => machines.waitForOnline(machineId),
      verifyRoot: async (machineId, rootPath) => {
        const separator = rootPath.includes('\\') && !rootPath.includes('/') ? '\\' : '/'
        const marker = await machines.fsRead(machineId, `${rootPath.replace(/[/\\]$/, '')}${separator}.voicechat${separator}storage.json`)
        const parsed = JSON.parse(Buffer.from(marker.dataBase64 ?? '', 'base64').toString('utf8')) as { id?: string }
        const binding = await db.machines.getChatStorageBinding(userId, conversationId)
        if (!binding || parsed.id !== binding.storageId) throw new Error('Marker привязанного хранилища отсутствует или конфликтует')
      }
    })
  }
  return { ensureChatStorage, managedChatStorage }
}
