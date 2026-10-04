import { ACTIVE_ENVIRONMENT_OPERATION_STATUSES, parseCoreSelection, type CoreSelection, type EnvironmentState, type EnvironmentOperationKind, type StoredEnvironmentSetting, parseEnvironmentId, parseModuleSelections, type EnvironmentDefinition, type EnvironmentConfiguration, type EnvironmentOperation, type ModuleSelection } from '@voicechat/shared'
import { BaseRepo } from './base.js'

interface DefinitionRow { mode: EnvironmentDefinition["mode"]; storage_id: string | null; state: EnvironmentState; compose_project: string | null; port: number | null; id: string; project_id: string; name: string; machines_json: string; checkout_path: string; created_by: string; created_at: number; updated_at: number }
interface ConfigurationRow { core_json: string | null; id: string; environment_id: string; revision: number; modules_json: string; note: string | null; created_by: string; created_at: number }
interface OperationRow { kind?: EnvironmentOperationKind; id: string; environment_id: string; configuration_id: string; previous_configuration_id: string | null; status: EnvironmentOperation['status']; steps_json: string; started_by: string; started_at: number; finished_at: number | null; error: string | null }
const definition = (r: DefinitionRow): EnvironmentDefinition => ({ mode: r.mode, storageId: r.storage_id, state: r.state, composeProject: r.compose_project, port: r.port, id: r.id, projectId: r.project_id, name: r.name, machines: JSON.parse(r.machines_json), checkoutPath: r.checkout_path, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at })
const configuration = (r: ConfigurationRow): EnvironmentConfiguration => ({ core: r.core_json ? JSON.parse(r.core_json) : null, id: r.id, environmentId: r.environment_id, revision: r.revision, modules: JSON.parse(r.modules_json), note: r.note, createdBy: r.created_by, createdAt: r.created_at })
const operation = (r: OperationRow): EnvironmentOperation => ({ kind: r.kind ?? 'apply', id: r.id, environmentId: r.environment_id, configurationId: r.configuration_id, previousConfigurationId: r.previous_configuration_id, status: r.status, steps: JSON.parse(r.steps_json), startedBy: r.started_by, startedAt: r.started_at, finishedAt: r.finished_at, error: r.error })
const active = `status IN (${ACTIVE_ENVIRONMENT_OPERATION_STATUSES.map(status => "'" + status + "'").join(", ")})`
function pageSize(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid limit')
  return limit
}

export interface EnvironmentLinkInput {
  projectId: string
  environmentId: string
  clientMachineId: string
  serverMachineId: string
  servicePort: number
  listenerPort: number
}
export interface EnvironmentLink extends EnvironmentLinkInput { id: string; state: 'open' | 'down'; transport: 'vpn' | 'tunnel'; address: string }
interface LinkRow { id: string; project_id: string; environment_id: string; client_machine_id: string; server_machine_id: string; service_port: number; listener_port: number; transport: 'vpn' | 'tunnel'; address: string; state: 'open' | 'down' }
const link = (r: LinkRow): EnvironmentLink => ({ id: r.id, projectId: r.project_id, environmentId: r.environment_id, clientMachineId: r.client_machine_id, serverMachineId: r.server_machine_id, servicePort: r.service_port, listenerPort: r.listener_port, state: r.state, transport: r.transport, address: r.address })

