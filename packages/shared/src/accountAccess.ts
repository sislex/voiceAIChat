import type { SystemRole } from './types'

/** Product entitlements are independent of system permissions and provider grants. */
export const PRODUCT_CAPABILITIES = [
  'chat.use', 'make.use', 'web-reader.use', 'playwright-reader.use',
  'image-studio.use', 'voice.stt', 'voice.tts', 'projects.use', 'machines.use'
] as const
export type ProductCapability = typeof PRODUCT_CAPABILITIES[number]

export interface PersonalTenant {
  id: string
  kind: 'personal'
  name: string
  owner: string
  createdAt: number
}

export interface TariffPlan {
  id: string
  name: string
  capabilities: ProductCapability[]
  revision: number
  createdAt: number
  updatedAt: number
}

export interface TariffPlanInput {
  id: string
  name: string
  capabilities: ProductCapability[]
  /** Omit when creating; updates must match the current revision. */
  expectedRevision?: number
}

/** Trusted context resolved from current Identity data, never from client claims. */
export interface AuthenticatedAccount {
  /** Stable Identity subject; older providers omit it and cannot authorize billing. */
  userId?: string
  tenantId: string
  tariffId: string
  tariffRevision: number
  capabilities: ProductCapability[]
}

export interface AccountAccess {
  /** Stable across account metadata changes; never derive this from the login name. */
  userId?: string
  userName: string
  systemRole: SystemRole
  tenant: PersonalTenant
  tariff: TariffPlan
  capabilities: ProductCapability[]
}

export interface TariffAssignment {
  userName: string
  systemRole: SystemRole
  tenantId: string
  tariffId: string
}

/** Host-injected client shared by the independent Account UI and Core shells. */
export interface AccountTariffClient {
  getAccess(): Promise<AccountAccess>
  listPlans(): Promise<TariffPlan[]>
  savePlan(input: TariffPlanInput): Promise<TariffPlan>
  listAssignments(): Promise<TariffAssignment[]>
  assign(userName: string, tariffId: string): Promise<AccountAccess>
}

export const DEFAULT_TARIFF_ID = 'standard'

export function isProductCapability(value: unknown): value is ProductCapability {
  return typeof value === 'string' && (PRODUCT_CAPABILITIES as readonly string[]).includes(value)
}

export function hasProductCapability(account: AuthenticatedAccount | undefined, capability: ProductCapability): boolean {
  return account?.capabilities.includes(capability) === true
}

/** Optimistic revisions prevent an old administration screen overwriting newer edits. */
export function validTariffPlanInput(value: unknown): value is TariffPlanInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !['id', 'name', 'capabilities', 'expectedRevision'].includes(key))) return false
  return typeof input.id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(input.id) &&
    typeof input.name === 'string' && input.name.trim().length > 0 && input.name.length <= 80 &&
    Array.isArray(input.capabilities) && input.capabilities.every(isProductCapability) &&
    new Set(input.capabilities).size === input.capabilities.length &&
    (input.expectedRevision === undefined || (Number.isSafeInteger(input.expectedRevision) && Number(input.expectedRevision) > 0))
}
