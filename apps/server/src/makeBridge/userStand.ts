import { createHash } from 'node:crypto'
import { z } from 'zod'
import { isSafeRepoRelativePath, isValidGitBranchName, normalizeCommitMessage, splitGitSections } from '@voicechat/shared'
import type { MachineAccessLevel } from '@sislexa/agent-contracts'
import type { VoiceChatDb } from '../db/database.js'
import type { MachinesService } from '../machines/service.js'
import type { ProjectPreviews } from './projectPreview.js'
import { externalStandUrl, resolveExternalStand, type ExternalStandTarget, type StandLookup } from '../standExternal.js'
import type { CommandGate } from '../agents/commandGate.js'
import { buildShellCommand } from '../util/shell.js'
import { checkoutScript, commitScript, createBranchScript, gitBaseEnv, type GitScript } from '../git/scripts.js'
import { standResearchOperationSchema, standResearchResultSchema, type StandResearch, type StandResearchOperation, type StandResearchResult } from './standResearch.js'

// Make "stands library": user-scoped stands (no project) with a folder, a start command and a
// localhost URL on one of the user's machines. Local shapes mirror make-contracts 1.8.16 plus the
// `git` and `release` operations of the next Make release (feat/stands-n-tools)
// (`MakeProjectCore.userStand`); once Core pins that release the published types replace these.

export const USER_STAND_ERROR_CODES = ['machine_unavailable', 'machine_forbidden', 'path_outside_stand', 'stand_command_forbidden',
  'stand_proxy_unavailable', 'file_too_large', 'invalid_user_stand', 'stand_url_forbidden', 'not_a_repository'] as const
export const USER_STAND_MAX_FILE_BYTES = 2 * 1024 * 1024

const machineId = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/)
const folder = z.string().min(1).max(1000).refine(value => /^\/./.test(value) || /^[A-Za-z]:\\./.test(value), 'absolute folder')
  .refine(value => !/[\0\r\n]/.test(value), 'folder')
const command = z.string().min(1).max(2000).refine(value => !/[\0\r\n]/.test(value), 'command')
const port = z.number().int().min(1).max(65535)
const relative = z.string().min(1).max(1000).refine(value => value === '.' || (isSafeRepoRelativePath(value) && !value.split('/').some(part => part.toLowerCase() === '.git')), 'path')
const filePath = relative.refine(value => value !== '.', 'path')
const branch = z.string().refine(isValidGitBranchName, 'branch')
/** Git in a stand folder (make-contracts `userStandGitOperationSchema`). */
const gitOperation = z.discriminatedUnion('op', [
  z.object({ op: z.literal('status') }).strict(),
  z.object({ op: z.literal('branches') }).strict(),
  z.object({ op: z.literal('checkout'), name: branch }).strict(),
  z.object({ op: z.literal('create_branch'), name: branch, from: branch.optional() }).strict(),
  z.object({ op: z.literal('commit'), message: z.string().min(1).max(4000), files: z.array(filePath).min(1).max(200).optional() }).strict(),
  z.object({ op: z.literal('diff'), path: relative.optional() }).strict()
])
export const USER_STAND_GIT_OUTPUT_MAX = 200_000

/** `files` variants share `op`, so operations validate as a plain union; RPC args are `[userId, operation]`. */
export const userStandOperationSchema = z.union([
  z.object({ op: z.literal('machines') }).strict(),
  z.object({ op: z.enum(['start', 'status', 'stop']), machineId, folder, command, port }).strict(),
  z.object({ op: z.literal('preview'), machineId, port }).strict(),
  // External http(s) stand (no machine): proxied through a `ue-` lease after the SSRF guard.
  z.object({ op: z.literal('preview'), url: z.string().min(1).max(4000) }).strict(),
  z.object({ op: z.literal('files'), machineId, folder, action: z.literal('list'), dir: relative }).strict(),
  z.object({ op: z.literal('files'), machineId, folder, action: z.literal('read'), path: filePath }).strict(),
  z.object({ op: z.literal('files'), machineId, folder, action: z.literal('write'), path: filePath,
    content: z.string().max(Math.ceil(USER_STAND_MAX_FILE_BYTES / 3) * 4 + 4), encoding: z.enum(['utf8', 'base64']) }).strict(),
  z.object({ op: z.literal('git'), machineId, folder, operation: gitOperation }).strict(),
  // Free the StandProxy lease of a stand Make no longer shows (deleted, moved or off screen).
  z.object({ op: z.literal('release'), machineId, port }).strict(),
  z.object({ op: z.literal('release'), url: z.string().min(1).max(4000) }).strict(),
  // Read-only page research of a stand in the conversation's headless browser-runner session.
  standResearchOperationSchema
])
export const userStandArgsSchema = z.tuple([z.string().min(1), userStandOperationSchema])
export const userStandResultSchema = z.union([
  z.object({ machines: z.array(z.object({ agentId: z.string(), name: z.string(), online: z.boolean() }).strict()) }).strict(),
  z.object({ status: z.enum(['stopped', 'starting', 'running', 'failed']), error: z.string().optional() }).strict(),
  z.object({ url: z.string().min(1), interactive: z.boolean() }).strict(),
  z.object({ entries: z.array(z.object({ path: z.string(), kind: z.enum(['file', 'directory']) }).strict()) }).strict(),
  z.object({ content: z.string(), encoding: z.enum(['utf8', 'base64']) }).strict(),
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ git: z.object({
    op: z.enum(['status', 'branches', 'checkout', 'create_branch', 'commit', 'diff']), ok: z.boolean(),
    branch: z.string().nullable().optional(), files: z.array(z.object({ path: z.string(), status: z.string() }).strict()).optional(),
    branches: z.array(z.object({ name: z.string(), current: z.boolean() }).strict()).optional(),
    commit: z.string().optional(), diff: z.string().optional(), truncated: z.boolean().optional(), output: z.string().optional()
  }).strict() }).strict(),
  standResearchResultSchema
])

