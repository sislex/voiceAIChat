// Реестр загруженных вложений. Файлы сохраняются на диск сервера; клиент шлёт
// байты (base64) по REST, получает id, затем передаёт id в claude.send. Сессия
// резолвит id → абсолютный путь и подкладывает его в промпт (Claude Code читает
// файл своими инструментами, изображения — визуально).

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'

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
export function machineUploadPath(root: string, id: string, name: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  const ext = extname(basename(name)).replace(/[^.a-zA-Z0-9]/g, '')
  return `${machineUploadDir(root)}${sep}${id}${ext}`
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
