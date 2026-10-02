import { parseEnvironmentId, parseModuleSelections, type EnvironmentDefinition, type EnvironmentConfiguration, type EnvironmentOperation, type ModuleSelection } from '@voicechat/shared'
import { BaseRepo } from './base.js'

interface DefinitionRow { id: string; project_id: string; name: string; machines_json: string; checkout_path: string; created_by: string; created_at: number; updated_at: number }
interface ConfigurationRow { id: string; environment_id: string; revision: number; modules_json: string; note: string | null; created_by: string; created_at: number }
interface OperationRow { id: string; environment_id: string; configuration_id: string; previous_configuration_id: string | null; status: EnvironmentOperation['status']; steps_json: string; started_by: string; started_at: number; finished_at: number | null; error: string | null }
// Stage-1 storage has no managed columns yet (B03): every row is an external, ready environment.
const definition = (r: DefinitionRow): EnvironmentDefinition => ({ mode: 'external', storageId: null, state: 'ready', composeProject: null, port: null, id: r.id, projectId: r.project_id, name: r.name, machines: JSON.parse(r.machines_json), checkoutPath: r.checkout_path, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at })
const configuration = (r: ConfigurationRow): EnvironmentConfiguration => ({ core: null, id: r.id, environmentId: r.environment_id, revision: r.revision, modules: JSON.parse(r.modules_json), note: r.note, createdBy: r.created_by, createdAt: r.created_at })
const operation = (r: OperationRow): EnvironmentOperation => ({ kind: 'apply', id: r.id, environmentId: r.environment_id, configurationId: r.configuration_id, previousConfigurationId: r.previous_configuration_id, status: r.status, steps: JSON.parse(r.steps_json), startedBy: r.started_by, startedAt: r.started_at, finishedAt: r.finished_at, error: r.error })
const active = "status IN ('pending', 'pulling', 'switching', 'health_check')"
function pageSize(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid limit')
  return limit
}

export class EnvironmentsRepo extends BaseRepo {
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
    const now = this.now()
    await this.sql.run(`INSERT INTO environments (id, project_id, name, machines_json, checkout_path, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, id) DO UPDATE SET name = excluded.name, machines_json = excluded.machines_json, checkout_path = excluded.checkout_path, updated_at = excluded.updated_at`, [id, projectId, input.name, JSON.stringify(input.machines), input.checkoutPath, userId, now, now])
    return (await this.getEnvironment(userId, projectId, id))!
  }

  async addConfiguration(userId: string, projectId: string, environmentId: string, modules: ModuleSelection[], note: string | null): Promise<EnvironmentConfiguration> {
    const parsed = parseModuleSelections(modules)
    if (note !== null && typeof note !== 'string') throw new Error('Invalid note')
    return this.sql.transaction(async () => {
      await this.requireMember(userId, projectId)
      // A write locks this environment before reading MAX, including across PG connections.
      const locked = await this.sql.run('UPDATE environments SET updated_at = updated_at WHERE project_id = ? AND id = ?', [projectId, environmentId])
      if (!locked.changes) throw new Error('Environment not found')
      const row = await this.sql.get('SELECT COALESCE(MAX(revision), 0) AS revision FROM environment_configurations WHERE project_id = ? AND environment_id = ?', [projectId, environmentId]) as { revision: number }
      const result: EnvironmentConfiguration = { core: null, id: this.newId(), environmentId, revision: Number(row.revision) + 1, modules: parsed, note, createdBy: userId, createdAt: this.now() }
      await this.sql.run('INSERT INTO environment_configurations (id, project_id, environment_id, revision, modules_json, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [result.id, projectId, environmentId, result.revision, JSON.stringify(parsed), note, userId, result.createdAt])
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

  async createOperation(userId: string, projectId: string, environmentId: string, configurationId: string, previousConfigurationId: string | null): Promise<EnvironmentOperation> {
    return this.sql.transaction(async () => {
      await this.requireMember(userId, projectId)
      for (const id of [configurationId, previousConfigurationId]) {
        if (id === null) continue
        const config = await this.getConfiguration(userId, projectId, id)
        if (!config || config.environmentId !== environmentId) throw new Error('Configuration does not belong to environment')
      }
      const result: EnvironmentOperation = { kind: 'apply', id: this.newId(), environmentId, configurationId, previousConfigurationId, status: 'pending', steps: [], startedBy: userId, startedAt: this.now(), finishedAt: null, error: null }
      // The partial unique index arbitrates concurrent requests on either engine.
      await this.sql.run(`INSERT INTO environment_operations (id, project_id, environment_id, configuration_id, previous_configuration_id, status, steps_json, started_by, started_at) VALUES (?, ?, ?, ?, ?, 'pending', '[]', ?, ?)`, [result.id, projectId, environmentId, configurationId, previousConfigurationId, userId, result.startedAt])
      return result
    })
  }

  /** Internal worker port; authorization is performed when creating the operation. */
  async updateOperation(operationId: string, patch: Partial<Pick<EnvironmentOperation, 'status' | 'steps' | 'error' | 'finishedAt'>>): Promise<void> {
    const fields: string[] = []
    const values: (string | number | null)[] = []
    if (patch.status !== undefined) {
      if (!['pending', 'pulling', 'switching', 'health_check', 'succeeded', 'failed', 'rolled_back'].includes(patch.status)) throw new Error('Invalid operation status')
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
