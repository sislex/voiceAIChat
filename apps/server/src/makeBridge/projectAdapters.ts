import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { buildGitWorkspaceId, DEV_COMPONENT_IDS, DEV_COMPONENT_REGISTRY, GIT_TEXT_MAX_BYTES, isSafeRepoRelativePath, searchHref, type EnvironmentDefinition } from '@voicechat/shared'
import { hasProjectPermission } from '@sislexa/identity/server/users/auth'
import { makeStandOperationSchema, MAKE_STAND_ERROR_CODES, MAKE_STAND_MAX_FILE_BYTES, type MakeStandOperation, type MakeStandResult, type CreateTransferTaskArgs, type StandPreviewOperation, type StandPreviewResult } from '@voicechat/make-contracts'
import { componentClone, conversationWorktree, workspaceCommand, type StandMachines } from './standWorkspace.js'
import { runProjectGit } from './localCore.js'
import type { VoiceChatDb } from '../db/database.js'
import { GitError, type GitWorkspaceService } from '../git/workspaceService.js'
import type { MakeRequestAuthority } from './requestAuthority.js'

export type PreviewOperation = StandPreviewOperation | {
  op: 'live_on' | 'live_off'; subprojectPath: string; component: typeof DEV_COMPONENT_IDS[number]; standId: string
}
export function projectModeError(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode })
}
const STAND_STATUS: Record<string, 'stopped' | 'starting' | 'running' | 'failed' | undefined> = {
  stopped: 'stopped', starting: 'starting', recovering: 'starting', running: 'running', ready: 'running', degraded: 'running', failed: 'failed'
}
const standSchema = z.object({
  standId: z.string().min(1), machineId: z.string().min(1),
  // Kanban details report ready/recovering/degraded; Make speaks the stand preview statuses.
  status: z.string().transform(value => STAND_STATUS[value]).optional(),
  gateway: z.object({ urls: z.array(z.string().url()) }).optional(), error: z.string().optional(),
  components: z.record(z.string(), z.object({ repository: z.string(), sha: z.string(), source: z.enum(['base', 'dev', 'live']) })).optional(),
  live: z.array(z.object({ component: z.string(), workingCopyPath: z.string(), branch: z.string().nullable().optional(), head: z.string().nullable().optional(), status: z.string().optional(), state: z.string().optional(), error: z.string().optional() })).optional(),
  operation: z.object({ status: z.string(), phase: z.string().optional(), error: z.string().nullable().optional() }).nullable().optional()
})
type Stand = z.infer<typeof standSchema>
function standDetail(value: unknown): Stand {
  const result = standSchema.safeParse(value)
  if (!result.success) projectModeError(502, 'invalid_stand_response')
  return result.data
}
function repositoryWebUrl(repository: string): string {
  const normalized = repository.replace(/^git@([^:]+):/, 'https://$1/')
  const url = new URL(normalized.includes('://') ? normalized : 'https://github.com/' + normalized)
  url.username = ''; url.password = ''; url.search = ''; url.hash = ''
  url.pathname = url.pathname.replace(/(?:\.git)?\/$|\.git$/, '')
  if (url.protocol === 'ssh:') return 'https://' + url.hostname + url.pathname
  return url.toString().replace(/\/$/, '')
}
interface Deps {
  db: VoiceChatDb
  git: GitWorkspaceService
  kanbanUrl?: string
  authority: MakeRequestAuthority
  fetchImpl?: typeof fetch
  machines?: StandMachines
  previewAccess?: (user: string, project: string, stand: string) => Promise<{ url: string }>
  readDesignFile(userId: string, conversationId: string, path: string): Promise<string>
  boardChanged(projectId: string): void
}

export function readyStandEnvironment(environments: EnvironmentDefinition[], machine: string) {
  return environments.find(e => e.mode === 'managed' && e.state === 'ready' && e.machines[0] === machine)
}

function repositoryId(repository: string | null | undefined): string | null {
  if (!repository) return null
  try {
    const url = new URL(repositoryWebUrl(repository))
    return url.hostname.toLowerCase() === 'github.com' ? url.pathname.slice(1).toLowerCase() : null
  } catch { return null }
}

