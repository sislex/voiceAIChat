import { describe, expect, it } from 'vitest'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { allowsInspector, canInjectInspector, injectInspectorHtml, inspectorScriptUrl } from './htmlInject.js'

const url = 'https://core.example:24016/api/make/inspector.js'
const headers = { 'content-type': 'text/html; charset=utf-8' }
const html = '<html><head></head><body>Привет</body></html>'
const script = `<script src="${url}" data-vc-make-inspector></script>`
describe('inspector HTML rewrite', () => {
  it.each([['identity', (b: Buffer) => b], ['gzip', gzipSync], ['br', brotliCompressSync], ['deflate', deflateSync]] as const)('decodes %s and inserts before the head closing tag', async (encoding, encode) => {
    expect((await injectInspectorHtml(encode(Buffer.from(html)), { ...headers, 'content-encoding': encoding }, url))?.toString()).toBe(html.replace('</head>', script + '</head>'))
  })
  it('falls back to the body and preserves documents without insertion points', async () => {
    expect((await injectInspectorHtml(Buffer.from('<BODY class="x">hello</BODY>'), headers, url))?.toString()).toBe('<BODY class="x">' + script + 'hello</BODY>')
    for (const body of ['{"value":1}', 'hello', '<meta http-equiv="Content-Security-Policy" content="script-src none"><body>', `<head>${script}</head>`]) {
      expect(await injectInspectorHtml(Buffer.from(body), headers, url)).toBeUndefined()
    }
    expect(await injectInspectorHtml(Buffer.from(html), { ...headers, 'content-encoding': 'gzip' }, url)).toBeUndefined()
  })
  it.each(["script-src 'none'", "default-src 'none'", "script-src 'unsafe-inline'", "script-src 'nonce-abc'", "script-src https://other.example", "script-src 'self'; script-src-elem 'none'", "script-src 'self' 'nonce-abc' 'strict-dynamic'", "script-src 'self', default-src 'none'", 'sandbox'])('preserves CSP restrictions: %s', csp => {
    expect(allowsInspector(csp, url)).toBe(false)
  })
  it.each([undefined, "script-src 'self'", "default-src 'none'; script-src-elem 'self'", 'script-src https:', 'script-src https://core.example:24016/api/make/', "img-src 'none'", 'sandbox allow-scripts; script-src *'])('accepts allowed external scripts: %s', csp => {
    expect(allowsInspector(csp, url)).toBe(true)
  })
  it('skips streaming, partial, non-HTML and unsupported encodings', () => {
    for (const extra of [{ 'transfer-encoding': 'chunked' }, { 'content-range': 'bytes 0-10/20' }, { 'content-type': 'text/event-stream' }, { 'content-type': 'application/json' }, { 'content-type': 'text/html; charset=iso-8859-1' }, { 'content-encoding': 'unknown' }]) {
      expect(canInjectInspector({ ...headers, ...extra }, url)).toBe(false)
    }
  })
  it('derives the script URL from the incoming authority and TLS', () => {
    expect(inspectorScriptUrl('core.example:24016', true)).toBe(url)
    expect(inspectorScriptUrl('[::1]:24016', false)).toBe('http://[::1]:24016/api/make/inspector.js')
    expect(inspectorScriptUrl('evil"><script>', false)).toBeUndefined()
  })
})
