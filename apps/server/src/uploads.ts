// Реестр загруженных вложений. Файлы сохраняются на диск сервера; клиент шлёт
// байты (base64) по REST, получает id, затем передаёт id в claude.send. Сессия
// резолвит id → абсолютный путь и подкладывает его в промпт (Claude Code читает
// файл своими инструментами, изображения — визуально).

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface StoredUpload {
  id: string
  name: string
  path: string
}

export class UploadStore {
  private readonly byId = new Map<string, StoredUpload>()

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  /** Сохраняет файл, возвращает метаданные (id — для передачи в claude.send). */
  save(name: string, data: Buffer): StoredUpload {
    const id = randomUUID()
    // Санитизируем имя, сохраняем расширение (важно для распознавания изображений).
    const safeBase = basename(name).replace(/[^\w.\- ]+/g, '_') || 'file'
    const ext = extname(safeBase)
    const path = join(this.dir, ext ? `${id}${ext}` : `${id}-${safeBase}`)
    writeFileSync(path, data)
    const rec: StoredUpload = { id, name: basename(name) || safeBase, path }
    this.byId.set(id, rec)
    return rec
  }

  /** Абсолютный путь по id (или undefined, если id неизвестен). */
  pathById(id: string): string | undefined {
    return this.byId.get(id)?.path
  }

  /** Удаляет файл и запись (напр. при чистке). */
  remove(id: string): void {
    const rec = this.byId.get(id)
    if (!rec) return
    rmSync(rec.path, { force: true })
    this.byId.delete(id)
  }
}