export class EnvironmentsRepo extends BaseRepo {
  /** Trusted machines worker port; links are owned by the environment. */
  async ensureLink(input: EnvironmentLinkInput): Promise<EnvironmentLink> {
    if (!input || [input.projectId, input.environmentId, input.clientMachineId, input.serverMachineId].some(v => typeof v !== 'string' || !v.trim()) ||
        [input.servicePort, input.listenerPort].some(v => !Number.isInteger(v) || v < 1 || v > 65535)) throw new Error('Invalid environment link')
    return this.sql.transaction(async () => {
      await this.lockEnvironment(input.projectId, input.environmentId)
      const env = await this.sql.get<{ state: string }>('SELECT state FROM environments WHERE project_id = ? AND id = ?', [input.projectId, input.environmentId])
      if (!env || !['provisioning', 'ready'].includes(env.state)) throw new Error('Environment is not active')
      await this.sql.run(`INSERT INTO environment_links (id, project_id, environment_id, client_machine_id, server_machine_id, service_port, listener_port, address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, environment_id, client_machine_id, server_machine_id, service_port) DO NOTHING`,
        [this.newId(), input.projectId, input.environmentId, input.clientMachineId, input.serverMachineId, input.servicePort, input.listenerPort, `host.docker.internal:${input.listenerPort}`])
      const result = (await this.listLinks(input.projectId, input.environmentId)).find(r => r.clientMachineId === input.clientMachineId && r.serverMachineId === input.serverMachineId && r.servicePort === input.servicePort)!
      if (result.listenerPort !== input.listenerPort) throw new Error('Environment link listener port cannot change')
      return result
    })
  }
  async listLinks(projectId?: string, environmentId?: string): Promise<EnvironmentLink[]> {
    const rows = await this.sql.all<LinkRow>('SELECT * FROM environment_links' + (projectId === undefined ? '' : ' WHERE project_id = ? AND environment_id = ?') + ' ORDER BY id', projectId === undefined ? [] : [projectId, environmentId ?? ''])
    return rows.map(link)
  }
  async authorizeLink(id: string): Promise<boolean> {
    return !!await this.sql.get(`SELECT l.id FROM environment_links l JOIN environments e ON e.project_id = l.project_id AND e.id = l.environment_id WHERE l.id = ? AND e.state IN ('provisioning', 'ready')`, [id])
  }
  async linkOwner(projectId: string): Promise<string | null> {
    return this.repos.projects.projectCreator(projectId)
  }
  async setLinkTransport(id: string, transport: 'vpn' | 'tunnel', address: string): Promise<void> {
    await this.sql.run('UPDATE environment_links SET transport = ?, address = ? WHERE id = ?', [transport, address, id])
  }
  async setLinkState(id: string, state: 'open' | 'down'): Promise<void> {
    await this.sql.run('UPDATE environment_links SET state = ? WHERE id = ?', [state, id])
  }
  async deleteLink(projectId: string, environmentId: string, id: string): Promise<void> {
    await this.sql.run('DELETE FROM environment_links WHERE project_id = ? AND environment_id = ? AND id = ?', [projectId, environmentId, id])
  }

  /** Serialize worker creation and settings writes on the same environment. */
  private async lockEnvironment(projectId: string, environmentId: string): Promise<void> {
    const result = await this.sql.run('UPDATE environments SET updated_at = updated_at WHERE project_id = ? AND id = ?', [projectId, environmentId])
    if (!result.changes) throw new Error('Environment not found')
  }

  async createManagedEnvironment(userId: string, projectId: string, input: { id: string; name: string; machineId: string; storageId: string; checkoutPath: string; composeProject: string }): Promise<EnvironmentDefinition> {
    await this.requireMember(userId, projectId)
    if (!await this.repos.projects.isProjectOwner(userId, projectId)) throw new Error('Project owner required')
    const id = parseEnvironmentId(input.id)
    if (id === 'production' || [input.name, input.machineId, input.storageId, input.checkoutPath, input.composeProject].some(value => typeof value !== 'string' || !value.trim())) throw new Error('Invalid managed environment definition')
    return this.sql.transaction(async () => {
      const now = this.now()
      const result = await this.sql.run(`INSERT INTO environments
        (id, project_id, name, machines_json, checkout_path, mode, storage_id, state, compose_project, port, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'managed', ?, 'draft', ?, NULL, ?, ?, ?)
        ON CONFLICT(project_id, id) DO UPDATE SET name = excluded.name, machines_json = excluded.machines_json,
        checkout_path = excluded.checkout_path, storage_id = excluded.storage_id, compose_project = excluded.compose_project,
        state = 'draft', port = NULL, updated_at = excluded.updated_at
        WHERE environments.mode = 'managed' AND environments.state IN ('draft', 'removed')`,
      [id, projectId, input.name, JSON.stringify([input.machineId]), input.checkoutPath, input.storageId, input.composeProject, userId, now, now])
      if (!result.changes) throw new Error('Environment already exists')
      return (await this.getEnvironment(userId, projectId, id))!
    })
  }

