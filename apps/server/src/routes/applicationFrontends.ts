import type { FastifyInstance } from 'fastify'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, join, extname } from 'node:path'
import {
  APPLICATION_CATALOG,
  parseApplicationFrontendManifest
} from '@voicechat/shared'

const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const mime: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2'
}
/** В production адреса задаются площадкой; в dev читаются независимые dist. */
export function registerApplicationFrontends(
  app: FastifyInstance,
  sources: Record<string, string> = {},
  localRoot = repo
): void {
  for (const id of Object.keys(sources))
    if (!APPLICATION_CATALOG.some((item) => item.id === id && item.frontend))
      throw new Error(`Неизвестный frontend ${id}`)
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
        let content: Buffer
        if (sources[definition.id]) {
          const base = new URL(sources[definition.id])
          if (
            !['http:', 'https:'].includes(base.protocol) ||
            base.username ||
            base.password ||
            base.search ||
            base.hash
          )
            throw new Error('Неверный адрес приложения')
          const response = await fetch(
            new URL(path, base.href.replace(/\/$/, '') + '/'),
            { redirect: 'error', signal: AbortSignal.timeout(20_000) }
          )
          if (!response.ok)
            return reply
              .code(response.status === 404 ? 404 : 502)
              .send({ error: 'Приложение недоступно' })
          content = Buffer.from(await response.arrayBuffer())
        } else
          content = await readFile(
            join(resolve(localRoot, definition.paths[0], 'dist'), path)
          )
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
