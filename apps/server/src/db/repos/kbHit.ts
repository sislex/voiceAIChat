/** Извлечение открытых моделью файлов и подсчёт попадания разделов БЗ. */

export interface KbDeliveredSection {
  documentId: string
  anchor: string
  relatedFiles: string[]
}

export interface CiKbHitMetric {
  sectionsDelivered: number
  sectionsHit: number
  hitRatio: number
}

function cleanPath(value: string): string {
  return value.trim().replace(/^(?:file_path|path)=/i, '').replace(/^["'`]+|["'`,;:)\]}]+$/g, '').replaceAll('\\\\', '/').replace(/^\.\//, '')
}

function looksLikePath(value: string): boolean {
  const v = cleanPath(value)
  return Boolean(v) && !v.startsWith('-') && (v.includes('/') || /\.[a-z0-9]{1,10}$/i.test(v))
}

function shellWords(command: string): string[] {
  return [...command.matchAll(/"([^"]*)"|'([^']*)'|([^\s|;&]+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '')
}

/** Основной формат — Read/Grep/Edit; bash-команды остаются запасным источником. */
export function filesReadFromCiLog(chunks: string[]): Set<string> {
  const files = new Set<string>()
  const add = (value: string): void => {
    const path = cleanPath(value)
    if (looksLikePath(path)) files.add(path)
  }
  for (const chunk of chunks) {
    for (const line of chunk.split('\n')) {
      if (!line) continue
      const tool = line.match(/\[tool_use\]\s+(?:mcp__[^_]+__)?(read|grep|edit)\b/i)
      if (tool) {
        for (const m of line.matchAll(/(?:file_path|path|files?)["']?\s*[=:]\s*["']?([^"'\s,}\]]+)/gi)) add(m[1])
        const direct = line.match(/\b(?:Read|Edit)\s*:\s*([^\s{]+)/i)
        if (direct) add(direct[1])
        const grepPath = line.match(/\bGrep\s*:.*?\s+in\s+([^\s{]+)/i)
        if (grepPath) add(grepPath[1])
      }
      const bash = line.match(/\[tool_use\]\s+(?:mcp__remote__)?bash\s*:\s*(.*)$/i)
        ?? line.match(/^\s*\$\s+(.*)$/)
      if (!bash) continue
      for (const command of bash[1].split(/&&|\|\||;/)) {
        const words = shellWords(command.trim())
        const index = words.findIndex((w) => /^(?:cat|sed|head|tail|grep)$/.test(w.replace(/^.*\//, '')))
        if (index < 0) continue
        for (const word of words.slice(index + 1)) if (looksLikePath(word)) add(word)
      }
    }
  }
  return files
}

function pathMatches(opened: string, area: string): boolean {
  const file = cleanPath(opened).replace(/^\/+/, '')
  const related = cleanPath(area).replace(/^\/+/, '').replace(/\*\*?\/?.*$/, '').replace(/\/$/, '')
  if (!related) return false
  return file === related || file.endsWith(`/${related}`) || file.startsWith(`${related}/`) || file.includes(`/${related}/`)
}

/** Один выданный раздел считается попавшим, если открыт хотя бы один его area. */
export function calculateKbHit(sections: KbDeliveredSection[], openedFiles: Iterable<string>): CiKbHitMetric | null {
  if (!sections.length) return null
  const opened = [...openedFiles]
  const hit = sections.filter((section) => section.relatedFiles.some((area) => opened.some((file) => pathMatches(file, area)))).length
  return { sectionsDelivered: sections.length, sectionsHit: hit, hitRatio: hit / sections.length }
}
