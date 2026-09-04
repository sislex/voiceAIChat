// Инвентарь галереи студии: текстовая сводка списка и поиск побайтовых
// дубликатов. Обе задачи — чистые функции над метаданными, поэтому живут
// отдельно от панели и проверяются без DOM.
import type { ImageStudioFile } from '@shared/imageStudio'

/** Строка «12,3 МБ» / «340 КБ»: тот же формат, что у панели. */
function bytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1).replace('.', ',').replace(',0', '')} МБ`
  if (value >= 1024) return `${Math.round(value / 1024)} КБ`
  return `${value} Б`
}

/** Экранирует вертикальную черту: иначе промпт разъедет markdown-таблицу. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ')
}

/**
 * Список галереи markdown-таблицей: его вставляют в задачу или в письмо,
 * когда надо согласовать набор картинок, а не сами картинки.
 */
export function inventoryMarkdown(
  files: ImageStudioFile[],
  extras: { dimensions?: Record<string, string>; notes?: Record<string, string> } = {}
): string {
  const head = '| Файл | Размер | Пиксели | Промпт | Заметка |\n| --- | --- | --- | --- | --- |'
  const rows = files.map((file) => [
    cell(file.path),
    bytes(file.size),
    extras.dimensions?.[file.path] ?? '',
    cell(file.prompt ?? ''),
    cell(extras.notes?.[file.path] ?? '')
  ].join(' | '))
  const total = files.reduce((sum, file) => sum + file.size, 0)
  return [head, ...rows.map((row) => `| ${row} |`), '', `Всего файлов: ${files.length}, занято ${bytes(total)}.`].join('\n')
}

export interface DuplicateGroup {
  /** Файл, который оставляем: самый старый — на него уже могли ссылаться. */
  keep: string
  /** Копии того же содержимого. */
  copies: string[]
}

/**
 * Группирует файлы с одинаковым содержимым. Ключ содержимого приходит извне
 * (панель читает base64 только у файлов с совпавшим размером), поэтому здесь
 * нет ни сети, ни канваса — только группировка и выбор «кого оставить».
 */
export function groupDuplicates(files: ImageStudioFile[], contentKey: (file: ImageStudioFile) => string | undefined): DuplicateGroup[] {
  const groups = new Map<string, ImageStudioFile[]>()
  for (const file of files) {
    const key = contentKey(file)
    if (!key) continue
    const list = groups.get(key)
    if (list) list.push(file)
    else groups.set(key, [file])
  }
  const out: DuplicateGroup[] = []
  for (const list of groups.values()) {
    if (list.length < 2) continue
    // Оставляем самый ранний файл: он вероятнее упомянут в чате и в ссылках.
    const sorted = [...list].sort((left, right) => left.updatedAt - right.updatedAt || left.path.localeCompare(right.path, 'ru'))
    out.push({ keep: sorted[0]!.path, copies: sorted.slice(1).map((file) => file.path) })
  }
  return out.sort((left, right) => left.keep.localeCompare(right.keep, 'ru'))
}

/**
 * Выполняет задачи пачками по `limit`. Превью галереи читаются по одному
 * запросу на файл, и на сотне картинок браузер открывал сотню соединений
 * разом: первые превью ждали последних, а сервер получал всплеск нагрузки.
 */
export async function mapWithLimit<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const size = Math.max(1, Math.floor(limit))
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await task(items[index]!, index)
    }
  })
  await Promise.all(workers)
  return results
}
