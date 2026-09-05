// Хранилище студии картинок: плоская галерея файлов на разговор в
// `<dataDir>/image-studio/<conversationId>/`. Намеренно проще мастерской Make:
// без снимков, публикаций и транспиляции — картинке нужны список, байты,
// запись, переименование и удаление, остальное — работа модели и панели.
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { IMAGE_STUDIO_LIMITS, isImageStudioPath, type ImageStudioFile } from '@voicechat/shared'

export class ImageStudioError extends Error {
  constructor(readonly code: 'bad_path' | 'bad_media' | 'not_found' | 'too_big' | 'quota' | 'exists', message: string) {
    super(message)
  }
}

/**
 * Байты обязаны быть картинкой заявленного типа: расширению верить нельзя —
 * «кот.png» с чем угодно внутри засорил бы галерею и уехал бы в промпт правки.
 */
function assertImageBytes(name: string, data: Buffer): void {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  const ok =
    ext === 'png' ? data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : ext === 'jpg' || ext === 'jpeg' ? data[0] === 0xff && data[1] === 0xd8
    : ext === 'gif' ? data.subarray(0, 3).toString('latin1') === 'GIF'
    : ext === 'webp' ? data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP'
    : ext === 'svg' ? /^\s*(<\?xml|<svg|<!--|<!DOCTYPE svg)/i.test(data.subarray(0, 256).toString('utf8'))
    : false
  if (!ok) throw new ImageStudioError('bad_media', `Содержимое «${name}» не похоже на ${ext.toUpperCase()}`)
}

/**
 * Имя файла галереи: одно звено, без каталогов и скрытых имён. Каталоги в
 * галерее не нужны, а плоское имя закрывает и обход путей, и служебные файлы.
 */
function safeName(raw: string): string {
  const name = raw.trim()
  if (!name || name.startsWith('.') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new ImageStudioError('bad_path', `Недопустимое имя файла: «${raw}»`)
  }
  if (!isImageStudioPath(name)) throw new ImageStudioError('bad_path', `«${name}» — не изображение (png, jpg, webp, gif, svg)`)
  return name
}

interface StudioMeta { prompt?: string; source?: string; tookMs?: number }

interface StudioPublication { token: string; publishedAt: number; views: number; passwordHash?: string | null; title?: string | null; days?: Record<string, number> }

const PUBLISH_FILE = '.studio-publish.json'
const TRASH_DIR = '.trash'
const TRASH_SEP = '__'
/** Корзина — страховка от промаха, а не архив: неделя и чистим. */
const TRASH_TTL_MS = 7 * 24 * 3600 * 1000
const PUBLISHED_INDEX_DIR = '.published'
const TOKEN_RE = /^[0-9a-f]{32}$/

export class ImageStudioStore {
  constructor(private readonly rootDir: string) {}

  // Мутации файла публикации — последовательно на разговор: урок Make, где
  // фоновый счётчик просмотров воскрешал снятую публикацию (lost-update).
  private publishChains = new Map<string, Promise<unknown>>()

