export type LoginApplicationPlatform = 'macos' | 'windows' | 'linux' | 'android'
export type LoginApplicationArch = 'arm64' | 'x64'

export interface LoginApplicationArtifact {
  platform: LoginApplicationPlatform
  arch: LoginApplicationArch
  available: boolean
  downloadUrl?: string
  filename?: string
}

export type EnrollmentStatus = 'pending' | 'completed' | 'expired'

export interface EnrollmentIssued {
  enrollmentToken: string
  statusId: string
  /** Public aliases used by the versioned deep-link contract. */
  secret?: string
  correlationId?: string
  expiresAt: number
  deepLink: string
}

export interface EnrollmentRedeemRequest {
  token: string
  name: string
}

export interface EnrollmentRedeemed {
  agentId: string
  name: string
  machineToken: string
  serverUrl: string
}

export interface EnrollmentStatusResult {
  status: EnrollmentStatus
  agentId?: string
  expiresAt: number
}

export const LOGIN_ENROLLMENT_TTL_MS = 2 * 60_000

function isAllowedEnrollmentOrigin(url: URL): boolean {
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host === '[::1]') return true
  const octets = host.split('.').map(Number)
  return octets.length === 4 &&
    octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    octets[0] === 127
}

export function loginEnrollmentDeepLink(token: string, statusId: string, serverUrl: string): string {
  const url = new URL('voicechat-login://enroll')
  url.searchParams.set('v', '1')
  url.searchParams.set('secret', token)
  url.searchParams.set('correlationId', statusId)
  url.searchParams.set('origin', serverUrl)
  return url.toString()
}

export function parseLoginEnrollmentDeepLink(value: string): { token: string; statusId: string; serverUrl: string } | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'voicechat-login:' || url.hostname !== 'enroll' || url.searchParams.get('v') !== '1') return null
    // Legacy names remain readable so links issued shortly before an upgrade still work.
    const token = (url.searchParams.get('secret') ?? url.searchParams.get('token'))?.trim() ?? ''
    const statusId = (url.searchParams.get('correlationId') ?? url.searchParams.get('status'))?.trim() ?? ''
    const serverUrl = (url.searchParams.get('origin') ?? url.searchParams.get('server'))?.trim() ?? ''
    const parsedServer = new URL(serverUrl)
    if (!token || !statusId || !isAllowedEnrollmentOrigin(parsedServer)) return null
    return { token, statusId, serverUrl: parsedServer.origin }
  } catch {
    return null
  }
}