  /** Internal worker port. */
  async setEnvironmentState(projectId: string, environmentId: string, patch: { state?: EnvironmentState; port?: number | null }): Promise<void> {
    const fields = ['updated_at = ?']
    const values: (string | number | null)[] = [this.now()]
    if (patch.state !== undefined) {
      if (!['draft', 'provisioning', 'ready', 'failed', 'removing', 'removed'].includes(patch.state)) throw new Error('Invalid environment state')
      fields.push('state = ?'); values.push(patch.state)
    }
    if (patch.port !== undefined) {
      if (patch.port !== null && (!Number.isInteger(patch.port) || patch.port < 1 || patch.port > 65535)) throw new Error('Invalid environment port')
      fields.push('port = ?'); values.push(patch.port)
    }
    const result = await this.sql.run(`UPDATE environments SET ${fields.join(', ')} WHERE project_id = ? AND id = ?`, [...values, projectId, environmentId])
    if (!result.changes) throw new Error('Environment not found')
  }

  async managedPorts(machineId: string): Promise<number[]> {
    const rows = await this.sql.all<{ machines_json: string; port: number }>("SELECT machines_json, port FROM environments WHERE mode = 'managed' AND state <> 'removed' AND port IS NOT NULL")
    return [...new Set(rows.filter(row => (JSON.parse(row.machines_json) as string[]).includes(machineId)).map(row => row.port))].sort((a, b) => a - b)
  }

  async listSettings(userId: string, projectId: string, environmentId: string): Promise<StoredEnvironmentSetting[]> {
    await this.requireMember(userId, projectId)
    return this.readSettings(projectId, environmentId)
  }

  /** Internal storage values; secret values are ciphertext supplied by Kanban. */
  async readSettings(projectId: string, environmentId: string): Promise<StoredEnvironmentSetting[]> {
    const rows = await this.sql.all<{ key: string; secret: number; value: string; source: 'user' | 'generated'; updated_by: string; updated_at: number }>(
      'SELECT * FROM environment_settings WHERE project_id = ? AND environment_id = ? ORDER BY key', [projectId, environmentId])
    return rows.map(row => ({ key: row.key, secret: !!row.secret, value: row.value, source: row.source, updatedBy: row.updated_by, updatedAt: row.updated_at }))
  }

