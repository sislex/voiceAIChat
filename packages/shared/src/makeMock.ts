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

/**
 * Persist-режим коллекции (roadmap-2 п.12): файл `mock/<путь>.json` вида `{ "$collection": true, "$body": [ ... ] }`.
 * GET отдаёт массив или элемент по id, POST добавляет (id генерируется, если нет), PUT/PATCH правят, DELETE удаляет;
 * результат пишется обратно в файл. Чистая функция: возвращает новый JSON файла и ответ.
 */
export interface CollectionResult { file: unknown; response: MockResponse; changed: boolean }

export function isMockCollection(json: unknown): json is { $collection: true; $body: unknown[] } {
  return Boolean(json && typeof json === 'object' && !Array.isArray(json) && (json as { $collection?: unknown }).$collection === true && Array.isArray((json as { $body?: unknown }).$body))
}

export function applyCollectionRequest(json: { $collection: true; $body: unknown[] }, method: string, idSegment: string | null, body: unknown, nextId: () => string): CollectionResult {
  const items = json.$body as Array<Record<string, unknown>>
  const m = method.toUpperCase()
  const idOf = (it: Record<string, unknown>): string => String(it.id ?? '')
  const notFound = (): CollectionResult => ({ file: json, response: { status: 404, body: { error: 'not found' }, headers: {}, delayMs: 0 }, changed: false })
  const ok = (status: number, payload: unknown, list: Array<Record<string, unknown>>, changed: boolean): CollectionResult =>
    ({ file: { ...json, $body: list }, response: { status, body: payload, headers: {}, delayMs: 0 }, changed })
  if (m === 'GET') {
    if (!idSegment) return ok(200, items, items, false)
    const it = items.find((x) => idOf(x) === idSegment)
    return it ? ok(200, it, items, false) : notFound()
  }
  if (m === 'POST' && !idSegment) {
    const src = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : { value: body }
    const item = { ...src, id: src.id ?? nextId() }
    return ok(201, item, [...items, item], true)
  }
  if ((m === 'PUT' || m === 'PATCH') && idSegment) {
    const idx = items.findIndex((x) => idOf(x) === idSegment)
    if (idx < 0) return notFound()
    const patch = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
    const item = m === 'PUT' ? { ...patch, id: items[idx]!.id } : { ...items[idx]!, ...patch, id: items[idx]!.id }
    const list = items.slice(); list[idx] = item
    return ok(200, item, list, true)
  }
  if (m === 'DELETE' && idSegment) {
    const list = items.filter((x) => idOf(x) !== idSegment)
    if (list.length === items.length) return notFound()
    return ok(204, null, list, true)
  }
  return { file: json, response: { status: 405, body: { error: 'method not allowed' }, headers: {}, delayMs: 0 }, changed: false }
}

/**
 * Кандидаты коллекции для пути: сначала сам путь как коллекция (`api/users` → `mock/api/users.json`, id нет),
 * затем родитель с последним сегментом как id (`api/users/42` → `mock/api/users.json`, id `42`).
 */
export function collectionCandidates(path: string): Array<{ file: string; id: string | null }> {
  const clean = (path.split('?')[0] ?? '').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!clean || clean.includes('..') || clean.startsWith(`${MAKE_MOCK_DIR}/`)) return []
  const out = [{ file: `${MAKE_MOCK_DIR}/${clean}.json`, id: null as string | null }]
  const parts = clean.split('/')
  const last = parts[parts.length - 1]!
  if (parts.length > 1 && /^[\w-]{1,64}$/.test(last)) out.push({ file: `${MAKE_MOCK_DIR}/${parts.slice(0, -1).join('/')}.json`, id: last })
  return out
}
