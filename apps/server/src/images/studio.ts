// Хранилище студии картинок: плоская галерея файлов на разговор в
// `<dataDir>/image-studio/<conversationId>/`. Намеренно проще мастерской Make:
// без снимков, публикаций и транспиляции — картинке нужны список, байты,
// запись, переименование и удаление, остальное — работа модели и панели.
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IMAGE_STUDIO_LIMITS, isImageStudioPath, type ImageStudioFile } from '@voicechat/shared'

export class ImageStudioError extends Error {
  constructor(readonly code: 'bad_path' | 'not_found' | 'too_big' | 'quota' | 'exists', message: string) {
    super(message)
  }
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

export class ImageStudioStore {
  constructor(private readonly rootDir: string) {}

  private dirOf(conversationId: string): string {
    return join(this.rootDir, conversationId)
  }

  async list(conversationId: string): Promise<ImageStudioFile[]> {
    const dir = this.dirOf(conversationId)
    if (!existsSync(dir)) return []
    const out: ImageStudioFile[] = []
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue
      const st = await stat(join(dir, entry.name))
      out.push({ path: entry.name, size: st.size, updatedAt: Math.round(st.mtimeMs) })
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

  async delete(conversationId: string, rawPath: string): Promise<void> {
    const name = safeName(rawPath)
    const abs = join(this.dirOf(conversationId), name)
    if (!existsSync(abs)) throw new ImageStudioError('not_found', `«${name}» не найден`)
    await rm(abs)
  }

  async rename(conversationId: string, rawFrom: string, rawTo: string): Promise<void> {
    const from = safeName(rawFrom)
    const to = safeName(rawTo)
    const dir = this.dirOf(conversationId)
    if (!existsSync(join(dir, from))) throw new ImageStudioError('not_found', `«${from}» не найден`)
    if (existsSync(join(dir, to))) throw new ImageStudioError('exists', `«${to}» уже есть в галерее`)
    await rename(join(dir, from), join(dir, to))
  }
}
