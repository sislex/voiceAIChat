import { chmodSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { GitAccessDiagnostics, GitAccessErrorCode, GitAccessRequest, GitAccessResult, GitAccessStatus } from '@voicechat/shared'

const git = (args: string[], input?: string) => spawnSync('git', args, { encoding: 'utf8', input, timeout: 30_000, maxBuffer: 262144, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '' } })
const empty = (repositoryUrl?: string): GitAccessStatus => ({ configured: false, readAccess: 'unknown', writeAccess: 'unknown', repositoryUrl, warnings: [] })

export function sanitizeRepositoryUrl(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.search || url.hash || !/^\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(url.pathname)) throw new Error('invalid_repository')
  return url.toString().replace(/\/$/, '')
}
const inputFor = (url: string, token?: string): string => {
  const path = new URL(url).pathname.replace(/^\//, '')
  return ['protocol=https', 'host=github.com', `path=${path}`, 'username=x-access-token', ...(token ? [`password=${token}`] : []), '', ''].join('\n')
}
const termuxFile = (): string => join(process.env.HOME || process.cwd(), '.voicechat', 'git-credentials')
const available = (name: string): boolean => !/is not a git command/i.test(git([name, '--help']).stderr || '')
const helper = (): GitAccessStatus['helperKind'] | undefined => {
  if (process.env.TERMUX_VERSION || process.env.PREFIX?.includes('com.termux')) return 'termux-file'
  if (process.platform === 'darwin' && available('credential-osxkeychain')) return 'osxkeychain'
  if (process.platform === 'win32' && available('credential-manager-core')) return 'manager-core'
  return available('credential-libsecret') ? 'libsecret' : undefined
}
const configureHelper = (kind: NonNullable<GitAccessStatus['helperKind']>): boolean => {
  if (kind === 'termux-file') mkdirSync(dirname(termuxFile()), { recursive: true, mode: 0o700 })
  const value = kind === 'termux-file' ? `store --file=${termuxFile()}` : kind
  return git(['config', '--global', 'credential.helper', value]).status === 0
}
const account = (url: string): string | undefined => {
  const result = git(['credential', 'fill'], inputFor(url))
  return result.status === 0 ? result.stdout.split(/\r?\n/).find((line) => line.startsWith('username='))?.slice(9) : undefined
}
const classify = (text: string, write = false): GitAccessErrorCode => {
  const value = text.toLowerCase()
  if (/terminal prompts disabled|prompt/.test(value)) return 'helper_interactive'
  if (/authenticat|invalid username|password|403/.test(value)) return write ? 'insufficient_permissions' : 'token_expired_or_invalid'
  return write ? 'insufficient_permissions' : 'repository_unavailable'
}
export function diagnoseGitAccess(raw: string): GitAccessDiagnostics {
  const originalUrl = sanitizeRepositoryUrl(raw)
  const result = git(['config', '--show-origin', '--get-regexp', '^url\\..*\\.insteadof'])
  const matchingRules = (result.stdout || '').split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^(\S+)\s+url\.(.+)\.insteadof\s+(.+)$/i)
    return match ? [{ scope: match[1], replacement: match[2], insteadOf: match[3] }] : []
  }).filter((rule) => originalUrl.startsWith(rule.insteadOf))
  const selected = [...matchingRules].sort((a, b) => b.insteadOf.length - a.insteadOf.length)[0]
  const effectiveUrl = selected ? selected.replacement + originalUrl.slice(selected.insteadOf.length) : originalUrl
  const warnings = effectiveUrl === originalUrl ? [] : [{ code: 'instead_of' as const, message: 'Git переписывает URL правилом insteadOf', originalUrl, effectiveUrl }]
  return { originalUrl, effectiveUrl, matchingRules, warnings }
}
export function handleGitAccess(request: GitAccessRequest): GitAccessResult {
  let url: string
  try { url = sanitizeRepositoryUrl(request.repositoryUrl) } catch { return { ok: false, code: 'invalid_repository', status: { ...empty(), lastErrorCode: 'invalid_repository' } } }
  const diagnostics = diagnoseGitAccess(url), kind = helper()
  const base: GitAccessStatus = { ...empty(url), helperKind: kind, account: account(url), warnings: diagnostics.warnings }
  if (request.operation === 'diagnostics') return { ok: true, status: { ...base, configured: !!base.account }, diagnostics }
  if (request.operation === 'status') return { ok: true, status: { ...base, configured: !!base.account } }
  if (request.operation === 'configure') {
    if (!request.token) return { ok: false, code: 'token_missing', status: { ...base, lastErrorCode: 'token_missing' } }
    if (!kind || !configureHelper(kind)) return { ok: false, code: 'helper_unavailable', status: { ...base, lastErrorCode: 'helper_unavailable' } }
    if (git(['credential', 'approve'], inputFor(url, request.token)).status !== 0) return { ok: false, code: 'helper_unavailable', status: { ...base, lastErrorCode: 'helper_unavailable' } }
    if (kind === 'termux-file') try {
      chmodSync(termuxFile(), 0o600)
      if ((statSync(termuxFile()).mode & 0o777) !== 0o600) throw new Error('mode')
    } catch {
      try { unlinkSync(termuxFile()) } catch {}
      return { ok: false, code: 'insecure_credential_file', status: { ...base, lastErrorCode: 'insecure_credential_file' } }
    }
    return { ok: true, status: { ...base, configured: true, account: account(url) ?? 'x-access-token' } }
  }
  if (request.operation === 'delete') {
    git(['credential', 'reject'], inputFor(url))
    if (kind === 'termux-file') try { unlinkSync(termuxFile()) } catch {}
    return { ok: true, status: empty(url) }
  }
  const read = git(['ls-remote', '--exit-code', url, 'HEAD']), checkedAt = Date.now()
  if (read.status !== 0) {
    const code = classify(read.stdout + '\n' + read.stderr)
    return { ok: false, code, status: { ...base, configured: true, readAccess: 'denied', writeAccess: 'unknown', checkedAt, lastErrorCode: code } }
  }
  const write = git(['push', '--dry-run', url, request.refspec])
  if (write.status !== 0) {
    const code = classify(write.stdout + '\n' + write.stderr, true)
    return { ok: false, code, status: { ...base, configured: true, readAccess: 'ok', writeAccess: 'denied', checkedAt, lastErrorCode: code } }
  }
  return { ok: true, status: { ...base, configured: true, readAccess: 'ok', writeAccess: 'ok', checkedAt, account: account(url) } }
}
