// Генерация моков из описания через ассистента (roadmap-4 п.30): из фразы пользователя собираем
// готовый запрос модели с точным форматом файла коллекции — чтобы ответ сразу лёг в mock/ и заработал в превью.

/** slug для пути мока: латиница/цифры/дефис, кириллица транслитерируется грубо, пусто → `items`. */
export function mockSlug(text: string): string {
  const map: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' }
  const slug = text.toLowerCase().split('').map((c) => map[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return slug || 'items'
}

export interface MockPromptOptions { count?: number; path?: string }

/** Текст запроса ассистенту: коллекция `$collection` по описанию, N записей, поля из описания, подключение через fetch. */
export function makeMockPrompt(description: string, options: MockPromptOptions = {}): { path: string; prompt: string } {
  const desc = description.trim()
  const count = options.count && options.count > 0 ? Math.min(options.count, 200) : 12
  const firstNoun = desc.split(/[\s,.;:]+/).find((w) => w.length > 2) ?? 'items'
  const path = options.path?.trim() || `mock/api/${mockSlug(firstNoun)}.json`
  const prompt = [
    `Создай мок-данные для превью: файл ${path} в формате коллекции {"$collection": true, "$body": [ … ]}.`,
    `Описание данных: ${desc}.`,
    `Сгенерируй ${count} правдоподобных записей на русском (уникальные, без «Lorem ipsum»), у каждой — числовое поле id начиная с 1 и поля из описания; типы соблюдай (числа числами, даты в ISO).`,
    `Файл записывай целиком через make_write_file. Если в проекте есть код, который должен показывать эти данные, подключи его через fetch("${path.replace(/^mock\//, '').replace(/\.json$/, '')}") и проверь проект (make_check).`,
    'Ничего другого в проекте не меняй.'
  ].join(' ')
  return { path, prompt }
}
