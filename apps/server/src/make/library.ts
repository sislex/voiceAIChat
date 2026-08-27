// Личная библиотека компонентов Make (п.17): пользователь сохраняет компонент (файл + сториз +
// связанные файлы) из одного проекта и вставляет в другой. Хранится вне проектов:
// `<dataDir>/make-library/<userKey>/<slug>/{meta.json, files/…}`. Без кросс-пользовательского
// доступа: ключ каталога — base64url логина, как у профилей CLI.

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { normalizeMakePath, type MakeLibraryItem } from '@voicechat/shared'
import { MakeError } from './workspace.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/

export function librarySlug(name: string): string {
  const base = name.trim().toLowerCase().replace(/\.(jsx|tsx|js|ts)$/i, '').replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '')
  const translit = base.replace(/[а-яё]/g, (ch) => ({ а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' } as Record<string, string>)[ch] ?? '')
  return (translit || 'component').slice(0, 60)
}

export class MakeLibrary {
  constructor(private readonly rootDir: string) {}

  private userDir(userId: string): string {
    return join(this.rootDir, 'make-library', Buffer.from(userId, 'utf8').toString('base64url'))
  }

  async list(userId: string): Promise<MakeLibraryItem[]> {
    const dir = this.userDir(userId)
    if (!existsSync(dir)) return []
    const out: MakeLibraryItem[] = []
    for (const slug of await readdir(dir)) {
      try { out.push(JSON.parse(await readFile(join(dir, slug, 'meta.json'), 'utf8')) as MakeLibraryItem) } catch { /* битый элемент */ }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** Сохранить набор файлов под именем; повторное сохранение с тем же slug перезаписывает. */
  async save(userId: string, name: string, files: Array<{ path: string; data: Buffer }>, sourceConversationId: string): Promise<MakeLibraryItem> {
    const slug = librarySlug(name)
    if (!SLUG_RE.test(slug)) throw new MakeError('invalid_path', 'Некорректное имя компонента')
    if (files.length === 0) throw new MakeError('invalid_path', 'Нет файлов для сохранения')
    const dir = join(this.userDir(userId), slug)
    await rm(join(dir, 'files'), { recursive: true, force: true })
    let bytes = 0
    for (const f of files) {
      const path = normalizeMakePath(f.path)
      if (!path) continue
      const abs = join(dir, 'files', ...path.split('/'))
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, f.data)
      bytes += f.data.byteLength
    }
    const item: MakeLibraryItem = { slug, name: name.trim().slice(0, 80), files: files.map((f) => f.path), bytes, sourceConversationId, updatedAt: Date.now() }
    await writeFile(join(dir, 'meta.json'), JSON.stringify(item), 'utf8')
    return item
  }

  async files(userId: string, slug: string): Promise<Array<{ path: string; data: Buffer }>> {
    if (!SLUG_RE.test(slug)) throw new MakeError('not_found', 'Компонент не найден')
    const root = join(this.userDir(userId), slug, 'files')
    if (!existsSync(root)) throw new MakeError('not_found', 'Компонент не найден')
    const out: Array<{ path: string; data: Buffer }> = []
    const walk = async (dir: string, rel: string): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const next = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) await walk(join(dir, e.name), next)
        else if ((await stat(join(dir, e.name))).isFile()) out.push({ path: next, data: await readFile(join(dir, e.name)) })
      }
    }
    await walk(root, '')
    return out
  }

  async remove(userId: string, slug: string): Promise<void> {
    if (!SLUG_RE.test(slug)) return
    await rm(join(this.userDir(userId), slug), { recursive: true, force: true })
  }
}
