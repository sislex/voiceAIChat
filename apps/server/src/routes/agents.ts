// REST для машин-агентов: список (с онлайн-статусом), создание (одноразовый
// токен), удаление (отзыв токена + разрыв соединения).

import { createReadStream, existsSync } from 'node:fs'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { REST, AGENT_VERSION, type AgentInfo, type AgentPolicy } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
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
  app.get(REST.agents, async (req): Promise<AgentInfo[]> => {
    const online = registry.onlineIds()
    return db.listAgents(uid(req)).map((a) => ({
      ...a,
      online: online.has(a.id),
      version: registry.versionOf(a.id)
    }))
  })

  // Владеет ли текущий пользователь машиной id (для операций над ней).
  const ownsAgent = (userId: string, id: string): boolean =>
    db.listAgents(userId).some((a) => a.id === id)

  // Последняя доступная версия агента (публично — трей проверяет обновления).
  app.get(REST.agentLatestVersion, async () => ({ version: AGENT_VERSION }))

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
    return db.createAgent(uid(req), name)
  })

  app.delete<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const u = uid(req)
    const id = req.params.id
    if (!ownsAgent(u, id)) return reply.code(404).send({ error: 'not found' })
    registry.disconnect(id)
    db.deleteAgent(u, id)
    // Удалили выбранную цель выполнения — возвращаемся на сервер.
    const settings = db.getSettings(u)
    if (settings.execTarget === id) db.saveSettings(u, { ...settings, execTarget: null })
    return { ok: true }
  })

  // Политика возможностей машины: сохранить в БД и сразу отправить онлайн-агенту.
  app.post<{ Params: { id: string }; Body: { policy: AgentPolicy } }>(
    '/api/agents/:id/policy',
    async (req, reply) => {
      const u = uid(req)
      const policy = req.body?.policy
      if (!policy) return reply.code(400).send({ error: 'policy required' })
      if (!ownsAgent(u, req.params.id)) return reply.code(404).send({ error: 'not found' })
      db.setAgentPolicy(u, req.params.id, policy)
      registry.updatePolicy(req.params.id, policy)
      return { ok: true }
    }
  )

  // Перевыпуск токена: старый перестаёт работать, текущее соединение рвём.
  app.post<{ Params: { id: string } }>('/api/agents/:id/token', async (req, reply) => {
    const u = uid(req)
    if (!ownsAgent(u, req.params.id)) return reply.code(404).send({ error: 'not found' })
    const { token } = db.regenerateAgentToken(u, req.params.id)
    registry.disconnect(req.params.id)
    return { token }
  })

  // --- Файловый проводник по машине (все под проверкой владения) ---
  /** Проверка владения + читаемый ответ на ошибки агента (офлайн/политика). */
  const withFs = async (
    req: { params: { id: string } },
    reply: FastifyReply,
    run: (id: string) => Promise<unknown>
  ): Promise<unknown> => {
    const u = uid(req as never)
    if (!ownsAgent(u, req.params.id)) return reply.code(404).send({ error: 'not found' })
    try {
      return await run(req.params.id)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/agents/:id/fs',
    async (req, reply) => withFs(req, reply, (id) => registry.fsList(id, req.query.path ?? ''))
  )
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/agents/:id/fs/file',
    async (req, reply) => withFs(req, reply, (id) => registry.fsRead(id, req.query.path ?? ''))
  )
  app.post<{ Params: { id: string }; Body: { path?: string; dataBase64?: string } }>(
    '/api/agents/:id/fs/file',
    { bodyLimit: 48 * 1024 * 1024 }, // ~32 МБ файла + запас base64
    async (req, reply) =>
      withFs(req, reply, (id) => registry.fsWrite(id, req.body?.path ?? '', req.body?.dataBase64 ?? ''))
  )
  app.delete<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/agents/:id/fs',
    async (req, reply) => withFs(req, reply, (id) => registry.fsDelete(id, req.query.path ?? ''))
  )
  app.post<{ Params: { id: string }; Body: { from?: string; to?: string } }>(
    '/api/agents/:id/fs/rename',
    async (req, reply) =>
      withFs(req, reply, (id) => registry.fsRename(id, req.body?.from ?? '', req.body?.to ?? ''))
  )
  app.post<{ Params: { id: string }; Body: { path?: string } }>(
    '/api/agents/:id/fs/mkdir',
    async (req, reply) => withFs(req, reply, (id) => registry.fsMkdir(id, req.body?.path ?? ''))
  )

  // Утилита «Консоль»: выполнить команду на своей машине (проверка политики — в registry.exec).
  app.post<{ Params: { id: string }; Body: { command?: string } }>(
    '/api/agents/:id/exec',
    async (req, reply) =>
      withFs(req, reply, (id) => registry.exec(id, req.body?.command ?? '', EXEC_TIMEOUT_MS))
  )
}

/** Таймаут пользовательской команды консоли. */
const EXEC_TIMEOUT_MS = 60_000
