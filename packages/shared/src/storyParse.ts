// Разбор CSF-файла сториз (`*.stories.(jsx|tsx)`) без исполнения: имена стори — именованные
// экспорты по регулярке, `play` — грубо по телу экспорта. Нужен и Make (витрина мастерской),
// и панели компонентов репозитория проекта, поэтому лежит в общих утилитах, а не в Make.

import type { MakeStoryFile } from './make'

export function parseStoryFile(path: string, source: string): MakeStoryFile {
  const names: string[] = []
  for (const m of source.matchAll(/^export\s+(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (m[1] && !names.includes(m[1])) names.push(m[1])
  }
  const titleMatch = source.match(/title\s*:\s*(['"`])([^'"`]+)\1/)
  const fallback = path.slice(path.lastIndexOf('/') + 1).replace(/\.stories\.(jsx|tsx)$/i, '')
  // `export const X = { ..., play: ... }` — грубо: у экспорта между его началом и следующим `export` есть `play`.
  const withPlay: string[] = []
  for (let i = 0; i < names.length; i++) {
    const start = source.indexOf(`export`, source.search(new RegExp(`export\\s+(?:const|let|var|function)\\s+${names[i]}\\b`)))
    const nextExport = source.indexOf('\nexport', start + 6)
    const body = source.slice(start, nextExport < 0 ? undefined : nextExport)
    if (/\bplay\s*[:(]/.test(body)) withPlay.push(names[i]!)
  }
  return { path, title: titleMatch?.[2] ?? fallback, stories: names, withPlay }
}
