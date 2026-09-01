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

export function loginEnrollmentDeepLink(token: string, statusId: string, serverUrl: string): string {
  const url = new URL('voicechat-login://enroll')
  url.searchParams.set('v', '1')
  url.searchParams.set('token', token)
  url.searchParams.set('status', statusId)
  url.searchParams.set('server', serverUrl)
  return url.toString()
}

export function parseLoginEnrollmentDeepLink(value: string): { token: string; statusId: string; serverUrl: string } | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'voicechat-login:' || url.hostname !== 'enroll' || url.searchParams.get('v') !== '1') return null
    const token = url.searchParams.get('token')?.trim() ?? ''
    const statusId = url.searchParams.get('status')?.trim() ?? ''
    const serverUrl = url.searchParams.get('server')?.trim() ?? ''
    const parsedServer = new URL(serverUrl)
    if (!token || !statusId || !/^https?:$/.test(parsedServer.protocol)) return null
    return { token, statusId, serverUrl: parsedServer.origin }
  } catch {
    return null
  }
}