function makeStandErrorCode(code: string, status?: number): string {
  return (MAKE_STAND_ERROR_CODES as readonly string[]).includes(code) ? code
    : /machine|offline|stand_preview_unavailable/.test(code) ? 'machine_unavailable'
    : /base_environment/.test(code) ? 'base_environment_missing'
    : /ref_not_found|unknown_branch/.test(code) ? 'branch_not_found'
    : /unknown_component|repository_not_found/.test(code) ? 'component_not_in_stand'
    : status === 404 ? 'stand_not_found' : 'operation_conflict'
}

export class MakeProjectAdapters {
  private transfers = new Set<string>()
  private standMutations = new Set<string>()
  private standProgress = new Map<string, MakeStandResult>()
  constructor(private readonly deps: Deps) {}

  private async project(userId: string, projectId: string, write: boolean) {
    const project = await this.deps.db.projects.getProject(userId, projectId)
    if (!project) projectModeError(404, 'project_not_found')
    const user = await this.deps.db.identity.getUser(userId)
    if (!user || user.blocked || (write && !hasProjectPermission(user.role, 'repository:write')))
      projectModeError(403, 'project_write_forbidden')
    return project
  }

  private async request<T>(user: string, path: string, method = 'GET', body?: unknown, accepted?: () => void): Promise<T> {
    if (!this.deps.kanbanUrl) projectModeError(503, 'stand_preview_unavailable')
    return this.deps.authority.run(user, method, path, async authorization => {
      let response: Response
      try {
        response = await (this.deps.fetchImpl ?? fetch)(this.deps.kanbanUrl!.replace(/\/$/, '') + path, {
          method, headers: { authorization, 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: 'error', signal: AbortSignal.timeout(25_000)
        })
      } catch { projectModeError(503, 'stand_preview_unavailable') }
      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { error?: string }
        const unavailable = [502, 503, 504].includes(response.status)
        projectModeError(unavailable ? 503 : response.status, unavailable ? 'stand_preview_unavailable' : error.error ?? 'stand_preview_failed')
      }
      if (response.status === 202) accepted?.()
      if (response.status === 204) return undefined as T
      try { return await response.json() as T } catch { projectModeError(502, 'invalid_stand_response') }
    })
  }

