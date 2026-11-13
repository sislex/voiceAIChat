import { createRequire } from 'node:module'
import type { DatabaseSync as SqliteDatabase } from 'node:sqlite'
import type { BillingReservation, BillingReservationInput, BillingUsageEvidence, BillingTokenPrices } from '@sislexa/sdk'
import type { LlmBillingSession } from '@voicechat/shared'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
export interface AccountingJob {
  modelApi?: boolean
  createdAt?: number
  application?: import('@voicechat/shared').ChatApplicationAttribution
  id: string
  login: string
  session: LlmBillingSession | { userId: string; tenantId: string; delegationId: string }
  originModuleId: string
  input: BillingReservationInput
  target: { kind: 'claude' | 'codex'; baseUrl: string; engineId?: string }
  model: string
  prices?: BillingTokenPrices
  reservation?: BillingReservation
  state: 'admitting' | 'reserved' | 'claiming' | 'dispatching' | 'settling' | 'done'
  settlement?: { eventId: string; actualMicroUsd: number; usage?: BillingUsageEvidence }
}

/** Delivery outbox only. Billing remains the spending authority. No bearer or prompt is stored. */
export class AccountingStore {
  private db: SqliteDatabase
  constructor(filename: string) {
    this.db = new DatabaseSync(filename)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=10000;
      CREATE TABLE IF NOT EXISTS chat_accounting_outbox (id TEXT PRIMARY KEY, state TEXT NOT NULL, value TEXT NOT NULL);`)
  }
  close(): void { this.db.close() }
  save(job: AccountingJob): void {
    this.db.prepare(`INSERT INTO chat_accounting_outbox VALUES (?,?,?) ON CONFLICT(id)
      DO UPDATE SET state=excluded.state, value=excluded.value`).run(job.id, job.state, JSON.stringify(job))
  }
  get(id: string): AccountingJob | undefined {
    const row = this.db.prepare('SELECT value FROM chat_accounting_outbox WHERE id=?').get(id)
    return row ? JSON.parse(String(row.value)) as AccountingJob : undefined
  }
  modelUsage(login: string, from = 0, to = Date.now()) {
    const rows = this.db.prepare("SELECT value FROM chat_accounting_outbox").all()
    const totals = new Map<string, { sid: string; tenantId: string; actualMicroUsd: number; requests: number }>()
    for (const row of rows) {
      const job = JSON.parse(String(row.value)) as AccountingJob
      if (!job.modelApi || job.login !== login || job.state !== 'done' || !job.settlement || !('sid' in job.session)
        || (job.createdAt ?? 0) < from || (job.createdAt ?? 0) > to) continue
      const { sid, tenantId } = job.session
      const key = JSON.stringify([sid, tenantId])
      const item = totals.get(key) ?? { sid, tenantId, actualMicroUsd: 0, requests: 0 }
      item.actualMicroUsd += job.settlement.actualMicroUsd
      item.requests++
      totals.set(key, item)
    }
    return [...totals.values()]
  }
  pending(): AccountingJob[] {
    return this.db.prepare("SELECT value FROM chat_accounting_outbox WHERE state!='done'").all()
      .map(row => JSON.parse(String(row.value)) as AccountingJob)
  }
}
