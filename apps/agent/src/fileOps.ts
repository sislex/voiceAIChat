// Файловые операции проводника по машине агента. Работают с абсолютными путями,
// ограничены политикой машины: чтение/навигация — в allowedDirs (пусто = вся ФС),
// мутации — только при allowWrite. Best-effort (не полноценная песочница).

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, resolve, sep } from 'node:path'
import type { AgentPolicy, FsResult } from '@voicechat/shared'

/** Лимит на чтение/запись одного файла (base64 раздувает ~на треть). */
export const FS_MAX_BYTES = 32 * 1024 * 1024

/** Проверка доступа к пути по политике; кидает при нарушении. */
function assertAllowed(policy: AgentPolicy, abs: string, forWrite: boolean): void {
  if (forWrite && !policy.allowWrite) {
    throw new Error('изменение файлов запрещено политикой машины')
  }
  if (policy.allowedDirs.length > 0) {
    const ok = policy.allowedDirs.some((d) => {
      const base = resolve(d)
      return abs === base || abs.startsWith(base.endsWith(sep) ? base : base + sep)
    })
    if (!ok) throw new Error('путь вне разрешённых каталогов машины')
  }
}

/** Абсолютный путь из запроса: пусто → корень; иначе — как есть (нормализуется). */
function absPath(root: string, path: string): string {
  return resolve(path && path.trim() ? path : root)
}

/** Листинг каталога → FsResult (переиспользуется после мутаций для обновления UI). */
function listResult(root: string, dir: string): FsResult {
  const entries = readdirSync(dir, { withFileTypes: true })
    .map((d) => {
      let size = 0
      let mtime = 0
      try {
        const st = statSync(resolve(dir, d.name))
        size = st.isDirectory() ? 0 : st.size
        mtime = st.mtimeMs
      } catch {
        /* недоступный элемент — показываем с нулями */
      }
      return { name: d.name, kind: d.isDirectory() ? ('dir' as const) : ('file' as const), size, mtime }
    })
    // Каталоги сверху, затем по имени.
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
  return { root, cwd: dir, entries }
}

export function fsList(root: string, policy: AgentPolicy, path: string): FsResult {
  const dir = absPath(root, path)
  assertAllowed(policy, dir, false)
  return listResult(root, dir)
}

export function fsRead(root: string, policy: AgentPolicy, path: string): FsResult {
  const abs = absPath(root, path)
  assertAllowed(policy, abs, false)
  const st = statSync(abs)
  if (st.isDirectory()) throw new Error('это каталог, а не файл')
  if (st.size > FS_MAX_BYTES) throw new Error('файл слишком большой для скачивания')
  return { root, cwd: dirname(abs), dataBase64: readFileSync(abs).toString('base64'), name: basename(abs) }
}

export function fsWrite(root: string, policy: AgentPolicy, path: string, dataBase64: string): FsResult {
  const abs = absPath(root, path)
  assertAllowed(policy, abs, true)
  const buf = Buffer.from(dataBase64, 'base64')
  if (buf.length > FS_MAX_BYTES) throw new Error('файл слишком большой для загрузки')
  writeFileSync(abs, buf)
  return listResult(root, dirname(abs))
}

export function fsDelete(root: string, policy: AgentPolicy, path: string): FsResult {
  const abs = absPath(root, path)
  assertAllowed(policy, abs, true)
  rmSync(abs, { recursive: true, force: true })
  return listResult(root, dirname(abs))
}

export function fsRename(root: string, policy: AgentPolicy, from: string, to: string): FsResult {
  const absFrom = absPath(root, from)
  const absTo = absPath(root, to)
  assertAllowed(policy, absFrom, true)
  assertAllowed(policy, absTo, true)
  renameSync(absFrom, absTo)
  return listResult(root, dirname(absTo))
}

export function fsMkdir(root: string, policy: AgentPolicy, path: string): FsResult {
  const abs = absPath(root, path)
  assertAllowed(policy, abs, true)
  mkdirSync(abs, { recursive: true })
  // Возвращаем листинг РОДИТЕЛЯ — чтобы новая папка была видна в текущем каталоге,
  // а не «проваливаться» в пустую только что созданную.
  return listResult(root, dirname(abs))
}