export type UserStandStatus = 'stopped' | 'starting' | 'running' | 'failed'
export type UserStandOperation =
  | { op: 'machines' }
  | { op: 'start' | 'status' | 'stop'; machineId: string; folder: string; command: string; port: number }
  | { op: 'preview'; machineId: string; port: number }
  | { op: 'preview'; url: string }
  | { op: 'files'; machineId: string; folder: string; action: 'list'; dir: string }
  | { op: 'files'; machineId: string; folder: string; action: 'read'; path: string }
  | { op: 'files'; machineId: string; folder: string; action: 'write'; path: string; content: string; encoding: 'utf8' | 'base64' }
  | { op: 'git'; machineId: string; folder: string; operation: UserStandGitOperation }
  | { op: 'release'; machineId: string; port: number }
  | { op: 'release'; url: string }
  | StandResearchOperation
export type UserStandGitOperation = z.infer<typeof gitOperation>
export interface UserStandGitResult {
  op: UserStandGitOperation['op']; ok: boolean; branch?: string | null; files?: Array<{ path: string; status: string }>
  branches?: Array<{ name: string; current: boolean }>; commit?: string; diff?: string; truncated?: boolean; output?: string
}
export type UserStandResult =
  | { machines: Array<{ agentId: string; name: string; online: boolean }> }
  | { status: UserStandStatus; error?: string }
  | { url: string; interactive: boolean }
  | { entries: Array<{ path: string; kind: 'file' | 'directory' }> }
  | { content: string; encoding: 'utf8' | 'base64' }
  | { ok: true }
  | { git: UserStandGitResult }
  | StandResearchResult

const STATUS_CODES: Record<typeof USER_STAND_ERROR_CODES[number], number> = {
  invalid_user_stand: 400, path_outside_stand: 400, machine_forbidden: 403, stand_command_forbidden: 403,
  machine_unavailable: 409, file_too_large: 413, stand_proxy_unavailable: 503, stand_url_forbidden: 403, not_a_repository: 409
}
export function userStandError(code: typeof USER_STAND_ERROR_CODES[number]): never {
  throw Object.assign(new Error(code), { statusCode: STATUS_CODES[code] })
}
/** Maps preview program and machine bridge failures onto the user stand error codes. */
function translate(error: unknown): never {
  const code = error instanceof Error ? error.message : ''
  if ((USER_STAND_ERROR_CODES as readonly string[]).includes(code)) userStandError(code as typeof USER_STAND_ERROR_CODES[number])
  if (code === 'path_outside_working_copy') userStandError('path_outside_stand')
  if (code === 'preview_command_forbidden') userStandError('stand_command_forbidden')
  if (code === 'preview_invalid_config' || code === 'invalid_action') userStandError('invalid_user_stand')
  userStandError('machine_unavailable')
}

/** `us-<machineId>-<port>`: StandProxy id of a user stand. Machine ids may contain `-`, so the port is the last segment. */
export function userStandId(machine: string, port: number): string { return 'us-' + machine + '-' + port }
export function parseUserStandId(standId: string): { machineId: string; port: number } | null {
  const match = /^us-([A-Za-z0-9_-]+)-(\d{1,5})$/.exec(standId)
  if (!match) return null
  const port = Number(match[2])
  return port >= 1 && port <= 65535 ? { machineId: match[1]!, port } : null
}

