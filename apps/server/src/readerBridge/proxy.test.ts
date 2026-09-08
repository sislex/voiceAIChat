// Прокси ридера в ядре: (1) полнота — каждый путь, который регистрируют `routes/previewProxy.ts` и
// `mcp/previewMcp.ts`, попадает под `READER_PROXY_PREFIXES`, иначе в `remote` он получит у ядра 404;
// (2) приоритет — пути Make под тем же префиксом `/api/preview/make*` уходят в Make, а не в ридер,
// и во встроенном Make, и когда оба соседа за прокси.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { PREVIEW_MCP_PATH } from '../mcp/previewMcp.js'
import { registerMakeProxy } from '../makeBridge/proxy.js'
import { READER_PROXY_PREFIXES, registerReaderProxy } from './proxy.js'

const srcDir = join(__dirname, '..')

function covered(path: string): boolean {
  return READER_PROXY_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

describe('READER_PROXY_PREFIXES', () => {
  it('покрывает каждый роут прокси превью и MCP «browser»', () => {
    const missing: string[] = []
    for (const file of ['routes/previewProxy.ts', 'mcp/previewMcp.ts']) {
      const text = readFileSync(join(srcDir, file), 'utf8')
      for (const m of text.matchAll(/\.(?:get|post|put|delete|patch|all)(?:<[^(]*?>)?\(\s*[`'"](\/[^`'"$]*)/g)) {
        if (!covered(m[1]!)) missing.push(`${file}: ${m[1]}`)
      }
    }
    expect(missing).toEqual([])
    expect(covered(PREVIEW_MCP_PATH)).toBe(true)
  })

  it('пути Make под /api/preview/make* конкретнее и уходят в Make, остальное превью — в ридер', async () => {
    const hits: string[] = []
    const fake = (name: string): typeof fetch => (async (input: string | URL | Request) => {
      hits.push(`${name} ${new URL(String(input)).pathname}`)
      return new Response(JSON.stringify({ via: name }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const app = Fastify({ logger: false })
    // Порядок регистрации не важен: выбирает роутер по конкретности пути.
    registerReaderProxy(app, { readerUrl: 'http://reader', fetchImpl: fake('reader') })
    registerMakeProxy(app, { makeUrl: 'http://make', fetchImpl: fake('make') })
    // Встроенный Make регистрирует свой роут под тем же префиксом — он тоже выигрывает у wildcard ридера.
    app.get('/api/preview/make-shared/:token/*', async () => ({ via: 'make-embedded' }))
    await app.ready()
    try {
      expect((await app.inject({ method: 'GET', url: '/api/preview?url=https%3A%2F%2Fexample.com%2F' })).json()).toEqual({ via: 'reader' })
      expect((await app.inject({ method: 'POST', url: '/api/preview/reset-cookies', payload: {} })).json()).toEqual({ via: 'reader' })
      expect((await app.inject({ method: 'GET', url: '/api/preview/diagnostics' })).json()).toEqual({ via: 'reader' })
      expect((await app.inject({ method: 'POST', url: `${PREVIEW_MCP_PATH}?k=s&turn=t`, payload: {} })).json()).toEqual({ via: 'reader' })
      expect((await app.inject({ method: 'GET', url: '/api/preview/make/p1/index.html' })).json()).toEqual({ via: 'make' })
      expect((await app.inject({ method: 'GET', url: '/api/preview/make-shared/tok/index.html' })).json()).toEqual({ via: 'make-embedded' })
      expect(hits.filter((h) => h.startsWith('reader'))).toEqual([
        'reader /api/preview', 'reader /api/preview/reset-cookies', 'reader /api/preview/diagnostics', `reader ${PREVIEW_MCP_PATH}`
      ])
    } finally { await app.close() }
  })
})
