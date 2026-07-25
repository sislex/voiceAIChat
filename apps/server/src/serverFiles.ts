// Чтение файла с диска СЕРВЕРА по абсолютному пути — для картинок, которые
// создаёт сам CLI (например встроенный инструмент Codex пишет их в
// `<профиль>/.codex/generated_images/<сессия>/<call-id>.png`). Такой файл лежит
// не на машине-агенте, поэтому `fs.read` агента его не найдёт.
//
// Отдавать наружу произвольный путь нельзя: роут закрыт токеном, но пользователь
// не должен читать ни чужой профиль, ни системные файлы контейнера. Поэтому путь
// обязан лежать внутри явного списка «своих» корней, и проверяется он ПОСЛЕ
// разыменования симлинков — иначе ссылка внутри профиля выводит куда угодно.

import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, resolve, sep } from 'node:path'

/** Лимит на файл — как у проводника машины (base64 раздувает ещё на треть). */
export const SERVER_FILE_MAX_BYTES = 32 * 1024 * 1024

export interface ServerFileContent {
  name: string
  dataBase64: string
}

/** Лежит ли `abs` внутри `root` (сам корень тоже считается своим). */
function inside(abs: string, root: string): boolean {
  return abs === root || abs.startsWith(root.endsWith(sep) ? root : root + sep)
}

/**
 * Приводит запрошенный путь к реальному и проверяет, что он внутри одного из
 * корней. Возвращает абсолютный путь или null (наружу — только null, без
 * подробностей: по тексту ошибки не должно быть видно, что где лежит).
 */
export function resolveUserFile(path: string, roots: string[]): string | null {
  if (!path || !path.trim()) return null
  let abs: string
  try {
    // realpath и для пути, и для корней: симлинк внутри профиля не должен
    // становиться дырой наружу, а сам корень может быть ссылкой (напр. /data).
    abs = realpathSync(resolve(path))
  } catch {
    return null
  }
  for (const root of roots) {
    let realRoot: string
    try {
      realRoot = realpathSync(resolve(root))
    } catch {
      continue // корня ещё нет (профиль не создан) — просто пропускаем
    }
    if (inside(abs, realRoot)) return abs
  }
  return null
}

/** Причина отказа — для кода ответа; текст наружу не уходит. */
export type ReadFailure = 'not-found' | 'too-large' | 'not-a-file'

/**
 * Читает файл из «своей» области. Всё, что вне корней или недоступно, — это
 * одинаковый `not-found`: наличие чужого файла не подтверждаем.
 */
export function readUserFile(
  path: string,
  roots: string[]
): { ok: true; file: ServerFileContent } | { ok: false; reason: ReadFailure } {
  const abs = resolveUserFile(path, roots)
  if (!abs) return { ok: false, reason: 'not-found' }
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(abs)
  } catch {
    return { ok: false, reason: 'not-found' }
  }
  if (st.isDirectory()) return { ok: false, reason: 'not-a-file' }
  if (st.size > SERVER_FILE_MAX_BYTES) return { ok: false, reason: 'too-large' }
  return { ok: true, file: { name: basename(abs), dataBase64: readFileSync(abs).toString('base64') } }
}
