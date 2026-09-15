import type { BrowserConsoleEntry, BrowserHistoryEntry, BrowserNetworkEntry, BrowserSnapshotInfo } from '@voicechat/shared'

/**
 * Отчёт о проверке — то, что остаётся после работы в браузере.
 *
 * Модель проверяла задачу и писала итог своими словами: «всё работает». Человек
 * в канбане видел этот текст и не мог понять ни что именно проверялось, ни на
 * чём проверка споткнулась и была повторена. Всё нужное уже лежит в сессии —
 * лента действий, вердикты проверок, снимки, ошибки страницы; отчёт просто
 * собирает это в один текст, который не стыдно вставить в задачу.
 *
 * Markdown, а не JSON: его читает человек в комментарии, а не парсер.
 */

export interface ReportInput {
  title?: string
  url: string
  startedAt: number
  history: BrowserHistoryEntry[]
  console: BrowserConsoleEntry[]
  network: BrowserNetworkEntry[]
  snapshots: BrowserSnapshotInfo[]
  /** Ограничение длины: комментарий в задаче читают, а не листают. */
  limit?: number
}

export interface ReportOutput {
  markdown: string
  passed: boolean
  actions: number
  failures: number
  truncated?: boolean
}

const DEFAULT_LIMIT = 8_000

export function buildSessionReport(input: ReportInput): ReportOutput {
  const acting = input.history.filter((entry) => entry.kind !== 'note')
  const notes = input.history.filter((entry) => entry.kind === 'note')
  const failed = acting.filter((entry) => !entry.ok)
  const errors = input.console.filter((entry) => entry.level === 'error')
  const badRequests = input.network.filter((entry) => (entry.status ?? 0) >= 400 || entry.error)
  const passed = failed.length === 0 && errors.length === 0
  const minutes = Math.max(1, Math.round((Date.now() - input.startedAt) / 60_000))
  const lines: string[] = []

  lines.push(`## Проверка в браузере${input.title ? `: ${input.title}` : ''}`)
  lines.push('')
  lines.push(`**Итог:** ${passed ? 'замечаний нет' : 'есть замечания'} · действий: ${acting.length} · ~${minutes} мин · ${input.url}`)

  if (notes.length) {
    lines.push('')
    lines.push('### Что проверялось')
    for (const note of notes.slice(-10)) lines.push(`- ${note.title}`)
  }

  if (failed.length) {
    lines.push('')
    lines.push('### Что не получилось')
    // Неудачные шаги — главное в отчёте: по ним человек решает, дефект это или
    // особенность стенда, и именно их он перепроверяет руками.
    for (const entry of failed.slice(0, 20)) lines.push(`- ${entry.title}${entry.error ? ` — ${entry.error}` : ''}`)
  }

  if (errors.length || badRequests.length) {
    lines.push('')
    lines.push('### Страница жаловалась')
    for (const entry of errors.slice(0, 10)) lines.push(`- Ошибка в консоли: ${entry.text.slice(0, 200)}`)
    for (const entry of badRequests.slice(0, 10)) lines.push(`- ${entry.status || 'Сбой сети'} ${entry.method} ${entry.url}`)
  }

  if (input.snapshots.length) {
    lines.push('')
    lines.push('### Снимки состояния')
    for (const snapshot of input.snapshots.slice(0, 10)) lines.push(`- \`${snapshot.name}\` — ${snapshot.url}`)
  }

  if (acting.length) {
    lines.push('')
    lines.push('### Шаги')
    // Хвост, а не начало: свежие шаги объясняют итог, а первые — только вход.
    for (const entry of acting.slice(-30)) lines.push(`- ${entry.actor === 'assistant' ? 'модель' : 'человек'}: ${entry.title}${entry.ok ? '' : ' — не выполнено'}`)
  }

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 500), 32_000)
  const full = lines.join('\n')
  const markdown = full.length > limit ? `${full.slice(0, limit)}\n\n…отчёт обрезан` : full
  return {
    markdown,
    passed,
    actions: acting.length,
    failures: failed.length + errors.length,
    ...(full.length > limit ? { truncated: true } : {})
  }
}
