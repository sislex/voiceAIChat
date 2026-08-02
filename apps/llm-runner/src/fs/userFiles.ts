import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, resolve, sep } from 'node:path'

export const RUNNER_FILE_MAX_BYTES = 32 * 1024 * 1024

export interface RunnerFileContent {
  name: string
  dataBase64: string
}

function inside(abs: string, root: string): boolean {
  return abs === root || abs.startsWith(root.endsWith(sep) ? root : root + sep)
}

export function resolveUserFile(path: string, roots: string[]): string | null {
  if (!path || !path.trim()) return null
  let abs: string
  try {
    abs = realpathSync(resolve(path))
  } catch {
    return null
  }
  for (const root of roots) {
    let realRoot: string
    try {
      realRoot = realpathSync(resolve(root))
    } catch {
      continue
    }
    if (inside(abs, realRoot)) return abs
  }
  return null
}

export type ReadFailure = 'not-found' | 'too-large' | 'not-a-file'

export function readUserFile(
  path: string,
  roots: string[]
): { ok: true; file: RunnerFileContent } | { ok: false; reason: ReadFailure } {
  const abs = resolveUserFile(path, roots)
  if (!abs) return { ok: false, reason: 'not-found' }
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(abs)
  } catch {
    return { ok: false, reason: 'not-found' }
  }
  if (st.isDirectory()) return { ok: false, reason: 'not-a-file' }
  if (st.size > RUNNER_FILE_MAX_BYTES) return { ok: false, reason: 'too-large' }
  return { ok: true, file: { name: basename(abs), dataBase64: readFileSync(abs).toString('base64') } }
}
