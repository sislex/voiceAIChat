// REST для машин-агентов: список (с онлайн-статусом), создание (одноразовый
// токен), удаление (отзыв токена + разрыв соединения).

import { createReadStream, existsSync } from 'node:fs'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { REST, type AgentInfo } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { AgentRegistry } from '../agents/registry.js'
import { buildAgentScript } from '../agents/agentScript.js'

/** Пути к собранным .dmg (undefined — не собрано). */
export interface AppArtifacts {
  agentApp?: string
  desktopApp?: string
}

/** Отдаёт .dmg на скачивание или 404 с подсказкой, как собрать. */
function sendDmg(
  reply: FastifyReply,
  path: string | undefined,
  filename: string,
  buildHint: string
): FastifyReply {
  if (!path || !existsSync(path)) {
    return reply.code(404).send({ error: `Приложение не собрано. Соберите: ${buildHint}` })
  }
  return reply
    .header('content-type', 'application/x-apple-diskimage')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .send(createReadStream(path))
}

export async function registerAgentRoutes(
  app: FastifyInstance,
  db: VoiceChatDb,
  registry: AgentRegistry,
  artifacts: AppArtifacts = {}
): Promise<void> {
  app.get(REST.agents, async (): Promise<AgentInfo[]> => {
    const online = registry.onlineIds()
    return db.listAgents().map((a) => ({ ...a, online: online.has(a.id) }))
  })

  // Собранные .dmg. Собираются заранее (npm --prefix … run dist).
  app.get(REST.agentApp, async (_req, reply) =>
    sendDmg(reply, artifacts.agentApp, 'voicechat-agent.dmg', 'npm --prefix apps/agent-tray run dist')
  )
  app.get(REST.desktopApp, async (_req, reply) =>
    sendDmg(reply, artifacts.desktopApp, 'voicechat-desktop.dmg', 'npm --prefix apps/desktop run dist')
  )

  // Бандл компаньон-агента (.cjs, без токена — настраивается строкой подключения).
  app.get(REST.agentScript, async (_req, reply) => {
    try {
      const script = await buildAgentScript()
      return reply
        .header('content-type', 'application/javascript; charset=utf-8')
        .header('content-disposition', 'attachment; filename="voicechat-agent.cjs"')
        .send(script)
    } catch (err) {
      return reply
        .code(500)
        .send({ error: `Не удалось собрать агента: ${err instanceof Error ? err.message : err}` })
    }
  })

  app.post<{ Body: { name?: string } }>(REST.agents, async (req, reply) => {
    const name = req.body?.name?.trim()
    if (!name) return reply.code(400).send({ error: 'name required' })
    return db.createAgent(name)
  })

  app.delete<{ Params: { id: string } }>('/api/agents/:id', async (req) => {
    const id = req.params.id
    registry.disconnect(id)
    db.deleteAgent(id)
    // Удалили выбранную цель выполнения — возвращаемся на сервер.
    const settings = db.getSettings()
    if (settings.execTarget === id) db.saveSettings({ ...settings, execTarget: null })
    return { ok: true }
  })
}
