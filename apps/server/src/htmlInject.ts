import type { IncomingHttpHeaders } from 'node:http'
import { promisify } from 'node:util'
import { brotliDecompress, gunzip, inflate } from 'node:zlib'

const decoders = { gzip: promisify(gunzip), br: promisify(brotliDecompress), deflate: promisify(inflate) }

// Multiple enforced policies intersect; unknown source expressions fail closed.
export function allowsInspector(csp: string | string[] | undefined, scriptUrl: string): boolean {
  const script = new URL(scriptUrl)
  return (Array.isArray(csp) ? csp : [csp ?? '']).flatMap(policy => policy.split(',')).every(policy => {
    const directives = new Map<string, string[]>()
    for (const part of policy.split(';')) {
      const [name, ...values] = part.trim().split(/\s+/)
      if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), values)
    }
    const sandbox = directives.get('sandbox')
    if (sandbox && !sandbox.includes('allow-scripts')) return false
    const sources = directives.get('script-src-elem') ?? directives.get('script-src') ?? directives.get('default-src')
    if (!sources) return true
    if (sources.includes("'strict-dynamic'")) return false
    return sources.some(source => {
      if (source === "'self'" || source === '*') return true
      if (source === script.protocol) return true
      if (source.startsWith("'")) return false
      try {
        const url = new URL(source.includes('://') ? source : `${script.protocol}//${source}`)
        return url.origin === script.origin && (url.pathname === '/' || url.pathname === script.pathname || (url.pathname.endsWith('/') && script.pathname.startsWith(url.pathname)))
      } catch { return false }
    })
  })
}

export function inspectorScriptUrl(host: string | undefined, encrypted: boolean): string | undefined {
  if (!host || /[\s/\\"'<>?#@]/.test(host)) return undefined
  try { return new URL(`${encrypted ? 'https' : 'http'}://${host}/api/make/inspector.js`).href } catch { return undefined }
}

export function canInjectInspector(headers: IncomingHttpHeaders, scriptUrl: string): boolean {
  const type = headers['content-type'] ?? ''
  const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(type)?.[1]?.toLowerCase()
  return /^text\/html(?:\s*;|\s*$)/i.test(type)
    && (!charset || ['utf-8', 'utf8', 'us-ascii'].includes(charset))
    && (!headers['transfer-encoding'] || headers['transfer-encoding'].toLowerCase() === 'chunked') && !headers['content-range']
    && allowsInspector(headers['content-security-policy'], scriptUrl)
    && (!headers['content-encoding'] || ['identity', ...Object.keys(decoders)].includes(headers['content-encoding'].toLowerCase()))
}

/** Returns undefined when the original bytes and headers must be preserved. Callers buffer the whole body, so chunked upstreams are fine; they must drop Transfer-Encoding when they set Content-Length. */
export async function injectInspectorHtml(body: Buffer, headers: IncomingHttpHeaders, scriptUrl: string, additionalScriptUrls: string[] = []): Promise<Buffer | undefined> {
  if (![scriptUrl, ...additionalScriptUrls].every(url => canInjectInspector(headers, url))) return undefined
  try {
    const encoding = headers['content-encoding']?.toLowerCase()
    const decoded = encoding && encoding !== 'identity' ? await decoders[encoding as keyof typeof decoders](body) : body
    const html = new TextDecoder('utf-8', { fatal: true }).decode(decoded)
    // Meta policies can further restrict scripts. Leave such documents untouched.
    if (/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy\b/i.test(html) || /<script\b[^>]*\bdata-vc-make-inspector\b/i.test(html)) return undefined
    const head = /<\/head\s*>/i.exec(html)
    const openingBody = /<body\b[^>]*>/i.exec(html)
    const offset = head?.index ?? (openingBody ? openingBody.index + openingBody[0].length : undefined)
    if (offset === undefined) return undefined
    const script = `<script src="${scriptUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" data-vc-make-inspector></script>`
    const additional = additionalScriptUrls.map(url => `<script src="${url.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></script>`).join('')
    return Buffer.from(html.slice(0, offset) + script + additional + html.slice(offset))
  } catch { return undefined }
}
