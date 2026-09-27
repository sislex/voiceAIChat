import type { TurnUsage } from './types'
import type { ChatApplicationAttribution } from './chatContract'

/** Built by authenticated Core admission, never accepted from a browser payload. */
export interface LlmAccountingContext {
  operationId: string
  reservationId: string
  userId: string
  tenantId: string
  environmentId: string
  originModuleId: string
  application?: ChatApplicationAttribution
}

/** Numeric receipt only: prompts, model output and credentials are never retained. */
export interface LlmExecutionReceipt {
  version: 1
  runId: string
  context: LlmAccountingContext
  kind: 'claude' | 'codex'
  state: 'claimed' | 'running' | 'finished' | 'not_started' | 'uncertain'
  createdAt: number
  updatedAt: number
  exitCode?: number | null
  model?: string
  /** Final provider counters; Codex counters still include the previous thread total. */
  usage?: TurnUsage
  /** Authoritative pre-spawn thread total, absent if the resumed history is unavailable. */
  baseline?: TurnUsage
  /** Decimal USD as reported by Claude, without a floating-point conversion to micro-USD. */
  providerCostUsd?: string
  finalUsage: boolean
}

export const LLM_RECEIPTS_PATH = '/v1/execution-receipts'

/** A queue stores this reference, never the credential used by its initiating session. */
export interface LlmBillingSession {
  sid: string
  userId: string
  tenantId: string
}

/** Shape validation is not authentication; runner caller identity comes from its bearer. */
export function parseLlmAccountingContext(value: unknown): LlmAccountingContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid accounting context')
  const source = value as Record<string, unknown>
  const keys = ['operationId', 'reservationId', 'userId', 'tenantId', 'environmentId', 'originModuleId'] as const
  if (Object.keys(source).some(key => key !== 'application' && !(keys as readonly string[]).includes(key))) throw Error('Unknown accounting field')
  for (const key of keys) {
    const field = source[key]
    if (typeof field !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(field) || /[\r\n]/.test(field)) {
      throw Error('Invalid accounting field')
    }
  }
  let application: ChatApplicationAttribution | undefined
  if (source.application !== undefined) {
    const value = source.application
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid application attribution')
    const app = value as Record<string, unknown>
    const allowed = ['version', 'originApplicationId', 'executorApplicationId', 'tokenId', 'delegationId']
    if (app.version !== 1 || Object.keys(app).some(key => !allowed.includes(key))) throw Error('Invalid application attribution')
    for (const key of ['originApplicationId', 'executorApplicationId']) {
      if (typeof app[key] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(app[key] as string)) throw Error('Invalid application attribution')
    }
    for (const key of ['tokenId', 'delegationId']) {
      if (app[key] !== null && (typeof app[key] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(app[key] as string))) throw Error('Invalid application attribution')
    }
    if (app.originApplicationId !== app.executorApplicationId && app.delegationId === null) throw Error('Application delegation required')
    application = { version: 1, originApplicationId: app.originApplicationId as string,
      executorApplicationId: app.executorApplicationId as string, tokenId: app.tokenId as string | null,
      delegationId: app.delegationId as string | null }
  }
  return { ...Object.fromEntries(keys.map(key => [key, source[key]])) as unknown as LlmAccountingContext,
    ...(application ? { application } : {}) }
}
