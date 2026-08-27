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
  MAKE_LIMITS, MAKE_SCAFFOLD, MAKE_TEMPLATES, detectPwaMeta, injectPwaIntoHtml, pwaFiles, isMakeTextPath, isValidMakeSlug, makePublicUrl, makeSlugUrl, makeSharedUrl, normalizeMakePath,
  type MakeCheckIssue, type MakeFileContent, type MakeFileInfo, type MakeProjectState, type MakePublication, type MakeSnapshot, isMakeStoriesPath, isMakeTranspiledPath } from '@voicechat/shared'
import { parseStoryFile } from './stories.js'
import { compileDiagnostics } from './transpile.js'
import type { MakeSearchMatch, MakeStoryFile, MakeStoryShot, MakeSnapshotDiff, MakeSnapshotDiffEntry, MakeImportMode, MockResponse, MakeUsage, MakeCleanupOptions, MakeCleanupResult, MakeComment, MakeShare } from '@voicechat/shared'
import { mockCandidates, unwrapMockEnvelope } from '@voicechat/shared'
import { buildStoredZip } from './zip.js'

export type MakeErrorCode = 'invalid_id' | 'invalid_path' | 'not_found' | 'too_large' | 'too_many_files' | 'not_text' | 'exists' | 'quota'

export class MakeError extends Error {
  constructor(readonly code: MakeErrorCode, message: string) {
    super(message)
    this.name = 'MakeError'
  }
}

const SNAPSHOTS_DIR = '.snapshots'
/** Файл публикации проекта (в его корне) и индекс токен → разговор (общий каталог). */
const PUBLISH_FILE = '.publish.json'
const COMMENTS_FILE = '.comments.json'
const SHARE_FILE = '.share.json'
/** Содержимое `.publish.json`; passwordHash = `<соль>:<sha256(соль:пароль)>`. */
interface PublishRaw { token: string; publishedAt?: number; snapshotId?: string | null; snapshotLabel?: string | null; slug?: string | null; passwordHash?: string | null; views?: number }
const SHOTS_DIR = '.shots'
const SHOTS_PER_STORY = 10
const PUBLISHED_INDEX_DIR = '.published'
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/

interface SnapshotMeta { id: string; createdAt: number; label: string; files: number }

/**
 * Путь файла проекта, на который указывает ссылка из файла в каталоге `dir`:
 * `.`/`..` сворачиваются, абсолютный `/x` — от корня. null — ссылка выходит за
 * корень проекта или битая; undefined — пустая после нормализации (не проверяем).
 */
