// Админ-роуты (только для роли admin): управление пользователями, отчёты по
// токенам, просмотр истории и реестр LLM-исполнителей. Все под guard requireAdmin.

import { request } from 'node:http'
import type { FastifyInstance } from 'fastify'
import {
  LLM_RUNNER,
  REST,
  type AdminDeployResponse,
  type AdminLlmEngineHealth,
  type AdminLlmEngineInput,
  type AdminUserInfo,
  type ModelPriceInput,
  type LlmEngineKind,
  type LlmRunnerHealth,
  type UsageUnit,
  type UserRole,
  type UserLlmAccess,
  CLAUDE_MODELS,
  CODEX_MODELS
} from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { AgentRegistry } from '../agents/registry.js'
import { requireAdmin, uid } from '../users/auth.js'

const UNITS: UsageUnit[] = ['hour', 'day', 'week']
const ENGINE_KINDS: LlmEngineKind[] = ['claude', 'codex']
const ROLES: UserRole[] = ['admin', 'developer', 'tester', 'observer']
const HEALTH_TIMEOUT_MS = 5_000

export interface DeployTrigger {
  trigger(): Promise<AdminDeployResponse>
}

/** Клиент host-side API через Unix-сокет: сеть и Docker socket серверу не выдаются. */
export class UnixDeployClient implements DeployTrigger {
  constructor(
    private readonly socketPath: string,
    private readonly timeoutMs = 5_000
  ) {}

  trigger(): Promise<AdminDeployResponse> {
    return new Promise((resolve, reject) => {
      const req = request({
        socketPath: this.socketPath,
        path: '/deploy',
        method: 'POST',
        headers: { 'content-length': '0' }
      }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          let body: unknown
          try {
            body = JSON.parse(raw)
          } catch {
            reject(new Error(`deploy API returned invalid JSON (${res.statusCode ?? 0})`))
            return
          }
          if (res.statusCode !== 202 && res.statusCode !== 409) {
            const detail = body && typeof body === 'object' && 'error' in body
              ? String((body as { error: unknown }).error)
              : `HTTP ${res.statusCode ?? 0}`
            reject(new Error(detail))
            return
          }
          const candidate = body as Partial<AdminDeployResponse>
          if ((candidate.status !== 'accepted' && candidate.status !== 'running') || typeof candidate.message !== 'string') {
            reject(new Error('deploy API returned an invalid response'))
            return
          }
          resolve({ status: candidate.status, message: candidate.message })
        })
      })
      req.setTimeout(this.timeoutMs, () => req.destroy(new Error('deploy API timeout')))
      req.on('error', reject)
      req.end()
    })
  }
}

