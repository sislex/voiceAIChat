// REST для машин-агентов: список (с онлайн-статусом), создание (одноразовый
// токен), удаление (отзыв токена + разрыв соединения).

import type { FastifyInstance } from 'fastify'
import { REST, type AgentInfo } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { AgentRegistry } from '../agents/registry.js'

export async function registerAgentRoutes(
  app: FastifyInstance,
  db: VoiceChatDb,
  registry: AgentRegistry
): Promise<void> {
  app.get(REST.agents, async (): Promise<AgentInfo[]> => {
    const online = registry.onlineIds()
    return db.listAgents().map((a) => ({ ...a, online: online.has(a.id) }))
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
