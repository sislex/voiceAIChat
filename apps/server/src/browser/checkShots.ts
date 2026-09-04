// Кадры браузерной проверки: файл на диске, ссылка в строке лога рана.
//
// Base64 в лог не кладём: строка кадра — сотни килобайт, а лента реплеится
// целиком после каждого reconnect. По той же причине снимок вердикта
// Playwright-этапа лежит файлом (см. `ci/qaScreenshots.ts`); отличие только в
// том, что проверок за ран много, поэтому кадры нумеруются внутри каталога рана.

import { mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REST } from '@voicechat/shared'

/** Имя кадра — только номер: любое другое имя в путь к файлу не попадает. */
const SHOT_NAME = /^(\d+)\.png$/

export function isBrowserShotName(name: string): boolean {
  return SHOT_NAME.test(name)
}

/** Следующий номер кадра в каталоге рана; дырки в нумерации не переиспользуются. */
export function nextBrowserShotIndex(names: string[]): number {
  let max = 0
  for (const name of names) {
    const match = SHOT_NAME.exec(name)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return max + 1
}

export interface SavedBrowserShot {
  name: string
  url: string
  path: string
}

/**
 * Сохраняет кадр рана и возвращает имя с публичной ссылкой; `null` — записать
 * не удалось (диск, права), и это не повод ронять действие модели: снимок она
 * уже получила в ответе инструмента.
 */
export function saveBrowserShot(root: string, runId: string, png: Buffer): SavedBrowserShot | null {
  try {
    const dir = join(root, runId)
    mkdirSync(dir, { recursive: true })
    const name = `${nextBrowserShotIndex(readdirSync(dir))}.png`
    const path = join(dir, name)
    writeFileSync(path, png)
    return { name, url: REST.ciRunBrowserShot(runId, name), path }
  } catch {
    return null
  }
}

/** Чтение кадра для REST-отдачи; `null` — нет файла или имя не наше. */
export function readBrowserShot(root: string, runId: string, name: string): Buffer | null {
  if (!isBrowserShotName(name)) return null
  try { return readFileSync(join(root, runId, name)) } catch { return null }
}

export interface BrowserShotSweepInput {
  root: string
  /** Раны, которые ещё существуют в БД; каталоги остальных удаляются целиком. */
  knownRunIds: Set<string>
  maxAgeMs: number
  now?: () => number
}

/** Что подлежит удалению — отдельно от удаления, чтобы проверять решение. */
export function planBrowserShotSweep(
  runs: Array<{ runId: string; modifiedAt: number }>,
  input: Pick<BrowserShotSweepInput, 'knownRunIds' | 'maxAgeMs'> & { now: number }
): string[] {
  return runs
    .filter((run) => !input.knownRunIds.has(run.runId) || input.now - run.modifiedAt >= input.maxAgeMs)
    .map((run) => run.runId)
}

/** Возвращает число удалённых каталогов; отсутствие корня — не ошибка. */
export function sweepBrowserShots(input: BrowserShotSweepInput): number {
  const now = (input.now ?? Date.now)()
  let runs: Array<{ runId: string; modifiedAt: number }>
  try {
    runs = readdirSync(input.root).map((runId) => ({ runId, modifiedAt: statSync(join(input.root, runId)).mtimeMs }))
  } catch { return 0 }
  let removed = 0
  for (const runId of planBrowserShotSweep(runs, { knownRunIds: input.knownRunIds, maxAgeMs: input.maxAgeMs, now })) {
    const dir = join(input.root, runId)
    try {
      for (const name of readdirSync(dir)) unlinkSync(join(dir, name))
      // Пустой каталог тоже убираем: иначе корень копил бы по папке на каждый ран.
      rmdirSync(dir)
      removed++
    } catch { /* каталог мог исчезнуть между чтением и удалением */ }
  }
  return removed
}
