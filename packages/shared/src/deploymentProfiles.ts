import type { SessionUser } from './types.js'

export const APPLICATION_IDS = ['chat', 'make', 'projects', 'web-reader', 'playwright-reader', 'image-studio', 'identity'] as const
export type ApplicationId = typeof APPLICATION_IDS[number]
export interface DeploymentApplication { id: ApplicationId; enabled: boolean; location: 'local' | 'external'; url?: string }
export interface DeploymentManifest { coreId: string; applications: DeploymentApplication[] }
export function isApplicationId(value: unknown): value is ApplicationId { return APPLICATION_IDS.includes(value as ApplicationId) }
export function validateCoreId(value: string): string {
  if (!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(value)) throw new Error('invalid_core_id')
  return value
}
export function applicationUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('invalid_application_url')
  return url.href.replace(/\/$/, '')
}
export function parseApplications(value?: string): DeploymentApplication[] {
  const selected = new Map<ApplicationId, string | undefined>()
  for (const item of value === undefined ? APPLICATION_IDS : value === '' ? [] : value.split(',')) {
    const separator = item.indexOf('=')
    const id = (separator < 0 ? item : item.slice(0, separator)).trim()
    if (!isApplicationId(id) || selected.has(id)) throw new Error('invalid_applications')
    selected.set(id, separator < 0 ? undefined : applicationUrl(item.slice(separator + 1).trim()))
  }
  return APPLICATION_IDS.map(id => ({ id, enabled: selected.has(id), location: selected.get(id) ? 'external' : 'local', ...(selected.get(id) ? { url: selected.get(id) } : {}) }))
}
export function serializeApplications(applications: DeploymentApplication[]): string {
  const value = applications.filter(a => a.enabled).map(a => a.location === 'external' ? `${a.id}=${applicationUrl(a.url ?? '')}` : a.id).join(',')
  parseApplications(value)
  return value
}
export interface EnterTicketRedeemRequest { ticket: string; application: ApplicationId }
export interface EnterTicketRedeemResponse { user: SessionUser; tenantId: string | null; capabilities: string[]; expiresAt: number }
export interface CoreLimits { diskBytes?: number; workshops?: number; machines?: number }
export interface TrustedCoreEntry { coreId: string; url: string; credentialRef: string; limits?: CoreLimits }
export interface CoreUsage { coreId: string; diskBytes: number; workshops: number; machines: number }
export type DeploymentErrorCode = 'application_disabled' | 'ticket_invalid' | 'ticket_used' | 'core_unknown' | 'core_limit_exceeded'
export interface SharedServiceSession extends EnterTicketRedeemResponse { coreId: string }
