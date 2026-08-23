// Файловые операции проводника по машине агента. Работают с абсолютными путями,
// ограничены политикой машины: чтение/навигация — в allowedDirs (пусто = вся ФС),
// мутации — только при allowWrite. Best-effort (не полноценная песочница).

import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, posix, resolve, sep, win32 } from 'node:path'
import type { AgentPolicy, FsResult } from '@voicechat/shared'
import { isWindows } from './platform.js'

/** Лимит на чтение/запись одного файла (base64 раздувает ~на треть). */
export const FS_MAX_BYTES = 32 * 1024 * 1024

/** `/c/Users/x` → `C:\Users\x`; всё остальное — как есть. */
function fromMsysPath(path: string): string {
  // Только прямые слэши: `\c\Users` на Windows — нормальный путь от корня
  // текущего диска, а не MSYS-путь, и трогать его нельзя.
  const m = /^\/([A-Za-z])(?:\/(.*))?$/.exec(path)
  return m ? `${m[1].toUpperCase()}:\\${m[2] ?? ''}` : path
}

/**
 * Абсолютный нативный путь. На Windows дополнительно разворачивает MSYS/Git
 * Bash-пути диска (`/c/Users/x` → `C:\Users\x`): такие пути приходят от модели,
 * работающей в git-bash (см. MCP `bash` в docs/kb/machines.md), а `resolve()`
 * считал бы их путями от корня текущего диска и давал несуществующий
 * `C:\c\Users\x` → ENOENT на fs.read.
 *
 * На POSIX `/c/...` — обычный каталог, поэтому преобразование только на win32;
 * платформа параметром, чтобы win32-ветка проверялась на POSIX-CI.
 */
export function toNativePath(path: string, platform: NodeJS.Platform = process.platform): string {
  const win = isWindows(platform)
  const impl = win ? win32 : posix
  const abs = impl.resolve(win ? fromMsysPath(path.trim()) : path.trim())
  // Букву диска приводим к верхнему регистру: иначе `/c/...` и `c:\...` дали бы
  // разные строки и сравнение с allowedDirs зависело бы от регистра ввода.
  return win && /^[a-z]:/.test(abs) ? abs[0].toUpperCase() + abs.slice(1) : abs
}

/** Проверка доступа к пути по политике; кидает при нарушении. */
function assertAllowed(policy: AgentPolicy, abs: string, forWrite: boolean): void {
  if (forWrite && !policy.allowWrite) {
    throw new Error('изменение файлов запрещено политикой машины')
  }
  if (policy.allowedDirs.length > 0) {
    // На Windows ФС регистронезависима, поэтому и сравниваем без учёта регистра —
    // иначе `C:\Users` в политике не совпал бы с `c:\users` из запроса.
    const fold = (s: string): string => (isWindows() ? s.toLowerCase() : s)
    const target = fold(abs)
    const ok = policy.allowedDirs.some((d) => {
      // allowedDirs нормализуем той же функцией: в политику тоже могли записать
      // MSYS-путь, и сравнивать надо однородные абсолютные пути.
      const base = fold(toNativePath(d))
      return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep)
    })
    if (!ok) throw new Error('путь вне разрешённых каталогов машины')
  }
}

/** Абсолютный путь из запроса: пусто → корень; иначе — как есть (нормализуется). */
function absPath(root: string, path: string): string {
  return toNativePath(path && path.trim() ? path : root)
}

/** Листинг каталога → FsResult (переиспользуется после мутаций для обновления UI). */
function listResult(root: string, dir: string): FsResult {
  const entries = readdirSync(dir, { withFileTypes: true })
    .map((d) => {
      let size = 0
      let mtime = 0
      try {
        const st = lstatSync(resolve(dir, d.name))
        size = st.isFile() ? st.size : 0
        mtime = st.mtimeMs
      } catch {
        /* недоступный элемент — показываем с нулями */
      }
      const kind = d.isSymbolicLink() ? ('symlink' as const) : d.isDirectory() ? ('dir' as const) : d.isFile() ? ('file' as const) : ('other' as const)
      return { name: d.name, kind, size, mtime }
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

/** Удаляет только подтверждённый обычный файл; симлинки и каталоги не затрагивает. */
export function fsDeleteFileSafe(root: string, policy: AgentPolicy, path: string): FsResult {
  const abs = absPath(root, path)
  assertAllowed(policy, abs, true)
  const st = lstatSync(abs)
  if (!st.isFile() || st.isSymbolicLink()) throw new Error('безопасное удаление разрешено только для обычного файла')
  unlinkSync(abs)
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
