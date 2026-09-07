// Домен «machines»: таблицы agents, machine_commands, machine_events, machine_storages, chat_storage_bindings, generated_cleanup_retry, login_enrollments, machine_project_shares, machine_project_share_audit, project_machines, user_project_machine_defaults, git_workspace_locks.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import type { MachineCommandRecord, MachineCommandSource, RoleCommandPolicies, MachineShareAccess, MachineAccessLevel } from '@voicechat/shared'
import { parseRoleCommandPolicies, DEFAULT_AGENT_POLICY, type AgentCreated, type AgentPolicy, type ProjectDetail, type MachineStorage, type ChatStorageBinding, type ProjectMachineDirectoryAssignments, type ProjectMachineDirectoryKind, recommendedProjectMachineDirectories, validateProjectMachineDirectories, validateStorageRelativePath } from '@voicechat/shared'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { BaseRepo } from './base.js'

interface AgentRow {
  id: string
  name: string
  token_hash: string
  created_at: number
  last_seen: number | null
  policy: string | null
  user_id: string | null
  token_expires_at?: number | null
  token_issued_at?: number | null
  last_ip?: string | null
  pin_ip?: number | null
}

/** Запись машины-агента из БД (онлайн-статус добавляется реестром). */
export interface AgentRecord {
  id: string
  name: string
  createdAt: number
  lastSeen: number | null
  policy: AgentPolicy
  /** Владелец машины (пользователь, создавший её). */
  userId: string | null
  /** Токен (п.11): срок, дата выпуска, IP последнего подключения и привязка к нему. */
  tokenExpiresAt: number | null
  tokenIssuedAt: number | null
  lastIp: string | null
  pinIp: boolean
}

/** Парсит JSON-политику из БД с откатом к дефолту (терпит старые/битые строки). */
function parsePolicy(raw: string | null): AgentPolicy {
  if (!raw) return { ...DEFAULT_AGENT_POLICY }
  try {
    return { ...DEFAULT_AGENT_POLICY, ...(JSON.parse(raw) as Partial<AgentPolicy>) }
  } catch {
    return { ...DEFAULT_AGENT_POLICY }
  }
}

/** sha256(token) в hex — токены храним только хэшем. */
export function hashAgentToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
export class MachinesRepo extends BaseRepo {
  /** Владелец машины (user_id агента); null — машина неизвестна. */
  async agentOwnerId(agentId: string): Promise<string | null> {
    const r = (await this.sql.get(`SELECT user_id FROM agents WHERE id = ?`, [agentId])) as { user_id?: string | null } | undefined
    return r?.user_id ?? null
  }

  async listMachineStorages(userId: string, machineId?: string): Promise<MachineStorage[]> {
    const rows = (await this.sql.all(`SELECT s.id, s.machine_id, s.root_path, s.format_version
       FROM machine_storages s JOIN agents a ON a.id = s.machine_id
       WHERE a.user_id = ? AND (? IS NULL OR s.machine_id = ?)
       ORDER BY s.created_at ASC`, [userId, machineId ?? null, machineId ?? null])) as Array<{ id: string; machine_id: string; root_path: string; format_version: number }>
    return rows.map((row) => ({
      id: row.id,
      machineId: row.machine_id,
      rootPath: row.root_path,
      formatVersion: row.format_version,
      status: 'ready'
    }))
  }

  async saveMachineStorage(userId: string, machineId: string, rootPath: string, formatVersion: number, preferredId?: string): Promise<MachineStorage> {
    if (!(await this.sql.get(`SELECT 1 FROM agents WHERE id = ? AND user_id = ?`, [machineId, userId]))) {
      throw new Error('Машина не найдена')
    }
    const normalized = rootPath.trim().replace(/[\\/]+$/, '')
    if (!normalized) throw new Error('rootPath required')
    const existing = (await this.sql.get(`SELECT id FROM machine_storages WHERE machine_id = ? AND root_path = ?`, [machineId, normalized])) as { id: string } | undefined
    const id = existing?.id ?? preferredId ?? this.newId()
    const now = this.now()
    await this.sql.run(`INSERT INTO machine_storages (id,machine_id,root_path,format_version,created_at,updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(machine_id,root_path) DO UPDATE SET format_version=excluded.format_version,updated_at=excluded.updated_at`, [id, machineId, normalized, formatVersion, now, now])
    return { id, machineId, rootPath: normalized, formatVersion, status: 'ready' }
  }

  async getChatStorageBinding(userId: string, conversationId: string): Promise<ChatStorageBinding | null> {
    if (!(await this.repos.chat.ownsConversation(userId, conversationId))) return null
    const row = (await this.sql.get(`SELECT conversation_id,machine_id,storage_id,relative_path FROM chat_storage_bindings WHERE conversation_id=?`, [conversationId])) as { conversation_id: string; machine_id: string; storage_id: string; relative_path: string } | undefined
    return row ? {
      conversationId: row.conversation_id,
      machineId: row.machine_id,
      storageId: row.storage_id,
      relativePath: row.relative_path
    } : null
  }