function validateLlmAccess(value: unknown): UserLlmAccess[] | null {
  if (!Array.isArray(value)) return null
  const seen = new Set<string>()
  const out: UserLlmAccess[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null
    const { provider, modelId } = entry as { provider?: unknown; modelId?: unknown }
    if ((provider !== 'claude' && provider !== 'codex') || typeof modelId !== 'string') return null
    const models = provider === 'claude' ? CLAUDE_MODELS : CODEX_MODELS
    if (modelId !== '*' && !models.some((model) => model.id === modelId)) return null
    const key = `${provider}:${modelId}`
    if (!seen.has(key)) { seen.add(key); out.push({ provider, modelId }) }
  }
  return out
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function validateEngineInput(body: Partial<AdminLlmEngineInput> | undefined): { ok: true; value: AdminLlmEngineInput } | { ok: false; error: string } {
  const name = body?.name?.trim() ?? ''
  const baseUrl = body?.baseUrl?.trim() ?? ''
  const token = body?.token ?? ''
  if (!name) return { ok: false, error: 'name required' }
  if (!ENGINE_KINDS.includes(body?.kind as LlmEngineKind)) return { ok: false, error: 'bad kind' }
  if (!baseUrl || !isAbsoluteHttpUrl(baseUrl)) return { ok: false, error: 'bad baseUrl' }
  if (!Array.isArray(body?.allowedRoles) || body.allowedRoles.length === 0) return { ok: false, error: 'allowedRoles required' }
  const allowedRoles = body.allowedRoles.filter((role): role is UserRole => ROLES.includes(role as UserRole))
  if (allowedRoles.length !== body.allowedRoles.length) return { ok: false, error: 'bad allowedRoles' }
  if (typeof body?.enabled !== 'boolean') return { ok: false, error: 'enabled required' }
  if (typeof body?.isDefault !== 'boolean') return { ok: false, error: 'isDefault required' }
  return {
    ok: true,
    value: {
      name,
      kind: body.kind as LlmEngineKind,
      baseUrl,
      token,
      enabled: body.enabled,
      allowedRoles,
      isDefault: body.isDefault
    }
  }
}

function validateModelPrice(body: Partial<ModelPriceInput> | undefined): { ok: true; value: ModelPriceInput } | { ok: false; error: string } {
  const provider = body?.provider?.trim() ?? ''
  const model = body?.model?.trim() ?? ''
  const sourceUrl = body?.sourceUrl?.trim() ?? ''
  const values = [body?.inputPerMillion, body?.cachedInputPerMillion, body?.cacheWritePerMillion, body?.outputPerMillion, body?.effectiveAt]
  if (!provider || !model) return { ok: false, error: 'provider and model required' }
  if (!sourceUrl || !isAbsoluteHttpUrl(sourceUrl)) return { ok: false, error: 'bad sourceUrl' }
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) return { ok: false, error: 'bad price values' }
  return { ok: true, value: { provider, model, sourceUrl, inputPerMillion: body!.inputPerMillion!, cachedInputPerMillion: body!.cachedInputPerMillion!, cacheWritePerMillion: body!.cacheWritePerMillion!, outputPerMillion: body!.outputPerMillion!, effectiveAt: body!.effectiveAt! } }
}