  async standPreview(user: string, projectId: string, op: PreviewOperation): Promise<StandPreviewResult> {
    const project = await this.project(user, projectId, !['status', 'url'].includes(op.op))
    const base = '/api/projects/' + encodeURIComponent(projectId) + '/dev-stands'
    const machines = project.machines.filter(m => m.canUse && (m.directories?.projectWorkdir.path || m.path))
    const agentId = op.op === 'start' ? op.agentId : undefined
    const machine = machines.find(m => m.agentId === (agentId ?? project.defaultAgentId)) ?? (!agentId ? machines[0] : undefined)
    if (!machine) projectModeError(409, 'project_working_copy_unavailable')
    let stand: Stand | undefined
    let pending = false
    if (op.op === 'live_on' || op.op === 'live_off') {
      stand = standDetail(await this.request(user, base + '/' + encodeURIComponent(op.standId)))
      if (stand.standId !== op.standId) projectModeError(502, 'invalid_stand_response')
      const standMachine = machines.find(m => m.agentId === stand!.machineId)
      if (!standMachine) projectModeError(403, 'stand_machine_forbidden')
      if (!(DEV_COMPONENT_IDS as readonly string[]).includes(op.component)) projectModeError(400, 'invalid_component')
      const path = base + '/' + encodeURIComponent(stand.standId) + '/components/' + op.component + '/live'
      await this.request(user, path, op.op === 'live_on' ? 'POST' : 'DELETE',
        op.op === 'live_on' ? { workingCopyPath: standMachine.directories?.projectWorkdir.path || standMachine.path } : undefined,
        () => { pending = true })
    } else {
      const stands = await this.request<unknown>(user, base)
      if (!Array.isArray(stands)) projectModeError(502, 'invalid_stand_response')
      stand = stands.map(standDetail).find(s => s.machineId === machine.agentId)
      if (!stand && op.op === 'start') {
        const environments = await this.deps.db.environments.listEnvironments(user, projectId)
        const environment = readyStandEnvironment(environments, machine.agentId)
        if (!environment) projectModeError(409, 'base_environment_unavailable')
        // Async creation may return only the allocated stand id and an operation id.
        const created = await this.request<{ standId?: string }>(user, base, 'POST', { machineId: machine.agentId, baseEnvironmentId: environment.id }, () => { pending = true })
        if (!created || typeof created.standId !== 'string' || !created.standId) projectModeError(502, 'invalid_stand_response')
        stand = { standId: created.standId, machineId: machine.agentId }
      }
    }
    if (!stand) return { standId: null, status: 'stopped', url: null }
    const detail = standDetail(await this.request(user, base + '/' + encodeURIComponent(stand.standId)))
    if (detail.standId !== stand.standId || detail.machineId !== stand.machineId) projectModeError(502, 'invalid_stand_response')
    const url = detail.gateway?.urls.find(url => /^https?:\/\//.test(url)) ?? null
    return { standId: stand.standId, status: detail.error ? 'failed' : pending ? 'starting' : detail.status ?? (url ? 'running' : 'starting'), url, ...(detail.error ? { error: detail.error } : {}) }
  }

  private async standHosts(user: string, projectId: string, component: string | null) {
    const projects = await this.deps.db.projects.listProjects(user)
    const hosts = []
    for (const item of projects) {
      const project = await this.project(user, item.id, false)
      const raw = await this.request<unknown>(user, '/api/projects/' + encodeURIComponent(item.id) + '/dev-stands')
      if (!Array.isArray(raw)) projectModeError(502, 'invalid_stand_response')
      const stands = raw.map(standDetail).filter(s => item.id === projectId || (component && s.components?.[component]))
      if (item.id === projectId || stands.length) hosts.push({ project, stands })
    }
    return hosts.sort((a, b) => Number(b.project.id === projectId) - Number(a.project.id === projectId) || a.project.id.localeCompare(b.project.id))
  }

  async makeStand(user: string, conversationId: string, operation: MakeStandOperation): Promise<MakeStandResult> {
    // Owner access is deliberately stricter than the project-viewer path in Make.
    if (await this.deps.db.chat.conversationOwner(conversationId) !== user) projectModeError(403, 'conversation_access_denied')
    const conversation = await this.deps.db.chat.getConversation(user, conversationId)
    if (!conversation || conversation.assistantKind !== 'make') projectModeError(403, 'conversation_access_denied')
    if (operation.op === 'files' && operation.action === 'write' && typeof operation.content === 'string' && Buffer.byteLength(operation.content) > MAKE_STAND_MAX_FILE_BYTES)
      projectModeError(413, 'file_too_large')
    const parsed = makeStandOperationSchema.safeParse(operation)
    if (!parsed.success) projectModeError(400, operation.op === 'files' ? 'path_outside_working_copy' : 'invalid_make_stand_operation')
    const op = parsed.data
    const projectId = await this.deps.db.chat.makeConversationProject(conversationId)
    if (!projectId) projectModeError(404, 'project_not_found')
    const write = !['options', 'status'].includes(op.op) && !(op.op === 'files' && ['list', 'read'].includes(op.action)) && !(op.op === 'git' && ['status', 'branches'].includes(op.operation.op))
    const project = await this.project(user, projectId, write)
    const repository = repositoryId(project.gitUrl)
    const component = DEV_COMPONENT_IDS.find(id => DEV_COMPONENT_REGISTRY[id].repository.toLowerCase() === repository) ?? null
    const state: MakeStandResult = { standId: null, hostProjectId: null, machineId: null, component, branch: null, workingCopyPath: null, phase: 'idle', previewUrl: null, directUrls: [] }
    const machines = this.deps.machines
    let lock: string | undefined
    try {
      if (write) {
        lock = user + ':' + conversationId
        if (this.standMutations.has(lock)) { lock = undefined; throw new Error('operation_conflict') }
        this.standMutations.add(lock)
      }
      if (op.op === 'options' || op.op === 'create') {
        const hosts = await this.standHosts(user, projectId, component)
        const candidates: Array<typeof hosts[number] & { environments: EnvironmentDefinition[] }> = []
        for (const host of hosts) {
          const environments = await this.deps.db.environments.listEnvironments(user, host.project.id)
          candidates.push({ ...host, environments })
        }
        const hostFor = (agent: string) => candidates.find(h => readyStandEnvironment(h.environments, agent))
        if (op.op === 'options') {
          state.options = { component, repository, stands: [], machines: project.machines.filter(m => m.canUse).map(m => {
            const online = machines?.isOnline(m.agentId) ?? false
            const ready = Boolean(component && hostFor(m.agentId))
            return { agentId: m.agentId, name: machines?.nameOf(m.agentId) ?? m.name ?? m.agentId, online, canCreate: ready && online,
              ...(!ready ? { reason: 'base_environment_missing' } : !online ? { reason: 'machine_unavailable' } : {}) }
          }) }
          // Kanban waits on an offline machine for its stand details; list entries are enough there.
          const details = await Promise.all(hosts.flatMap(host => host.stands.map(async summary => ({ host, stand:
            machines?.isOnline(summary.machineId)
              ? standDetail(await this.request(user, '/api/projects/' + encodeURIComponent(host.project.id) + '/dev-stands/' + encodeURIComponent(summary.standId)))
              : summary }))))
          for (const { host, stand } of details) {
            const live = stand.live?.find(l => l.component === component)
            const source = component ? stand.components?.[component] : undefined
            state.options.stands.push({ standId: stand.standId, hostProjectId: host.project.id, hostProjectName: host.project.name,
              machineId: stand.machineId, machineName: machines?.nameOf(stand.machineId) ?? host.project.machines.find(m => m.agentId === stand.machineId)?.name ?? stand.machineId,
              online: machines?.isOnline(stand.machineId) ?? false, status: !(machines?.isOnline(stand.machineId) ?? false) ? 'stopped' : stand.status ?? (stand.error ? 'failed' : 'running'),
              componentSource: live ? 'live' : source?.source ?? 'base', branch: live?.branch ?? null, sha: live?.head ?? source?.sha ?? null })
          }
          return state
        }
        if (!component) throw new Error('component_not_in_stand')
        if (!machines?.isOnline(op.agentId) || !project.machines.some(m => m.canUse && m.agentId === op.agentId)) throw new Error('machine_unavailable')
        const host = hostFor(op.agentId)
        if (!host) throw new Error('base_environment_missing')
        await this.project(user, host.project.id, true)
        const environment = readyStandEnvironment(host.environments, op.agentId)!
        const created = await this.request<{ standId: string; operationId: string }>(user, '/api/projects/' + encodeURIComponent(host.project.id) + '/dev-stands', 'POST', { machineId: op.agentId, baseEnvironmentId: environment.id })
        if (!created?.standId || !created.operationId) throw new Error('operation_conflict')
        return { ...state, standId: created.standId, hostProjectId: host.project.id, machineId: op.agentId, operationId: created.operationId, phase: 'creating' }
      }
      if (!component) throw new Error('component_not_in_stand')
      let hostProjectId: string, stand: Stand
      if (op.op === 'files' || op.op === 'git') {
        const matches: Array<{ hostProjectId: string; stand: Stand }> = []
        for (const host of await this.standHosts(user, projectId, component)) for (const summary of host.stands) {
          const machine = project.machines.find(m => m.canUse && m.agentId === summary.machineId)
          const reposRoot = host.project.machines.find(m => m.agentId === summary.machineId)?.reposRoot
          if (!machine || !reposRoot || !machines?.isOnline(summary.machineId)) continue
          const root = conversationWorktree(reposRoot, conversationId)
          const detail = standDetail(await this.request(user, '/api/projects/' + encodeURIComponent(host.project.id) + '/dev-stands/' + encodeURIComponent(summary.standId)))
          if (detail.live?.some(l => l.component === component && l.workingCopyPath === root)) matches.push({ hostProjectId: host.project.id, stand: detail })
        }
        if (!matches.length) throw new Error('stand_not_found')
        if (matches.length > 1) throw new Error('operation_conflict')
        ;({ hostProjectId, stand } = matches[0]!)
      } else {
        hostProjectId = op.hostProjectId
        await this.project(user, hostProjectId, write)
        stand = standDetail(await this.request(user, '/api/projects/' + encodeURIComponent(hostProjectId) + '/dev-stands/' + encodeURIComponent(op.standId)))
        if (stand.standId !== op.standId) throw new Error('stand_not_found')
      }
      const hostProject = await this.project(user, hostProjectId, write)
      Object.assign(state, { standId: stand.standId, hostProjectId, machineId: stand.machineId })
      if (op.op === 'status' && !stand.components && (stand.status === 'starting' || stand.operation?.phase === 'creating'))
        return { ...state, phase: 'creating' }
      if (!stand.components?.[component] || repositoryId(stand.components[component].repository) !== repository) throw new Error('component_not_in_stand')
      const machine = project.machines.find(m => m.canUse && m.agentId === stand.machineId)
      if (!machine || !machines) throw new Error('machine_unavailable')
      const reposRoot = hostProject.machines.find(m => m.agentId === stand.machineId)?.reposRoot
      if (!reposRoot) throw new Error('machine_unavailable')
      const clone = componentClone(stand.components[component].repository)
      const location = { reposRoot, repoName: clone.name, repositoryUrl: clone.url }
      const root = conversationWorktree(reposRoot, conversationId)
      const live = stand.live?.find(l => l.component === component && l.workingCopyPath === root)
      Object.assign(state, { workingCopyPath: root, branch: live?.branch ?? null,
        directUrls: stand.gateway?.urls.filter(url => /^https?:\/\//.test(url)) ?? [],
        phase: stand.error || live?.error || stand.operation?.status === 'failed' ? 'failed' : live ? 'ready' : 'idle' })
      if (state.phase === 'failed') state.error = makeStandErrorCode(stand.error ?? live?.error ?? stand.operation?.error ?? 'operation_conflict')
      const phase = stand.operation?.phase ?? live?.status ?? live?.state
      if (phase && ['creating', 'preparing', 'installing', 'switching'].includes(phase)) state.phase = phase as MakeStandResult['phase']
      if (phase === 'starting') state.phase = 'switching'
      if (phase === 'failed') { state.phase = 'failed'; state.error ??= 'operation_conflict' }
      const progress = this.standProgress.get(user + ':' + conversationId)
      if (op.op === 'status' && progress?.standId === stand.standId && progress.hostProjectId === hostProjectId) Object.assign(state, progress)
      if (op.op !== 'status' && !machines.isOnline(machine.agentId)) throw new Error('machine_unavailable')
      const workspace = buildGitWorkspaceId({ kind: 'project-machine', agentId: machine.agentId })
      if (op.op !== 'status') await this.deps.git.resolve(user, projectId, workspace, { write })
      const livePath = '/api/projects/' + encodeURIComponent(hostProjectId) + '/dev-stands/' + encodeURIComponent(stand.standId) + '/components/' + component + '/live'
      if (op.op === 'attach') {
        state.phase = 'preparing'
        this.standProgress.set(lock!, state)
        const slug = (conversation.title ?? 'conversation').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'conversation'
        const prepared = await workspaceCommand(machines, user, machine.agentId, { action: 'prepare', ...location, conversation: conversationId,
          branch: op.branch, newBranch: op.newBranch, baseBranch: op.baseBranch ?? (project.ciBaseBranch || 'main'), defaultBranch: 'make/' + slug + '-' + conversationId.slice(0, 8) })
        if (prepared.root !== root) throw new Error('path_outside_working_copy')
        state.branch = prepared.branch
        state.phase = 'switching'
        await this.request(user, livePath, 'POST', { workingCopyPath: root }, () => { state.phase = 'installing' })
      } else if (op.op === 'detach') {
        // Never turn off a different conversation's live working copy.
        if (stand.live?.some(l => l.component === component && l.workingCopyPath !== root)) throw new Error('operation_conflict')
        await this.request(user, livePath, 'DELETE', undefined, () => { state.phase = 'switching' })
        if (state.phase !== 'switching') state.phase = 'idle'
        return state
      } else if (op.op === 'files' || op.op === 'git') {
        const check = async (relative: string, allowMissing = false) => {
          if (relative !== '.' && (!isSafeRepoRelativePath(relative) || relative.split('/').some(p => p.toLowerCase() === '.git'))) throw new Error('path_outside_working_copy')
          const checked = await workspaceCommand(machines, user, machine.agentId, { action: 'check', ...location, conversation: conversationId, relative, allowMissing })
          if (checked.root !== root) throw new Error('path_outside_working_copy')
          return checked
        }
        if (op.op === 'git') {
          await check('.')
          if (op.operation.op === 'commit') for (const file of op.operation.files) await check(file, true)
          state.git = await runProjectGit(this.deps.git.atWorkingCopy(user, projectId, workspace, root), user, projectId, workspace, op.operation)
        } else if (op.action === 'list') {
          const target = await check(op.dir)
          const entries = (await machines.fsList(machine.agentId, target.target)).entries ?? []
          state.files = { action: 'list', entries: [] }
          for (const entry of entries) {
            if (!['file', 'dir'].includes(entry.kind) || entry.name === '.git' || /[/\\]/.test(entry.name)) continue
            const relative = op.dir === '.' ? entry.name : op.dir + '/' + entry.name
            try { await check(relative) } catch (error) {
              if (error instanceof Error && ['path_outside_working_copy', 'file_too_large'].includes(error.message)) continue
              throw error
            }
            state.files.entries.push({ path: relative, kind: entry.kind === 'dir' ? 'directory' : 'file' })
          }
        } else if (op.action === 'rename') {
          const from = await check(op.from), to = await check(op.to, true)
          if (from.directory || to.directory || op.from === '.' || op.to === '.') throw new Error('path_outside_working_copy')
          await machines.fsRename(machine.agentId, from.target, to.target)
          state.files = { action: 'rename' }
        } else {
          const target = await check(op.path, op.action === 'write')
          if (target.directory || op.path === '.') throw new Error('path_outside_working_copy')
          if (op.action === 'read') {
            const file = await machines.fsRead(machine.agentId, target.target)
            const content = Buffer.from(file.dataBase64 ?? '', 'base64')
            if (file.truncated || content.length > MAKE_STAND_MAX_FILE_BYTES) projectModeError(413, 'file_too_large')
            state.files = { action: 'read', content: content.toString('utf8') }
          } else if (op.action === 'write') {
            if (Buffer.byteLength(op.content) > MAKE_STAND_MAX_FILE_BYTES) projectModeError(413, 'file_too_large')
            await machines.fsWrite(machine.agentId, target.target, Buffer.from(op.content).toString('base64'))
            state.files = { action: 'write' }
          } else {
            await machines.fsDeleteFileSafe(machine.agentId, target.target)
            state.files = { action: 'delete' }
          }
        }
      }
      if (this.deps.previewAccess && state.directUrls.length) state.previewUrl = (await this.deps.previewAccess(user, hostProjectId, stand.standId)).url
      return state
    } catch (error) {
      if (error instanceof GitError && error.status === 403) projectModeError(403, error.code)
      const code = error instanceof GitError ? error.code : error instanceof Error ? error.message : ''
      const status = (error as { statusCode?: number }).statusCode
      if (status === 401 || status === 403) throw error
      if (code === 'file_too_large') projectModeError(413, code)
      return { ...state, phase: 'failed', error: makeStandErrorCode(code, status) }
    } finally { if (lock) { this.standMutations.delete(lock); this.standProgress.delete(lock) } }
  }

  async createTransferTask(user: string, args: CreateTransferTaskArgs) {
    const projectId = args.targetProjectId
    const project = await this.project(user, projectId, true)
    // The project owns the selected repository; callers cannot supply a sibling path.
    const repo = args.targetRepository === 'core-ui' ? 'sislexa-core-ui' : args.targetRepository === 'ui-kit' ? 'sielexa-ui' : ''
    if (!repo || !project.gitUrl || !new RegExp('(?:^|[:/])sislex/' + repo + '(?:\\.git)?/?$').test(project.gitUrl))
      projectModeError(409, 'target_repository_mismatch')
    const conversation = await this.deps.db.chat.getConversation(user, args.designConversationId)
    if (!conversation || conversation.assistantKind !== 'make' || await this.deps.db.chat.conversationOwner(args.designConversationId) !== user)
      projectModeError(403, 'design_access_forbidden')
    const files = [...new Set(args.files)]
    if (!args.title.trim() || args.title.length > 1000 || !files.length || files.length > 200 || files.some(path => !isSafeRepoRelativePath(path) || path.split('/').some(part => part.toLowerCase() === '.git')))
      projectModeError(400, 'invalid_transfer')
    const machine = project.machines.find(m => m.canUse && m.agentId === project.defaultAgentId)
      ?? project.machines.find(m => m.canUse)
    if (!machine) projectModeError(409, 'project_working_copy_unavailable')
    const workspace = buildGitWorkspaceId({ kind: 'project-machine', agentId: machine.agentId })
    const git = this.deps.git
    let lock: string | undefined
    try {
      const ref = await git.resolve(user, projectId, workspace, { write: true })
      const key = ref.agentId + ':' + ref.path
      if (this.transfers.has(key)) projectModeError(409, 'transfer_workspace_busy')
      this.transfers.add(key)
      lock = key
      const status = await git.status(user, projectId, workspace)
      if (status.problem || status.changes.length || !status.branch) projectModeError(409, 'transfer_workspace_not_clean')
      const contents: Array<{ path: string; content: string }> = []
      let total = 0
      for (const path of files) {
        const content = await this.deps.readDesignFile(user, args.designConversationId, path)
        if (Buffer.byteLength(content) > GIT_TEXT_MAX_BYTES) projectModeError(413, 'transfer_file_too_large')
        total += Buffer.byteLength(content)
        if (total > 4 * 1024 * 1024) projectModeError(413, 'transfer_too_large')
        contents.push({ path, content })
      }
      const board = await this.deps.db.tasks.getBoard(user, projectId)
      const column = board?.columns.find(c => c.semanticType === 'awaiting_merge')
      const backlog = board?.columns.find(c => c.semanticType === 'backlog')
      if (!column || !backlog) projectModeError(409, 'column_missing')
      const task = await this.deps.db.tasks.createTask(user, projectId, { title: args.title.trim(), columnId: backlog.id, source: 'make-components' })
      if (!task) projectModeError(409, 'task_not_created')
      await this.deps.db.tasks.linkTaskDesign(user, projectId, task.id, {
        conversationId: args.designConversationId, mode: 'files', paths: files
      }, { transfer: true })
      const slug = args.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'design'
      const branch = 'make/' + slug + '-' + randomUUID().slice(0, 8)
      let pushed = false
      try {
        await git.createBranch(user, projectId, workspace, branch, project.ciBaseBranch || 'main')
        for (const file of contents) await git.saveFile(user, projectId, workspace, file.path, file.content)
        const commit = await git.commit(user, projectId, workspace, { message: args.title.trim(), paths: files })
        const push = await git.push(user, projectId, workspace, branch)
        pushed = true
        const ci = await this.deps.db.ci.createCiWorkspace({ projectId, taskId: task.id, agentId: ref.agentId, path: ref.path })
        await this.deps.db.ci.updateCiWorkspaceRevision(ci.id, branch, push.sha || commit.sha, true)
        if (!await this.deps.db.tasks.moveTask(user, projectId, task.id, { columnId: column.id }))
          projectModeError(409, 'transfer_task_move_failed')
        const repositoryUrl = repositoryWebUrl(project.gitUrl)
        return { taskId: task.id, projectId, branch, taskUrl: searchHref({ source: 'tasks', projectId, taskId: task.id }),
          branchUrl: repositoryUrl + '/tree/' + branch, designUrl: '#/make/' + encodeURIComponent(args.designConversationId) }
      } finally {
        // Preserve failed writes for recovery; never discard a user's working tree.
        if (pushed) await git.checkout(user, projectId, workspace, status.branch, false)
        this.deps.boardChanged(projectId)
      }
    } catch (error) {
      if (error instanceof GitError) projectModeError(error.status, error.code)
      throw error
    } finally {
      if (lock) this.transfers.delete(lock)
    }
  }
}
