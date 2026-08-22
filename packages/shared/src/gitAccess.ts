export type GitAccessErrorCode =
  | 'token_missing' | 'token_expired_or_invalid' | 'insufficient_permissions'
  | 'repository_unavailable' | 'machine_offline' | 'helper_unavailable'
  | 'helper_interactive' | 'insecure_credential_file' | 'conflicting_operation'
  | 'invalid_repository'

export type GitAccessCheck = 'unknown' | 'ok' | 'denied'
export interface GitAccessWarning { code: 'instead_of'; message: string; originalUrl: string; effectiveUrl: string }
export interface GitAccessStatus {
  configured: boolean
  helperKind?: 'osxkeychain' | 'manager-core' | 'libsecret' | 'termux-file'
  account?: string
  checkedAt?: number
  readAccess: GitAccessCheck
  writeAccess: GitAccessCheck
  repositoryUrl?: string
  warnings: GitAccessWarning[]
  lastErrorCode?: GitAccessErrorCode
}
export interface GitAccessDiagnostics {
  originalUrl: string
  effectiveUrl: string
  matchingRules: Array<{ scope: string; insteadOf: string; replacement: string }>
  warnings: GitAccessWarning[]
}
export type GitAccessRequest =
  | { operation: 'status'; repositoryUrl: string }
  | { operation: 'configure'; repositoryUrl: string; token: string }
  | { operation: 'verify'; repositoryUrl: string; refspec: string }
  | { operation: 'delete'; repositoryUrl: string }
  | { operation: 'diagnostics'; repositoryUrl: string }
export type GitAccessResult =
  | { ok: true; status: GitAccessStatus; diagnostics?: GitAccessDiagnostics }
  | { ok: false; code: GitAccessErrorCode; status: GitAccessStatus }
