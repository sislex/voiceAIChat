// Админ-роуты (только для роли admin): управление пользователями, отчёты по
// токенам, просмотр истории и реестр LLM-исполнителей. Все под guard requireAdmin.

import { request } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readSignupConfig } from '../users/auth.js'
import { checkPasswordPolicy } from '@voicechat/shared'
import { hibpEnabled, pwnedCount } from '../users/pwned.js'
import type { AdminMakeStats } from '@voicechat/shared'
import { formatMakeMetrics } from '../make/metrics.js'
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
import { updateAgentOnMachine } from './agents.js'

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
  deployTrigger?: DeployTrigger,
  makeStats?: () => Promise<AdminMakeStats>,
  mailConfigured = false
): void {
  const guard = { preHandler: requireAdmin }

  // Метрики Make (п.38): место, публикации, просмотры — по системе и по пользователям.
  // Сессии пользователей (auth-roadmap п.4): список и отзыв администратором.
  app.get<{ Params: { name: string } }>(REST.adminSessions(':name').replace('%3Aname', ':name'), guard, async (req, reply) => {
    if (!db.getUser(req.params.name)) return reply.code(404).send({ error: 'not found' })
    return { sessions: db.listSessions(req.params.name) }
  })
  app.delete<{ Params: { sid: string } }>(REST.adminSessionRevoke(':sid').replace('%3Asid', ':sid'), guard, async (req, reply) => {
    return db.revokeSessionById(req.params.sid) ? { ok: true } : reply.code(404).send({ error: 'not found' })
  })
  // Открытая регистрация: включить/выключить и роль новых пользователей.
  app.get(REST.adminSignup, guard, async () => ({ ...readSignupConfig(db), mailConfigured: Boolean(mailConfigured) }))
  app.put<{ Body: { enabled?: boolean; role?: string } | undefined }>(REST.adminSignup, guard, async (req, reply) => {
    const role = req.body?.role
    if (role !== undefined && role !== 'admin' && role !== 'developer' && role !== 'tester' && role !== 'observer') return reply.code(400).send({ error: 'bad role' })
    if (typeof req.body?.enabled === 'boolean') db.setAppConfig('signup.enabled', req.body.enabled ? '1' : '0')
    if (role) db.setAppConfig('signup.role', role)
    return { ...readSignupConfig(db), mailConfigured: Boolean(mailConfigured) }
  })
  // Код сброса пароля (auth-roadmap п.10): администратор выдаёт одноразовый код на 24 часа, пользователь вводит его на экране входа.
  app.post<{ Params: { name: string } }>(REST.adminUserResetCode(':name').replace('%3Aname', ':name'), guard, async (req, reply) => {
    if (!db.getUser(req.params.name)) return reply.code(404).send({ error: 'not found' })
    const code = randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8).toUpperCase()
    const ttl = 24 * 60 * 60_000
    db.setResetCode(req.params.name, code, ttl)
    db.logSecurityEvent({ user: req.params.name, type: 'reset_code_issued', ip: req.ip, details: `администратор ${uid(req)}` })
    return { code, expiresAt: Date.now() + ttl }
  })
  // Инвайты на саморегистрацию (auth-roadmap п.8): создать (роль, срок, лимит), список, отозвать.
  app.get(REST.adminInvites, guard, async () => ({ invites: db.listInvites() }))
  app.post<{ Body: { role?: string; ttlHours?: number; maxUses?: number; note?: string } | undefined }>(REST.adminInvites, guard, async (req, reply) => {
    const role = req.body?.role
    if (role !== 'admin' && role !== 'developer' && role !== 'tester' && role !== 'observer') return reply.code(400).send({ error: 'bad role' })
    const ttlHours = Math.min(Math.max(Number(req.body?.ttlHours ?? 72), 1), 24 * 30)
    const maxUses = Math.min(Math.max(Number(req.body?.maxUses ?? 1), 1), 100)
    const invite = db.createInvite({ token: randomBytes(18).toString('base64url'), role, createdBy: uid(req), ttlMs: ttlHours * 60 * 60_000, maxUses, note: req.body?.note })
    db.logSecurityEvent({ user: uid(req), type: 'invite_created', ip: req.ip, details: `роль ${role}, ${maxUses} исп., ${ttlHours} ч` })
    return invite
  })
  app.delete<{ Params: { token: string } }>(REST.adminInvite(':token').replace('%3Atoken', ':token'), guard, async (req, reply) => {
    return db.deleteInvite(req.params.token) ? { ok: true } : reply.code(404).send({ error: 'not found' })
  })
  // Журнал безопасности (auth-roadmap п.7).
  app.get<{ Querystring: { user?: string; limit?: string } }>(REST.adminSecurity, guard, async (req) => ({ events: db.listSecurityEvents({ user: req.query.user || undefined, limit: req.query.limit ? Number(req.query.limit) : undefined }) }))
  app.get(REST.adminMakeStats, guard, async (_req, reply) => {
    if (!makeStats) return reply.code(404).send({ error: 'Make недоступен' })
    return makeStats()
  })
  // Те же цифры в формате Prometheus (roadmap-2 п.17) — для скрейпа с Bearer-токеном администратора.
  app.get(REST.adminMakeMetrics, guard, async (_req, reply) => {
    if (!makeStats) return reply.code(404).send({ error: 'Make недоступен' })
    return reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8').send(formatMakeMetrics(await makeStats()))
  })

  /** Собирает карточку пользователя: роль/блок + машины (с онлайн) + число разговоров. */
  const toInfo = (name: string, role: UserRole, blocked: boolean, createdAt: number, lock: { failedLogins?: number; lockedUntil?: number | null; lockReason?: string | null; mustChangePassword?: boolean; lastLogin?: number | null; llmLimitUsd?: number | null; email?: string | null } = {}): AdminUserInfo => {
    const online = registry.onlineIds()
    // Версия нужна админке для «обновить до актуальной» (п.16); у офлайн-машины её нет.
    const agents = db.listAgents(name).map((a) => ({ ...a, online: online.has(a.id), ...(online.has(a.id) && registry.versionOf(a.id) ? { version: registry.versionOf(a.id) } : {}) }))
    // Админу — все беседы пользователя: скрытие чатов завершённых задач это
    // фильтр сайдбара их владельца, а не свойство данных.
    return { failedLogins: lock.failedLogins ?? 0, lockedUntil: lock.lockedUntil ?? null, lockReason: lock.lockReason ?? null, mustChangePassword: Boolean(lock.mustChangePassword), lastLogin: lock.lastLogin ?? null, llmLimitUsd: lock.llmLimitUsd ?? null, email: lock.email ?? null, name, role, blocked, createdAt, agents, conversationCount: db.listConversations(name, { includeCompleted: true }).length }
  }

  app.get(REST.adminUsers, guard, async (): Promise<AdminUserInfo[]> =>
    db.listUsers().map((u) => toInfo(u.name, u.role, u.blocked, u.createdAt, u))
  )

  // Обновление агента на любой машине (machines-roadmap п.16): владение не требуется — админ.
  app.post<{ Params: { id: string } }>(REST.adminMachineUpdate(':id').replace('%3Aid', ':id'), guard, async (req, reply) => {
    if (!db.agentOwnerId(req.params.id)) return reply.code(404).send({ error: 'not found' })
    const result = await updateAgentOnMachine(registry, req.params.id, req)
    if ('status' in result) return reply.code(result.status).send({ error: result.error })
    return result
  })

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

  app.post<{ Body: { name?: string; password?: string; role?: string; mustChangePassword?: boolean } }>(
    REST.adminUsers,
    guard,
    async (req, reply) => {
      const name = req.body?.name?.trim()
      const role = req.body?.role
      if (!name) return reply.code(400).send({ error: 'name required' })
      if (role !== 'admin' && role !== 'developer' && role !== 'tester' && role !== 'observer') return reply.code(400).send({ error: 'bad role' })
      if (db.getUser(name)) return reply.code(409).send({ error: 'пользователь уже существует' })
      // Политика пароля (auth-roadmap п.2): пустые и слабые пароли не принимаем; HIBP — только при VC_HIBP_CHECK=1, fail-open.
      const password = req.body?.password ?? ''
      const violation = checkPasswordPolicy(password, { name })
      if (violation) return reply.code(400).send({ error: violation })
      if (hibpEnabled()) {
        const count = await pwnedCount(password)
        if (count && count > 0) return reply.code(400).send({ error: `Этот пароль встречался в утечках (${count}) — выберите другой` })
      }
      const u = db.createUser(name, password, role)
      if (req.body?.mustChangePassword) db.setMustChangePassword(name, true)
      db.logSecurityEvent({ user: name, type: 'password_set', ip: req.ip, details: `учётка создана администратором ${uid(req)}${req.body?.mustChangePassword ? ', временный пароль' : ''}` })
      return toInfo(u.name, u.role, u.blocked, u.createdAt, u)
    }
  )

  app.patch<{ Params: { name: string }; Body: { role?: string; llmLimitUsd?: number | null } }>(
    REST.adminUser(':name').replace('%3Aname', ':name'),
    guard,
    async (req, reply) => {
      // Лимит расхода LLM (п.17) можно менять отдельно от роли: тело только с llmLimitUsd.
      if ('llmLimitUsd' in (req.body ?? {}) && req.body?.role === undefined) {
        if (!db.getUser(req.params.name)) return reply.code(404).send({ error: 'not found' })
        const v = req.body?.llmLimitUsd
        db.setUserLlmLimit(req.params.name, v === null || v === undefined ? null : Math.max(0, Number(v)))
        const u = db.getUser(req.params.name)!
        return toInfo(u.name, u.role, u.blocked, u.createdAt, u)
      }
      const role = req.body?.role
      if (role !== 'admin' && role !== 'developer' && role !== 'tester' && role !== 'observer') return reply.code(400).send({ error: 'bad role' })
      const user = db.setUserRole(req.params.name, role)
      return user ? toInfo(user.name, user.role, user.blocked, user.createdAt, user) : reply.code(404).send({ error: 'not found' })
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
      db.logSecurityEvent({ user: target, type: req.body?.blocked ? 'user_blocked' : 'user_unblocked', ip: req.ip, details: `администратор ${uid(req)}` })
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