function resolveRelativeRef(dir: string, value: string): string | null | undefined {
  const raw = value.startsWith('/') ? value.slice(1) : dir ? `${dir}/${value}` : value
  const out: string[] = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') { if (out.length === 0) return null; out.pop(); continue }
    out.push(part)
  }
  if (out.length === 0) return undefined
  return normalizeMakePath(out.join('/'))
}

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
    return this.writeBuffer(conversationId, rawPath, Buffer.from(content, 'utf8'))
  }

  /** Бинарная запись (картинки, шрифты из загрузки пользователя) — те же лимиты, что у текста. */
  async writeBuffer(conversationId: string, rawPath: string, content: Buffer): Promise<MakeProjectState> {
    const { path, abs } = await this.resolveFile(conversationId, rawPath)
    if (content.byteLength > MAKE_LIMITS.maxFileBytes) {
      throw new MakeError('too_large', `Файл «${path}» больше ${Math.round(MAKE_LIMITS.maxFileBytes / 1024)} КБ`)
    }
    const files = await this.list(conversationId)
    if (!files.some((f) => f.path === path) && files.length >= MAKE_LIMITS.maxFiles) {
      throw new MakeError('too_many_files', `В проекте уже ${MAKE_LIMITS.maxFiles} файлов`)
    }
    // Квота проекта (п.30): считаем со снимками и PNG стори — именно они незаметно съедают место.
    const prev = files.find((f) => f.path === path)?.size ?? 0
    const usage = await this.usage(conversationId)
    if (usage.totalBytes - prev + content.byteLength > MAKE_LIMITS.maxProjectBytes) {
      throw new MakeError('quota', `Проект занял ${Math.round(usage.totalBytes / 1048576)} МБ из ${Math.round(MAKE_LIMITS.maxProjectBytes / 1048576)} — очистите снимки в «Место»`)
    }
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content)
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

  // ---- Read-only ссылка внутри ChatAI (п.33): .share.json + индекс share-<token> → разговор ----

  async share(conversationId: string): Promise<MakeShare | null> {
    try {
      const raw = JSON.parse(await readFile(join(this.dirOf(conversationId), SHARE_FILE), 'utf8')) as { token?: string; createdAt?: number }
      if (!raw.token || !ID_RE.test(raw.token)) return null
      return { token: raw.token, createdAt: raw.createdAt ?? 0, url: makeSharedUrl(raw.token) }
    } catch { return null }
  }

  /** Создаёт ссылку (повторный вызов возвращает ту же). */
  async createShare(conversationId: string): Promise<MakeProjectState> {
    if (!(await this.share(conversationId))) {
      const token = randomUUID().replace(/-/g, '')
      const indexDir = join(this.rootDir, 'make', PUBLISHED_INDEX_DIR)
      await mkdir(indexDir, { recursive: true })
      await writeFile(join(indexDir, `share-${token}.json`), JSON.stringify({ conversationId }), 'utf8')
      await writeFile(join(this.dirOf(conversationId), SHARE_FILE), JSON.stringify({ token, createdAt: Date.now() }), 'utf8')
    }
    return this.state(conversationId)
  }

  async revokeShare(conversationId: string): Promise<MakeProjectState> {
    const cur = await this.share(conversationId)
    if (cur) {
      await rm(join(this.rootDir, 'make', PUBLISHED_INDEX_DIR, `share-${cur.token}.json`), { force: true })
      await rm(join(this.dirOf(conversationId), SHARE_FILE), { force: true })
    }
    return this.state(conversationId)
  }

  /** Разговор по share-токену; null — ссылка отозвана или неверна. */
  async sharedTarget(token: string): Promise<string | null> {
    if (!ID_RE.test(token)) return null
    try {
      const raw = JSON.parse(await readFile(join(this.rootDir, 'make', PUBLISHED_INDEX_DIR, `share-${token}.json`), 'utf8')) as { conversationId?: string }
      if (!raw.conversationId) return null
      const cur = await this.share(raw.conversationId)
      return cur?.token === token ? raw.conversationId : null
    } catch { return null }
  }

  // ---- Комментарии к элементам превью (п.32): .comments.json, переживает reset как .publish.json ----

  async comments(conversationId: string): Promise<MakeComment[]> {
    try {
      const raw = JSON.parse(await readFile(join(this.dirOf(conversationId), COMMENTS_FILE), 'utf8')) as MakeComment[]
      return Array.isArray(raw) ? raw : []
    } catch { return [] }
  }

  private async saveComments(conversationId: string, list: MakeComment[]): Promise<MakeComment[]> {
    await writeFile(join(this.dirOf(conversationId), COMMENTS_FILE), JSON.stringify(list), 'utf8')
    return list
  }

  async addComment(conversationId: string, input: { selector: string; elementLabel: string; text: string; author: string }): Promise<MakeComment[]> {
    const text = input.text.trim().slice(0, 2000)
    const selector = input.selector.trim().slice(0, 500)
    if (!text || !selector) throw new MakeError('invalid_path', 'Нужны селектор и текст комментария')
    const list = await this.comments(conversationId)
    if (list.length >= 500) throw new MakeError('too_many_files', 'Слишком много комментариев — удалите решённые')
    const item: MakeComment = { id: `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`, selector, elementLabel: input.elementLabel.slice(0, 160), text, author: input.author, createdAt: Date.now(), resolved: false }
    return this.saveComments(conversationId, [item, ...list])
  }

  async updateComment(conversationId: string, commentId: string, patch: { resolved?: boolean; text?: string }): Promise<MakeComment[]> {
    const list = await this.comments(conversationId)
    const idx = list.findIndex((c) => c.id === commentId)
    if (idx < 0) throw new MakeError('not_found', 'Комментарий не найден')
    const cur = list[idx]!
    list[idx] = { ...cur, resolved: patch.resolved ?? cur.resolved, text: patch.text?.trim() ? patch.text.trim().slice(0, 2000) : cur.text }
    return this.saveComments(conversationId, list)
  }

  async removeComment(conversationId: string, commentId: string): Promise<MakeComment[]> {
    const list = await this.comments(conversationId)
    if (!list.some((c) => c.id === commentId)) throw new MakeError('not_found', 'Комментарий не найден')
    return this.saveComments(conversationId, list.filter((c) => c.id !== commentId))
  }

  // ---- Квота и очистка (п.30) ---------------------------------------------

  private async dirBytes(dir: string): Promise<number> {
    let total = 0
    let entries: import('node:fs').Dirent[]
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return 0 }
    for (const e of entries) {
      const abs = join(dir, e.name)
      if (e.isDirectory()) total += await this.dirBytes(abs)
      else if (e.isFile()) total += (await stat(abs).catch(() => ({ size: 0 }))).size
    }
    return total
  }

  /** Занятое место по составляющим и список бинарных файлов, на которые никто не ссылается. */
  async usage(conversationId: string): Promise<MakeUsage> {
    const root = this.dirOf(conversationId)
    const files = await this.list(conversationId)
    const filesBytes = files.reduce((s, f) => s + f.size, 0)
    const snapshots = await this.snapshots(conversationId)
    const [snapshotsBytes, shotsBytes, shots] = await Promise.all([
      this.dirBytes(join(root, SNAPSHOTS_DIR)), this.dirBytes(join(root, SHOTS_DIR)), this.shots(conversationId)
    ])
    // Неиспользуемые ассеты: бинарник, имя которого не встречается ни в одном текстовом файле.
    const texts: string[] = []
    for (const f of files) {
      if (!isMakeTextPath(f.path) || f.size > 512 * 1024) continue
      const buf = await this.readBuffer(conversationId, f.path).catch(() => null)
      if (buf) texts.push(buf.data.toString('utf8'))
    }
    const unusedAssets = files
      .filter((f) => !isMakeTextPath(f.path))
      .filter((f) => { const name = f.path.split('/').pop()!; return !texts.some((t) => t.includes(name)) })
      .map((f) => ({ path: f.path, size: f.size }))
    return {
      filesBytes, filesCount: files.length, snapshotsBytes, snapshotsCount: snapshots.length, shotsBytes, shotsCount: shots.length,
      totalBytes: filesBytes + snapshotsBytes + shotsBytes, limitBytes: MAKE_LIMITS.maxProjectBytes, unusedAssets
    }
  }

  /** Очистка по выбранным пунктам; возвращает, сколько освободили. Закреплённый в публикации снимок не удаляется. */
  async cleanup(conversationId: string, options: MakeCleanupOptions): Promise<MakeCleanupResult> {
    const root = this.dirOf(conversationId)
    const before = await this.usage(conversationId)
    const removed = { snapshots: 0, shots: 0, assets: 0 }
    if (typeof options.keepSnapshots === 'number') {
      const keep = Math.max(0, Math.floor(options.keepSnapshots))
      const pinned = (await this.publication(conversationId))?.snapshotId ?? null
      const all = await this.snapshots(conversationId)
      for (const snap of all.slice(keep)) {
        if (snap.id === pinned) continue
        await rm(join(root, SNAPSHOTS_DIR, snap.id), { recursive: true, force: true })
        removed.snapshots += 1
      }
    }
    if (options.shots) {
      removed.shots = (await this.shots(conversationId)).length
      await rm(join(root, SHOTS_DIR), { recursive: true, force: true })
    }
    if (options.unusedAssets) {
      for (const asset of before.unusedAssets) {
        try { await this.delete(conversationId, asset.path); removed.assets += 1 } catch { /* уже удалён */ }
      }
    }
    const usage = await this.usage(conversationId)
    return { freedBytes: Math.max(0, before.totalBytes - usage.totalBytes), removed, usage, state: await this.state(conversationId) }
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

  /** Сравнение снимка с текущими файлами — что добавилось, пропало и изменилось. */
  async snapshotDiff(conversationId: string, snapshotId: string): Promise<MakeSnapshotDiff> {
    if (!ID_RE.test(snapshotId)) throw new MakeError('not_found', 'Снимок не найден')
    const snapRoot = join(this.dirOf(conversationId), SNAPSHOTS_DIR, snapshotId, 'files')
    if (!existsSync(snapRoot)) throw new MakeError('not_found', 'Снимок не найден')
    const before = new Map<string, Buffer>()
    const walk = async (dir: string, rel: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const next = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory()) await walk(join(dir, entry.name), next)
        else before.set(next, await readFile(join(dir, entry.name)))
      }
    }
    await walk(snapRoot, '')
    const current = await this.list(conversationId)
    const files: MakeSnapshotDiffEntry[] = []
    for (const file of current) {
      const now = await readFile(join(this.dirOf(conversationId), ...file.path.split('/')))
      const old = before.get(file.path)
      if (!old) files.push({ path: file.path, status: 'added', before: null, after: now.length })
      else files.push({ path: file.path, status: old.equals(now) ? 'same' : 'changed', before: old.length, after: now.length })
      before.delete(file.path)
    }
    for (const [path, data] of before) files.push({ path, status: 'removed', before: data.length, after: null })
    files.sort((a, b) => a.path.localeCompare(b.path))
    return { snapshotId, files }
  }

  /** Текст файла из снимка (для сравнения с текущим). */
  async snapshotFile(conversationId: string, snapshotId: string, rawPath: string): Promise<MakeFileContent> {
    if (!ID_RE.test(snapshotId)) throw new MakeError('not_found', 'Снимок не найден')
    const path = normalizeMakePath(rawPath)
    if (!path) throw new MakeError('invalid_path', 'Недопустимый путь')
    if (!isMakeTextPath(path)) throw new MakeError('not_text', `Файл «${path}» не текстовый`)
    const src = join(this.dirOf(conversationId), SNAPSHOTS_DIR, snapshotId, 'files', ...path.split('/'))
    if (!existsSync(src)) throw new MakeError('not_found', `В снимке нет файла «${path}»`)
    const data = await readFile(src)
    return { path, size: data.byteLength, updatedAt: (await stat(src)).mtimeMs, content: data.toString('utf8') }
  }

  /** Вернуть один файл из снимка, остальное не трогая. */
  async restoreFile(conversationId: string, snapshotId: string, rawPath: string): Promise<MakeProjectState> {
    if (!ID_RE.test(snapshotId)) throw new MakeError('not_found', 'Снимок не найден')
    const { path, abs } = await this.resolveFile(conversationId, rawPath)
    const src = join(this.dirOf(conversationId), SNAPSHOTS_DIR, snapshotId, 'files', ...path.split('/'))
    if (!existsSync(src)) throw new MakeError('not_found', `В снимке нет файла «${path}»`)
    await mkdir(dirname(abs), { recursive: true })
    await cp(src, abs)
    this.bump(conversationId)
    return this.state(conversationId)
  }

  /** Импорт набора файлов (ZIP или страница по URL); перед этим — снимок. */
  async importFiles(conversationId: string, files: Array<{ path: string; data: Buffer }>, mode: MakeImportMode): Promise<MakeProjectState> {
    await this.ensure(conversationId)
    const accepted: Array<{ path: string; data: Buffer }> = []
    for (const file of files) {
      const path = normalizeMakePath(file.path)
      if (!path) continue
      if (file.data.byteLength > MAKE_LIMITS.maxFileBytes) throw new MakeError('too_large', `Файл «${path}» больше ${Math.round(MAKE_LIMITS.maxFileBytes / 1024)} КБ`)
      accepted.push({ path, data: file.data })
    }
    if (accepted.length === 0) throw new MakeError('invalid_path', 'В импорте нет подходящих файлов')
    if (accepted.length > MAKE_LIMITS.maxFiles) throw new MakeError('too_many_files', `В проекте не может быть больше ${MAKE_LIMITS.maxFiles} файлов`)
    await this.snapshot(conversationId, mode === 'replace' ? 'Перед импортом (замена)' : 'Перед импортом')
    if (mode === 'replace') await this.clearFiles(conversationId)
    for (const file of accepted) {
      const abs = join(this.dirOf(conversationId), ...file.path.split('/'))
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, file.data)
    }
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
      if (entry === SNAPSHOTS_DIR || entry === PUBLISH_FILE || entry === SHOTS_DIR || entry === COMMENTS_FILE || entry === SHARE_FILE) continue
      await rm(join(root, entry), { recursive: true, force: true })
    }
  }

  /** Поиск по содержимому текстовых файлов: без регистра, до `limit` совпадений, строки обрезаны. */
  async search(conversationId: string, query: string, limit = 200): Promise<MakeSearchMatch[]> {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return []
    const matches: MakeSearchMatch[] = []
    for (const file of await this.list(conversationId)) {
      if (!isMakeTextPath(file.path)) continue
      const { content } = await this.read(conversationId, file.path)
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.toLocaleLowerCase().includes(needle)) {
          matches.push({ path: file.path, line: i + 1, text: lines[i]!.trim().slice(0, 200) })
          if (matches.length >= limit) return matches
        }
      }
    }
    return matches
  }

  /** Замена подстроки во всех текстовых файлах (без регулярных выражений); перед правкой — снимок. */
  async replaceAll(conversationId: string, query: string, replacement: string, options: { matchCase?: boolean } = {}): Promise<{ files: number; replacements: number; state: MakeProjectState }> {
    if (!query) throw new MakeError('invalid_path', 'Пустая строка поиска')
    const flags = options.matchCase ? 'g' : 'gi'
    const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
    let files = 0, replacements = 0
    const touched: Array<{ path: string; next: string }> = []
    for (const file of await this.list(conversationId)) {
      if (!isMakeTextPath(file.path)) continue
      const { content } = await this.read(conversationId, file.path)
      const count = (content.match(re) ?? []).length
      if (count === 0) continue
      files += 1; replacements += count
      touched.push({ path: file.path, next: content.replace(re, () => replacement) })
    }
    if (touched.length > 0) {
      await this.snapshot(conversationId, `Перед заменой «${query.slice(0, 30)}» → «${replacement.slice(0, 30)}»`)
      for (const t of touched) await writeFile(join(this.dirOf(conversationId), ...t.path.split('/')), t.next, 'utf8')
      this.bump(conversationId)
    }
    return { files, replacements, state: await this.state(conversationId) }
  }

  /** Визуальные снимки стори: PNG в `.shots/<id>.png` + `meta.json`; на стори — не больше SHOTS_PER_STORY. */
  async shots(conversationId: string): Promise<MakeStoryShot[]> {
    try {
      const raw = JSON.parse(await readFile(join(this.dirOf(conversationId), SHOTS_DIR, 'meta.json'), 'utf8')) as MakeStoryShot[]
      return Array.isArray(raw) ? raw.sort((a, b) => b.at - a.at) : []
    } catch { return [] }
  }

  async addShot(conversationId: string, file: string, story: string, png: Buffer): Promise<MakeStoryShot[]> {
    if (png.byteLength > MAKE_LIMITS.maxFileBytes * 2) throw new MakeError('too_large', 'Снимок больше 4 МБ')
    if (!/^\x89PNG/.test(png.subarray(0, 4).toString('latin1'))) throw new MakeError('invalid_path', 'Ожидается PNG')
    const dir = join(this.dirOf(conversationId), SHOTS_DIR)
    await mkdir(dir, { recursive: true })
    const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`
    await writeFile(join(dir, `${id}.png`), png)
    const list = [{ id, file, story, at: Date.now(), rev: this.rev(conversationId) }, ...(await this.shots(conversationId))]
    // Лимит на стори: старые снимки той же стори удаляем вместе с файлами.
    const keep: MakeStoryShot[] = []
    const perStory = new Map<string, number>()
    for (const s of list) {
      const k = `${s.file}::${s.story}`
      const n = (perStory.get(k) ?? 0) + 1
      perStory.set(k, n)
      if (n <= SHOTS_PER_STORY) keep.push(s)
      else await rm(join(dir, `${s.id}.png`), { force: true })
    }
    await writeFile(join(dir, 'meta.json'), JSON.stringify(keep), 'utf8')
    return keep
  }

  async shotImage(conversationId: string, shotId: string): Promise<Buffer | null> {
    if (!ID_RE.test(shotId)) return null
    try { return await readFile(join(this.dirOf(conversationId), SHOTS_DIR, `${shotId}.png`)) } catch { return null }
  }

  /** Файлы сториз проекта с именами стори. */
  async stories(conversationId: string): Promise<MakeStoryFile[]> {
    const result: MakeStoryFile[] = []
    for (const file of await this.list(conversationId)) {
      if (!isMakeStoriesPath(file.path)) continue
      const { content } = await this.read(conversationId, file.path)
      result.push(parseStoryFile(file.path, content))
    }
    return result
  }

  async state(conversationId: string): Promise<MakeProjectState> {
    const [files, snapshots, published, shared] = await Promise.all([this.list(conversationId), this.snapshots(conversationId), this.publication(conversationId), this.share(conversationId)])
    return { conversationId, files, snapshots, rev: this.rev(conversationId), published, shared }
  }

  // ---- Публикация: непубличная ссылка /p/<token>/ без авторизации -------------

  /** Сырой файл публикации — с хэшем пароля; наружу (в MakePublication) хэш не уходит. */
  private async publishRaw(conversationId: string): Promise<PublishRaw | null> {
    try {
      const raw = JSON.parse(await readFile(join(this.dirOf(conversationId), PUBLISH_FILE), 'utf8')) as PublishRaw
      if (!raw.token || !ID_RE.test(raw.token)) return null
      return raw
    } catch {
      return null
    }
  }

  async publication(conversationId: string): Promise<MakePublication | null> {
    const raw = await this.publishRaw(conversationId)
    if (!raw) return null
    return {
      token: raw.token, publishedAt: raw.publishedAt ?? 0, url: makePublicUrl(raw.token),
      snapshotId: raw.snapshotId ?? null, snapshotLabel: raw.snapshotLabel ?? null,
      slug: raw.slug ?? null, slugUrl: raw.slug ? makeSlugUrl(raw.slug) : null,
      passwordProtected: Boolean(raw.passwordHash), views: raw.views ?? 0
    }
  }

  /** Публикует проект (повторный вызов возвращает ту же ссылку). */
  /**
   * Опубликовать: токен создаётся один раз и не меняется; `snapshotId` закрепляет публикацию за снимком
   * (ссылка отдаёт его файлы, пока публикацию не обновят), null — «живая» публикация текущих файлов.
   */
  async publish(conversationId: string, options: { snapshotId?: string | null; slug?: string | null; password?: string | null } = {}): Promise<MakeProjectState> {
    const existing = await this.publishRaw(conversationId)
    const token = existing?.token ?? randomUUID().replace(/-/g, '')
    if (!existing) {
      const indexDir = join(this.rootDir, 'make', PUBLISHED_INDEX_DIR)
      await mkdir(indexDir, { recursive: true })
      await writeFile(join(indexDir, `${token}.json`), JSON.stringify({ conversationId }), 'utf8')
    }
    let snapshotId: string | null = null, snapshotLabel: string | null = null
    if (options.snapshotId) {
      if (!ID_RE.test(options.snapshotId)) throw new MakeError('not_found', 'Снимок не найден')
      const snap = (await this.snapshots(conversationId)).find((s) => s.id === options.snapshotId)
      if (!snap) throw new MakeError('not_found', 'Снимок не найден')
      snapshotId = snap.id; snapshotLabel = snap.label
    }
    // Slug (п.25): undefined — не трогать, null — снять, строка — проверить и занять (индекс slug→token, чужой занятый — конфликт).
    let slug = existing?.slug ?? null
    if (options.slug !== undefined) {
      const next = options.slug ? options.slug.trim().toLowerCase() : null
      if (next && !isValidMakeSlug(next)) throw new MakeError('invalid_path', 'Адрес: 3–40 символов, латиница, цифры и дефис')
      if (next !== slug) {
        const indexDir = join(this.rootDir, 'make', PUBLISHED_INDEX_DIR)
        if (next) {
          const owner = await this.slugToken(next)
          if (owner && owner !== token) throw new MakeError('exists', 'Такой адрес уже занят другим проектом')
          await mkdir(indexDir, { recursive: true })
          await writeFile(join(indexDir, `slug-${next}.json`), JSON.stringify({ token }), 'utf8')
        }
        if (slug) await rm(join(indexDir, `slug-${slug}.json`), { force: true })
        slug = next
      }
    }
    // Пароль: undefined — оставить, null — снять, строка — новый хэш с солью. Сам пароль не хранится.
    let passwordHash = existing?.passwordHash ?? null
    if (options.password !== undefined) {
      if (options.password === null || options.password === '') passwordHash = null
      else {
        if (options.password.length < 4) throw new MakeError('invalid_path', 'Пароль — не короче 4 символов')
        const salt = randomUUID().replace(/-/g, '')
        passwordHash = `${salt}:${createHash('sha256').update(`${salt}:${options.password}`).digest('hex')}`
      }
    }
    const raw: PublishRaw = { token, publishedAt: Date.now(), snapshotId, snapshotLabel, slug, passwordHash, views: existing?.views ?? 0 }
    await writeFile(join(this.dirOf(conversationId), PUBLISH_FILE), JSON.stringify(raw), 'utf8')
    return this.state(conversationId)
  }

  /** Токен публикации по slug; null — адрес свободен или снят. */
  async slugToken(slug: string): Promise<string | null> {
    if (!isValidMakeSlug(slug)) return null
    try {
      const raw = JSON.parse(await readFile(join(this.rootDir, 'make', PUBLISHED_INDEX_DIR, `slug-${slug}.json`), 'utf8')) as { token?: string }
      if (!raw.token) return null
      // Индекс мог остаться от снятой публикации — сверяем с самой публикацией.
      const conversationId = await this.publishedTarget(raw.token)
      if (!conversationId) return null
      const pub = await this.publishRaw(conversationId)
      return pub?.slug === slug ? raw.token : null
    } catch { return null }
  }

  /**
   * Пропуск по паролю: `null` — публикация без пароля; иначе подпись, которую сервер кладёт в cookie
   * после верного пароля и сравнивает при каждом запросе. Подпись зависит от хэша: смена пароля
   * автоматически разлогинивает всех.
   */
  async publicGate(conversationId: string): Promise<string | null> {
    const raw = await this.publishRaw(conversationId)
    if (!raw?.passwordHash) return null
    return createHash('sha256').update(`gate:${raw.token}:${raw.passwordHash}`).digest('hex')
  }

  async verifyPublicPassword(conversationId: string, password: string): Promise<boolean> {
    const raw = await this.publishRaw(conversationId)
    if (!raw?.passwordHash) return true
    const [salt, hash] = raw.passwordHash.split(':')
    return createHash('sha256').update(`${salt}:${password}`).digest('hex') === hash
  }

  /** Счётчик просмотров: +1 на открытие index.html публикации. Гонки терпимы — это статистика, не биллинг. */
  async countView(conversationId: string): Promise<void> {
    const raw = await this.publishRaw(conversationId)
    if (!raw) return
    raw.views = (raw.views ?? 0) + 1
    await writeFile(join(this.dirOf(conversationId), PUBLISH_FILE), JSON.stringify(raw), 'utf8').catch(() => undefined)
  }

  /**
   * Мок-API (п.29): для отсутствующего файла ищет `mock/<путь>[.<METHOD>].json`; `publicMode` — файлы с публикации
   * (закреплённый снимок), иначе текущие. Возвращает разобранный ответ или null, если мока нет / JSON битый.
   */
  async resolveMock(conversationId: string, rawPath: string, method: string, publicMode = false): Promise<MockResponse | null> {
    for (const candidate of mockCandidates(rawPath, method)) {
      let file: { data: Buffer } | null = null
      try { file = publicMode ? await this.publicFile(conversationId, candidate) : await this.readBuffer(conversationId, candidate) } catch { file = null }
      if (!file) continue
      try { return unwrapMockEnvelope(JSON.parse(file.data.toString('utf8'))) } catch { return { status: 500, body: { error: `Мок ${candidate}: невалидный JSON` }, headers: {}, delayMs: 0 } }
    }
    return null
  }

  /** Файл для публичной ссылки: из закреплённого снимка или текущий. Возвращает и «ключ ревизии» для кэша транспиляции. */
  async publicFile(conversationId: string, rawPath: string): Promise<{ path: string; data: Buffer; cacheKey: string; rev: number } | null> {
    const pub = await this.publication(conversationId)
    if (pub?.snapshotId) {
      const path = normalizeMakePath(rawPath)
      if (!path) return null
      const abs = join(this.dirOf(conversationId), SNAPSHOTS_DIR, pub.snapshotId, 'files', ...path.split('/'))
      try {
        const st = await stat(abs)
        if (!st.isFile()) return null
        return { path, data: await readFile(abs), cacheKey: `${conversationId}@${pub.snapshotId}`, rev: 0 }
      } catch { return null }
    }
    const file = await this.readBuffer(conversationId, rawPath)
    return file ? { ...file, cacheKey: conversationId, rev: this.rev(conversationId) } : null
  }

  async unpublish(conversationId: string): Promise<MakeProjectState> {
    const existing = await this.publishRaw(conversationId)
    if (existing) {
      await rm(join(this.rootDir, 'make', PUBLISHED_INDEX_DIR, `${existing.token}.json`), { force: true })
      if (existing.slug) await rm(join(this.rootDir, 'make', PUBLISHED_INDEX_DIR, `slug-${existing.slug}.json`), { force: true })
      await rm(join(this.dirOf(conversationId), PUBLISH_FILE), { force: true })
    }
    return this.state(conversationId)
  }

  /** Разговор, опубликованный под токеном; null — ссылка недействительна или снята. */
  async publishedTarget(token: string): Promise<string | null> {
    if (!ID_RE.test(token)) return null
    try {
      const raw = JSON.parse(await readFile(join(this.rootDir, 'make', PUBLISHED_INDEX_DIR, `${token}.json`), 'utf8')) as { conversationId?: string }
      if (!raw.conversationId) return null
      // Индекс мог остаться от удалённого проекта — сверяем с файлом публикации.
      const current = await this.publication(raw.conversationId)
      return current?.token === token ? raw.conversationId : null
    } catch {
      return null
    }
  }

  // ---- Статическая проверка проекта ----------------------------------------

  /**
   * Ищет типовые ошибки, из-за которых превью «молча» ломается: нет index.html,
   * ссылки href/src на несуществующие файлы проекта, пустые файлы, внешние скрипты
   * не по https. Не парсер HTML — регулярки по атрибутам, этого хватает для статики.
   */
  async check(conversationId: string): Promise<MakeCheckIssue[]> {
    const files = await this.list(conversationId)
    const paths = new Set(files.map((f) => f.path))
    const issues: MakeCheckIssue[] = []
    if (!paths.has('index.html')) issues.push({ path: 'index.html', kind: 'no-index', message: 'Нет index.html — превью открывать нечего' })
    for (const file of files) {
      if (file.size === 0) issues.push({ path: file.path, kind: 'empty-file', message: 'Файл пустой' })
      if (isMakeTranspiledPath(file.path) && file.size > 0) {
        const source = await readFile(join(this.dirOf(conversationId), ...file.path.split('/')), 'utf8')
        for (const d of await compileDiagnostics(file.path, source)) {
          issues.push({ path: file.path, kind: 'compile-error', message: `Ошибка компиляции (строка ${d.line}): ${d.message}`, line: d.line, column: d.column })
        }
      }
      if (!/\.(html?|css)$/i.test(file.path)) continue
      const text = (await readFile(join(this.dirOf(conversationId), ...file.path.split('/')), 'utf8')).slice(0, 512 * 1024)
      const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
      const refs = new Set<string>()
      for (const m of text.matchAll(/(?:href|src)\s*=\s*["']([^"'#?]+)/gi)) refs.add(m[1]!)
      for (const m of text.matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/gi)) refs.add(m[1]!)
      for (const ref of refs) {
        const value = ref.trim()
        // Якоря (#top) и ссылки на SVG-элементы (url(#shadow)) — не файлы.
        if (!value || value.startsWith('#') || value.startsWith('data:') || value.startsWith('mailto:') || value.startsWith('tel:') || value.startsWith('javascript:') || value.startsWith('//')) continue
        if (/^https?:/i.test(value)) {
          if (/^http:/i.test(value) && /\.js$/i.test(value)) issues.push({ path: file.path, kind: 'external-script', message: `Внешний скрипт не по https: ${value}` })
          continue
        }
        const target = resolveRelativeRef(dir, value)
        if (target === undefined) continue // не файл проекта (например, «..» выше корня разрешается как отсутствующий)
        if (target === null || !paths.has(target)) issues.push({ path: file.path, kind: 'missing-file', message: `Ссылка на отсутствующий файл: ${value}` })
      }
    }
    return issues
  }

  /** Заменяет файлы проекта шаблоном (текущее состояние — в снимок). */
  async applyTemplate(conversationId: string, templateId: string): Promise<MakeProjectState> {
    const template = MAKE_TEMPLATES.find((t) => t.id === templateId)
    if (!template) throw new MakeError('not_found', `Шаблон «${templateId}» не найден`)
    await this.ensure(conversationId)
    await this.snapshot(conversationId, `Перед шаблоном «${template.title}»`)
    await this.clearFiles(conversationId)
    for (const [path, content] of Object.entries(template.files)) {
      const abs = join(this.dirOf(conversationId), ...path.split('/'))
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, content, 'utf8')
    }
    this.bump(conversationId)
    return this.state(conversationId)
  }

  /** ZIP всех файлов проекта (без снимков) — «Скачать код». */
  async exportZip(conversationId: string, options: { vite?: boolean; pwa?: boolean } = {}): Promise<Buffer> {
    const files = await this.list(conversationId)
    const entries: Array<{ path: string; data: Buffer; mtime?: Date }> = []
    for (const file of files) {
      const data = await readFile(join(this.dirOf(conversationId), ...file.path.split('/')))
      entries.push({ path: file.path, data, mtime: new Date(file.updatedAt) })
    }
    if (options.pwa) {
      // PWA (п.35): манифест + SW + иконка, ссылки — в копию index.html внутри архива (проект не трогаем).
      const index = entries.find((e) => e.path === 'index.html')
      const css = entries.find((e) => /\.css$/i.test(e.path))
      const meta = detectPwaMeta(index ? index.data.toString('utf8') : null, css ? css.data.toString('utf8') : null)
      const pwa = { ...meta, vite: Boolean(options.vite) }
      for (const [path, text] of Object.entries(pwaFiles(pwa))) if (!files.some((f) => f.path === path)) entries.push({ path, data: Buffer.from(text, 'utf8') })
      if (index) index.data = Buffer.from(injectPwaIntoHtml(index.data.toString('utf8'), pwa), 'utf8')
    }
    if (options.vite) {
      // «Настоящий проект»: package.json + vite.config, чтобы `npm i && npm run dev` работал локально.
      // Import map на esm.sh Vite не мешает: он переписывает bare-импорты до того, как браузер применит карту.
      const paths = new Set(files.map((f) => f.path))
      const react = files.some((f) => /\.(jsx|tsx)$/i.test(f.path))
      const ts = files.some((f) => /\.tsx?$/i.test(f.path))
      const pkg = {
        name: 'make-project', private: true, version: '0.1.0', type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: react ? { react: '^18.3.1', 'react-dom': '^18.3.1' } : {},
        devDependencies: { vite: '^5.4.11', ...(react ? { '@vitejs/plugin-react': '^4.3.4' } : {}), ...(ts ? { typescript: '^5.7.2', '@types/react': '^18.3.18', '@types/react-dom': '^18.3.5' } : {}) }
      }
      const add = (path: string, text: string): void => { if (!paths.has(path)) entries.push({ path, data: Buffer.from(text, 'utf8') }) }
      add('package.json', JSON.stringify(pkg, null, 2) + '\n')
      add('vite.config.js', react
        ? "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({ plugins: [react()] })\n"
        : "import { defineConfig } from 'vite'\n\nexport default defineConfig({})\n")
      if (ts) add('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, allowImportingTsExtensions: true, noEmit: true, skipLibCheck: true }, include: ['src'] }, null, 2) + '\n')
      add('.gitignore', 'node_modules\ndist\n')
      add('README.md', '# Проект из Make\n\n```bash\nnpm install\nnpm run dev\n```\n\nСобрано в инструменте Make: статический сайт' + (react ? ' на React (JSX транспилируется Vite)' : '') + '.\n')
    }
    return buildStoredZip(entries)
  }

  /** Короткий отпечаток содержимого — для ETag превью. */
  static etag(data: Buffer): string {
    return `"${createHash('sha1').update(data).digest('hex').slice(0, 16)}"`
  }
}
