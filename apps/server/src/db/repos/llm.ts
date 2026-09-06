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

  listLlmEngines(): AdminLlmEngine[] {
    const rows = this.db
      .prepare(`SELECT * FROM llm_engines ORDER BY kind ASC, is_default DESC, created_at ASC`)
      .all() as LlmEngineRow[]
    return rows.map((row) => this.mapLlmEngine(row))
  }

  getLlmEngine(id: string): AdminLlmEngine | null {
    const row = this.db.prepare(`SELECT * FROM llm_engines WHERE id = ?`).get(id) as LlmEngineRow | undefined
    return row ? this.mapLlmEngine(row) : null
  }

  /** Исполнители, доступные роли; секреты наружу не возвращаются. */
  listLlmEnginesForRole(role: UserRole) {
    return this.listLlmEngines()
      .filter((engine) => engine.enabled && engine.allowedRoles.includes(role))
      .map(({ id, name, kind, isDefault }) => ({ id, name, kind, isDefault }))
  }

  resolveLlmEngine(engineId: string | null | undefined, kind: LlmEngineKind, role: UserRole) {
    const allowed = (engine: AdminLlmEngine | null): engine is AdminLlmEngine =>
      Boolean(engine && engine.kind === kind && engine.enabled && engine.allowedRoles.includes(role))
    const requested = engineId ? this.getLlmEngine(engineId) : null
    if (allowed(requested)) return { engine: requested, substituted: false }
    const fallback = this.listLlmEngines().find((engine) => engine.kind === kind && engine.isDefault && allowed(engine))
      ?? this.listLlmEngines().find((engine) => engine.kind === kind && allowed(engine))
      ?? null
    return { engine: fallback, substituted: Boolean(engineId && engineId !== fallback?.id) }
  }

  createLlmEngine(input: AdminLlmEngineInput): AdminLlmEngine {
    const id = this.newId()
    const ts = this.now()
    this.db.transaction(() => {
      if (input.isDefault) this.db.prepare(`UPDATE llm_engines SET is_default = 0 WHERE kind = ?`).run(input.kind)
      this.db
        .prepare(
          `INSERT INTO llm_engines (id, name, kind, base_url, token, enabled, allowed_roles, is_default, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.name,
          input.kind,
          input.baseUrl,
          input.token,
          input.enabled ? 1 : 0,
          JSON.stringify(input.allowedRoles),
          input.isDefault ? 1 : 0,
          ts
        )
    })()
    return this.getLlmEngine(id) as AdminLlmEngine
  }

  updateLlmEngine(id: string, patch: AdminLlmEngineInput): AdminLlmEngine | null {
    const exists = this.getLlmEngine(id)
    if (!exists) return null
    this.db.transaction(() => {
      if (patch.isDefault) this.db.prepare(`UPDATE llm_engines SET is_default = 0 WHERE kind = ? AND id != ?`).run(patch.kind, id)
      this.db
        .prepare(
          `UPDATE llm_engines
           SET name = ?, kind = ?, base_url = ?, token = ?, enabled = ?, allowed_roles = ?, is_default = ?
           WHERE id = ?`
        )
        .run(
          patch.name,
          patch.kind,
          patch.baseUrl,
          patch.token,
          patch.enabled ? 1 : 0,
          JSON.stringify(patch.allowedRoles),
          patch.isDefault ? 1 : 0,
          id
        )
    })()
    return this.getLlmEngine(id)
  }

  deleteLlmEngine(id: string): void {
    this.db.prepare(`DELETE FROM llm_engines WHERE id = ?`).run(id)
  }

  listModelPrices(): ModelPrice[] {
    return this.db.prepare(`SELECT provider, model, input_per_million AS inputPerMillion, cached_input_per_million AS cachedInputPerMillion, cache_write_per_million AS cacheWritePerMillion, output_per_million AS outputPerMillion, source_url AS sourceUrl, effective_at AS effectiveAt, updated_at AS updatedAt FROM model_prices ORDER BY provider, model`).all() as ModelPrice[]
  }

  upsertModelPrice(input: ModelPriceInput): ModelPrice {
    const updatedAt = Date.now()
    this.db.prepare(`INSERT INTO model_prices (provider, model, input_per_million, cached_input_per_million, cache_write_per_million, output_per_million, source_url, effective_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(provider, model) DO UPDATE SET input_per_million=excluded.input_per_million, cached_input_per_million=excluded.cached_input_per_million, cache_write_per_million=excluded.cache_write_per_million, output_per_million=excluded.output_per_million, source_url=excluded.source_url, effective_at=excluded.effective_at, updated_at=excluded.updated_at`).run(input.provider, input.model, input.inputPerMillion, input.cachedInputPerMillion, input.cacheWritePerMillion, input.outputPerMillion, input.sourceUrl, input.effectiveAt, updatedAt)
    return this.db.prepare(`SELECT provider, model, input_per_million AS inputPerMillion, cached_input_per_million AS cachedInputPerMillion, cache_write_per_million AS cacheWritePerMillion, output_per_million AS outputPerMillion, source_url AS sourceUrl, effective_at AS effectiveAt, updated_at AS updatedAt FROM model_prices WHERE provider = ? AND model = ?`).get(input.provider, input.model) as ModelPrice
  }

  deleteModelPrice(provider: string, model: string): boolean {
    return this.db.prepare(`DELETE FROM model_prices WHERE provider = ? AND model = ?`).run(provider, model).changes > 0
  }

  /**
   * Отметка версии прайса: смена цен обесценивает все посчитанные итоги.
   * Дешевле одного числа на запрос, чем пересчёта стоимости на каждый список.
   */
  modelPricesStamp(): number {
    const row = this.db.prepare(`SELECT COALESCE(MAX(updated_at), 0) AS stamp, COUNT(*) AS n FROM model_prices`).get() as { stamp: number; n: number }
    // Число строк в паре с меткой ловит и удаление цены, которое MAX не заметит.
    return row.stamp * 1000 + row.n
  }
}
