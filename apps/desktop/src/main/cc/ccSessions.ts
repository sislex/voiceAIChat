// Чтение сессий Claude Code из ~/.claude/projects (read-only).
// Чистый парсинг — из @shared/cc; здесь только доступ к ФС.

import { readdirSync, statSync, openSync, readSync, closeSync, readFileSync, watch } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  parseCcTranscript,
  parseCcLine,
  ccSessionTitle,
  ccCwdFromHead,
  type CcProject,
  type CcSession,
  type CcItem
} from '@shared/cc'

/** Каталог проектов Claude Code (env VC_CC_DIR → иначе ~/.claude/projects). */
export function ccBaseDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.VC_CC_DIR ?? join(homedir(), '.claude', 'projects')
}

/** Защита от обхода пути: slug/id — только «плоские» имена. */
function safeName(name: string): boolean {
  return name.length > 0 && !name.includes('/') && !name.includes('\\') && !name.includes('..')
}

/** Первые `bytes` байт файла как utf8 (для заголовка/cwd без чтения целиком). */
function readHead(path: string, bytes = 65_536): string {
  try {
    const fd = openSync(path, 'r')
    try {
      const buf = Buffer.alloc(bytes)
      const n = readSync(fd, buf, 0, bytes, 0)
      return buf.subarray(0, n).toString('utf8')
    } finally {
      closeSync(fd)
    }
  } catch {
    return ''
  }
}

interface SessionFile {
  id: string
  path: string
  mtime: number
  size: number
}

function sessionFiles(dir: string): SessionFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const p = join(dir, f)
      const st = statSync(p)
      return { id: f.slice(0, -'.jsonl'.length), path: p, mtime: st.mtimeMs, size: st.size }
    })
}

/** Список проектов (папок с сессиями), отсортирован по последней активности. */
export function listProjects(baseDir = ccBaseDir()): CcProject[] {
  let slugs: string[]
  try {
    slugs = readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
  const projects: CcProject[] = []
  for (const slug of slugs) {
    let files: SessionFile[]
    try {
      files = sessionFiles(join(baseDir, slug))
    } catch {
      continue
    }
    if (files.length === 0) continue
    files.sort((a, b) => b.mtime - a.mtime)
    const path = ccCwdFromHead(readHead(files[0].path)) ?? slug
    const name = path.split('/').filter(Boolean).pop() ?? slug
    projects.push({ slug, path, name, sessionCount: files.length, lastActivity: files[0].mtime })
  }
  return projects.sort((a, b) => b.lastActivity - a.lastActivity)
}

/** Сессии проекта, новые сверху. */
export function listSessions(slug: string, baseDir = ccBaseDir()): CcSession[] {
  if (!safeName(slug)) return []
  let files: SessionFile[]
  try {
    files = sessionFiles(join(baseDir, slug))
  } catch {
    return []
  }
  return files
    .sort((a, b) => b.mtime - a.mtime)
    .map((f) => ({
      id: f.id,
      title: ccSessionTitle(readHead(f.path)),
      updatedAt: f.mtime,
      sizeBytes: f.size
    }))
}

/** Абсолютный путь к файлу сессии (или null, если имена небезопасны). */
export function sessionPath(slug: string, id: string, baseDir = ccBaseDir()): string | null {
  if (!safeName(slug) || !safeName(id)) return null
  return join(baseDir, slug, `${id}.jsonl`)
}

/** Транскрипт сессии — последние `limit` записей. */
export function readTranscript(
  slug: string,
  id: string,
  opts: { limit?: number } = {},
  baseDir = ccBaseDir()
): CcItem[] {
  const p = sessionPath(slug, id, baseDir)
  if (!p) return []
  let text: string
  try {
    text = readFileSync(p, 'utf8')
  } catch {
    return []
  }
  const items = parseCcTranscript(text)
  const limit = opts.limit ?? 2000
  return items.length > limit ? items.slice(-limit) : items
}

/** Читает добавленные с `offset` байты файла; возвращает текст и новый offset. */
function readAppended(path: string, offset: number): { text: string; next: number } {
  try {
    const size = statSync(path).size
    if (size <= offset) return { text: '', next: size } // не вырос (или усечён)
    const fd = openSync(path, 'r')
    try {
      const len = size - offset
      const buf = Buffer.alloc(len)
      const n = readSync(fd, buf, 0, len, offset)
      return { text: buf.subarray(0, n).toString('utf8'), next: offset + n }
    } finally {
      closeSync(fd)
    }
  } catch {
    return { text: '', next: offset }
  }
}

/**
 * Live-tail: следит за файлом сессии и отдаёт НОВЫЕ записи (появившиеся после
 * старта). Возвращает функцию остановки. Ошибки/отсутствие файла — тихо.
 */
export function watchTranscript(
  slug: string,
  id: string,
  onItems: (items: CcItem[]) => void,
  baseDir = ccBaseDir()
): () => void {
  const p = sessionPath(slug, id, baseDir)
  if (!p) return () => {}
  let offset = (() => {
    try {
      return statSync(p).size
    } catch {
      return 0
    }
  })()
  let leftover = ''
  const onChange = (): void => {
    const { text, next } = readAppended(p, offset)
    offset = next
    if (!text) return
    const buf = leftover + text
    const nl = buf.lastIndexOf('\n')
    if (nl < 0) {
      leftover = buf
      return
    }
    const complete = buf.slice(0, nl)
    leftover = buf.slice(nl + 1)
    const items: CcItem[] = []
    for (const line of complete.split('\n')) items.push(...parseCcLine(line))
    if (items.length > 0) onItems(items)
  }
  let watcher: ReturnType<typeof watch> | null = null
  try {
    watcher = watch(p, { persistent: false }, onChange)
  } catch {
    return () => {}
  }
  return () => {
    try {
      watcher?.close()
    } catch {
      /* уже закрыт */
    }
  }
}