  async saveSettings(userId: string, projectId: string, environmentId: string, entries: Array<{ key: string; secret: boolean; value: string | null; source: 'user' | 'generated' }>): Promise<void> {
    await this.requireMember(userId, projectId)
    if (!await this.repos.projects.isProjectOwner(userId, projectId)) throw new Error('Project owner required')
    await this.sql.transaction(async () => {
      await this.lockEnvironment(projectId, environmentId)
      if (await this.activeOperation(projectId, environmentId)) throw new Error('Environment is busy')
      for (const entry of entries) {
        if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(entry.key) || typeof entry.secret !== 'boolean' || !['user', 'generated'].includes(entry.source) || (entry.value !== null && typeof entry.value !== 'string')) throw new Error('Invalid stored environment setting')
        if (entry.value === null) {
          await this.sql.run('DELETE FROM environment_settings WHERE project_id = ? AND environment_id = ? AND key = ?', [projectId, environmentId, entry.key])
        } else {
          await this.sql.run(`INSERT INTO environment_settings (project_id, environment_id, key, secret, value, source, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, environment_id, key) DO UPDATE SET
            secret = excluded.secret, value = excluded.value, source = excluded.source, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
          [projectId, environmentId, entry.key, entry.secret ? 1 : 0, entry.value, entry.source, userId, this.now()])
        }
      }
    })
  }

  private async requireMember(userId: string, projectId: string): Promise<void> {
    if (!await this.repos.projects.isProjectMember(userId, projectId)) throw new Error('Project membership required')
  }

  async listEnvironments(userId: string, projectId: string): Promise<EnvironmentDefinition[]> {
    await this.requireMember(userId, projectId)
    return (await this.sql.all('SELECT * FROM environments WHERE project_id = ? ORDER BY id', [projectId]) as DefinitionRow[]).map(definition)
  }

  async getEnvironment(userId: string, projectId: string, environmentId: string): Promise<EnvironmentDefinition | null> {
    await this.requireMember(userId, projectId)
    const row = await this.sql.get('SELECT * FROM environments WHERE project_id = ? AND id = ?', [projectId, environmentId]) as DefinitionRow | undefined
    return row ? definition(row) : null
  }

  async upsertEnvironment(userId: string, projectId: string, input: Pick<EnvironmentDefinition, 'id' | 'name' | 'machines' | 'checkoutPath'>): Promise<EnvironmentDefinition> {
    await this.requireMember(userId, projectId)
    if (!await this.repos.projects.isProjectOwner(userId, projectId)) throw new Error('Project owner required')
    const id = parseEnvironmentId(input.id)
    if (typeof input.name !== 'string' || !input.name.trim() || typeof input.checkoutPath !== 'string' || !input.checkoutPath.trim() || !Array.isArray(input.machines) || input.machines.length !== 1 || typeof input.machines[0] !== 'string' || !input.machines[0].trim()) throw new Error('Invalid environment definition')
    if ((await this.getEnvironment(userId, projectId, id))?.mode === 'managed') throw new Error('Managed environment cannot be changed')
    const now = this.now()
    const written = await this.sql.run(`INSERT INTO environments (id, project_id, name, machines_json, checkout_path, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, id) DO UPDATE SET name = excluded.name, machines_json = excluded.machines_json, checkout_path = excluded.checkout_path, updated_at = excluded.updated_at WHERE environments.mode = 'external'`, [id, projectId, input.name, JSON.stringify(input.machines), input.checkoutPath, userId, now, now])
    if (!written.changes) throw new Error('Managed environment cannot be changed')
    return (await this.getEnvironment(userId, projectId, id))!
  }

  async addConfiguration(userId: string, projectId: string, environmentId: string, modules: ModuleSelection[], note: string | null, core: CoreSelection | null = null): Promise<EnvironmentConfiguration> {
    const parsed = parseModuleSelections(modules)
    const parsedCore = parseCoreSelection(core)
    if (note !== null && typeof note !== 'string') throw new Error('Invalid note')
    return this.sql.transaction(async () => {
      await this.requireMember(userId, projectId)
      // A write locks this environment before reading MAX, including across PG connections.
      const locked = await this.sql.run('UPDATE environments SET updated_at = updated_at WHERE project_id = ? AND id = ?', [projectId, environmentId])
      if (!locked.changes) throw new Error('Environment not found')
      const row = await this.sql.get('SELECT COALESCE(MAX(revision), 0) AS revision FROM environment_configurations WHERE project_id = ? AND environment_id = ?', [projectId, environmentId]) as { revision: number }
      const result: EnvironmentConfiguration = { core: parsedCore, id: this.newId(), environmentId, revision: Number(row.revision) + 1, modules: parsed, note, createdBy: userId, createdAt: this.now() }
      await this.sql.run('INSERT INTO environment_configurations (id, project_id, environment_id, revision, modules_json, note, core_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [result.id, projectId, environmentId, result.revision, JSON.stringify(parsed), note, parsedCore ? JSON.stringify(parsedCore) : null, userId, result.createdAt])
      return result
    })
  }

  async listConfigurations(userId: string, projectId: string, environmentId: string, limit = 100): Promise<EnvironmentConfiguration[]> {
    await this.requireMember(userId, projectId)
    return (await this.sql.all('SELECT * FROM environment_configurations WHERE project_id = ? AND environment_id = ? ORDER BY revision DESC LIMIT ?', [projectId, environmentId, pageSize(limit)]) as ConfigurationRow[]).map(configuration)
  }

  async getConfiguration(userId: string, projectId: string, configurationId: string): Promise<EnvironmentConfiguration | null> {
    await this.requireMember(userId, projectId)
    const row = await this.sql.get('SELECT * FROM environment_configurations WHERE project_id = ? AND id = ?', [projectId, configurationId]) as ConfigurationRow | undefined
    return row ? configuration(row) : null
  }

  async createOperation(userId: string, projectId: string, environmentId: string, configurationId: string, previousConfigurationId: string | null, kind: EnvironmentOperationKind = 'apply'): Promise<EnvironmentOperation> {
    if (!['apply', 'provision', 'remove'].includes(kind)) throw new Error('Invalid operation kind')
    return this.sql.transaction(async () => {
      await this.requireMember(userId, projectId)
      await this.lockEnvironment(projectId, environmentId)
      for (const id of [configurationId, previousConfigurationId]) {
        if (id === null) continue
        const config = await this.getConfiguration(userId, projectId, id)
        if (!config || config.environmentId !== environmentId) throw new Error('Configuration does not belong to environment')
      }
      const result: EnvironmentOperation = { kind, id: this.newId(), environmentId, configurationId, previousConfigurationId, status: 'pending', steps: [], startedBy: userId, startedAt: this.now(), finishedAt: null, error: null }
      // The partial unique index arbitrates concurrent requests on either engine.
      await this.sql.run(`INSERT INTO environment_operations (id, project_id, environment_id, configuration_id, previous_configuration_id, kind, status, steps_json, started_by, started_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', '[]', ?, ?)`, [result.id, projectId, environmentId, configurationId, previousConfigurationId, kind, userId, result.startedAt])
      return result
    })
  }

  /** Internal worker port; authorization is performed when creating the operation. */
  async updateOperation(operationId: string, patch: Partial<Pick<EnvironmentOperation, 'status' | 'steps' | 'error' | 'finishedAt'>>): Promise<void> {
    const fields: string[] = []
    const values: (string | number | null)[] = []
    if (patch.status !== undefined) {
      if (![...ACTIVE_ENVIRONMENT_OPERATION_STATUSES, 'succeeded', 'failed', 'rolled_back'].includes(patch.status)) throw new Error('Invalid operation status')
      fields.push('status = ?'); values.push(patch.status)
    }
    if (patch.steps !== undefined) { fields.push('steps_json = ?'); values.push(JSON.stringify(patch.steps)) }
    if (patch.error !== undefined) { fields.push('error = ?'); values.push(patch.error) }
    if (patch.finishedAt !== undefined) { fields.push('finished_at = ?'); values.push(patch.finishedAt) }
    if (fields.length) await this.sql.run(`UPDATE environment_operations SET ${fields.join(', ')} WHERE id = ?`, [...values, operationId])
  }

  async listOperations(userId: string, projectId: string, environmentId: string, limit = 100): Promise<EnvironmentOperation[]> {
    await this.requireMember(userId, projectId)
    return (await this.sql.all('SELECT * FROM environment_operations WHERE project_id = ? AND environment_id = ? ORDER BY started_at DESC, id DESC LIMIT ?', [projectId, environmentId, pageSize(limit)]) as OperationRow[]).map(operation)
  }

  /** Internal worker lookup, scoped by project and environment. */
  async activeOperation(projectId: string, environmentId: string): Promise<EnvironmentOperation | null> {
    const row = await this.sql.get(`SELECT * FROM environment_operations WHERE project_id = ? AND environment_id = ? AND ${active}`, [projectId, environmentId]) as OperationRow | undefined
    return row ? operation(row) : null
  }
}