  async saveChatStorageBinding(userId: string, binding: ChatStorageBinding): Promise<ChatStorageBinding> {
    if (!(await this.repos.chat.ownsConversation(userId, binding.conversationId))) throw new Error('Чат не найден')
    const storage = (await this.sql.get(`SELECT s.machine_id FROM machine_storages s JOIN agents a ON a.id=s.machine_id
       WHERE s.id=? AND a.user_id=?`, [binding.storageId, userId])) as { machine_id: string } | undefined
    if (!storage || storage.machine_id !== binding.machineId) throw new Error('Хранилище не найдено')
    const relativePath = validateStorageRelativePath(binding.relativePath)
    await this.sql.run(`INSERT INTO chat_storage_bindings (conversation_id,machine_id,storage_id,relative_path,updated_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(conversation_id) DO UPDATE SET machine_id=excluded.machine_id,storage_id=excluded.storage_id,relative_path=excluded.relative_path,updated_at=excluded.updated_at`, [binding.conversationId, binding.machineId, binding.storageId, relativePath, this.now()])
    return { ...binding, relativePath }
  }

  /** Managed-разговоры и due-retry образуют идемпотентный набор целей прохода. */
  async listGeneratedCleanupTargets(now = this.now()): Promise<Array<{ userId: string; conversationId: string }>> {
    const rows = (await this.sql.all(`SELECT c.user_id,c.id FROM conversations c JOIN chat_storage_bindings b ON b.conversation_id=c.id
       LEFT JOIN generated_cleanup_retry r ON r.conversation_id=c.id
       WHERE c.user_id IS NOT NULL AND (r.next_attempt_at IS NULL OR r.next_attempt_at<=?)`, [now])) as Array<{ user_id: string; id: string }>
    return rows.map((row) => ({ userId: row.user_id, conversationId: row.id }))
  }

  async deferGeneratedCleanup(userId: string, conversationId: string, error: string, nextAttemptAt: number): Promise<void> {
    await this.sql.run(`INSERT INTO generated_cleanup_retry(conversation_id,user_id,attempts,last_error,next_attempt_at,updated_at)
       VALUES(?,?,1,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET
       attempts=attempts+1,last_error=excluded.last_error,next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at`, [conversationId, userId, error.slice(0, 500), nextAttemptAt, this.now()])
  }

  async completeGeneratedCleanup(conversationId: string): Promise<void> {
    await this.sql.run(`DELETE FROM generated_cleanup_retry WHERE conversation_id=?`, [conversationId])
  }

  async getGeneratedCleanupRetry(conversationId: string): Promise<{ attempts: number; lastError: string; nextAttemptAt: number } | null> {
    const row = (await this.sql.get(`SELECT attempts,last_error,next_attempt_at FROM generated_cleanup_retry WHERE conversation_id=?`, [conversationId])) as { attempts: number; last_error: string; next_attempt_at: number } | undefined
    return row ? { attempts: row.attempts, lastError: row.last_error, nextAttemptAt: row.next_attempt_at } : null
  }

  /** Выпускает opaque enrollment: в БД хранится только SHA-256, status id не является секретом. */
  async createLoginEnrollment(userId: string, ttlMs: number): Promise<{ token: string; statusId: string; expiresAt: number }> {
    const token = randomBytes(32).toString('base64url')
    const statusId = randomUUID()
    const expiresAt = this.now() + ttlMs
    await this.sql.run('INSERT INTO login_enrollments(status_id,token_hash,user_id,expires_at,consumed_at,agent_id,created_at) VALUES(?,?,?,?,NULL,NULL,?)', [statusId, createHash('sha256').update(token).digest('hex'), userId, expiresAt, this.now()])
    return { token, statusId, expiresAt }
  }

  async getLoginEnrollmentStatus(userId: string, statusId: string): Promise<{ status: 'pending' | 'completed' | 'expired'; agentId?: string; expiresAt: number } | null> {
    const row = (await this.sql.get('SELECT expires_at,consumed_at,agent_id FROM login_enrollments WHERE status_id=? AND user_id=?', [statusId, userId])) as { expires_at: number; consumed_at: number | null; agent_id: string | null } | undefined
    if (!row) return null
    if (row.consumed_at && row.agent_id) return { status: 'completed', agentId: row.agent_id, expiresAt: row.expires_at }
    return { status: row.expires_at <= this.now() ? 'expired' : 'pending', expiresAt: row.expires_at }
  }

  /** Атомарно погашает enrollment, создаёт ровно одну машину и назначает personal default. */
  async redeemLoginEnrollment(token: string, name: string): Promise<(AgentCreated & { userId: string }) | null> {
    const tokenHash = createHash('sha256').update(token).digest('hex')
    return await this.sql.transaction(async () => {
      const row = (await this.sql.get('SELECT status_id,user_id FROM login_enrollments WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?', [tokenHash, this.now()])) as { status_id: string; user_id: string } | undefined
      if (!row) return null
      const agent = await this.createAgent(row.user_id, name)
      const consumed = await this.sql.run('UPDATE login_enrollments SET consumed_at=?,agent_id=? WHERE status_id=? AND consumed_at IS NULL AND expires_at>?', [this.now(), agent.id, row.status_id, this.now()])
      if (consumed.changes !== 1) throw new Error('enrollment already consumed')
      const settings = await this.repos.settings.readSettings(row.user_id)
      await this.repos.settings.saveSettings(row.user_id, { ...settings, defaultAgentId: agent.id })
      return { ...agent, userId: row.user_id }
    })
  }

  /** Создаёт машину-агента пользователя; возвращает токен открытым текстом (раз). */
  async createAgent(userId: string, name: string): Promise<AgentCreated> {
    const id = this.newId()
    const token = randomBytes(24).toString('hex')
    await this.sql.run(`INSERT INTO agents (id, name, token_hash, created_at, last_seen, policy, user_id)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`, [id, name, hashAgentToken(token), this.now(), JSON.stringify(DEFAULT_AGENT_POLICY), userId])
    return { id, name, token }
  }

