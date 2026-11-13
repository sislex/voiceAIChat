import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { REST, parseAndroidReleaseManifest, type AndroidRelease } from '@voicechat/shared'

export interface AndroidAppOptions {
  manifestPath?: string
  fetchImpl?: typeof fetch
  githubToken?: string
}

async function download(a: AndroidRelease, fetchImpl: typeof fetch, token?: string): Promise<Buffer> {
  const url = new URL(a.url)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Invalid pinned Android URL')
  let target = url.href
  const headers: Record<string, string> = {}
  // Private release credentials are used only with GitHub's API, never with the public response.
  const release = /^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/.exec(url.pathname)
  if (url.hostname === 'github.com' && release && token) {
    const [, owner, repo, tag, filename] = release
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30_000)
    })
    if (!response.ok) throw new Error('Android release lookup failed')
    const metadata = await response.json() as { assets: { id: number; name: string }[] }
    const asset = metadata.assets.find(item => item.name === decodeURIComponent(filename!))
    if (!asset || !Number.isSafeInteger(asset.id)) throw new Error('Android asset missing')
    target = `https://api.github.com/repos/${owner}/${repo}/releases/assets/${asset.id}`
    headers.authorization = `Bearer ${token}`
    headers.accept = 'application/octet-stream'
  }
  const response = await fetchImpl(target, { headers, signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error('Android download failed')
  return Buffer.from(await response.arrayBuffer())
}

function matches(header: string | undefined, etag: string): boolean {
  return !!header?.split(',').some(value => value.trim().replace(/^W\//, '') === etag || value.trim() === '*')
}

export function registerAndroidAppRoutes(app: FastifyInstance, options: AndroidAppOptions): void {
  let cached: { hash: string; bytes: Promise<Buffer> } | undefined
  const serve = (apk: boolean) => async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    reply.header('cache-control', 'no-cache')
    if (!options.manifestPath) return reply.code(404).send({ error: 'android_release_not_pinned' })
    try {
      let raw: string
      try { raw = await readFile(options.manifestPath, 'utf8') } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reply.code(404).send({ error: 'android_release_not_pinned' })
        throw error
      }
      const manifest = parseAndroidReleaseManifest(JSON.parse(raw))
      const a = manifest.android
      if (!apk) {
        a.url = REST.androidApk
        const body = JSON.stringify(manifest)
        const etag = '"' + createHash('sha256').update(body).digest('hex') + '"'
        reply.header('etag', etag)
        if (matches(req.headers['if-none-match'], etag)) return reply.code(304).send()
        return reply.type('application/json').send(body)
      }
      let bytes: Buffer
      try { bytes = await readFile(join(dirname(options.manifestPath), a.filename)) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        if (cached?.hash !== a.sha256) {
          cached = { hash: a.sha256, bytes: download(a, options.fetchImpl ?? fetch, options.githubToken) }
          void cached.bytes.catch(() => { cached = undefined })
        }
        bytes = await cached.bytes
      }
      // Verify the exact bytes being sent, including before returning 304.
      if (bytes.length !== a.size || createHash('sha256').update(bytes).digest('hex') !== a.sha256) {
        cached = undefined
        throw new Error('Android artifact integrity mismatch')
      }
      const etag = '"' + a.sha256 + '"'
      reply.header('etag', etag)
        .type('application/vnd.android.package-archive')
        .header('content-disposition', `attachment; filename="${a.filename}"`)
      if (matches(req.headers['if-none-match'], etag)) return reply.code(304).send()
      return reply.send(bytes)
    } catch (error) {
      req.log.error({ err: error }, 'Android artifact unavailable')
      return reply.code(503).send({ error: 'android_artifact_unavailable' })
    }
  }
  // Public binary routes finish before the authenticated API preHandler.
  for (const [path, apk] of [[REST.androidApp, false], [REST.androidApk, true]] as const) {
    app.get(path, { onRequest: serve(apk) }, async () => undefined)
  }
}
