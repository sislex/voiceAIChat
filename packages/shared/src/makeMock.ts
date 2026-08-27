// Мок-API внутри проекта Make (п.29): fetch('api/users') из превью/публикации, если такого файла
// нет, отдаёт JSON из `mock/api/users.json` (или метод-специфичный `mock/api/users.POST.json`).
// Модуль чистый: только имена кандидатов и разбор «конверта» ответа.

export const MAKE_MOCK_DIR = 'mock'
export const MAKE_MOCK_MAX_DELAY_MS = 5000

/** Файлы-кандидаты для пути и метода: сначала метод-специфичный, затем общий, затем index в папке. */
export function mockCandidates(path: string, method: string): string[] {
  const clean = (path.split('?')[0] ?? '').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!clean || clean.startsWith(`${MAKE_MOCK_DIR}/`) || clean.includes('..')) return []
  const m = method.toUpperCase()
  const base = `${MAKE_MOCK_DIR}/${clean}`
  const out = [`${base}.${m}.json`, `${base}.json`, `${base}/index.${m}.json`, `${base}/index.json`]
  return [...new Set(out)]
}

export interface MockResponse { status: number; body: unknown; headers: Record<string, string>; delayMs: number }

/**
 * Файл мока — либо просто JSON-тело, либо конверт `{ "$status": 201, "$headers": {...}, "$delay": 300, "$body": ... }`.
 * Конверт распознаётся по наличию хотя бы одного `$`-поля.
 */
export function unwrapMockEnvelope(json: unknown): MockResponse {
  const out: MockResponse = { status: 200, body: json, headers: {}, delayMs: 0 }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return out
  const o = json as Record<string, unknown>
  if (!('$status' in o || '$body' in o || '$headers' in o || '$delay' in o)) return out
  if (typeof o.$status === 'number' && o.$status >= 100 && o.$status < 600) out.status = Math.floor(o.$status)
  if (o.$headers && typeof o.$headers === 'object') {
    for (const [k, v] of Object.entries(o.$headers as Record<string, unknown>)) if (typeof v === 'string' && /^[\w-]+$/.test(k)) out.headers[k.toLowerCase()] = v
  }
  if (typeof o.$delay === 'number') out.delayMs = Math.min(MAKE_MOCK_MAX_DELAY_MS, Math.max(0, o.$delay))
  out.body = '$body' in o ? o.$body : null
  return out
}

/** Стартовый пример для подсказки/шаблона. */
export const MAKE_MOCK_EXAMPLE = `{
  "$status": 200,
  "$delay": 300,
  "$body": [
    { "id": 1, "name": "Анна", "role": "admin" },
    { "id": 2, "name": "Борис", "role": "user" }
  ]
}
`
