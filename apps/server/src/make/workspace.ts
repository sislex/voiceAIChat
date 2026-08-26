// Рабочие папки проектов Make: `<dataDir>/make/<conversationId>/` — статические
// файлы проекта плюс служебный `.snapshots/` с ревизиями. Единственная точка
// доступа к диску для REST-маршрутов и MCP-инструментов ассистента: здесь же
// валидация путей (никаких `..`, скрытых сегментов, символических ссылок наружу)
// и лимиты. Номер изменения `rev` живёт в памяти процесса: он нужен только чтобы
// открытые панели перезагрузили превью, а не как долговечная версия.

import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import {
  MAKE_LIMITS, MAKE_SCAFFOLD, isMakeTextPath, normalizeMakePath,
  type MakeFileContent, type MakeFileInfo, type MakeProjectState, type MakeSnapshot
} from '@voicechat/shared'
import { buildStoredZip } from './zip.js'

export type MakeErrorCode = 'invalid_id' | 'invalid_path' | 'not_found' | 'too_large' | 'too_many_files' | 'not_text' | 'exists'

export class MakeError extends Error {
  constructor(readonly code: MakeErrorCode, message: string) {
    super(message)
    this.name = 'MakeError'
  }
}

const SNAPSHOTS_DIR = '.snapshots'
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/

interface SnapshotMeta { id: string; createdAt: number; label: string; files: number }

export class MakeWorkspaces {
  private readonly revs = new Map<string, number>()

  constructor(private readonly rootDir: string) {}

  /** Корень проекта разговора; id проверяется, чтобы имя каталога нельзя было подделать. */
  dirOf(conversationId: string): string {
    if (!ID_RE.test(conversationId)) throw new MakeError('invalid_id', 'Некорректный id разговора')
    return join(this.rootDir, 'make', conversationId)
  }

  /** Абсолютный путь файла внутри проекта или ошибка; символические ссылки наружу отвергаются. */
  private async resolveFile(conversationId: string, rawPath: string): Promise<{ path: string; abs: string }> {
    const path = normalizeMakePath(rawPath)
    if (!path) throw new MakeError('invalid_path', `Недопустимый путь файла: «${rawPath}»`)
    const root = resolve(this.dirOf(conversationId))
    const abs = resolve(root, ...path.split('/'))
    if (abs !== root && !abs.startsWith(root + sep)) throw new MakeError('invalid_path', 'Путь выходит за пределы проекта')
    // Каждый существующий сегмент не должен быть ссылкой: иначе `a/b` мог бы указывать наружу.
    let cursor = root
    for (const part of path.split('/')) {
      cursor = join(cursor, part)
      try {
        const st = await lstat(cursor)
        if (st.isSymbolicLink()) throw new MakeError('invalid_path', 'Символические ссылки в проекте запрещены')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
        throw error
      }
    }
    return { path, abs }
  }

  rev(conversationId: string): number {
    return this.revs.get(conversationId) ?? 0
  }

  private bump(conversationId: string): number {
    const next = this.rev(conversationId) + 1
    this.revs.set(conversationId, next)
    return next
  }

  /** Создаёт проект-заготовку, если папки ещё нет или она пуста. */
  async ensure(conversationId: string): Promise<void> {
    const dir = this.dirOf(conversationId)
    await mkdir(join(dir, SNAPSHOTS_DIR), { recursive: true })
    const files = await this.list(conversationId)
    if (files.length > 0) return
    for (const [path, content] of Object.entries(MAKE_SCAFFOLD)) {
      await writeFile(join(dir, ...path.split('/')), content, 'utf8')
    }
  }

