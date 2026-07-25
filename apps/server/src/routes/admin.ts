// Админ-роуты (только для роли admin): управление пользователями, отчёты по
// токенам, просмотр истории. Все под guard requireAdmin.

import type { FastifyInstance } from 'fastify'
import { REST, type AdminUserInfo, type UsageUnit, type UserRole } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { AgentRegistry } from '../agents/registry.js'
import { requireAdmin, uid } from '../users/auth.js'

const UNITS: UsageUnit[] = ['hour', 'day', 'week']

export function registerAdminRoutes(
  app: FastifyInstance,
  db: VoiceChatDb,
  registry: AgentRegistry
): void {
  const guard = { preHandler: requireAdmin }

  /** Собирает карточку пользователя: роль/блок + машины (с онлайн) + число разговоров. */
  const toInfo = (name: string, role: UserRole, blocked: boolean, createdAt: number): AdminUserInfo => {
    const online = registry.onlineIds()
    const agents = db.listAgents(name).map((a) => ({ ...a, online: online.has(a.id) }))
    return { name, role, blocked, createdAt, agents, conversationCount: db.listConversations(name).length }
  }

  app.get(REST.adminUsers, guard, async (): Promise<AdminUserInfo[]> =>
    db.listUsers().map((u) => toInfo(u.name, u.role, u.blocked, u.createdAt))
  )

  app.post<{ Body: { name?: string; password?: string; role?: string } }>(
    REST.adminUsers,
    guard,
    async (req, reply) => {
      const name = req.body?.name?.trim()
      const role = req.body?.role
      if (!name) return reply.code(400).send({ error: 'name required' })
      if (role !== 'admin' && role !== 'user') return reply.code(400).send({ error: 'bad role' })
      if (db.getUser(name)) return reply.code(409).send({ error: 'пользователь уже существует' })
      const u = db.createUser(name, req.body?.password ?? '', role)
      return toInfo(u.name, u.role, u.blocked, u.createdAt)
    }
  )

  app.post<{ Params: { name: string }; Body: { blocked?: boolean } }>(
    '/api/admin/users/:name/block',
    guard,
    async (req, reply) => {
      const target = req.params.name
      if (target === 'admin') return reply.code(400).send({ error: 'нельзя изменить admin' })
      if (!db.getUser(target)) return reply.code(404).send({ error: 'not found' })
      db.setUserBlocked(target, Boolean(req.body?.blocked))
      return { ok: true }
    }
  )

  app.delete<{ Params: { name: string } }>('/api/admin/users/:name', guard, async (req, reply) => {
    const target = req.params.name
    if (target === 'admin') return reply.code(400).send({ error: 'нельзя удалить admin' })
    if (target === uid(req)) return reply.code(400).send({ error: 'нельзя удалить себя' })
    if (!db.getUser(target)) return reply.code(404).send({ error: 'not found' })
    // Рвём соединения его онлайн-машин, затем удаляем все данные + учётку.
    for (const a of db.listAgents(target)) registry.disconnect(a.id)
    db.deleteUserData(target)
    return { ok: true }
  })

  app.get<{ Params: { name: string }; Querystring: { unit?: string; from?: string; to?: string } }>(
    '/api/admin/users/:name/usage',
    guard,
    async (req) => {
      const unit = (UNITS as string[]).includes(req.query.unit ?? '')
        ? (req.query.unit as UsageUnit)
        : 'day'
      const from = req.query.from ? Number(req.query.from) : undefined
      const to = req.query.to ? Number(req.query.to) : undefined
      return db.usageReport(req.params.name, unit, from, to)
    }
  )

  app.get<{ Params: { name: string } }>(
    '/api/admin/users/:name/conversations',
    guard,
    async (req) => db.listConversations(req.params.name)
  )

  app.get<{ Params: { name: string }; Querystring: { conversationId?: string } }>(
    '/api/admin/users/:name/messages',
    guard,
    async (req) => db.listMessages(req.params.name, req.query.conversationId ?? '')
  )
}