  private mapAgent(r: AgentRow): AgentRecord {
    return {
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      lastSeen: r.last_seen,
      policy: parsePolicy(r.policy),
      userId: r.user_id,
      tokenExpiresAt: r.token_expires_at ?? null,
      tokenIssuedAt: r.token_issued_at ?? null,
      lastIp: r.last_ip ?? null,
      pinIp: r.pin_ip === 1
    }
  }

  /** Агрегаты по командам и тревогам машины (machines-roadmap п.5); без online/версии/телеметрии — их знает реестр. */
  async machineStatsRows(now = Date.now()): Promise<Array<{ machineId: string; commandsTotal: number; commands24h: number; errors24h: number; avgDurationMs24h: number; lastCommandAt: number | null; offlineEvents30d: number; offlineMs30d: number }>> {
    const dayAgo = now - 24 * 60 * 60_000
    const monthAgo = now - 30 * 24 * 60 * 60_000
    const cmd = (await this.sql.all(`SELECT machine_id AS machineId, COUNT(*) AS total,
        SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END) AS day,
        SUM(CASE WHEN started_at >= ? AND (error IS NOT NULL OR timed_out = 1 OR (exit_code IS NOT NULL AND exit_code <> 0)) THEN 1 ELSE 0 END) AS errors,
        AVG(CASE WHEN started_at >= ? THEN duration_ms END) AS avgMs,
        MAX(started_at) AS lastAt
      FROM machine_commands GROUP BY machine_id`, [dayAgo, dayAgo, dayAgo])) as Array<{ machineId: string; total: number; day: number; errors: number; avgMs: number | null; lastAt: number | null }>
    const ev = (await this.sql.all(`SELECT machine_id AS machineId, COUNT(*) AS n, COALESCE(SUM(offline_for_ms), 0) AS ms FROM machine_events WHERE state = 'offline' AND at >= ? GROUP BY machine_id`, [monthAgo])) as Array<{ machineId: string; n: number; ms: number }>
    const byId = new Map<string, { machineId: string; commandsTotal: number; commands24h: number; errors24h: number; avgDurationMs24h: number; lastCommandAt: number | null; offlineEvents30d: number; offlineMs30d: number }>()
    const get = (id: string) => { let r = byId.get(id); if (!r) { r = { machineId: id, commandsTotal: 0, commands24h: 0, errors24h: 0, avgDurationMs24h: 0, lastCommandAt: null, offlineEvents30d: 0, offlineMs30d: 0 }; byId.set(id, r) } return r }
    for (const c of cmd) { const r = get(c.machineId); r.commandsTotal = c.total; r.commands24h = c.day ?? 0; r.errors24h = c.errors ?? 0; r.avgDurationMs24h = Math.round(c.avgMs ?? 0); r.lastCommandAt = c.lastAt }
    for (const e of ev) { const r = get(e.machineId); r.offlineEvents30d = e.n; r.offlineMs30d = e.ms }
    return [...byId.values()]
  }

  /** Все машины всех пользователей — для серверного watchdog. */
  async listAllAgents(): Promise<AgentRecord[]> {
    const rows = (await this.sql.all(`SELECT * FROM agents ORDER BY created_at ASC`)) as AgentRow[]
    return rows.map((r) => this.mapAgent(r))
  }

  /** Watchdog: тревога «не в сети» / «вернулась» (machines-roadmap п.1). */
  async logMachineEvent(e: { machineId: string; userId: string; state: 'offline' | 'online'; at: number; offlineForMs: number }): Promise<void> {
    await this.sql.run(`INSERT INTO machine_events (machine_id, user_id, state, at, offline_for_ms) VALUES (?, ?, ?, ?, ?)`, [e.machineId, e.userId, e.state, e.at, e.offlineForMs])
  }

  async listMachineEvents(machineId: string, limit = 50): Promise<Array<{ id: number; machineId: string; userId: string; state: 'offline' | 'online'; at: number; offlineForMs: number }>> {
    const rows = (await this.sql.all(`SELECT * FROM machine_events WHERE machine_id = ? ORDER BY id DESC LIMIT ?`, [machineId, Math.min(Math.max(limit, 1), 500)])) as Array<{ id: number; machine_id: string; user_id: string; state: 'offline' | 'online'; at: number; offline_for_ms: number }>
    return rows.map((r) => ({ id: r.id, machineId: r.machine_id, userId: r.user_id, state: r.state, at: r.at, offlineForMs: r.offline_for_ms }))
  }

  async listAgents(userId: string): Promise<AgentRecord[]> {
    const rows = (await this.sql.all(`SELECT * FROM agents WHERE user_id = ? ORDER BY created_at ASC`, [userId])) as AgentRow[]
    return rows.map((r) => this.mapAgent(r))
  }

  /**
   * Машины, доступные в контексте чата: все личные и, только для действующего
   * участника проекта, связанные с ним машины. DISTINCT убирает личную машину,
   * которая одновременно добавлена в проект.
   */
  async listUsableAgents(userId: string, projectId?: string | null): Promise<AgentRecord[]> {
    const rows = (await this.sql.all(`SELECT DISTINCT a.*
       FROM agents a
       WHERE a.user_id = ?
          OR (? IS NOT NULL AND EXISTS (
            SELECT 1 FROM machine_project_shares share
            JOIN project_members member ON member.project_id = share.project_id
            JOIN users u ON u.name = member.username
            WHERE share.project_id = ? AND share.agent_id = a.id AND share.shared = 1
              AND member.username = ? AND u.blocked = 0
          ))
       ORDER BY a.created_at ASC`, [userId, projectId ?? null, projectId ?? null, userId])) as AgentRow[]
    return rows.map((r) => this.mapAgent(r))
  }