function healthUrl(baseUrl: string) {
  return new URL(LLM_RUNNER.health, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
}

function healthDetail(kind: LlmEngineKind, status: LlmRunnerHealth): { available: boolean; detail: string } {
  const bin = status.bins[kind]
  const login = status.login[kind]
  if (!bin?.present) return { available: false, detail: `${kind}: бинарь не найден` }
  if (!login?.loggedIn) return { available: false, detail: login?.detail ?? `${kind}: вход не выполнен` }
  return { available: true, detail: `${kind}: доступен` }
}

async function probeEngineHealth(engine: { id: string; kind: LlmEngineKind; baseUrl: string; token: string }): Promise<AdminLlmEngineHealth> {
  const checkedAt = Date.now()
  const url = healthUrl(engine.baseUrl)
  try {
    const res = await fetch(url, {
      headers: engine.token ? { authorization: `Bearer ${engine.token}` } : undefined,
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
    })
    if (!res.ok) {
      return {
        engineId: engine.id,
        kind: engine.kind,
        checkedAt,
        available: false,
        detail: `health вернул ${res.status}`,
        status: null
      }
    }
    const status = (await res.json()) as LlmRunnerHealth
    const pair = healthDetail(engine.kind, status)
    return {
      engineId: engine.id,
      kind: engine.kind,
      checkedAt,
      available: pair.available,
      detail: pair.detail,
      status
    }
  } catch (err) {
    return {
      engineId: engine.id,
      kind: engine.kind,
      checkedAt,
      available: false,
      detail: err instanceof Error ? err.message : String(err),
      status: null
    }
  }
}

export function registerAdminRoutes(
  app: FastifyInstance,
  db: VoiceChatDb,
  registry: AgentRegistry,
  deployTrigger?: DeployTrigger
): void {
  const guard = { preHandler: requireAdmin }

  /** Собирает карточку пользователя: роль/блок + машины (с онлайн) + число разговоров. */
  const toInfo = (name: string, role: UserRole, blocked: boolean, createdAt: number): AdminUserInfo => {
    const online = registry.onlineIds()
    const agents = db.listAgents(name).map((a) => ({ ...a, online: online.has(a.id) }))
    // Админу — все беседы пользователя: скрытие чатов завершённых задач это
    // фильтр сайдбара их владельца, а не свойство данных.
    return { name, role, blocked, createdAt, agents, conversationCount: db.listConversations(name, { includeCompleted: true }).length }
  }

  app.get(REST.adminUsers, guard, async (): Promise<AdminUserInfo[]> =>
    db.listUsers().map((u) => toInfo(u.name, u.role, u.blocked, u.createdAt))
  )

  app.post(REST.adminDeploy, guard, async (_req, reply) => {
    if (!deployTrigger) return reply.code(503).send({ error: 'deploy API is not configured' })
    try {
      const result = await deployTrigger.trigger()
      return reply.code(result.status === 'accepted' ? 202 : 409).send(result)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      app.log.error({ err }, 'host-side deploy API request failed')
      return reply.code(503).send({ error: 'deploy API unavailable', detail })
    }
  })

  // Агрегаты строятся одним запросом к БД, а не вызовом usageReport для каждого
  // пользователя: это таблица дашборда, а не набор персональных отчётов.
  app.get<{ Querystring: { from?: string; to?: string } }>(REST.adminUsersUsageSummary, guard, async (req, reply) => {
    const parse = (value: string | undefined): number | undefined => value === undefined || value === '' ? undefined : Number(value)
    const from = parse(req.query.from)
    const to = parse(req.query.to)
    if (!Number.isFinite(from ?? 0) && from !== undefined || !Number.isFinite(to ?? 0) && to !== undefined) return reply.code(400).send({ error: 'from and to must be timestamps' })
    return db.usageSummary(from, to)
  })

  app.post<{ Body: { name?: string; password?: string; role?: string } }>(
    REST.adminUsers,
    guard,
    async (req, reply) => {
      const name = req.body?.name?.trim()
      const role = req.body?.role
      if (!name) return reply.code(400).send({ error: 'name required' })
      if (role !== 'admin' && role !== 'developer' && role !== 'tester' && role !== 'observer') return reply.code(400).send({ error: 'bad role' })
      if (db.getUser(name)) return reply.code(409).send({ error: 'пользователь уже существует' })
      const u = db.createUser(name, req.body?.password ?? '', role)
      return toInfo(u.name, u.role, u.blocked, u.createdAt)
    }
  )

  app.patch<{ Params: { name: string }; Body: { role?: string } }>(
    REST.adminUser(':name').replace('%3Aname', ':name'),
    guard,
    async (req, reply) => {
      const role = req.body?.role
      if (role !== 'admin' && role !== 'developer' && role !== 'tester' && role !== 'observer') return reply.code(400).send({ error: 'bad role' })
      const user = db.setUserRole(req.params.name, role)
      return user ? toInfo(user.name, user.role, user.blocked, user.createdAt) : reply.code(404).send({ error: 'not found' })
    }
  )

  app.post<{ Params: { name: string }; Body: { blocked?: boolean } }>(
    REST.adminUserBlock(':name').replace('%3Aname', ':name'),
    guard,
    async (req, reply) => {
      const target = req.params.name
      if (target === 'admin') return reply.code(400).send({ error: 'нельзя изменить admin' })
      if (!db.getUser(target)) return reply.code(404).send({ error: 'not found' })
      db.setUserBlocked(target, Boolean(req.body?.blocked))
      return { ok: true }
    }
  )

  app.delete<{ Params: { name: string } }>(REST.adminUser(':name').replace('%3Aname', ':name'), guard, async (req, reply) => {
    const target = req.params.name
    if (target === 'admin') return reply.code(400).send({ error: 'нельзя удалить admin' })
    if (target === uid(req)) return reply.code(400).send({ error: 'нельзя удалить себя' })
    if (!db.getUser(target)) return reply.code(404).send({ error: 'not found' })
    // Рвём соединения его онлайн-машин, затем удаляем все данные + учётку.
    for (const a of db.listAgents(target)) registry.disconnect(a.id)
    db.deleteUserData(target)
    return { ok: true }
  })

  app.get<{ Params: { name: string }; Querystring: { unit?: string; from?: string; to?: string; conversationId?: string } }>(
    REST.adminUserUsage(':name').replace('%3Aname', ':name'),
    guard,
    async (req) => {
      const unit = (UNITS as string[]).includes(req.query.unit ?? '')
        ? (req.query.unit as UsageUnit)
        : 'day'
      const from = req.query.from ? Number(req.query.from) : undefined
      const to = req.query.to ? Number(req.query.to) : undefined
      return db.usageReport(req.params.name, unit, from, to, req.query.conversationId || undefined)
    }
  )

  app.get<{ Params: { name: string } }>(
    REST.adminUserConversations(':name').replace('%3Aname', ':name'),
    guard,
    async (req) => db.listConversations(req.params.name, { includeCompleted: true })
  )

  app.get<{ Params: { name: string }; Querystring: { conversationId?: string } }>(
    REST.adminUserMessages(':name').replace('%3Aname', ':name'),
    guard,
    async (req) => db.listMessages(req.params.name, req.query.conversationId ?? '')
  )

  app.get<{ Params: { name: string } }>(REST.adminUserLlmAccess(':name').replace('%3Aname', ':name'), guard, async (req, reply) => {
    if (!db.getUser(req.params.name)) return reply.code(404).send({ error: 'not found' })
    return db.getUserLlmAccess(req.params.name)
  })

  app.put<{ Params: { name: string }; Body: unknown }>(REST.adminUserLlmAccess(':name').replace('%3Aname', ':name'), guard, async (req, reply) => {
    if (!db.getUser(req.params.name)) return reply.code(404).send({ error: 'not found' })
    const access = validateLlmAccess(req.body)
    if (!access) return reply.code(400).send({ error: 'bad llm access' })
    db.setUserLlmAccess(req.params.name, access)
    return db.getUserLlmAccess(req.params.name)
  })

  app.get(REST.adminModelPrices, guard, async () => db.listModelPrices())

  app.put<{ Body: Partial<ModelPriceInput> }>(REST.adminModelPrices, guard, async (req, reply) => {
    const parsed = validateModelPrice(req.body)
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error })
    return db.upsertModelPrice(parsed.value)
  })

  app.delete<{ Params: { provider: string; model: string } }>(
    '/api/admin/model-prices/:provider/:model', guard, async (req, reply) => {
      if (!db.deleteModelPrice(req.params.provider, req.params.model)) return reply.code(404).send({ error: 'not found' })
      return { ok: true }
    }
  )

  app.get(REST.adminLlmEngines, guard, async () => db.listLlmEngines())

  app.post<{ Body: Partial<AdminLlmEngineInput> }>(REST.adminLlmEngines, guard, async (req, reply) => {
    const parsed = validateEngineInput(req.body)
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error })
    return db.createLlmEngine(parsed.value)
  })

  app.patch<{ Params: { id: string }; Body: Partial<AdminLlmEngineInput> }>(
    REST.adminLlmEngine(':id').replace('%3Aid', ':id'),
    guard,
    async (req, reply) => {
      if (!db.getLlmEngine(req.params.id)) return reply.code(404).send({ error: 'not found' })
      const parsed = validateEngineInput(req.body)
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error })
      return db.updateLlmEngine(req.params.id, parsed.value)
    }
  )

  app.delete<{ Params: { id: string } }>(
    REST.adminLlmEngine(':id').replace('%3Aid', ':id'),
    guard,
    async (req, reply) => {
      if (!db.getLlmEngine(req.params.id)) return reply.code(404).send({ error: 'not found' })
      db.deleteLlmEngine(req.params.id)
      return { ok: true }
    }
  )

  app.get<{ Params: { id: string } }>(
    REST.adminLlmEngineHealth(':id').replace('%3Aid', ':id'),
    guard,
    async (req, reply) => {
      const engine = db.getLlmEngine(req.params.id)
      if (!engine) return reply.code(404).send({ error: 'not found' })
      return probeEngineHealth(engine)
    }
  )
}