/** `ue-<sha256(origin)>`: StandProxy id of an external user stand; the origin itself is kept by `UserStands`. */
export function externalUserStandId(origin: string): string { return 'ue-' + createHash('sha256').update(origin).digest('hex').slice(0, 32) }

export type UserStandMachines = Pick<MachinesService, 'isOnline' | 'fsList' | 'fsRead' | 'fsWrite' | 'exec'>
interface Deps {
  db: Pick<VoiceChatDb, 'machines'>
  /** Command policy (role layer; user stands have no project) applied to every Git script. */
  gate?: CommandGate
  /** Drops the StandProxy leases of this user for a `us-`/`ue-` stand id. */
  releaseAccess?: (user: string, standId: string) => Promise<void>
  machines: UserStandMachines
  previews: Pick<ProjectPreviews, 'runAt' | 'check'>
  /** StandProxy listener ports; a stand may never target one. */
  reservedPorts: number[]
  /** Make inspector lease for a `us-` stand id; absent when the proxy has no ports. */
  previewAccess?: (user: string, standId: string) => Promise<{ url: string }>
  /** SSRF guard overrides (tests); defaults to system DNS and `VC_STAND_PROXY_ALLOW_PRIVATE`. */
  externalGuard?: { lookup?: StandLookup; allowPrivate?: boolean }
  /** Stand research through browser-runner; absent when Core has no runner. */
  research?: Pick<StandResearch, 'research'>
}

export class UserStands {
  /** `ue-` id -> upstream origin, registered by `preview {url}`; bounded, oldest entries drop first. */
  private readonly external = new Map<string, string>()
  constructor(private readonly deps: Deps) {}

  /** Usable machine of the user or `machine_forbidden`; `write` requires owner or full share access. */
  private async machine(user: string, agentId: string, write: boolean): Promise<{ agentId: string; access: MachineAccessLevel }> {
    const machine = (await this.deps.db.machines.listUserMachineAccess(user)).find(item => item.agentId === agentId)
    if (!machine || (write && machine.access === 'read')) userStandError('machine_forbidden')
    if (!this.deps.machines.isOnline(agentId)) userStandError('machine_unavailable')
    return machine
  }

  private port(value: number): number {
    if (this.deps.reservedPorts.includes(value)) userStandError('invalid_user_stand')
    return value
  }

  /** StandProxy resolver for `us-` ids; re-run on every proxied request. */
  async target(user: string, standId: string): Promise<{ machineId: string; gatewayPort: number } | ExternalStandTarget> {
    if (standId.startsWith('ue-')) {
      const origin = this.external.get(standId)
      if (!origin) throw Object.assign(new Error('stand_not_found'), { statusCode: 404 })
      return resolveExternalStand(origin, this.deps.externalGuard)
    }
    const parsed = parseUserStandId(standId)
    if (!parsed) throw Object.assign(new Error('stand_not_found'), { statusCode: 404 })
    await this.machine(user, parsed.machineId, false)
    return { machineId: parsed.machineId, gatewayPort: this.port(parsed.port) }
  }

