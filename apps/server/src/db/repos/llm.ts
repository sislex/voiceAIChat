// Домен «llm»: таблицы llm_engines, model_prices.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import { type UserRole, type AdminLlmEngine, type AdminLlmEngineInput, type ModelPrice, type ModelPriceInput, type LlmEngineKind } from '@voicechat/shared'
import { BaseRepo } from './base.js'
import { parseStringArray } from './support.js'

interface LlmEngineRow {
  id: string
  name: string
  kind: string
  base_url: string
  token: string
  enabled: number
  allowed_roles: string
  is_default: number
  created_at: number
}

function parseAllowedRoles(raw: string | null): UserRole[] {
  return parseStringArray(raw).map((role) => role === 'user' ? 'developer' : role).filter((role): role is UserRole => role === 'admin' || role === 'developer' || role === 'tester' || role === 'observer')
}

function normEngineKind(raw: string): LlmEngineKind {
  return raw === 'codex' ? 'codex' : 'claude'
}
export class LlmRepo extends BaseRepo {
  private mapLlmEngine(r: LlmEngineRow): AdminLlmEngine {
    return {
      id: r.id,
      name: r.name,
      kind: normEngineKind(r.kind),
      baseUrl: r.base_url,
      token: r.token,
      enabled: r.enabled !== 0,
      allowedRoles: parseAllowedRoles(r.allowed_roles),
      isDefault: r.is_default !== 0,
      createdAt: r.created_at
    }
  }

  async listLlmEngines(): Promise<AdminLlmEngine[]> {
    const rows = (await this.sql.all(`SELECT * FROM llm_engines ORDER BY kind ASC, is_default DESC, created_at ASC`)) as LlmEngineRow[]
    return rows.map((row) => this.mapLlmEngine(row))
  }

  async getLlmEngine(id: string): Promise<AdminLlmEngine | null> {
    const row = (await this.sql.get(`SELECT * FROM llm_engines WHERE id = ?`, [id])) as LlmEngineRow | undefined
    return row ? this.mapLlmEngine(row) : null
  }

  /** Исполнители, доступные роли; секреты наружу не возвращаются. */
  async listLlmEnginesForRole(role: UserRole) {
    return (await this.listLlmEngines())
      .filter((engine) => engine.enabled && engine.allowedRoles.includes(role))
      .map(({ id, name, kind, isDefault }) => ({ id, name, kind, isDefault }))
  }

  async resolveLlmEngine(engineId: string | null | undefined, kind: LlmEngineKind, role: UserRole) {
    const allowed = (engine: AdminLlmEngine | null): engine is AdminLlmEngine =>
      Boolean(engine && engine.kind === kind && engine.enabled && engine.allowedRoles.includes(role))
    const requested = engineId ? await this.getLlmEngine(engineId) : null
    if (allowed(requested)) return { engine: requested, substituted: false }
    const fallback = (await this.listLlmEngines()).find((engine) => engine.kind === kind && engine.isDefault && allowed(engine))
      ?? (await this.listLlmEngines()).find((engine) => engine.kind === kind && allowed(engine))
      ?? null
    return { engine: fallback, substituted: Boolean(engineId && engineId !== fallback?.id) }
  }

  async createLlmEngine(input: AdminLlmEngineInput): Promise<AdminLlmEngine> {
    const id = this.newId()
    const ts = this.now()
    await this.sql.transaction(async () => {
      if (input.isDefault) await this.sql.run(`UPDATE llm_engines SET is_default = 0 WHERE kind = ?`, [input.kind])
      await this.sql.run(`INSERT INTO llm_engines (id, name, kind, base_url, token, enabled, allowed_roles, is_default, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, input.name, input.kind, input.baseUrl, input.token, input.enabled ? 1 : 0, JSON.stringify(input.allowedRoles), input.isDefault ? 1 : 0, ts])
    })
    return (await this.getLlmEngine(id)) as AdminLlmEngine
  }

  async updateLlmEngine(id: string, patch: AdminLlmEngineInput): Promise<AdminLlmEngine | null> {
    const exists = await this.getLlmEngine(id)
    if (!exists) return null
    await this.sql.transaction(async () => {
      if (patch.isDefault) await this.sql.run(`UPDATE llm_engines SET is_default = 0 WHERE kind = ? AND id != ?`, [patch.kind, id])
      await this.sql.run(`UPDATE llm_engines
           SET name = ?, kind = ?, base_url = ?, token = ?, enabled = ?, allowed_roles = ?, is_default = ?
           WHERE id = ?`, [patch.name, patch.kind, patch.baseUrl, patch.token, patch.enabled ? 1 : 0, JSON.stringify(patch.allowedRoles), patch.isDefault ? 1 : 0, id])
    })
    return await this.getLlmEngine(id)
  }

  async deleteLlmEngine(id: string): Promise<void> {
    await this.sql.run(`DELETE FROM llm_engines WHERE id = ?`, [id])
  }

  async listModelPrices(): Promise<ModelPrice[]> {
    return (await this.sql.all(`SELECT provider, model, input_per_million AS inputPerMillion, cached_input_per_million AS cachedInputPerMillion, cache_write_per_million AS cacheWritePerMillion, output_per_million AS outputPerMillion, source_url AS sourceUrl, effective_at AS effectiveAt, updated_at AS updatedAt FROM model_prices ORDER BY provider, model`)) as ModelPrice[]
  }

  async upsertModelPrice(input: ModelPriceInput): Promise<ModelPrice> {
    const updatedAt = Date.now()
    await this.sql.run(`INSERT INTO model_prices (provider, model, input_per_million, cached_input_per_million, cache_write_per_million, output_per_million, source_url, effective_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(provider, model) DO UPDATE SET input_per_million=excluded.input_per_million, cached_input_per_million=excluded.cached_input_per_million, cache_write_per_million=excluded.cache_write_per_million, output_per_million=excluded.output_per_million, source_url=excluded.source_url, effective_at=excluded.effective_at, updated_at=excluded.updated_at`, [input.provider, input.model, input.inputPerMillion, input.cachedInputPerMillion, input.cacheWritePerMillion, input.outputPerMillion, input.sourceUrl, input.effectiveAt, updatedAt])
    return (await this.sql.get(`SELECT provider, model, input_per_million AS inputPerMillion, cached_input_per_million AS cachedInputPerMillion, cache_write_per_million AS cacheWritePerMillion, output_per_million AS outputPerMillion, source_url AS sourceUrl, effective_at AS effectiveAt, updated_at AS updatedAt FROM model_prices WHERE provider = ? AND model = ?`, [input.provider, input.model])) as ModelPrice
  }

  async deleteModelPrice(provider: string, model: string): Promise<boolean> {
    return (await this.sql.run(`DELETE FROM model_prices WHERE provider = ? AND model = ?`, [provider, model])).changes > 0
  }

  /**
   * Отметка версии прайса: смена цен обесценивает все посчитанные итоги.
   * Дешевле одного числа на запрос, чем пересчёта стоимости на каждый список.
   */
  async modelPricesStamp(): Promise<number> {
    const row = (await this.sql.get(`SELECT COALESCE(MAX(updated_at), 0) AS stamp, COUNT(*) AS n FROM model_prices`)) as { stamp: number; n: number }
    // Число строк в паре с меткой ловит и удаление цены, которое MAX не заметит.
    return row.stamp * 1000 + row.n
  }
}
