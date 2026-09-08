// Кадры CI принадлежат ядру: доступ к ранам и файлы остаются рядом с канбаном.
import type { FastifyInstance } from 'fastify'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
import { readBrowserShot } from '../browser/checkShots.js'

export function registerBrowserShotRoutes(app: FastifyInstance, deps: { db: VoiceChatDb; shotsRoot?: string }): void {
  const { db } = deps
  // Кадр браузерной проверки рана. Доступ решает `getCiRun` (он проверяет
  // членство в проекте), имя файла — строгий шаблон номера: в путь не должно
  // попадать ничего, кроме кадра этого рана.
  if (deps.shotsRoot) {
    const shotsRoot = deps.shotsRoot
    app.get<{ Params: { runId: string; name: string } }>('/api/ci/runs/:runId/browser-shots/:name', async (req, reply) => {
      if (!await db.ci.getCiRun(uid(req), req.params.runId)) return reply.code(404).send({ error: 'not_found' })
      const png = readBrowserShot(shotsRoot, req.params.runId, req.params.name)
      if (!png) return reply.code(404).send({ error: 'not_found' })
      return reply.type('image/png').header('cache-control', 'private, max-age=86400').send(png)
    })
  }

}
