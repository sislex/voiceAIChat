import { readdirSync, statSync, openSync, readSync, closeSync, readFileSync, watch } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  parseCcTranscript,
  parseCcLine,
  ccSessionUsage,
  ccSessionTitle,
  ccCwdFromHead,
  type CcProject,
  type CcSession,
  type CcItem,
  type SessionUsage
} from '@voicechat/shared'

export function ccBaseDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.VC_CC_DIR ?? join(homedir(), '.claude', 'projects')
}

function safeName(name: string): boolean {
  return name.length > 0 && !name.includes('/') && !name.includes('\\') && !name.includes('..')
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

export function sessionPath(slug: string, id: string, baseDir = ccBaseDir()): string | null {
  if (!safeName(slug) || !safeName(id)) return null
  return join(baseDir, slug, `${id}.jsonl`)
}

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

export function readUsage(slug: string, id: string, baseDir = ccBaseDir()): SessionUsage {
  const p = sessionPath(slug, id, baseDir)
  if (!p) return {}
  try {
    return ccSessionUsage(readFileSync(p, 'utf8'))
  } catch {
    return {}
  }
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

function initialOffset(path: string, startOffset?: number): number {
  try {
    const size = statSync(path).size
    if (typeof startOffset !== 'number' || !Number.isFinite(startOffset) || startOffset < 0) return size
    return Math.min(startOffset, size)
  } catch {
    return 0
  }
}

export function watchTranscriptFromOffset(
  slug: string,
  id: string,
  startOffset: number | undefined,
  onItems: (items: CcItem[], nextOffset: number) => void,
  baseDir = ccBaseDir()
): () => void {
  const p = sessionPath(slug, id, baseDir)
  if (!p) return () => {}
  let offset = initialOffset(p, startOffset)
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
    if (items.length > 0) onItems(items, offset)
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
      /* already closed */
    }
  }
}

export function watchTranscript(
  slug: string,
  id: string,
  onItems: (items: CcItem[]) => void,
  baseDir = ccBaseDir()
): () => void {
  return watchTranscriptFromOffset(slug, id, undefined, (items) => onItems(items), baseDir)
}