  async userStand(user: string, operation: UserStandOperation): Promise<UserStandResult> {
    const parsed = userStandOperationSchema.safeParse(operation)
    if (!parsed.success) userStandError(operation && (operation as { op?: string }).op === 'files' ? 'path_outside_stand' : 'invalid_user_stand')
    const op = parsed.data as UserStandOperation
    if (op.op === 'machines') {
      const machines = await this.deps.db.machines.listUserMachineAccess(user)
      return { machines: machines.map(m => ({ agentId: m.agentId, name: m.name, online: this.deps.machines.isOnline(m.agentId) })) }
    }
    if (op.op === 'preview' && 'url' in op) {
      const url = externalStandUrl(op.url)
      await resolveExternalStand(url.href, this.deps.externalGuard)
      if (!this.deps.previewAccess) userStandError('stand_proxy_unavailable')
      const standId = externalUserStandId(url.origin)
      this.external.delete(standId); this.external.set(standId, url.origin)
      if (this.external.size > 1000) this.external.delete(this.external.keys().next().value!)
      const lease = await this.deps.previewAccess(user, standId).catch((error: { statusCode?: number }) => {
        userStandError(error?.statusCode === 403 ? 'stand_url_forbidden' : 'stand_proxy_unavailable')
      })
      // The proxied app is served at the root of the lease origin; keep the stand path and query.
      return { url: new URL(lease.url).origin + url.pathname + url.search + url.hash, interactive: true }
    }
    if (op.op === 'preview') {
      await this.machine(user, op.machineId, false)
      this.port(op.port)
      if (!this.deps.previewAccess) userStandError('stand_proxy_unavailable')
      const lease = await this.deps.previewAccess(user, userStandId(op.machineId, op.port)).catch((error: { statusCode?: number }) => {
        if (error?.statusCode === 403) userStandError('machine_forbidden')
        userStandError('stand_proxy_unavailable')
      })
      return { url: lease.url, interactive: true }
    }
    if (op.op === 'files') return this.files(user, op)
    if (op.op === 'git') return { git: await this.git(user, op) }
    if (op.op === 'release') {
      let standId: string
      if ('url' in op) {
        try { standId = externalUserStandId(new URL(op.url).origin) } catch { userStandError('invalid_user_stand') }
      } else standId = userStandId(op.machineId, op.port)
      await this.deps.releaseAccess?.(user, standId)
      return { ok: true }
    }
    if (op.op === 'research') {
      if (!this.deps.research) userStandError('stand_proxy_unavailable')
      return this.deps.research.research(user, op)
    }
    await this.machine(user, op.machineId, op.op !== 'status')
    this.port(op.port)
    // One state file per (user, machine, folder, port): the same folder on another port is another stand.
    const id = createHash('sha256').update(JSON.stringify(['user-stand', user, op.machineId, op.folder, op.port])).digest('hex')
    try {
      const status = await this.deps.previews.runAt(user, op.machineId, op.op, { id, root: op.folder, command: op.command, port: op.port, projectId: null })
      return status === 'failed' ? { status, error: 'stand_start_failed' } : { status }
    } catch (error) { translate(error) }
  }

  private async files(user: string, op: Extract<UserStandOperation, { op: 'files' }>): Promise<UserStandResult> {
    await this.machine(user, op.machineId, op.action === 'write')
    const { machines, previews } = this.deps
    const check = (relativePath: string, allowMissing = false) => previews.check(user, op.machineId, op.folder, relativePath, allowMissing).catch(translate)
    try {
      if (op.action === 'list') {
        const target = await check(op.dir)
        if (!target.directory) userStandError('path_outside_stand')
        const entries = (await machines.fsList(op.machineId, target.target)).entries ?? []
        // Symlinks are never listed; every later read/write re-checks realpath containment.
        return { entries: entries.filter(e => (e.kind === 'file' || e.kind === 'dir') && e.name !== '.git' && !/[/\\\0]/.test(e.name) && e.name !== '.' && e.name !== '..')
          .map(e => ({ path: op.dir === '.' ? e.name : op.dir + '/' + e.name, kind: e.kind === 'dir' ? 'directory' as const : 'file' as const })) }
      }
      if (op.action === 'read') {
        const target = await check(op.path)
        if (target.directory) userStandError('path_outside_stand')
        const file = await machines.fsRead(op.machineId, target.target)
        const content = Buffer.from(file.dataBase64 ?? '', 'base64')
        if (file.truncated || content.length > USER_STAND_MAX_FILE_BYTES) userStandError('file_too_large')
        const text = content.toString('utf8')
        return Buffer.from(text, 'utf8').equals(content) && !text.includes('\0')
          ? { content: text, encoding: 'utf8' } : { content: content.toString('base64'), encoding: 'base64' }
      }
      const data = op.encoding === 'base64' ? Buffer.from(op.content, 'base64') : Buffer.from(op.content, 'utf8')
      if (data.length > USER_STAND_MAX_FILE_BYTES) userStandError('file_too_large')
      const target = await check(op.path, true)
      if (target.directory) userStandError('path_outside_stand')
      await machines.fsWrite(op.machineId, target.target, data.toString('base64'))
      return { ok: true }
    } catch (error) { translate(error) }
  }