  async list(conversationId: string): Promise<MakeFileInfo[]> {
    const root = this.dirOf(conversationId)
    if (!existsSync(root)) return []
    const out: MakeFileInfo[] = []
    const walk = async (dir: string, prefix: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) { await walk(join(dir, entry.name), rel); continue }
        if (!entry.isFile()) continue
        const st = await stat(join(dir, entry.name))
        out.push({ path: rel, size: st.size, updatedAt: Math.round(st.mtimeMs) })
      }
    }
    await walk(root, '')
    return out.sort((a, b) => a.path.localeCompare(b.path, 'ru'))
  }

  async read(conversationId: string, rawPath: string): Promise<MakeFileContent> {
    const { path, abs } = await this.resolveFile(conversationId, rawPath)
    if (!isMakeTextPath(path)) throw new MakeError('not_text', `Файл «${path}» не текстовый — откройте его в превью`)
    let st
    try { st = await stat(abs) } catch { throw new MakeError('not_found', `Файл «${path}» не найден`) }
    if (!st.isFile()) throw new MakeError('not_found', `Файл «${path}» не найден`)
    const content = await readFile(abs, 'utf8')
    return { path, size: st.size, updatedAt: Math.round(st.mtimeMs), content }
  }

  /** Байты любого файла (для отдачи превью); null — нет такого файла. */
  async readBuffer(conversationId: string, rawPath: string): Promise<{ path: string; data: Buffer } | null> {
    const { path, abs } = await this.resolveFile(conversationId, rawPath)
    try {
      const st = await stat(abs)
      if (!st.isFile()) return null
      return { path, data: await readFile(abs) }
    } catch {
      return null
    }
  }

  async write(conversationId: string, rawPath: string, content: string): Promise<MakeProjectState> {
    const { path, abs } = await this.resolveFile(conversationId, rawPath)
    if (Buffer.byteLength(content, 'utf8') > MAKE_LIMITS.maxFileBytes) {
      throw new MakeError('too_large', `Файл «${path}» больше ${Math.round(MAKE_LIMITS.maxFileBytes / 1024)} КБ`)
    }
    const files = await this.list(conversationId)
    if (!files.some((f) => f.path === path) && files.length >= MAKE_LIMITS.maxFiles) {
      throw new MakeError('too_many_files', `В проекте уже ${MAKE_LIMITS.maxFiles} файлов`)
    }
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
    this.bump(conversationId)
    return this.state(conversationId)
  }

  async delete(conversationId: string, rawPath: string): Promise<MakeProjectState> {
    const { path, abs } = await this.resolveFile(conversationId, rawPath)
    try {
      const st = await stat(abs)
      if (!st.isFile()) throw new MakeError('not_found', `Файл «${path}» не найден`)
    } catch (error) {
      if (error instanceof MakeError) throw error
      throw new MakeError('not_found', `Файл «${path}» не найден`)
    }
    await rm(abs)
    await this.pruneEmptyDirs(conversationId, dirname(abs))
    this.bump(conversationId)
    return this.state(conversationId)
  }

  async rename(conversationId: string, rawFrom: string, rawTo: string): Promise<MakeProjectState> {
    const from = await this.resolveFile(conversationId, rawFrom)
    const to = await this.resolveFile(conversationId, rawTo)
    if (!existsSync(from.abs)) throw new MakeError('not_found', `Файл «${from.path}» не найден`)
    if (existsSync(to.abs)) throw new MakeError('exists', `Файл «${to.path}» уже существует`)
    await mkdir(dirname(to.abs), { recursive: true })
    await rename(from.abs, to.abs)
    await this.pruneEmptyDirs(conversationId, dirname(from.abs))
    this.bump(conversationId)
    return this.state(conversationId)
  }

  /** Удаляет опустевшие каталоги вверх до корня проекта (сам корень не трогает). */
  private async pruneEmptyDirs(conversationId: string, dir: string): Promise<void> {
    const root = resolve(this.dirOf(conversationId))
    let cursor = resolve(dir)
    while (cursor !== root && cursor.startsWith(root + sep)) {
      const entries = await readdir(cursor).catch(() => null)
      if (!entries || entries.length > 0) return
      await rmdir(cursor).catch(() => undefined)
      cursor = dirname(cursor)
    }
  }

  async snapshots(conversationId: string): Promise<MakeSnapshot[]> {
    const dir = join(this.dirOf(conversationId), SNAPSHOTS_DIR)
    if (!existsSync(dir)) return []
    const ids = await readdir(dir)
    const out: MakeSnapshot[] = []
    for (const id of ids) {
      try {
        const meta = JSON.parse(await readFile(join(dir, id, 'meta.json'), 'utf8')) as SnapshotMeta
        out.push({ id: meta.id, createdAt: meta.createdAt, label: meta.label, files: meta.files })
      } catch { /* битый снимок пропускаем */ }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Снимок текущих файлов; старые снимки сверх лимита удаляются. */
  async snapshot(conversationId: string, label: string): Promise<MakeProjectState> {
    const files = await this.list(conversationId)
    const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`
    const dir = join(this.dirOf(conversationId), SNAPSHOTS_DIR, id)
    await mkdir(join(dir, 'files'), { recursive: true })
    for (const file of files) {
      const src = join(this.dirOf(conversationId), ...file.path.split('/'))
      const dst = join(dir, 'files', ...file.path.split('/'))
      await mkdir(dirname(dst), { recursive: true })
      await cp(src, dst)
    }
    const meta: SnapshotMeta = { id, createdAt: Date.now(), label: label.slice(0, 120) || 'Снимок', files: files.length }
    await writeFile(join(dir, 'meta.json'), JSON.stringify(meta), 'utf8')
    const all = await this.snapshots(conversationId)
    for (const old of all.slice(MAKE_LIMITS.maxSnapshots)) {
      await rm(join(this.dirOf(conversationId), SNAPSHOTS_DIR, old.id), { recursive: true, force: true })
    }
    return this.state(conversationId)
  }

  /** Возвращает проект к снимку; текущее состояние перед этим сохраняется отдельным снимком. */
  async restore(conversationId: string, snapshotId: string): Promise<MakeProjectState> {
    if (!ID_RE.test(snapshotId)) throw new MakeError('not_found', 'Снимок не найден')
    const src = join(this.dirOf(conversationId), SNAPSHOTS_DIR, snapshotId, 'files')
    if (!existsSync(src)) throw new MakeError('not_found', 'Снимок не найден')
    await this.snapshot(conversationId, 'Перед восстановлением снимка')
    await this.clearFiles(conversationId)
    await cp(src, this.dirOf(conversationId), { recursive: true })
    this.bump(conversationId)
    return this.state(conversationId)
  }

  /** Стартовая заготовка вместо всех файлов (снимки остаются). */
  async reset(conversationId: string): Promise<MakeProjectState> {
    await this.snapshot(conversationId, 'Перед сбросом проекта')
    await this.clearFiles(conversationId)
    for (const [path, content] of Object.entries(MAKE_SCAFFOLD)) {
      await writeFile(join(this.dirOf(conversationId), ...path.split('/')), content, 'utf8')
    }
    this.bump(conversationId)
    return this.state(conversationId)
  }

  private async clearFiles(conversationId: string): Promise<void> {
    const root = this.dirOf(conversationId)
    for (const entry of await readdir(root)) {
      if (entry === SNAPSHOTS_DIR) continue
      await rm(join(root, entry), { recursive: true, force: true })
    }
  }

  async state(conversationId: string): Promise<MakeProjectState> {
    const [files, snapshots] = await Promise.all([this.list(conversationId), this.snapshots(conversationId)])
    return { conversationId, files, snapshots, rev: this.rev(conversationId) }
  }

  /** ZIP всех файлов проекта (без снимков) — «Скачать код». */
  async exportZip(conversationId: string): Promise<Buffer> {
    const files = await this.list(conversationId)
    const entries = []
    for (const file of files) {
      const data = await readFile(join(this.dirOf(conversationId), ...file.path.split('/')))
      entries.push({ path: file.path, data, mtime: new Date(file.updatedAt) })
    }
    return buildStoredZip(entries)
  }

  /** Короткий отпечаток содержимого — для ETag превью. */
  static etag(data: Buffer): string {
    return `"${createHash('sha1').update(data).digest('hex').slice(0, 16)}"`
  }
}
