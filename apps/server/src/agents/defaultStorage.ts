// Каталог ChatAI по умолчанию на машине. При подключении агента (первая телеметрия с homePath) у владельца
// без хранилищ на этой машине создаётся MachineStorage `<home>/ChatAI`; чат без привязки перед первой записью
// файла получает привязку к первому хранилищу машины (рекомендуемый относительный путь). Так любые файлы —
// картинки, вложения, артефакты — ложатся внутрь ChatAI, а не в корень проводника машины.
import { randomUUID } from 'node:crypto'
import {
  MACHINE_STORAGE_FORMAT_VERSION, isMachineStoragePathAllowed, managedChatArtifactsPath, managedChatAttachmentsPath,
  managedChatTemporaryPath, normalizeMachineStoragePath, recommendedChatStoragePath, validateStorageRelativePath,
  type AgentPolicy, type ChatStorageBinding, type MachineStorage
} from '@voicechat/shared'

export const DEFAULT_MACHINE_DIR = 'ChatAI'

export interface DefaultStorageDeps {
  db: {
    agentOwnerId(agentId: string): string | null
    listMachineStorages(userId: string, machineId?: string): MachineStorage[]
    saveMachineStorage(userId: string, machineId: string, rootPath: string, formatVersion: number, preferredId?: string): MachineStorage
    getChatStorageBinding(userId: string, conversationId: string): ChatStorageBinding | null
    saveChatStorageBinding(userId: string, binding: ChatStorageBinding): ChatStorageBinding
    getConversation(userId: string, id: string): { id: string; projectId?: string | null; taskId?: string | null } | null
  }
  registry: {
    isOnline(id: string): boolean
    platformOf(id: string): string | undefined
    telemetryOf(id: string): { os: { homePath?: string } } | undefined
    policyOf(id: string): AgentPolicy | undefined
    fsMkdir(id: string, path: string): Promise<unknown>
    fsRead(id: string, path: string): Promise<{ dataBase64?: string }>
    fsWrite(id: string, path: string, dataBase64: string): Promise<unknown>
  }
  log?: (msg: string, extra?: Record<string, unknown>) => void
}

const sep = (platform: string): string => (platform === 'win32' ? '\\' : '/')
const joinPath = (root: string, platform: string, name: string): string => root.replace(/[/\\]$/, '') + sep(platform) + name.replace(/[\\/]/g, sep(platform))

/** `<home>/ChatAI` в нормализованном виде для платформы машины; null — телеметрия ещё без homePath. */
export function defaultStorageRoot(homePath: string | undefined, platform: string): string | null {
  if (!homePath) return null
  try { return normalizeMachineStoragePath(joinPath(homePath, platform, DEFAULT_MACHINE_DIR), platform) } catch { return null }
}

async function readMarker(deps: DefaultStorageDeps, machineId: string, rootPath: string, platform: string): Promise<string | null> {
  try {
    const r = await deps.registry.fsRead(machineId, joinPath(rootPath, platform, '.voicechat/storage.json'))
    const marker = JSON.parse(Buffer.from(r.dataBase64 ?? '', 'base64').toString('utf8')) as { id?: unknown }
    return typeof marker.id === 'string' ? marker.id : null
  } catch { return null }
}

/**
 * Хранилище машины по умолчанию: существующее первое либо созданное `<home>/ChatAI`. null — машина офлайн,
 * телеметрии нет или путь вне allowedDirs политики (тогда пользователь заводит хранилище руками).
 */
export async function ensureDefaultStorage(deps: DefaultStorageDeps, userId: string, machineId: string): Promise<MachineStorage | null> {
  const existing = deps.db.listMachineStorages(userId, machineId)
  if (existing.length > 0) return existing[0]!
  if (!deps.registry.isOnline(machineId)) return null
  const platform = deps.registry.platformOf(machineId) ?? 'linux'
  const rootPath = defaultStorageRoot(deps.registry.telemetryOf(machineId)?.os.homePath, platform)
  if (!rootPath) return null
  const policy = deps.registry.policyOf(machineId)
  if (policy && !isMachineStoragePathAllowed(rootPath, policy.allowedDirs, platform)) return null
  try {
    for (const dir of [rootPath, '.voicechat', '.voicechat/index', '.voicechat/locks', '.voicechat/migrations', '.voicechat/temporary'].map((d, i) => (i === 0 ? d : joinPath(rootPath, platform, d)))) {
      await deps.registry.fsMkdir(machineId, dir)
    }
    const found = await readMarker(deps, machineId, rootPath, platform)
    const storageId = found ?? randomUUID()
    if (!found) {
      const marker = JSON.stringify({ id: storageId, formatVersion: MACHINE_STORAGE_FORMAT_VERSION }, null, 2) + '\n'
      await deps.registry.fsWrite(machineId, joinPath(rootPath, platform, '.voicechat/storage.json'), Buffer.from(marker).toString('base64'))
    }
    const storage = deps.db.saveMachineStorage(userId, machineId, rootPath, MACHINE_STORAGE_FORMAT_VERSION, storageId)
    deps.log?.('machine: создано хранилище ChatAI по умолчанию', { machineId, rootPath })
    return storage
  } catch (error) {
    deps.log?.('machine: не удалось создать хранилище ChatAI по умолчанию', { machineId, rootPath, error: error instanceof Error ? error.message : String(error) })
    return null
  }
}

/** Привязка чата к хранилищу машины по умолчанию (если её нет): каталоги чата создаются сразу. */
export async function ensureDefaultChatBinding(deps: DefaultStorageDeps, userId: string, conversationId: string, machineId: string): Promise<ChatStorageBinding | null> {
  const current = deps.db.getChatStorageBinding(userId, conversationId)
  if (current) return current
  const conversation = deps.db.getConversation(userId, conversationId)
  if (!conversation) return null
  const storage = await ensureDefaultStorage(deps, userId, machineId)
  if (!storage) return null
  const platform = deps.registry.platformOf(machineId) ?? 'linux'
  const relativePath = validateStorageRelativePath(conversation.taskId && conversation.projectId
    ? recommendedChatStoragePath({ kind: 'task', projectId: conversation.projectId, taskId: conversation.taskId, conversationId: conversation.id })
    : conversation.projectId
      ? recommendedChatStoragePath({ kind: 'project', projectId: conversation.projectId, conversationId: conversation.id })
      : recommendedChatStoragePath({ kind: 'chat', conversationId: conversation.id }))
  try {
    for (const d of [relativePath, managedChatAttachmentsPath(relativePath), managedChatArtifactsPath(relativePath), managedChatTemporaryPath(relativePath)]) {
      await deps.registry.fsMkdir(machineId, joinPath(storage.rootPath, platform, d))
    }
    return deps.db.saveChatStorageBinding(userId, { conversationId: conversation.id, machineId, storageId: storage.id, relativePath })
  } catch (error) {
    deps.log?.('machine: не удалось привязать чат к хранилищу по умолчанию', { machineId, conversationId, error: error instanceof Error ? error.message : String(error) })
    return null
  }
}