  /**
   * Единый гейт использования машины. Проектный доступ существует только при
   * явно переданном контексте проекта и действующем членстве пользователя.
   */
  /**
   * Доступ к машине для loopback-моста превью (тестовые окружения Web Reader):
   * владелец машины либо share в любом проекте, где пользователь — участник.
   */
  async canUseAgentForPreview(userId: string, agentId: string): Promise<boolean> {
    if (await this.sql.get(`SELECT 1 FROM agents WHERE id = ? AND user_id = ?`, [agentId, userId])) return true
    return Boolean(await this.sql.get(`SELECT 1 FROM machine_project_shares share
       JOIN project_members member ON member.project_id = share.project_id
       JOIN users u ON u.name = member.username
       WHERE share.agent_id = ? AND share.shared = 1 AND member.username = ? AND u.blocked = 0`, [agentId, userId]))
  }

  /**
   * Права пользователя на машину (machines-roadmap п.18): 'owner' — своя машина (полный доступ),
   * 'full'/'read' — уровень, с которым владелец предоставил её проекту, null — доступа нет.
   */
  async machineAccess(userId: string, agentId: string, projectId?: string | null): Promise<MachineAccessLevel | null> {
    if (await this.sql.get(`SELECT 1 FROM agents WHERE id = ? AND user_id = ?`, [agentId, userId])) return 'owner'
    if (!projectId) return null
    const row = (await this.sql.get(`SELECT share.access AS access FROM machine_project_shares share
       JOIN project_members member ON member.project_id = share.project_id
       JOIN users u ON u.name = member.username
       WHERE share.project_id = ? AND share.agent_id = ? AND share.shared = 1
         AND member.username = ? AND u.blocked = 0`, [projectId, agentId, userId])) as { access?: string } | undefined
    if (!row) return null
    return row.access === 'read' ? 'read' : 'full'
  }

  /** Может ли пользователь менять состояние машины (команды, PTY, запись файлов). */
  async canWriteAgent(userId: string, agentId: string, projectId?: string | null): Promise<boolean> {
    const access = await this.machineAccess(userId, agentId, projectId)
    return access === 'owner' || access === 'full'
  }

  async canUseAgent(userId: string, agentId: string, projectId?: string | null): Promise<boolean> {
    if (await this.sql.get(`SELECT 1 FROM agents WHERE id = ? AND user_id = ?`, [agentId, userId])) return true
    if (!projectId) return false
    return Boolean(await this.sql.get(`SELECT 1 FROM machine_project_shares share
       JOIN project_members member ON member.project_id = share.project_id
       JOIN users u ON u.name = member.username
       WHERE share.project_id = ? AND share.agent_id = ? AND share.shared = 1
         AND member.username = ? AND u.blocked = 0`, [projectId, agentId, userId]))
  }

  async getUserProjectDefaultMachine(userId: string, projectId: string): Promise<string | null> {
    const row = (await this.sql.get(`SELECT d.agent_id FROM user_project_machine_defaults d
       WHERE d.username = ? AND d.project_id = ?`, [userId, projectId])) as { agent_id: string } | undefined
    return row && await this.canUseAgent(userId, row.agent_id, projectId) ? row.agent_id : null
  }

