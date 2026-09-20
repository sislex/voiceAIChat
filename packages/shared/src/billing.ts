import { assertPlatformIdentifier } from './platformOperation'

/** Integer micro-USD avoids floating-point rounding in reservation arithmetic. */
export const BILLING_MAX_AMOUNT = 1_000_000_000_000
export interface BillingPolicy {
  monthlyMicroUsd: number | null
  monthlyRequests: number | null
  maxConcurrent: number | null
}
export interface BillingPrincipal {
  userId: string
  tenantId: string
  environmentId: string
  actorClientId: string
  originModuleId: string
}
export interface BillingReservationInput {
  operationId: string
  maxMicroUsd: number
  /** An unstarted reservation expires; running work is never released by TTL alone. */
  expiresAt: number
}
export type BillingReservationState = 'reserved' | 'running' | 'uncertain' | 'settled' | 'released'
export interface BillingReservation extends BillingPrincipal, BillingReservationInput {
  id: string
  period: string
  state: BillingReservationState
  createdAt: number
  actualMicroUsd: number | null
}
export function billingAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= BILLING_MAX_AMOUNT
}
export function parseBillingPolicy(value: unknown): BillingPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid billing policy')
  const p = value as Record<string, unknown>
  const fields = ['monthlyMicroUsd', 'monthlyRequests', 'maxConcurrent'] as const
  if (Object.keys(p).some(key => !(fields as readonly string[]).includes(key))) throw Error('Unknown billing policy field')
  for (const key of fields) if (p[key] !== null && !billingAmount(p[key])) throw Error('Invalid billing policy limit')
  return { monthlyMicroUsd: p.monthlyMicroUsd as number | null, monthlyRequests: p.monthlyRequests as number | null, maxConcurrent: p.maxConcurrent as number | null }
}
/** Shape checking only. Callers must resolve these fields from authenticated authority. */
export function parseBillingPrincipal(value: unknown): BillingPrincipal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid billing principal')
  const p = value as Record<string, unknown>
  const fields = ['userId', 'tenantId', 'environmentId', 'actorClientId', 'originModuleId'] as const
  if (Object.keys(p).some(key => !(fields as readonly string[]).includes(key))) throw Error('Unknown billing principal field')
  for (const key of fields) assertPlatformIdentifier(p[key], key)
  return { userId: p.userId as string, tenantId: p.tenantId as string, environmentId: p.environmentId as string,
    actorClientId: p.actorClientId as string, originModuleId: p.originModuleId as string }
}
