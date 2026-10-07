import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { buildGitWorkspaceId, DEV_COMPONENT_IDS, GIT_TEXT_MAX_BYTES, isSafeRepoRelativePath, searchHref } from '@voicechat/shared'
import { hasProjectPermission } from '@sislexa/identity/server/users/auth'
import type { CreateTransferTaskArgs, StandPreviewOperation, StandPreviewResult } from '@voicechat/make-contracts'
import type { VoiceChatDb } from '../db/database.js'
import { GitError, type GitWorkspaceService } from '../git/workspaceService.js'
import type { MakeRequestAuthority } from './requestAuthority.js'

export type PreviewOperation = StandPreviewOperation | {
  op: 'live_on' | 'live_off'; subprojectPath: string; component: typeof DEV_COMPONENT_IDS[number]; standId: string
}
export function projectModeError(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode })
}
const standSchema = z.object({
  standId: z.string().min(1), machineId: z.string().min(1),
  status: z.enum(['stopped', 'starting', 'running', 'failed']).optional(),
  gateway: z.object({ urls: z.array(z.string().url()) }).optional(), error: z.string().optional()
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
  readDesignFile(userId: string, conversationId: string, path: string): Promise<string>
  boardChanged(projectId: string): void
}

export class MakeProjectAdapters {
  private transfers = new Set<string>()
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
        const environment = environments.find(e => e.machines.includes(machine.agentId))
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
