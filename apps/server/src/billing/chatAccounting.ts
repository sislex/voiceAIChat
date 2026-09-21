import { randomUUID } from 'node:crypto'
import type { LlmBillingSession, LlmAccountingContext, LlmClient, LlmStreamHandlers } from '@voicechat/shared'
import type { BillingReservation } from '@voicechat/platform-sdk'
import { RemoteLlmClient } from '../llm/remoteClient.js'
import { AccountingStore, type AccountingJob } from './accountingStore.js'
import { BillingSessions } from './sessions.js'
import { estimatePrices, receiptSettlement } from './usage.js'

interface Transport { url: string; fetchImpl: typeof fetch }
export interface ChatAccountingOptions {
  store: AccountingStore
  sessions: BillingSessions
  billing: Transport
  environmentId: string
  resolveRunner(target: AccountingJob['target']): Promise<RemoteLlmClient | undefined>
  now?: () => number
}
export interface AccountingTurn {
  login: string
  session?: LlmBillingSession
  originModuleId: string
  engineId?: string
}
class AdmissionError extends Error {
  constructor(readonly status: number, readonly reason: string) { super(reason) }
}
const messages: Record<string, string> = {
  execution_cost_not_bounded: 'Для этого тарифа нужен исполнитель с жёстким ограничением стоимости. Текущий CLI его не поддерживает.',
  request_limit_reached: 'Достигнут лимит запросов вашего тарифа.',
  concurrency_limit_reached: 'Достигнут лимит одновременно выполняемых запросов. Дождитесь завершения текущих.',
  budget_exhausted: 'Бюджет на этот месяц исчерпан.'
}

