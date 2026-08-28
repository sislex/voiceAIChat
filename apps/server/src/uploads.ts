// Реестр загруженных вложений. Файлы сохраняются на диск сервера; клиент шлёт
// байты (base64) по REST, получает id, затем передаёт id в claude.send. Сессия
// резолвит id → абсолютный путь и подкладывает его в промпт (Claude Code читает
// файл своими инструментами, изображения — визуально).

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { managedChatArtifactsPath, managedChatAttachmentsPath, managedChatTemporaryPath, validateStorageRelativePath, type ChatStorageBinding, type MachineStorage } from '@voicechat/shared'

export interface ManagedChatStorageDeps {
  getBinding(userId: string, conversationId: string): ChatStorageBinding | null
  listStorages(userId: string, machineId: string): MachineStorage[]
  ownsMachine(userId: string, machineId: string): boolean
  isOnline(machineId: string): boolean
  /** Подождать возврата офлайн-машины (registry.waitForOnline); нет — отказ сразу. */
  waitOnline?(machineId: string): Promise<boolean>
  verifyRoot(machineId: string, rootPath: string): Promise<unknown>
}

export interface ResolvedManagedChatStorage {
  binding: ChatStorageBinding
  storage: MachineStorage
  chatRoot: string
  attachments: string
  generated: string
  artifacts: string
}

export function machineStoragePath(root: string, relativePath: string): string {
  const normalizedRoot = root.trim().replace(/[/\\]+$/, '')
  if (!normalizedRoot) throw new Error('Корень MachineStorage не задан')
  if (/^(?:[\\/]|[A-Za-z]:[\\/])/.test(relativePath)) throw new Error('Путь MachineStorage должен быть относительным')
  const relative = relativePath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!relative || relative.split('/').some((part) => !/^[A-Za-z0-9._-]+$/.test(part) || part === '.' || part === '..')) throw new Error('Небезопасный путь внутри MachineStorage')
  const separator = normalizedRoot.includes('\\') && !normalizedRoot.includes('/') ? '\\' : '/'
  return `${normalizedRoot}${separator}${relative.replace(/[/\\]/g, separator)}`
}

export async function resolveManagedChatStorage(userId: string, conversationId: string, deps: ManagedChatStorageDeps): Promise<ResolvedManagedChatStorage | null> {
  const binding = deps.getBinding(userId, conversationId)
  if (!binding) return null
  if (!deps.ownsMachine(userId, binding.machineId)) throw new Error('Машина хранилища больше не принадлежит пользователю')
  if (!deps.isOnline(binding.machineId) && !(await deps.waitOnline?.(binding.machineId))) throw new Error('Машина хранилища не в сети')
  const storage = deps.listStorages(userId, binding.machineId).find((item) => item.id === binding.storageId)
  if (!storage) throw new Error('Привязанное хранилище больше недоступно')
  await deps.verifyRoot(binding.machineId, storage.rootPath)
  const relativePath = validateStorageRelativePath(binding.relativePath)
  return {
    binding: { ...binding, relativePath },
    storage,
    chatRoot: machineStoragePath(storage.rootPath, relativePath),
    attachments: machineStoragePath(storage.rootPath, managedChatAttachmentsPath(relativePath)),
    generated: machineStoragePath(storage.rootPath, managedChatTemporaryPath(relativePath)),
    artifacts: machineStoragePath(storage.rootPath, managedChatArtifactsPath(relativePath))
  }
}

export const MACHINE_UPLOAD_DIR = '.voicechat_uploads'

export interface StoredUpload {
  id: string
  name: string
  path: string
  mimeType: string
  size: number
  /** Машина, на которой постоянно хранится файл; undefined — старый серверный режим. */
  agentId?: string
}

export function machineUploadDir(root: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return `${root.replace(/[/\\]$/, '')}${sep}${MACHINE_UPLOAD_DIR}`
}

/** Путь постоянного исходника внутри корня проводника пользовательской машины. */
export function machineManagedFilePath(directory: string, id: string, name: string): string {
  const sep = directory.includes('\\') && !directory.includes('/') ? '\\' : '/'
  const ext = extname(basename(name)).replace(/[^.a-zA-Z0-9]/g, '')
  return `${directory.replace(/[/\\]$/, '')}${sep}${id}${ext}`
}

export function machineUploadPath(root: string, id: string, name: string): string {
  return machineManagedFilePath(machineUploadDir(root), id, name)
}

export class UploadStore {
  private readonly byId = new Map<string, StoredUpload>()

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  /** Сохраняет файл, возвращает метаданные (id — для передачи в claude.send). */
  save(name: string, data: Buffer, mimeType = 'application/octet-stream'): StoredUpload {
    const id = randomUUID()
    // Санитизируем имя, сохраняем расширение (важно для распознавания изображений).
    const safeBase = basename(name).replace(/[^\w.\- ]+/g, '_') || 'file'
    const ext = extname(safeBase)
    const path = join(this.dir, ext ? `${id}${ext}` : `${id}-${safeBase}`)
    writeFileSync(path, data)
    const rec: StoredUpload = { id, name: basename(name) || safeBase, path, mimeType, size: data.byteLength }
    this.byId.set(id, rec)
    return rec
  }

  /** Регистрирует уже записанный на пользовательскую машину файл. */
  saveRemote(name: string, path: string, agentId: string, size: number, mimeType = 'application/octet-stream'): StoredUpload {
    const id = randomUUID()
    const safeName = basename(name) || 'file'
    const rec: StoredUpload = { id, name: safeName, path, agentId, size, mimeType }
    this.byId.set(id, rec)
    return rec
  }

  get(id: string): StoredUpload | undefined {
    return this.byId.get(id)
  }

  /** Абсолютный путь по id (или undefined, если id неизвестен). */
  pathById(id: string): string | undefined {
    return this.byId.get(id)?.path
  }

  /** Удаляет файл и запись (напр. при чистке). */
  remove(id: string): void {
    const rec = this.byId.get(id)
    if (!rec) return
    if (!rec.agentId) rmSync(rec.path, { force: true })
    this.byId.delete(id)
  }
}