  /**
   * Git in the realpath of a stand folder that must be a repository root, so `add -A` and
   * checkout never reach files outside the stand. Mutations need write access to the machine;
   * every script goes through the command gate and the per-folder Git lock shared with Core's
   * project Git. A failing git command answers `ok: false` with git's own message.
   */
  private async git(user: string, op: Extract<UserStandOperation, { op: 'git' }>): Promise<UserStandGitResult> {
    const git = op.operation
    const mutates = git.op === 'checkout' || git.op === 'create_branch' || git.op === 'commit'
    await this.machine(user, op.machineId, mutates)
    const root = (await this.deps.previews.check(user, op.machineId, op.folder, '.').catch(translate)).root
    const script = userStandGitScript(git, user)
    const command = buildShellCommand(script.script, root, { ...gitBaseEnv(), ...script.env, VC_GIT_ROOT: root })
    const verdict = await this.deps.gate?.({ command, userId: user, projectId: null, source: 'console' })
    if (verdict && !verdict.allowed) userStandError('stand_command_forbidden')
    const holder = `${user}:${process.pid}:${Date.now()}`
    const locks = this.deps.db.machines
    if (!await locks.acquireGitWorkspaceLock(op.machineId, root, holder, 'user-stand ' + git.op, 6 * 60_000))
      return { op: git.op, ok: false, output: 'Another Git operation is running in this folder' }
    let result: { output: string; exitCode: number | null; timedOut: boolean }
    try {
      result = await this.deps.machines.exec(op.machineId, command, git.op === 'checkout' ? 300_000 : 60_000, undefined, { source: 'console', userId: user })
    } catch { userStandError('machine_unavailable') } finally { await locks.releaseGitWorkspaceLock(op.machineId, root, holder) }
    if (result.exitCode === 64) userStandError('not_a_repository')
    const output = result.output.length > USER_STAND_GIT_OUTPUT_MAX ? result.output.slice(0, USER_STAND_GIT_OUTPUT_MAX) : result.output
    const tail = (text: string) => text.trim().split(/\r?\n/).slice(-20).join('\n').slice(-4000)
    if (result.timedOut || result.exitCode !== 0) return { op: git.op, ok: false, output: tail(output.replace(/^==VC:[a-z_0-9]+==$/gm, '')) }
    const sections = splitGitSections(output)
    const current = (sections.branch ?? '').trim() || null
    if (git.op === 'status') {
      const files = (sections.status ?? '').split('\n').filter(line => line.length > 3).map(line => ({ status: line.slice(0, 2), path: line.slice(3) }))
      return { op: 'status', ok: true, branch: current, files }
    }
    if (git.op === 'branches') {
      const branches = (sections.branches ?? '').split('\n').filter(Boolean).map(line => ({ name: line.slice(2), current: line.startsWith('*') }))
      return { op: 'branches', ok: true, branch: current, branches }
    }
    if (git.op === 'diff') {
      const diff = sections.diff ?? ''
      return { op: 'diff', ok: true, branch: current, diff, truncated: result.output.length > USER_STAND_GIT_OUTPUT_MAX }
    }
    if (git.op === 'commit') return { op: 'commit', ok: true, branch: current, commit: /[0-9a-f]{7,40}/.exec(sections.sha ?? '')?.[0] }
    return { op: git.op, ok: true, branch: current ?? git.name }
  }
}

const mark = (name: string): string => `printf '%s\\n' '==VC:${name}=='`
const READ = 'git --no-optional-locks -c core.quotepath=false'

/**
 * Script for one stand Git operation. User data only travels in `VC_GIT_*` variables (see
 * git/scripts.ts); no redirections, so read operations also run on read-only machine shares.
 * Exit 64 = the folder is not the root of a Git repository.
 */
export function userStandGitScript(git: UserStandGitOperation, user: string): GitScript {
  const guard = [
    `top=$(${READ} rev-parse --show-toplevel) || { printf '%s\\n' 'not_a_repository'; exit 64; }`,
    `[ "$top" = "$VC_GIT_ROOT" ] || { printf '%s\\n' 'not_a_repository'; exit 64; }`
  ]
  const branchSection = [mark('branch'), `${READ} symbolic-ref --short -q HEAD || true`]
  const wrap = (body: GitScript, after: string[] = []): GitScript => ({ env: body.env, script: [...guard, body.script, ...after].join('\n') })
  if (git.op === 'status') return wrap({ env: {}, script: [...branchSection, mark('status'), `${READ} status --porcelain=v1 --untracked-files=all`, mark('done')].join('\n') })
  if (git.op === 'branches') return wrap({ env: {}, script: [...branchSection, mark('branches'), `${READ} for-each-ref --format='%(HEAD) %(refname:short)' refs/heads`, mark('done')].join('\n') })
  if (git.op === 'diff') return wrap({ env: { VC_GIT_PATH: git.path ?? '.' }, script: [...branchSection, mark('diff'), `${READ} diff --no-color HEAD -- "$VC_GIT_PATH"`, mark('done')].join('\n') })
  if (git.op === 'checkout') return wrap(checkoutScript(git.name))
  if (git.op === 'create_branch') return wrap(createBranchScript(git.name, git.from ?? 'HEAD'))
  const message = normalizeCommitMessage(git.message) ?? 'Update'
  return wrap(commitScript({ message, paths: git.files ?? [], all: !git.files, user, email: `${user}@users.noreply.voicechat` }), branchSection)
}