/** A single durable outbox bridges Core, Billing and executor receipts without sharing their databases. */
export class ChatAccounting {
  private active = new Set<string>()
  private reconciling = new Map<string, Promise<void>>()
  private admissions = new Set<Promise<void>>()
  private stopping = false
  private now: () => number
  constructor(private opts: ChatAccountingOptions) { this.now = opts.now ?? Date.now }
  private async call<T>(path: string, body?: unknown, authorization?: string): Promise<T> {
    const response = await this.opts.billing.fetchImpl(this.opts.billing.url+'/v1/billing/'+path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(authorization ? { 'x-sislexa-user-authorization': authorization } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const result = await response.json() as T & { error?: string }
    if (!response.ok) throw new AdmissionError(response.status, result.error ?? 'billing_unavailable')
    return result
  }
  private context(job: AccountingJob): LlmAccountingContext {
    const r = job.reservation!
    return { operationId: job.id, reservationId: r.id, userId: job.session.userId,
      tenantId: job.session.tenantId, environmentId: this.opts.environmentId, originModuleId: job.originModuleId }
  }
  private assertReservation(job: AccountingJob, r: BillingReservation): void {
    if (r.operationId !== job.id || r.userId !== job.session.userId || r.tenantId !== job.session.tenantId ||
      r.environmentId !== this.opts.environmentId || r.actorClientId !== 'core' || r.originModuleId !== job.originModuleId ||
      r.executionBound !== 'unbounded' || !r.id) throw Error('billing_principal_mismatch')
  }
  wrap(client: LlmClient, turn: AccountingTurn): LlmClient {
    return { send: (request, handlers) => {
      let cancelled = false, inner: ReturnType<LlmClient['send']> | undefined, job: AccountingJob | undefined
      const error = (message: string) => { if (!cancelled) handlers.onError(message) }
      const complete = async (fn: () => void) => {
        if (job) {
          this.active.delete(job.id)
          try { await this.reconcile(job.id) } catch { /* The durable outbox retries independently. */ }
        }
        if (!cancelled) fn()
      }
      const admission = (async () => {
        try {
          if (this.stopping) throw Error('accounting_stopping')
          if (!(client instanceof RemoteLlmClient) || !await client.accountingReady()) {
            throw Error('accounting_runner_required')
          }
          const authorization = this.opts.sessions.authorization(turn.login, turn.session)
          if (!authorization || !turn.session) {
            error('Для запуска очереди нужно восстановить исходную сессию входа. Откройте чат в ней или отправьте запрос заново.'); return
          }
          if (cancelled) return
          const id = randomUUID()
          job = { id, login: turn.login, session: { ...turn.session }, originModuleId: turn.originModuleId,
            input: { operationId: id, maxMicroUsd: 0, executionBound: 'unbounded', expiresAt: this.now()+60_000 },
            target: { ...client.accountingTarget, ...(turn.engineId ? { engineId: turn.engineId } : {}) },
            model: request.model, prices: estimatePrices(request.model), state: 'admitting' }
          this.active.add(id); this.opts.store.save(job)
          const admitted = await this.call<BillingReservation>('reservations', { ...job.input, originModuleId: turn.originModuleId }, authorization)
          this.assertReservation(job, admitted)
          job.reservation = admitted; job.state = 'reserved'; this.opts.store.save(job)
          if (cancelled) return
          job.state = 'claiming'; this.opts.store.save(job)
          const started = await this.call<BillingReservation & { transitioned: boolean }>('reservations/'+admitted.id+'/start', {}, authorization)
          this.assertReservation(job, started)
          if (!started.transitioned || started.state !== 'running') throw Error('billing_claim_not_acquired')
          if (cancelled) return
          // This durable boundary distinguishes a never-dispatched start from possibly incurred work.
          job.state = 'dispatching'; this.opts.store.save(job)
          const forwarded: LlmStreamHandlers = { ...handlers,
            onDone: (text, meta) => { void complete(() => handlers.onDone(text, meta)) },
            onError: message => { void complete(() => handlers.onError(message)) } }
          inner = client.send({ ...request, accounting: this.context(job) }, forwarded)
        } catch (failure) {
          if (job && job.state === 'admitting' && failure instanceof AdmissionError && failure.status >= 400 && failure.status < 500) {
            job.state = 'done'; this.opts.store.save(job)
          }
          error(failure instanceof AdmissionError ? messages[failure.reason] ?? 'Сервис учёта отклонил запуск. Проверьте доступ или повторите позже.' :
            'Не удалось подтвердить учёт расхода. Запрос не будет запущен повторно автоматически.')
        } finally {
          if (job && (!inner || cancelled)) {
            this.active.delete(job.id)
            void this.reconcile(job.id).catch(() => {})
          }
        }
      })()
      this.admissions.add(admission)
      void admission.finally(() => { this.admissions.delete(admission) }).catch(() => {})
      return { cancel: () => {
        cancelled = true; inner?.cancel()
        if (job && inner) { this.active.delete(job.id); void this.reconcile(job.id).catch(() => {}) }
      } }
    } }
  }
  async reconcileAll(): Promise<void> {
    for (const job of this.opts.store.pending()) {
      if (this.stopping) return
      try { await this.reconcile(job.id) } catch { /* A failed dependency retains the durable hold for the next pass. */ }
    }
  }
  async shutdown(): Promise<void> {
    this.stopping = true
    await Promise.allSettled([...this.admissions])
    await Promise.allSettled([...this.reconciling.values()])
    for (const job of this.opts.store.pending()) {
      try { await this.reconcile(job.id) } catch { /* Restart continues from this outbox. */ }
    }
    await Promise.allSettled([...this.reconciling.values()])
  }
  reconcile(id: string): Promise<void> {
    if (this.active.has(id)) return Promise.resolve()
    const pending = this.reconciling.get(id)
    if (pending) return pending
    const work = this.reconcileInside(id).finally(() => { this.reconciling.delete(id) })
    this.reconciling.set(id, work)
    return work
  }
  private async reconcileInside(id: string): Promise<void> {
    const job = this.opts.store.get(id)
    if (!job || job.state === 'done') return
    if (!job.reservation) {
      // Admission may have reached Billing, but Core never attempted /start in this state.
      if (job.input.expiresAt <= this.now()) { job.state = 'done'; this.opts.store.save(job) }
      return
    }
    const path = 'reservations/'+job.reservation.id
    const current = await this.call<BillingReservation>(path)
    this.assertReservation(job, current)
    if (current.state === 'settled' || current.state === 'released') {
      job.state = 'done'; this.opts.store.save(job); return
    }
    if (job.state === 'reserved' || job.state === 'claiming') {
      if (current.state === 'reserved') await this.call(path+'/release', {})
      else await this.call(path+'/settle', { eventId: 'no-spawn:'+job.id, actualMicroUsd: 0 })
      job.state = 'done'; this.opts.store.save(job); return
    }
    if (!job.settlement) {
      const runner = await this.opts.resolveRunner(job.target)
      if (!runner || runner.accountingTarget.baseUrl !== job.target.baseUrl || runner.accountingTarget.kind !== job.target.kind) return
      const context = this.context(job), receipt = await runner.executionReceipt(context)
      if (receipt.version !== 1 || receipt.runId !== job.id || receipt.kind !== job.target.kind ||
        Object.entries(context).some(([key, value]) => receipt.context?.[key as keyof LlmAccountingContext] !== value)) throw Error('execution_receipt_mismatch')
      if (receipt.state === 'not_started') job.settlement = { eventId: 'no-spawn:'+job.id, actualMicroUsd: 0 }
      else {
        const settlement = receiptSettlement(receipt, job.model, job.prices)
        if (settlement) job.settlement = { eventId: 'usage:'+job.id, ...settlement }
        else {
          if ((receipt.state === 'uncertain' || receipt.state === 'finished') && current.state === 'running') await this.call(path+'/uncertain', {})
          return
        }
      }
      job.state = 'settling'; this.opts.store.save(job)
    }
    await this.call(path+'/settle', job.settlement)
    job.state = 'done'; this.opts.store.save(job)
  }
}
