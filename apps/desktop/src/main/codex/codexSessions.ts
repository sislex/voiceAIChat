// Чтение сессий Codex CLI из ~/.codex/sessions (read-only).
// Чистый парсинг — из @shared/codexSessions; здесь только доступ к ФС.
// Структура: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl.

import { readdirSync, statSync, openSync, readSync, closeSync, readFileSync, watch } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  parseCxTranscript,
  parseCxLine,
  cxSessionTitle,
  cxMetaFromHead,
  type CxProject,
  type CxSession,
  type CxItem
} from '@shared/codexSessions'

/** Каталог сессий Codex (env VC_CODEX_DIR → иначе ~/.codex/sessions). */
export function codexBaseDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.VC_CODEX_DIR ?? join(homedir(), '.codex', 'sessions')
}

/** Защита id от обхода пути: uuid — только [0-9a-fA-F-]. */
function safeCxId(id: string): boolean {
  return id.length > 0 && /^[0-9a-fA-F-]+$/.test(id)
}

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

interface RolloutFile {
  path: string
  name: string
  mtime: number
  size: number
}

function rolloutFiles(baseDir: string): RolloutFile[] {
  const out: RolloutFile[] = []
  const walk = (dir: string, depth: number): void => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (depth < 4) walk(p, depth + 1)
      } else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) {
        try {
          const st = statSync(p)
          out.push({ path: p, name: e.name, mtime: st.mtimeMs, size: st.size })
        } catch {
          /* пропуск */
        }
      }
    }
  }
  walk(baseDir, 0)
  return out
}

function sessionIdOf(file: RolloutFile, head: string): string {
  const meta = cxMetaFromHead(head)
  if (meta?.id) return meta.id
  const m = /-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.jsonl$/.exec(
    file.name
  )
  return m ? m[1] : file.name.replace(/\.jsonl$/, '')
}

/** «Проекты» Codex — группировка сессий по cwd, новые сверху. */
export function listCxProjects(baseDir = codexBaseDir()): CxProject[] {
  const files = rolloutFiles(baseDir)
  const byCwd = new Map<string, { count: number; lastActivity: number }>()
  for (const f of files) {
    const meta = cxMetaFromHead(readHead(f.path))
    const cwd = meta?.cwd
    if (!cwd) continue
    const cur = byCwd.get(cwd)
    if (cur) {
      cur.count += 1
      if (f.mtime > cur.lastActivity) cur.lastActivity = f.mtime
    } else {
      byCwd.set(cwd, { count: 1, lastActivity: f.mtime })
    }
  }
  const projects: CxProject[] = []
  for (const [cwd, v] of byCwd) {
    const name = cwd.split('/').filter(Boolean).pop() ?? cwd
    projects.push({ cwd, name, sessionCount: v.count, lastActivity: v.lastActivity })
  }
  return projects.sort((a, b) => b.lastActivity - a.lastActivity)
}

/** Сессии с указанным cwd, новые сверху. */
export function listCxSessions(cwd: string, baseDir = codexBaseDir()): CxSession[] {
  if (!cwd) return []
  const files = rolloutFiles(baseDir)
  const sessions: CxSession[] = []
  for (const f of files) {
    const head = readHead(f.path)
    const meta = cxMetaFromHead(head)
    if (meta?.cwd !== cwd) continue
    sessions.push({
      id: sessionIdOf(f, head),
      title: cxSessionTitle(head),
      updatedAt: f.mtime,
      sizeBytes: f.size
    })
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Абсолютный путь к rollout-файлу сессии по id (или null). */
export function resolveCxSessionPath(id: string, baseDir = codexBaseDir()): string | null {
  if (!safeCxId(id)) return null
  const suffix = `-${id}.jsonl`
  const hit = rolloutFiles(baseDir).find((f) => f.name.endsWith(suffix))
  return hit ? hit.path : null
}

/** Транскрипт сессии Codex — последние `limit` записей. */
export function readCxTranscript(
  id: string,
  opts: { limit?: number } = {},
  baseDir = codexBaseDir()
): CxItem[] {
  const p = resolveCxSessionPath(id, baseDir)
  if (!p) return []
  let text: string
  try {
    text = readFileSync(p, 'utf8')
  } catch {
    return []
  }
  const items = parseCxTranscript(text)
  const limit = opts.limit ?? 2000
  return items.length > limit ? items.slice(-limit) : items
}

function readAppended(path: string, offset: number): { text: string; next: number } {
  try {
    const size = statSync(path).size
    if (size <= offset) return { text: '', next: size }
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

/** Live-tail сессии Codex: отдаёт НОВЫЕ записи. Возвращает функцию остановки. */
export function watchCxTranscript(
  id: string,
  onItems: (items: CxItem[]) => void,
  baseDir = codexBaseDir()
): () => void {
  const p = resolveCxSessionPath(id, baseDir)
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
    const items: CxItem[] = []
    for (const line of complete.split('\n')) items.push(...parseCxLine(line))
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
