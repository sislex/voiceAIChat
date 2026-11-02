import type { FastifyInstance } from 'fastify'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { join, extname } from 'node:path'
import {
  APPLICATION_CATALOG,
  parseApplicationFrontendManifest,
  type DeploymentManifest
} from '@voicechat/shared'

const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const mime: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2'
}
/** Production prefers pinned owner archives; development can use working-copy sources. */
export function registerApplicationFrontends(
  app: FastifyInstance,
  sources: Record<string, string> = {},
  localRoot = repo,
  deployment?: DeploymentManifest,
  allowOverrides = process.env.NODE_ENV !== 'production' || process.env.VC_APPLICATION_FRONTENDS_OVERRIDE === '1'
): void {
  const require = createRequire(join(localRoot, 'package.json'))
  for (const id of Object.keys(sources))
    if (!APPLICATION_CATALOG.some((item) => item.id === id && item.frontend))
      throw new Error(`Неизвестный frontend ${id}`)
  // Validate every configured ID before filtering out inactive owners.
  if (deployment) {
    sources = Object.fromEntries(Object.entries(sources).filter(([id]) => {
      const frontend = APPLICATION_CATALOG.find(item => item.id === id)!
      return deployment.applications.some(application =>
        application.enabled && application.location === 'local' &&
        (application.id === id || frontend.runtimeDependencies.includes(application.id)))
    }))
  }
  // Catalog owner packages are pinned archives. A broken installation must not
  // silently fall back to a potentially stale container.
  sources = Object.fromEntries(Object.entries(sources).filter(([id]) =>
    allowOverrides || !APPLICATION_CATALOG.find(item => item.id === id)!.external
  ))
  const readArtifact = async (definition: typeof APPLICATION_CATALOG[number], path: string) => {
    if (!sources[definition.id]) {
      if (!definition.external) throw new Error('Missing frontend owner')
      return { status: 200, content: await readFile(require.resolve(`${definition.external.package}/frontend/${path}`)) }
    }
    const base = new URL(sources[definition.id])
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
      throw new Error('Неверный адрес приложения')
    const response = await fetch(new URL(path, base.href.replace(/\/$/, '') + '/'), {
      redirect: 'error', signal: AbortSignal.timeout(20_000)
    })
    return { status: response.status, content: response.ok ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0) }
  }
  app.addHook('onReady', async () => {
    await Promise.all(APPLICATION_CATALOG.filter(item => item.frontend).map(async definition => {
      const source = sources[definition.id] ? 'override' : 'pinned'
      try {
        const { status, content } = await readArtifact(definition, 'manifest.json')
        if (status < 200 || status >= 300) throw new Error('Manifest unavailable')
        const manifest = parseApplicationFrontendManifest(JSON.parse(content.toString('utf8')), definition.id)
        console.info('[application-frontend]', JSON.stringify({
          id: definition.id, source, version: manifest.version, commit: manifest.commit
        }))
      } catch {
        console.warn('[application-frontend]', JSON.stringify({
          id: definition.id, source, version: null, commit: null, error: 'manifest_unavailable'
        }))
      }
    }))
  })
  app.get<{ Params: { id: string; '*': string } }>(
    '/applications/:id/*',
    async (req, reply) => {
      const definition = APPLICATION_CATALOG.find(
        (item) => item.id === req.params.id && item.frontend
      )
      const path = req.params['*']
      if (
        !definition ||
        !/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/.test(path) ||
        path
          .split('/')
          .some((part) => part === '.' || part === '..' || !part) ||
        !mime[extname(path)]
      )
        return reply.code(404).send({ error: 'Артефакт приложения не найден' })
      try {
        const { status, content } = await readArtifact(definition, path)
        if (status < 200 || status >= 300)
          return reply.code(status === 404 ? 404 : 502).send({ error: 'Приложение недоступно' })
        if (path === 'manifest.json')
          parseApplicationFrontendManifest(
            JSON.parse(content.toString('utf8')),
            definition.id
          )
        return reply
          .header(
            'cache-control',
            path === 'manifest.json'
              ? 'no-store'
              : 'public, max-age=31536000, immutable'
          )
          .header('x-content-type-options', 'nosniff')
          .type(mime[extname(path)]!)
          .send(content)
      } catch {
        return reply
          .code(503)
          .send({
            error:
              'Приложение недоступно. Проверьте его сборку и адрес в конфигурации окружения.'
          })
      }
    }
  )
}
