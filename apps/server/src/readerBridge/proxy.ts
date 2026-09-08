// Прокси путей Web Reader в ядре для режима `remote`. Пути превью идут только через ядро: авторизация
// `/api/*` (Bearer, cookie сессии, preview-cookie iframe и ключ Chromium) срабатывает у ядра, ридер
// перепроверяет её через `whoami`. Роуты Make под тем же префиксом (`/api/preview/make*`) конкретнее
// wildcard-а и по правилам Fastify выигрывают — во встроенном Make это его роуты, в remote — его прокси.
// `/mcp/preview` исполнитель зовёт напрямую по `VC_READER_MCP_PUBLIC_BASE`; прокси здесь — запасной путь.
import type { FastifyInstance } from 'fastify'
import { registerServiceProxy } from '../makeBridge/proxy.js'

/** Всё, что регистрируют `routes/previewProxy.ts` и `mcp/previewMcp.ts`; полноту держит `proxy.test.ts`. */
export const READER_PROXY_PREFIXES = ['/api/preview', '/mcp/preview'] as const

export function registerReaderProxy(app: FastifyInstance, opts: { readerUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }): void {
  // Прокси превью отдаёт страницы и ресурсы до 5 МБ, формы уходят сырым телом; запас — на обёртку.
  registerServiceProxy(app, { name: 'reader', baseUrl: opts.readerUrl, prefixes: READER_PROXY_PREFIXES, bodyLimit: 16 * 1024 * 1024, ...opts })
}