  private withPublishLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.publishChains.get(conversationId) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.publishChains.set(conversationId, next.then(() => undefined, () => undefined))
    return next
  }

  private async readPublication(conversationId: string): Promise<StudioPublication | null> {
    try {
      const raw = JSON.parse(await readFile(join(this.dirOf(conversationId), PUBLISH_FILE), 'utf8')) as StudioPublication
      return raw.token && TOKEN_RE.test(raw.token) ? raw : null
    } catch {
      return null
    }
  }

  private async writePublication(conversationId: string, raw: StudioPublication): Promise<void> {
    await mkdir(this.dirOf(conversationId), { recursive: true })
    const file = join(this.dirOf(conversationId), PUBLISH_FILE)
    const temporary = `${file}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(raw), 'utf8')
    await rename(temporary, file)
  }

  async publication(conversationId: string): Promise<StudioPublication | null> {
    return this.readPublication(conversationId)
  }

  /**
   * Публикует галерею (повторный вызов не ротирует ссылку, но обновляет
   * пароль/название). password: undefined — не трогать, null/'' — снять,
   * строка — задать; сам пароль не хранится, только хэш с солью.
   */
  async publish(conversationId: string, options: { password?: string | null; title?: string | null } = {}): Promise<StudioPublication> {
    return this.withPublishLock(conversationId, async () => {
      const existing = await this.readPublication(conversationId)
      let token = existing?.token
      if (!token) {
        token = randomUUID().replace(/-/g, '')
        const indexDir = join(this.rootDir, PUBLISHED_INDEX_DIR)
        await mkdir(indexDir, { recursive: true })
        await writeFile(join(indexDir, `${token}.json`), JSON.stringify({ conversationId }), 'utf8')
      }
      let passwordHash = existing?.passwordHash ?? null
      if (options.password !== undefined) {
        if (!options.password) passwordHash = null
        else {
          if (options.password.length < 4) throw new ImageStudioError('bad_path', 'Пароль — не короче 4 символов')
          const salt = randomUUID().replace(/-/g, '')
          passwordHash = `${salt}:${createHash('sha256').update(`${salt}:${options.password}`).digest('hex')}`
        }
      }
      const raw: StudioPublication = {
        token,
        publishedAt: existing?.publishedAt ?? Date.now(),
        views: existing?.views ?? 0,
        passwordHash,
        title: options.title !== undefined ? options.title : existing?.title ?? null
      }
      await this.writePublication(conversationId, raw)
      return raw
    })
  }

  /** Гейт-значение для cookie: живо, пока не сменили пароль. */
  async publicGate(conversationId: string): Promise<string | null> {
    const raw = await this.readPublication(conversationId)
    if (!raw?.passwordHash) return null
    return createHash('sha256').update(`gate:${raw.token}:${raw.passwordHash}`).digest('hex')
  }

  async verifyPublicPassword(conversationId: string, password: string): Promise<boolean> {
    const raw = await this.readPublication(conversationId)
    if (!raw?.passwordHash) return true
    const [salt, hash] = raw.passwordHash.split(':')
    return createHash('sha256').update(`${salt}:${password}`).digest('hex') === hash
  }

  async unpublish(conversationId: string): Promise<void> {
    return this.withPublishLock(conversationId, async () => {
      const existing = await this.readPublication(conversationId)
      if (existing) await rm(join(this.rootDir, PUBLISHED_INDEX_DIR, `${existing.token}.json`), { force: true })
      await rm(join(this.dirOf(conversationId), PUBLISH_FILE), { force: true })
    })
  }

  /** Разговор по токену публикации; null — ссылка снята или не существовала. */
  async publishedTarget(token: string): Promise<string | null> {
    if (!TOKEN_RE.test(token)) return null
    try {
      const raw = JSON.parse(await readFile(join(this.rootDir, PUBLISHED_INDEX_DIR, `${token}.json`), 'utf8')) as { conversationId?: string }
      if (!raw.conversationId) return null
      const current = await this.readPublication(raw.conversationId)
      return current?.token === token ? raw.conversationId : null
    } catch {
      return null
    }
  }

  /** Счётчик просмотров публичной страницы; гонки терпимы, но пишем под локом. */
  async countView(conversationId: string): Promise<void> {
    return this.withPublishLock(conversationId, async () => {
      try {
        const raw = await this.readPublication(conversationId)
        if (!raw) return
        // День в UTC; храним хвост в 30 дней — этого хватает на сводку недели.
        const day = new Date().toISOString().slice(0, 10)
        const days = { ...(raw.days ?? {}), [day]: ((raw.days ?? {})[day] ?? 0) + 1 }
        const trimmed = Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).slice(-30))
        await this.writePublication(conversationId, { ...raw, views: (raw.views ?? 0) + 1, days: trimmed })
      } catch {
        // Статистика не стоит ошибки: галерею могли снять/удалить между чтением
        // и записью (в тестах — rmSync каталога), просмотр просто теряется.
      }
    })
  }

  private dirOf(conversationId: string): string {
    return join(this.rootDir, conversationId)
  }

  /** Происхождение файлов: скрытый sidecar в папке галереи, наружу не отдаётся. */
  private metaPath(conversationId: string): string {
    return join(this.dirOf(conversationId), '.studio-meta.json')
  }

  private async readMeta(conversationId: string): Promise<Record<string, StudioMeta>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.metaPath(conversationId), 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed as Record<string, StudioMeta> : {}
    } catch {
      return {}
    }
  }

  private async writeMeta(conversationId: string, meta: Record<string, StudioMeta>): Promise<void> {
    await mkdir(this.dirOf(conversationId), { recursive: true })
    await writeFile(this.metaPath(conversationId), JSON.stringify(meta))
  }

  /** Запомнить происхождение файла (промпт и, для правок, исходник). */
  async setMeta(conversationId: string, rawPath: string, entry: StudioMeta): Promise<void> {
    const name = safeName(rawPath)
    const meta = await this.readMeta(conversationId)
    meta[name] = entry
    await this.writeMeta(conversationId, meta)
  }

  async list(conversationId: string): Promise<ImageStudioFile[]> {
    const dir = this.dirOf(conversationId)
    if (!existsSync(dir)) return []
    const out: ImageStudioFile[] = []
    const meta = await this.readMeta(conversationId)
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue
      const st = await stat(join(dir, entry.name))
      const origin = meta[entry.name]
      out.push({
        path: entry.name, size: st.size, updatedAt: Math.round(st.mtimeMs),
        ...(origin?.prompt ? { prompt: origin.prompt } : {}),
        ...(origin?.source ? { source: origin.source } : {}),
        ...(origin?.tookMs !== undefined ? { tookMs: origin.tookMs } : {})
      })
    }
    // Свежие сверху: студия — про «что я только что нарисовал».
    return out.sort((a, b) => b.updatedAt - a.updatedAt || a.path.localeCompare(b.path, 'ru'))
  }

  async readBuffer(conversationId: string, rawPath: string): Promise<Buffer | null> {
    const name = safeName(rawPath)
    try {
      return await readFile(join(this.dirOf(conversationId), name))
    } catch {
      return null
    }
  }

  async writeBuffer(conversationId: string, rawPath: string, data: Buffer): Promise<ImageStudioFile> {
    const name = safeName(rawPath)
    assertImageBytes(name, data)
    if (data.byteLength > IMAGE_STUDIO_LIMITS.maxFileBytes) {
      throw new ImageStudioError('too_big', `Файл больше ${Math.round(IMAGE_STUDIO_LIMITS.maxFileBytes / 1024 / 1024)} МБ`)
    }
    const existing = await this.list(conversationId)
    const others = existing.filter((file) => file.path !== name).reduce((total, file) => total + file.size, 0)
    if (others + data.byteLength > IMAGE_STUDIO_LIMITS.maxConversationBytes) {
      throw new ImageStudioError('quota', 'Квота галереи исчерпана — удалите ненужные изображения')
    }
    await mkdir(this.dirOf(conversationId), { recursive: true })
    await writeFile(join(this.dirOf(conversationId), name), data)
    const st = await stat(join(this.dirOf(conversationId), name))
    return { path: name, size: st.size, updatedAt: Math.round(st.mtimeMs) }
  }

  /** Свободное имя: «кот.png», занято → «кот-2.png», «кот-3.png»… */
  async freeName(conversationId: string, rawPath: string): Promise<string> {
    const name = safeName(rawPath)
    const taken = new Set((await this.list(conversationId)).map((file) => file.path))
    if (!taken.has(name)) return name
    const dot = name.lastIndexOf('.')
    const base = name.slice(0, dot)
    const ext = name.slice(dot)
    for (let index = 2; ; index += 1) {
      const candidate = `${base}-${index}${ext}`
      if (!taken.has(candidate)) return candidate
    }
  }

  private trashDir(conversationId: string): string {
    return join(this.dirOf(conversationId), TRASH_DIR)
  }

  /** Удаление — мягкое: файл уезжает в корзину галереи и живёт там 7 дней. */
  async delete(conversationId: string, rawPath: string): Promise<void> {
    const name = safeName(rawPath)
    const abs = join(this.dirOf(conversationId), name)
    if (!existsSync(abs)) throw new ImageStudioError('not_found', `«${name}» не найден`)
    await mkdir(this.trashDir(conversationId), { recursive: true })
    await rename(abs, join(this.trashDir(conversationId), `${Date.now()}${TRASH_SEP}${name}`))
    const meta = await this.readMeta(conversationId)
    if (meta[name]) { delete meta[name]; await this.writeMeta(conversationId, meta) }
  }

  /**
   * Содержимое корзины (свежие сверху); заодно чистит записи старше TTL.
   * Размер отдаём вместе с именем: корзина занимает ту же квоту разговора, и
   * без веса вопрос «сколько освободит очистка» с экрана не ответить.
   */
  async listTrash(conversationId: string): Promise<Array<{ name: string; deletedAt: number; size: number }>> {
    const dir = this.trashDir(conversationId)
    if (!existsSync(dir)) return []
    const out: Array<{ name: string; deletedAt: number; size: number }> = []
    for (const entry of await readdir(dir)) {
      const sep = entry.indexOf(TRASH_SEP)
      if (sep <= 0) continue
      const deletedAt = Number(entry.slice(0, sep))
      const name = entry.slice(sep + TRASH_SEP.length)
      if (!Number.isFinite(deletedAt) || !isImageStudioPath(name)) continue
      if (Date.now() - deletedAt > TRASH_TTL_MS) {
        await rm(join(dir, entry), { force: true })
        continue
      }
      const size = await stat(join(dir, entry)).then((info) => info.size).catch(() => 0)
      out.push({ name, deletedAt, size })
    }
    return out.sort((a, b) => b.deletedAt - a.deletedAt)
  }

  /**
   * Чистит корзину: без имени — целиком, с именем — все экземпляры одного
   * файла. Корзина занимает ту же квоту разговора, а ждать неделю, когда
   * место нужно сейчас, — не выход.
   */
  async purgeTrash(conversationId: string, rawName?: string): Promise<number> {
    const dir = this.trashDir(conversationId)
    if (!existsSync(dir)) return 0
    const name = rawName ? safeName(rawName) : null
    let removed = 0
    for (const entry of await readdir(dir)) {
      const sep = entry.indexOf(TRASH_SEP)
      if (sep <= 0) continue
      if (name !== null && entry.slice(sep + TRASH_SEP.length) !== name) continue
      await rm(join(dir, entry), { force: true })
      removed += 1
    }
    if (name !== null && removed === 0) throw new ImageStudioError('not_found', `«${name}» нет в корзине`)
    return removed
  }

  /** Возвращает последний удалённый экземпляр `name` обратно в галерею. */
  async restore(conversationId: string, rawName: string): Promise<string> {
    const name = safeName(rawName)
    const dir = this.trashDir(conversationId)
    const entries = existsSync(dir) ? await readdir(dir) : []
    const candidates = entries
      .filter((entry) => entry.slice(entry.indexOf(TRASH_SEP) + TRASH_SEP.length) === name)
      .sort()
      .reverse()
    const entry = candidates[0]
    if (!entry) throw new ImageStudioError('not_found', `«${name}» нет в корзине`)
    const target = await this.freeName(conversationId, name)
    // Через writeBuffer нельзя (лимиты уже соблюдены при первичной записи), но
    // квоту уважить надо — восстановление тоже занимает место.
    const data = await readFile(join(dir, entry))
    const restored = await this.writeBuffer(conversationId, target, data)
    await rm(join(dir, entry), { force: true })
    return restored.path
  }

  /** Копирует или переносит файл в галерею другого разговора (имя — freeName). */
  async transfer(fromConversationId: string, rawPath: string, toConversationId: string, mode: 'move' | 'copy'): Promise<string> {
    const name = safeName(rawPath)
    const data = await this.readBuffer(fromConversationId, name)
    if (!data) throw new ImageStudioError('not_found', `«${name}» не найден`)
    const target = await this.freeName(toConversationId, name)
    await this.writeBuffer(toConversationId, target, data)
    const meta = await this.readMeta(fromConversationId)
    if (meta[name]) await this.setMeta(toConversationId, target, meta[name]!)
    if (mode === 'move') await this.delete(fromConversationId, name)
    return target
  }

  async rename(conversationId: string, rawFrom: string, rawTo: string): Promise<void> {
    const from = safeName(rawFrom)
    const to = safeName(rawTo)
    const dir = this.dirOf(conversationId)
    if (!existsSync(join(dir, from))) throw new ImageStudioError('not_found', `«${from}» не найден`)
    if (existsSync(join(dir, to))) throw new ImageStudioError('exists', `«${to}» уже есть в галерее`)
    await rename(join(dir, from), join(dir, to))
    const meta = await this.readMeta(conversationId)
    if (meta[from]) { meta[to] = meta[from]; delete meta[from]; await this.writeMeta(conversationId, meta) }
  }
}
