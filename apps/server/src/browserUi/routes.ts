import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { join, resolve } from 'node:path'
import coreRelease from '../../release.json' with { type: 'json' }
import { APPLICATION_HOST_API_VERSION, BROWSER_UI_RELEASE_PREFIX, BROWSER_UI_RUNTIME_PATH, browserUiAssetPath } from '@voicechat/shared'
import { BrowserUiReleases } from './releases.js'

export async function registerBrowserUi(app: FastifyInstance, bundledDirectory: string, releaseRoot: string): Promise<void> {
  releaseRoot = resolve(releaseRoot)
  bundledDirectory = resolve(bundledDirectory)
  const releases = new BrowserUiReleases(releaseRoot, bundledDirectory, { coreApi: coreRelease.apiVersion, applicationHost: APPLICATION_HOST_API_VERSION })
  // Existing bundled assets remain available to tabs opened before activation.
  await app.register(fastifyStatic, { root: bundledDirectory, wildcard: false })
  app.get(BROWSER_UI_RUNTIME_PATH, (_req, reply) => reply.header('cache-control', 'no-store').send(releases.runtime()))
  app.get<{ Params: { id: string; '*': string } }>(`${BROWSER_UI_RELEASE_PREFIX}:id/*`, (req, reply) => {
    const { id, '*': file } = req.params
    try {
      const release = releases.release(id)
      if (!browserUiAssetPath(file) || !Object.hasOwn(release.files, file)) return reply.code(404).send({ error: 'not found' })
      return reply.header('cache-control', 'public, max-age=31536000, immutable')
        .sendFile(file, join(releaseRoot, 'releases', id), { cacheControl: false })
    } catch { return reply.code(404).send({ error: 'not found' }) }
  })
  app.addHook('onRequest', (req, reply, done) => {
    const path = req.url.split('?')[0]
    if ((req.method === 'GET' || req.method === 'HEAD') && (path === '/' || path === '/index.html')) {
      void reply.header('cache-control', 'no-store').type('text/html').sendFile('index.html', releases.directory(), { cacheControl: false, etag: false, lastModified: false })
      return
    }
    done()
  })
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0]
    if (req.method === 'GET' && !['/api', '/ws', '/agent', '/web-recorder', '/applications/', '/ui/', '/assets/'].some(prefix => path.startsWith(prefix))) {
      return reply.header('cache-control', 'no-store').type('text/html').sendFile('index.html', releases.directory(), { cacheControl: false, etag: false, lastModified: false })
    }
    return reply.code(404).send({ error: 'not found' })
  })
}
