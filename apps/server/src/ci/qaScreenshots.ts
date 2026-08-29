// Уборка снимков вердикта Playwright-этапа.
//
// Снимок пишется на каждый прогон в `<dataDir>/qa-screenshots/<runId>.png` и до
// этого модуля не удалялся никогда: ни при удалении задачи (каскад чистит
// строку рана, но не файл), ни по возрасту. На проде переполнение диска уже
// случалось, так что растущий без предела каталог — не теория.

import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export interface QaScreenshotSweepInput {
  dir: string
  /** Раны, которые ещё существуют в БД; снимки остальных удаляются. */
  knownRunIds: Set<string>
  /** Возраст, после которого снимок удаляется независимо от наличия рана. */
  maxAgeMs: number
  now?: () => number
}

/** Что подлежит удалению — отдельно от самого удаления, чтобы проверять решение. */
export function planQaScreenshotSweep(
  files: Array<{ name: string; modifiedAt: number }>,
  input: Pick<QaScreenshotSweepInput, 'knownRunIds' | 'maxAgeMs'> & { now: number }
): string[] {
  return files
    .filter((file) => file.name.endsWith('.png'))
    .filter((file) => {
      const runId = file.name.slice(0, -'.png'.length)
      // Осиротевший снимок удаляется сразу: рана нет, показать его негде.
      if (!input.knownRunIds.has(runId)) return true
      return input.now - file.modifiedAt >= input.maxAgeMs
    })
    .map((file) => file.name)
}

/** Возвращает число удалённых файлов; отсутствие каталога — не ошибка. */
export function sweepQaScreenshots(input: QaScreenshotSweepInput): number {
  const now = (input.now ?? Date.now)()
  let files: Array<{ name: string; modifiedAt: number }>
  try {
    files = readdirSync(input.dir).map((name) => ({ name, modifiedAt: statSync(join(input.dir, name)).mtimeMs }))
  } catch { return 0 }
  const doomed = planQaScreenshotSweep(files, { knownRunIds: input.knownRunIds, maxAgeMs: input.maxAgeMs, now })
  let removed = 0
  for (const name of doomed) {
    try { unlinkSync(join(input.dir, name)); removed++ } catch { /* файл уже унесли — не беда */ }
  }
  return removed
}
