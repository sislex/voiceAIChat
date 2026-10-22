import path from 'node:path'
import { z } from 'zod'
import { buildGitWorkspaceId, type StandSyncStatus, type StandSyncResult } from '@voicechat/shared'
import { hasProjectPermission } from '@sislexa/identity/server/users/auth'
import type { VoiceChatDb } from '../db/database.js'
import type { GitWorkspaceService } from '../git/workspaceService.js'
import { projectModeError, repositoryId, type MakeProjectAdapters } from './projectAdapters.js'
import type { StandMachines } from './standWorkspace.js'
import { standDeliveryCommand } from './standDeliveryAgent.js'
import { StandDeliveryCoordinator } from './standDeliveryCoordinator.js'

export const standDeliveryBody = z.object({
  branch: z.string().min(1).max(240).refine(value => !value.startsWith('-') && !/[\s\x00-\x1f~^:?*\[\\]/.test(value) && !value.includes('..') && !value.includes('@{')),
  title: z.string().trim().min(1).max(1000)
}).strict()

interface Deps {
  db: VoiceChatDb
  git: GitWorkspaceService
  stands: Pick<MakeProjectAdapters, 'getStand'>
  machines: Pick<StandMachines, 'exec' | 'isOnline'>
  coordinator: StandDeliveryCoordinator
}

export class StandDeliveries {
  private busy = new Set<string>()
  constructor(private readonly deps: Deps) {}

  private async workspace(userId: string, projectId: string, standId: string, write: boolean) {
    const project = await this.deps.db.projects.getProject(userId, projectId)
    if (!project) projectModeError(404, 'project_not_found')
    const user = await this.deps.db.identity.getUser(userId)
    if (!user || user.blocked || (write && !hasProjectPermission(user.role, 'repository:write'))) projectModeError(403, 'project_write_forbidden')
    const stand = await this.deps.stands.getStand(userId, projectId, standId)
    if (stand.standId !== standId) projectModeError(502, 'invalid_stand_response')
    const machine = project.machines.find(machine => machine.agentId === stand.machineId && machine.canUse)
    if (!machine) projectModeError(403, 'stand_machine_forbidden')
    const matching = stand.live?.filter(live => repositoryId(stand.components?.[live.component]?.repository) === repositoryId(project.gitUrl)) ?? []
    const lives = matching.length ? matching : stand.live ?? []
    if (lives.length !== 1) projectModeError(409, 'stand_working_copy_ambiguous')
    const live = lives[0]!
    const repository = repositoryId(stand.components?.[live.component]?.repository)
    if (!repository || !live.branch) projectModeError(409, 'stand_repository_unavailable')
    const roots = [machine.reposRoot, machine.directories?.projectWorkdir.path, machine.path].filter((root): root is string => !!root && path.posix.isAbsolute(root) && root !== '/')
    const root = path.posix.resolve(live.workingCopyPath)
    const allowedRoot = roots.find(allowed => root === path.posix.resolve(allowed) || root.startsWith(path.posix.resolve(allowed) + '/'))
    if (!path.posix.isAbsolute(live.workingCopyPath) || !allowedRoot) projectModeError(403, 'stand_path_forbidden')
    if (write) {
      const workspace = buildGitWorkspaceId({ kind: 'project-machine', agentId: machine.agentId })
      await this.deps.git.atWorkingCopy(userId, projectId, workspace, root).resolve(userId, projectId, workspace, { write: true })
      if (!this.deps.machines.isOnline(machine.agentId)) projectModeError(409, 'machine_unavailable')
    }
    return { agentId: machine.agentId, root, allowedRoot, repository, branch: live.branch }
  }

  async list(user: string, project: string, stand: string) {
    const workspace = await this.workspace(user, project, stand, false)
    return this.deps.coordinator.list(project, workspace.repository, workspace.branch)
  }

  private async locked<T>(user: string, project: string, stand: string, work: (workspace: Awaited<ReturnType<StandDeliveries['workspace']>>) => Promise<T>, write = true) {
    const workspace = await this.workspace(user, project, stand, write)
    if (!this.deps.machines.isOnline(workspace.agentId)) projectModeError(409, 'machine_unavailable')
    const key = workspace.agentId + ':' + workspace.root
    if (this.busy.has(key)) projectModeError(409, 'stand_workspace_busy')
    this.busy.add(key)
    try { return await work(workspace) } finally { this.busy.delete(key) }
  }

  async submit(user: string, project: string, stand: string, body: unknown) {
    const parsed = standDeliveryBody.safeParse(body)
    if (!parsed.success) projectModeError(400, 'invalid_stand_delivery')
    return this.locked(user, project, stand, async workspace => {
      if (parsed.data.branch !== workspace.branch) projectModeError(409, 'stand_branch_mismatch')
      const result = await standDeliveryCommand(this.deps.machines, user, workspace, { action: 'head', branch: parsed.data.branch })
      if (!('headSha' in result)) projectModeError(502, 'invalid_stand_agent_response')
      return this.deps.coordinator.submit(project, {
        repository: workspace.repository, ...parsed.data, targetBranch: 'dev', headSha: result.headSha, author: user
      })
    })
  }

  async behind(user: string, project: string, stand: string): Promise<StandSyncStatus> {
    return this.locked(user, project, stand, async workspace => {
      const result = await standDeliveryCommand(this.deps.machines, user, workspace, { action: 'behind' })
      if (!('behind' in result)) projectModeError(502, 'invalid_stand_agent_response')
      return { behind: result.behind }
    }, false)
  }

  async sync(user: string, project: string, stand: string): Promise<StandSyncResult> {
    return this.locked(user, project, stand, async workspace => {
      const result = await standDeliveryCommand(this.deps.machines, user, workspace, { action: 'sync' })
      if (!('merged' in result)) projectModeError(502, 'invalid_stand_agent_response')
      return result
    })
  }
}
