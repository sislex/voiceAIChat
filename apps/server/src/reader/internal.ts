// Внутренний протокол «ридер ↔ ядро» для режима двух процессов (docs/plans/web-reader-service.md, круг 2).
// Контракт лежит на стороне ридера (как у канбана и админки): ядро импортирует его, а не наоборот. Оба
// конца — Fastify под общим Bearer `VC_INTERNAL_TOKEN`; наружу Caddy эти пути не проксирует. У ядра —
// `ReaderCore` по RPC (`{ method, args }`); обратного канала нет: ядру от ридера нужен только его адрес.
export const INTERNAL_READER_CORE_PATH = '/internal/reader/core'
export const READER_HEALTH_PATH = '/v1/health'
/** Методы `ReaderCore`, которые ядро отдаёт по RPC. */
export const READER_CORE_RPC_METHODS = ['projectResource', 'previewAction', 'issuePreviewRunKey', 'listPreviews', 'logBrowserShot'] as const
/** Кадр PNG в base64 может быть на несколько мегабайт — лимит тела RPC выше умолчания Fastify (1 МБ). */
export const READER_RPC_BODY_LIMIT = 16 * 1024 * 1024
