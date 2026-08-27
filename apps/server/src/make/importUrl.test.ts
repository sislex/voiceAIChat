import { describe, expect, it, vi } from 'vitest'
import { importFromUrl } from './importUrl'

vi.mock('../routes/previewProxy.js', () => ({ assertPublicHost: async () => undefined }))

const fakeFetch = (routes: Record<string, { body: string; type: string; status?: number }>): typeof fetch =>
  (async (input: string | URL | Request) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const r = routes[href]
    if (!r) return new Response('nope', { status: 404 })
    return new Response(r.body, { status: r.status ?? 200, headers: { 'content-type': r.type } })
  }) as typeof fetch

describe('importFromUrl', () => {
  it('HTML → index.html; same-origin css/js/img скачиваются в assets/ и ссылки переписываются; чужие остаются', async () => {
    const f = fakeFetch({
      'https://site.test/page/': { body: '<html><head><link rel="stylesheet" href="/css/a.css"><script src="https://cdn.other/x.js"></script></head><body><img src="img/logo.png"><a href="about">О нас</a></body></html>', type: 'text/html' },
      'https://site.test/css/a.css': { body: 'body{}', type: 'text/css' },
      'https://site.test/page/img/logo.png': { body: 'PNG', type: 'image/png' }
    })
    const files = await importFromUrl('https://site.test/page/', f)
    const index = files.find((x) => x.path === 'index.html')!.data.toString()
    expect(files.map((x) => x.path).sort()).toEqual(['assets/a.css', 'assets/logo.png', 'index.html'])
    expect(index).toContain('href="assets/a.css"')
    expect(index).toContain('src="assets/logo.png"')
    expect(index).toContain('src="https://cdn.other/x.js"')
    expect(index).toContain('href="https://site.test/page/about"')
    expect(index).toContain('импортировано из https://site.test/page/')
  })

  it('не-HTML и не-http отклоняются', async () => {
    await expect(importFromUrl('ftp://x')).rejects.toThrow(/http/)
    const f = fakeFetch({ 'https://site.test/a.json': { body: '{}', type: 'application/json' } })
    await expect(importFromUrl('https://site.test/a.json', f)).rejects.toThrow(/не HTML/)
  })
})
