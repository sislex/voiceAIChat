import { createHash } from 'node:crypto'
import { z } from 'zod'
import { isSafeRepoRelativePath } from '@voicechat/shared'
import type { MachineAccessLevel } from '@sislexa/agent-contracts'
import type { VoiceChatDb } from '../db/database.js'
import type { MachinesService } from '../machines/service.js'
import type { ProjectPreviews } from './projectPreview.js'

// Make "stands library": user-scoped stands (no project) with a folder, a start command and a
// localhost URL on one of the user's machines. Local shapes mirror make-contracts 1.8.16
// (`MakeProjectCore.userStand`); once Core pins that release the published types replace these.

export const USER_STAND_ERROR_CODES = ['machine_unavailable', 'machine_forbidden', 'path_outside_stand', 'stand_command_forbidden',
  'stand_proxy_unavailable', 'file_too_large', 'invalid_user_stand'] as const
export const USER_STAND_MAX_FILE_BYTES = 2 * 1024 * 1024

const machineId = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/)
const folder = z.string().min(1).max(1000).refine(value => /^\/./.test(value) || /^[A-Za-z]:\\./.test(value), 'absolute folder')
  .refine(value => !/[\0\r\n]/.test(value), 'folder')
const command = z.string().min(1).max(2000).refine(value => !/[\0\r\n]/.test(value), 'command')
const port = z.number().int().min(1).max(65535)
const relative = z.string().min(1).max(1000).refine(value => value === '.' || (isSafeRepoRelativePath(value) && !value.split('/').some(part => part.toLowerCase() === '.git')), 'path')
const filePath = relative.refine(value => value !== '.', 'path')

/** `files` variants share `op`, so operations validate as a plain union; RPC args are `[userId, operation]`. */
export const userStandOperationSchema = z.union([
  z.object({ op: z.literal('machines') }).strict(),
  z.object({ op: z.enum(['start', 'status', 'stop']), machineId, folder, command, port }).strict(),
  z.object({ op: z.literal('preview'), machineId, port }).strict(),
  z.object({ op: z.literal('files'), machineId, folder, action: z.literal('list'), dir: relative }).strict(),
  z.object({ op: z.literal('files'), machineId, folder, action: z.literal('read'), path: filePath }).strict(),
  z.object({ op: z.literal('files'), machineId, folder, action: z.literal('write'), path: filePath,
    content: z.string().max(Math.ceil(USER_STAND_MAX_FILE_BYTES / 3) * 4 + 4), encoding: z.enum(['utf8', 'base64']) }).strict()
])
export const userStandArgsSchema = z.tuple([z.string().min(1), userStandOperationSchema])
export const userStandResultSchema = z.union([
  z.object({ machines: z.array(z.object({ agentId: z.string(), name: z.string(), online: z.boolean() }).strict()) }).strict(),
  z.object({ status: z.enum(['stopped', 'starting', 'running', 'failed']), error: z.string().optional() }).strict(),
  z.object({ url: z.string().min(1), interactive: z.boolean() }).strict(),
  z.object({ entries: z.array(z.object({ path: z.string(), kind: z.enum(['file', 'directory']) }).strict()) }).strict(),
  z.object({ content: z.string(), encoding: z.enum(['utf8', 'base64']) }).strict(),
  z.object({ ok: z.literal(true) }).strict()
])

export type UserStandStatus = 'stopped' | 'starting' | 'running' | 'failed'
export type UserStandOperation =
  | { op: 'machines' }
  | { op: 'start' | 'status' | 'stop'; machineId: string; folder: string; command: string; port: number }
  | { op: 'preview'; machineId: string; port: number }
  | { op: 'files'; machineId: string; folder: string; action: 'list'; dir: string }
  | { op: 'files'; machineId: string; folder: string; action: 'read'; path: string }
  | { op: 'files'; machineId: string; folder: string; action: 'write'; path: string; content: string; encoding: 'utf8' | 'base64' }
export type UserStandResult =
  | { machines: Array<{ agentId: string; name: string; online: boolean }> }
  | { status: UserStandStatus; error?: string }
  | { url: string; interactive: boolean }
  | { entries: Array<{ path: string; kind: 'file' | 'directory' }> }
  | { content: string; encoding: 'utf8' | 'base64' }
  | { ok: true }

const STATUS_CODES: Record<typeof USER_STAND_ERROR_CODES[number], number> = {
  invalid_user_stand: 400, path_outside_stand: 400, machine_forbidden: 403, stand_command_forbidden: 403,
  machine_unavailable: 409, file_too_large: 413, stand_proxy_unavailable: 503
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

export type UserStandMachines = Pick<MachinesService, 'isOnline' | 'fsList' | 'fsRead' | 'fsWrite'>
interface Deps {
  db: Pick<VoiceChatDb, 'machines'>
  machines: UserStandMachines
  previews: Pick<ProjectPreviews, 'runAt' | 'check'>
  /** StandProxy listener ports; a stand may never target one. */
  reservedPorts: number[]
  /** Make inspector lease for a `us-` stand id; absent when the proxy has no ports. */
  previewAccess?: (user: string, standId: string) => Promise<{ url: string }>
}

export class UserStands {
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
  async target(user: string, standId: string): Promise<{ machineId: string; gatewayPort: number }> {
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
}