  async setUserProjectDefaultMachine(userId: string, projectId: string, agentId: string | null): Promise<void> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) throw new Error('Пользователь не состоит в проекте')
    if (agentId === null) {
      await this.sql.run(`DELETE FROM user_project_machine_defaults WHERE username=? AND project_id=?`, [userId, projectId])
      return
    }
    if (!(await this.canUseAgent(userId, agentId, projectId))) throw new Error('Машина недоступна в этом проекте')
    await this.sql.run(`INSERT INTO user_project_machine_defaults (username,project_id,agent_id,updated_at)
       VALUES (?,?,?,?)
       ON CONFLICT(username,project_id) DO UPDATE SET agent_id=excluded.agent_id,updated_at=excluded.updated_at`, [userId, projectId, agentId, this.now()])
  }

  async setMachineSharedWithProject(userId: string, projectId: string, agentId: string, shared: boolean, access: MachineShareAccess = 'full'): Promise<void> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) throw new Error('Пользователь не состоит в проекте')
    if (!(await this.sql.get(`SELECT 1 FROM agents WHERE id=? AND user_id=?`, [agentId, userId]))) {
      throw new Error('Только владелец машины может менять предоставление')
    }
    const row = (await this.sql.get(`SELECT shared, access FROM machine_project_shares WHERE project_id=? AND agent_id=?`, [projectId, agentId])) as { shared: number; access?: string } | undefined
    const previous = Boolean(row?.shared)
    // Смена только уровня доступа (без снятия/выдачи) — тоже сохраняется, но в аудит идёт лишь флаг shared.
    if (previous === shared && (row?.access ?? 'full') === access) return
    const ts = this.now()
    await this.sql.transaction(async () => {
      await this.sql.run(`INSERT INTO machine_project_shares (project_id,agent_id,shared,access,created_at,updated_at,updated_by)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(project_id,agent_id) DO UPDATE SET shared=excluded.shared,access=excluded.access,updated_at=excluded.updated_at,updated_by=excluded.updated_by`, [projectId, agentId, shared ? 1 : 0, access, ts, ts, userId])
      if (previous !== shared) {
        await this.sql.run(`INSERT INTO machine_project_share_audit (id,project_id,agent_id,actor,old_value,new_value,created_at)
           VALUES (?,?,?,?,?,?,?)`, [this.newId(), projectId, agentId, userId, previous ? 1 : 0, shared ? 1 : 0, ts])
      }
      if (!shared) {
        await this.sql.run(`DELETE FROM user_project_machine_defaults WHERE project_id=? AND agent_id=?`, [projectId, agentId])
      }
    })
  }

  async isMachineSharedWithProject(projectId: string, agentId: string): Promise<boolean> {
    return Boolean(((await this.sql.get(`SELECT shared FROM machine_project_shares WHERE project_id=? AND agent_id=?`, [projectId, agentId])) as { shared: number } | undefined)?.shared)
  }

  async listMachineShareAudit(projectId: string): Promise<Array<{ actor: string; agentId: string; oldValue: boolean; newValue: boolean; createdAt: number }>> {
    return ((await this.sql.all(`SELECT actor,agent_id,old_value,new_value,created_at FROM machine_project_share_audit
       WHERE project_id=? ORDER BY created_at,rowid`, [projectId])) as Array<{ actor: string; agent_id: string; old_value: number; new_value: number; created_at: number }>)
      .map((row) => ({ actor: row.actor, agentId: row.agent_id, oldValue: !!row.old_value, newValue: !!row.new_value, createdAt: row.created_at }))
  }

  /** Ищет агента по хэшу токена (авторизация WS-подключения). Глобально по токену. */
  async findAgentByTokenHash(tokenHash: string): Promise<AgentRecord | null> {
    const row = (await this.sql.get(`SELECT * FROM agents WHERE token_hash = ?`, [tokenHash])) as AgentRow | undefined
    return row ? this.mapAgent(row) : null
  }

  /** Задаёт политику возможностей машины (в рамках владельца). */
  async setAgentPolicy(userId: string, id: string, policy: AgentPolicy): Promise<void> {
    await this.sql.run(`UPDATE agents SET policy = ? WHERE id = ? AND user_id = ?`, [JSON.stringify(policy), id, userId])
  }

  /** Перевыпускает токен машины (старый перестаёт работать). Возвращает новый токен; ttlMs — срок (нет — бессрочный). */
  async regenerateAgentToken(userId: string, id: string, ttlMs?: number): Promise<{ token: string; expiresAt: number | null }> {
    const token = randomBytes(24).toString('hex')
    const now = Date.now()
    const expiresAt = ttlMs && ttlMs > 0 ? now + ttlMs : null
    await this.sql.run(`UPDATE agents SET token_hash = ?, token_issued_at = ?, token_expires_at = ? WHERE id = ? AND user_id = ?`, [hashAgentToken(token), now, expiresAt, id, userId])
    return { token, expiresAt }
  }

  /** Отзыв токена (п.11): хэш заменяется случайным, срок — «уже истёк»; подключиться можно только после перевыпуска. */
  async revokeAgentToken(id: string): Promise<void> {
    await this.sql.run(`UPDATE agents SET token_hash = ?, token_expires_at = ? WHERE id = ?`, [hashAgentToken(randomBytes(24).toString('hex')), Date.now() - 1, id])
  }

  async setAgentPinIp(userId: string, id: string, pin: boolean): Promise<void> {
    await this.sql.run(`UPDATE agents SET pin_ip = ? WHERE id = ? AND user_id = ?`, [pin ? 1 : 0, id, userId])
  }

  /** IP успешного подключения агента — для привязки и журнала. */
  async recordAgentIp(id: string, ip: string): Promise<void> {
    await this.sql.run(`UPDATE agents SET last_ip = ? WHERE id = ?`, [ip.slice(0, 64), id])
  }

  /**
   * Атомарно удаляет принадлежащую пользователю машину и все активные ссылки на
   * неё. Исторические записи с обязательным snapshot agent_id сохраняются.
   * Возвращает false для отсутствующей или чужой машины.
   */
  async deleteAgent(userId: string, id: string): Promise<boolean> {
    return await this.sql.transaction(async () => {
      const owned = await this.sql.get(`SELECT 1 FROM agents WHERE id = ? AND user_id = ?`, [id, userId])
      if (!owned) return false

      // chat_storage_bindings и conversation_workspaces имеют RESTRICT одновременно
      // на agents и machine_storages, поэтому их необходимо очистить до каскадного
      // удаления storage; привязки чатов чистит их владелец — chat.
      await this.sql.run(`DELETE FROM chat_storage_bindings WHERE machine_id = ?`, [id])
      await this.repos.chat.clearConversationWorkspacesOfMachine(id)

      // Активные и nullable-привязки теряют машину, но история ран/checkout
      // сохраняется. Обязательные snapshot-id в merge_runs/task_repositories не
      // являются FK и намеренно остаются частью исторической записи.
      await this.sql.run(`DELETE FROM git_workspace_locks WHERE agent_id = ?`, [id])
      await this.repos.ci.detachAgent(id)
      await this.repos.chat.clearConversationExecTargetForAgent(userId, id)
      await this.repos.projects.detachAgent(id)

      const settings = await this.repos.settings.readSettings(userId)
      if (settings.execTarget === id || settings.defaultAgentId === id) {
        await this.repos.settings.saveSettings(userId, {
          ...settings,
          ...(settings.execTarget === id ? { execTarget: null } : {}),
          ...(settings.defaultAgentId === id ? { defaultAgentId: null } : {})
        })
      }

      await this.sql.run(`DELETE FROM agents WHERE id = ? AND user_id = ?`, [id, userId])
      return true
    })
  }

  /** Обновляет last_seen (при регистрации и по pong). */
  async touchAgent(id: string): Promise<void> {
    if (this.closed) return
    await this.sql.run(`UPDATE agents SET last_seen = ? WHERE id = ?`, [this.now(), id])
  }

  /** Ролевые правила команд (п.10) — одна JSON-запись app_config. */
  async getRoleCommandPolicies(): Promise<RoleCommandPolicies> { return parseRoleCommandPolicies(await this.repos.settings.getAppConfig('commandPolicy.roles')) }

  async setRoleCommandPolicies(roles: RoleCommandPolicies): Promise<void> { await this.repos.settings.setAppConfig('commandPolicy.roles', JSON.stringify(roles)) }

  async addMachineCommand(rec: Omit<MachineCommandRecord, 'id'>): Promise<MachineCommandRecord> {
    const info = await this.sql.run(`INSERT INTO machine_commands (machine_id, user_id, source, command, exit_code, timed_out, error, duration_ms, started_at, conversation_id, output_excerpt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [rec.machineId, rec.userId, rec.source, rec.command.slice(0, 4000), rec.exitCode, rec.timedOut ? 1 : 0, rec.error ? rec.error.slice(0, 500) : null, rec.durationMs, rec.startedAt, rec.conversationId, rec.outputExcerpt.slice(0, 500)])
    // Журнал не растёт бесконечно: по 5000 последних записей на машину.
    if (Math.random() < 0.02) await this.sql.run(`DELETE FROM machine_commands WHERE machine_id = ? AND id < (SELECT COALESCE(MAX(id), 0) - 5000 FROM machine_commands WHERE machine_id = ?)`, [rec.machineId, rec.machineId])
    return { ...rec, id: Number(info.lastInsertRowid) }
  }

  async listMachineCommands(machineId: string, filter: { limit?: number; q?: string; source?: MachineCommandSource } = {}): Promise<MachineCommandRecord[]> {
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 2000)
    const where = ['machine_id = ?']
    const params: unknown[] = [machineId]
    if (filter.source) { where.push('source = ?'); params.push(filter.source) }
    if (filter.q?.trim()) { where.push('command LIKE ?'); params.push(`%${filter.q.trim()}%`) }
    const rows = (await this.sql.all(`SELECT * FROM machine_commands WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`, [...params, limit])) as Array<{
      id: number; machine_id: string; user_id: string; source: MachineCommandSource; command: string; exit_code: number | null; timed_out: number; error: string | null; duration_ms: number; started_at: number; conversation_id: string | null; output_excerpt: string
    }>
    return rows.map((r) => ({ id: r.id, machineId: r.machine_id, userId: r.user_id, source: r.source, command: r.command, exitCode: r.exit_code, timedOut: r.timed_out === 1, error: r.error, durationMs: r.duration_ms, startedAt: r.started_at, conversationId: r.conversation_id, outputExcerpt: r.output_excerpt }))
  }

  /**
   * Машины проекта с именами — для MCP-моста remote. Пользователь не проверяется
   * намеренно: параметры query моста собирает сам сервер при отправке хода, а
   * доступ к эндпоинту закрыт секретом процесса.
   */
  async listProjectMachines(projectId: string): Promise<Array<{ agentId: string; name: string; path: string }>> {
    return (
      (await this.sql.all(`SELECT pm.agent_id, pm.path, a.name FROM project_machines pm
           JOIN agents a ON a.id = pm.agent_id
           WHERE pm.project_id = ? ORDER BY a.name ASC`, [projectId])) as Array<{ agent_id: string; path: string | null; name: string }>
    ).map((x) => ({ agentId: x.agent_id, name: x.name, path: x.path ?? '' }))
  }

  projectStoragePlatform(rootPath: string): string {
    return /^(?:[A-Za-z]:[\\\\/]|\\\\\\\\)/.test(rootPath) ? 'win32' : 'linux'
  }

  async configureProjectMachineStorage(
    userId: string,
    projectId: string,
    agentId: string,
    storageId: string,
    directories?: ProjectMachineDirectoryAssignments,
    platform?: string
  ): Promise<ProjectDetail | null> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return null
    if (!(await this.sql.get(`SELECT 1 FROM agents WHERE id=? AND user_id=?`, [agentId, userId]))) return null
    const storage = (await this.listMachineStorages(userId, agentId)).find((item) => item.id === storageId)
    if (!storage) throw new Error('Хранилище не принадлежит выбранной машине')
    const targetPlatform = platform ?? this.projectStoragePlatform(storage.rootPath)
    const recommendationPaths = recommendedProjectMachineDirectories(storage.rootPath, projectId, targetPlatform)
    const recommended = Object.fromEntries(Object.entries(recommendationPaths).map(([kind, path]) => [kind, { path, override: false }])) as ProjectMachineDirectoryAssignments
    const current = (await this.sql.get(`SELECT storage_id, path, repos_root FROM project_machines WHERE project_id=? AND agent_id=?`, [projectId, agentId])) as { storage_id: string | null; path: string; repos_root: string } | undefined
    const changingStorage = !!current?.storage_id && current.storage_id !== storageId
    let candidate = directories && changingStorage ? Object.fromEntries(Object.entries(recommended).map(([kind, value]) => {
      const saved = directories[kind as keyof ProjectMachineDirectoryAssignments]
      return [kind, saved?.override ? saved : value]
    })) as ProjectMachineDirectoryAssignments : directories ?? recommended
    if (!directories && current && !current.storage_id) {
      candidate = structuredClone(recommended)
      if (current.path.trim()) candidate.projectWorkdir = { path: current.path, override: true }
      if (current.repos_root.trim()) candidate.reposRoot = { path: current.repos_root, override: true }
    }
    const assignments = validateProjectMachineDirectories(
      candidate,
      storage.rootPath,
      projectId,
      targetPlatform
    )
    await this.sql.transaction(async () => {
      await this.sql.run(`INSERT INTO project_machines (project_id,agent_id,path,repos_root,storage_id,directories_json,added_at,added_by)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(project_id,agent_id) DO UPDATE SET path=excluded.path,repos_root=excluded.repos_root,storage_id=excluded.storage_id,directories_json=excluded.directories_json`, [projectId, agentId, assignments.projectWorkdir.path, assignments.reposRoot.path, storageId, JSON.stringify(assignments), this.now(), userId])
      await this.repos.projects.touchProject(projectId)
    })
    return await this.repos.projects.getProject(userId, projectId)
  }

  async resetProjectMachineDirectory(userId: string, projectId: string, agentId: string, kind: ProjectMachineDirectoryKind): Promise<ProjectDetail | null> {
    const machine = (await this.repos.projects.getProject(userId, projectId))?.machines.find((item) => item.agentId === agentId)
    if (!machine?.storage || !machine.directories || !machine.recommendations) throw new Error('MachineStorage не настроено')
    const directories = structuredClone(machine.directories)
    directories[kind] = { path: machine.recommendations[kind], override: false }
    return await this.configureProjectMachineStorage(userId, projectId, agentId, machine.storage.id, directories)
  }

  async linkMachine(userId: string, id: string, agentId: string, storageId?: string): Promise<ProjectDetail | null> {
    if (!(await this.repos.projects.isProjectMember(userId, id))) return null
    if (!(await this.sql.get(`SELECT 1 FROM agents WHERE id = ? AND user_id = ?`, [agentId, userId]))) {
      throw new Error(`Машина ${agentId} не найдена`)
    }
    const storages = await this.listMachineStorages(userId, agentId)
    const selected = storageId ? storages.find((item) => item.id === storageId) : storages[0]
    if (storageId && !selected) throw new Error('Хранилище не принадлежит выбранной машине')
    if (selected) await this.configureProjectMachineStorage(userId, id, agentId, selected.id)
    else await this.sql.run(`INSERT OR IGNORE INTO project_machines (project_id,agent_id,path,added_at,added_by) VALUES (?,?,'',?,?)`, [id, agentId, this.now(), userId])
    await this.setMachineSharedWithProject(userId, id, agentId, true)
    return await this.repos.projects.getProject(userId, id)
  }

  /** Задать папку проекта на конкретной машине (только владелец). */
  async setProjectMachinePath(userId: string, id: string, agentId: string, path: string): Promise<ProjectDetail | null> {
    if (!(await this.repos.projects.isProjectMember(userId, id))) return null
    if (!(await this.sql.get(`SELECT 1 FROM agents WHERE id=? AND user_id=?`, [agentId, userId]))) return null
    const managed = (await this.repos.projects.getProject(userId, id))?.machines.find((item) => item.agentId === agentId)
    if (managed?.storageId && managed.directories) {
      const directories = structuredClone(managed.directories)
      directories.projectWorkdir = { path, override: true }
      return await this.configureProjectMachineStorage(userId, id, agentId, managed.storageId, directories)
    }
    await this.sql.run(`INSERT OR IGNORE INTO project_machines (project_id,agent_id,path,added_at,added_by) VALUES (?,?,'',?,?)`, [id, agentId, this.now(), userId])
    const row = (await this.sql.get(`SELECT directories_json FROM project_machines WHERE project_id=? AND agent_id=?`, [id, agentId])) as { directories_json: string } | undefined
    let directoriesJson = row?.directories_json ?? ''
    if (directoriesJson) {
      try {
        const directories = JSON.parse(directoriesJson) as ProjectMachineDirectoryAssignments
        directories.projectWorkdir = { path: path.trim(), override: true }
        directoriesJson = JSON.stringify(directories)
      } catch { directoriesJson = '' }
    }
    await this.sql.run(`UPDATE project_machines SET path = ?, directories_json = ? WHERE project_id = ? AND agent_id = ?`, [path.trim(), directoriesJson, id, agentId])
    await this.repos.projects.touchProject(id)
    return await this.repos.projects.getProject(userId, id)
  }

  /** Корень пула рабочих копий CI на этой машине. */
  async setProjectMachineReposRoot(userId: string, id: string, agentId: string, root: string): Promise<ProjectDetail | null> {
    if (!(await this.repos.projects.isProjectMember(userId, id))) return null
    if (!(await this.sql.get(`SELECT 1 FROM agents WHERE id=? AND user_id=?`, [agentId, userId]))) return null
    const managed = (await this.repos.projects.getProject(userId, id))?.machines.find((item) => item.agentId === agentId)
    if (managed?.storageId && managed.directories) {
      const directories = structuredClone(managed.directories)
      directories.reposRoot = { path: root, override: true }
      return await this.configureProjectMachineStorage(userId, id, agentId, managed.storageId, directories)
    }
    await this.sql.run(`INSERT OR IGNORE INTO project_machines (project_id,agent_id,path,added_at,added_by) VALUES (?,?,'',?,?)`, [id, agentId, this.now(), userId])
    const row = (await this.sql.get(`SELECT directories_json FROM project_machines WHERE project_id=? AND agent_id=?`, [id, agentId])) as { directories_json: string } | undefined
    let directoriesJson = row?.directories_json ?? ''
    if (directoriesJson) {
      try {
        const directories = JSON.parse(directoriesJson) as ProjectMachineDirectoryAssignments
        directories.reposRoot = { path: root.trim(), override: true }
        directoriesJson = JSON.stringify(directories)
      } catch { directoriesJson = '' }
    }
    await this.sql.run(`UPDATE project_machines SET repos_root = ?, directories_json = ? WHERE project_id = ? AND agent_id = ?`, [root.trim(), directoriesJson, id, agentId])
    return await this.repos.projects.getProject(userId, id)
  }

  /** Явные SSH-настройки машины для ручного preview-туннеля. */
  async setProjectMachineSsh(userId: string, id: string, agentId: string, sshHost: string, sshUser: string): Promise<ProjectDetail | null> {
    if (!(await this.repos.projects.isProjectMember(userId, id))) return null
    if (!(await this.sql.get(`SELECT 1 FROM agents WHERE id=? AND user_id=?`, [agentId, userId]))) return null
    await this.sql.run(`INSERT OR IGNORE INTO project_machines (project_id,agent_id,path,added_at,added_by) VALUES (?,?,'',?,?)`, [id, agentId, this.now(), userId])
    await this.sql.run(`UPDATE project_machines SET ssh_host = ?, ssh_user = ? WHERE project_id = ? AND agent_id = ?`, [sshHost.trim(), sshUser.trim(), id, agentId])
    return await this.repos.projects.getProject(userId, id)
  }

  /** Имя машины по id (для читаемой подписи в шапке чата). */
  async agentName(agentId: string): Promise<string | null> {
    const r = (await this.sql.get(`SELECT name FROM agents WHERE id = ?`, [agentId])) as { name: string } | undefined
    return r?.name ?? null
  }

  async getProjectMachine(projectId: string, agentId: string): Promise<{ agentId: string; path: string; reposRoot: string | null; storageId: string | null; storageRoot: string | null; storageFormatVersion: number | null; directories: ProjectMachineDirectoryAssignments | null } | null> {
    const row = (await this.sql.get(`SELECT pm.agent_id,pm.path,pm.repos_root,pm.storage_id,pm.directories_json,s.root_path AS storage_root,s.format_version AS storage_format_version
      FROM project_machines pm LEFT JOIN machine_storages s ON s.id=pm.storage_id AND s.machine_id=pm.agent_id
      WHERE pm.project_id=? AND pm.agent_id=?`, [projectId, agentId])) as { agent_id: string; path: string; repos_root: string | null; storage_id: string | null; directories_json: string | null; storage_root: string | null; storage_format_version: number | null } | undefined
    if (!row) return null
    let directories: ProjectMachineDirectoryAssignments | null = null
    try { directories = row.directories_json ? JSON.parse(row.directories_json) as ProjectMachineDirectoryAssignments : null } catch { directories = null }
    return { agentId: row.agent_id, path: row.path, reposRoot: row.repos_root, storageId: row.storage_id, storageRoot: row.storage_root, storageFormatVersion: row.storage_format_version, directories }
  }

  /**
   * Взять блокировку рабочей копии на время мутации. Возвращает null, если каталог
   * уже занят живой блокировкой — тогда вызывающий отказывает человеку, а не ждёт:
   * ожидание в HTTP-запросе выглядит как зависший интерфейс.
   *
   * Просроченные записи вычищаются здесь же: держать отдельный сборщик ради строки
   * с TTL незачем, а упавший процесс иначе оставил бы каталог заблокированным.
   */
  async acquireGitWorkspaceLock(agentId: string, path: string, holder: string, operation: string, ttlMs: number): Promise<{ expiresAt: number } | null> {
    const at = this.now()
    await this.sql.run(`DELETE FROM git_workspace_locks WHERE expires_at <= ?`, [at])
    const existing = (await this.sql.get(`SELECT holder, operation, expires_at FROM git_workspace_locks WHERE agent_id=? AND path=?`, [agentId, path])) as { holder: string; operation: string; expires_at: number } | undefined
    if (existing) return null
    const expiresAt = at + ttlMs
    await this.sql.run(`INSERT INTO git_workspace_locks (agent_id,path,holder,operation,acquired_at,expires_at) VALUES (?,?,?,?,?,?)`, [agentId, path, holder, operation, at, expiresAt])
    return { expiresAt }
  }

  async releaseGitWorkspaceLock(agentId: string, path: string, holder: string): Promise<void> {
    await this.sql.run(`DELETE FROM git_workspace_locks WHERE agent_id=? AND path=? AND holder=?`, [agentId, path, holder])
  }

  /** Кто держит каталог сейчас (для сообщения человеку), либо null. */
  async gitWorkspaceLockHolder(agentId: string, path: string): Promise<{ holder: string; operation: string; expiresAt: number } | null> {
    const row = (await this.sql.get(`SELECT holder, operation, expires_at FROM git_workspace_locks WHERE agent_id=? AND path=? AND expires_at > ?`, [agentId, path, this.now()])) as { holder: string; operation: string; expires_at: number } | undefined
    return row ? { holder: row.holder, operation: row.operation, expiresAt: row.expires_at } : null
  }

  /** Каскад удаления аккаунта: все машины пользователя (project_machines уйдут по CASCADE). */
  async deleteAgentsOfUser(userId: string): Promise<void> {
    await this.sql.run(`DELETE FROM agents WHERE user_id = ?`, [userId])
  }
}
