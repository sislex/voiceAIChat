// Реализация порта `MakeCore` в процессе ядра: те же `db.*`-порты, реестр машин и живая доска,
// что у остальных роутов. Единственное место, где Make и слой данных встречаются напрямую;
// отдельный сервис Make заменит этот файл HTTP-клиентом к `/internal/*` ядра.

import type { VoiceChatDb } from '../db/database.js'
import { buildGitWorkspaceId } from '@voicechat/shared'
import type { CreateTransferTaskArgs, MakeCore, MakeMachineFs, MakeStandOperation, MakeStandResult, MakeTaskDesignArgs, ProjectDesign, ProjectGitOperation, ProjectGitResult, ProjectSubproject, StandPreviewResult } from '@voicechat/make-contracts'
import type { GitWorkspaceService } from '../git/workspaceService.js'
import type { MakeProjectAdapters, PreviewOperation } from './projectAdapters.js'

const MAX_FILES = 2_000
const MAX_FILE_BYTES = 256 * 1024
const MAX_TOTAL_BYTES = 4 * 1024 * 1024
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next'])

type ProjectMachine = { agentId: string; path: string; name?: string; online?: boolean; canUse?: boolean }
type ScannedFile = { path: string; content: string }

function join(root: string, relative: string): string { return relative === '.' ? root : `${root.replace(/\/$/, '')}/${relative}` }
function fail(statusCode: number, message: string): never { throw Object.assign(new Error(message), { statusCode }) }

export interface LocalMakeCoreDeps {
  db: VoiceChatDb
  /** Файловый мост реестра машин; `isOnline` здесь синхронный — порт оборачивает его в Promise. */
  machineFs?: Omit<MakeMachineFs, 'isOnline'> & { isOnline(agentId: string): boolean }
  boardChanged?: (projectId: string) => void
  git?: GitWorkspaceService
  standPreview?: (userId: string, projectId: string, operation: PreviewOperation) => Promise<StandPreviewResult>
  transferTask?: MakeProjectAdapters['createTransferTask']
  makeStand?: (userId: string, conversationId: string, operation: MakeStandOperation) => Promise<MakeStandResult>
}

export class LocalMakeCore implements MakeCore {
  async listProjects(userId: string) {
    return Promise.all((await this.deps.db.projects.listProjects(userId)).map(async project => {
      const detail = await this.deps.db.projects.getProject(userId, project.id)
      const machines = (detail?.machines ?? []).filter(machine => machine.canUse).map(machine => ({
        agentId: machine.agentId, name: machine.name, online: this.deps.machineFs?.isOnline(machine.agentId) ?? false,
        canUse: machine.canUse, path: machine.directories?.projectWorkdir.path || machine.path
      }))
      return { id: project.id, name: project.name, type: project.typeId, gitUrl: project.gitUrl,
        hasGit: Boolean(project.gitUrl), machines, defaultAgentId: detail?.defaultAgentId ?? null, role: project.role }
    }))
  }

  private async projectMachine(userId: string, projectId: string): Promise<ProjectMachine> {
    const project = await this.deps.db.projects.getProject(userId, projectId)
    if (!project) fail(404, 'project_not_found')
    const candidates = project.machines.filter(machine => machine.canUse && (machine.directories?.projectWorkdir.path || machine.path))
    const machine = candidates.find(item => item.agentId === project.defaultAgentId) ?? candidates[0]
    if (!machine) fail(409, 'project_working_copy_unavailable')
    if (!this.deps.machineFs || !await this.machineFs!.isOnline(machine.agentId)) fail(409, 'machine_offline')
    return { agentId: machine.agentId, name: machine.name, canUse: machine.canUse,
      path: machine.directories?.projectWorkdir.path || machine.path }
  }

  private async scan(userId: string, projectId: string, subproject = '.'): Promise<ScannedFile[]> {
    const machine = await this.projectMachine(userId, projectId)
    const fs = this.machineFs!
    const root = join(machine.path, subproject)
    const pending = [{ absolute: root, relative: '.' }]
    const files: ScannedFile[] = []
    let total = 0
    while (pending.length) {
      const current = pending.shift()!
      const result = await fs.list(machine.agentId, current.absolute)
      for (const entry of result.entries ?? []) {
        if (files.length + pending.length >= MAX_FILES) fail(413, 'project_file_limit_exceeded')
        const relative = current.relative === '.' ? entry.name : `${current.relative}/${entry.name}`
        if (entry.kind === 'dir') { if (!SKIP_DIRS.has(entry.name)) pending.push({ absolute: join(root, relative), relative }); continue }
        if (entry.kind !== 'file' || (entry.size ?? 0) > MAX_FILE_BYTES) continue
        if (!/\.(?:json|css|scss|sass|less|ts|tsx|js|jsx)$/i.test(entry.name)) continue
        const read = await fs.read(machine.agentId, join(root, relative))
        const bytes = Buffer.from(read.dataBase64 ?? '', 'base64')
        if (read.truncated || bytes.byteLength > MAX_FILE_BYTES) continue
        total += bytes.byteLength
        if (total > MAX_TOTAL_BYTES) fail(413, 'project_byte_limit_exceeded')
        files.push({ path: relative, content: bytes.toString('utf8') })
      }
    }
    return files
  }

  async projectStructure(userId: string, projectId: string): Promise<ProjectSubproject[]> {
    const files = await this.scan(userId, projectId)
    const packages = files.filter(file => /(^|\/)package\.json$/.test(file.path))
    const result: ProjectSubproject[] = []
    for (const file of packages) {
      const path = file.path === 'package.json' ? '.' : file.path.slice(0, -'/package.json'.length)
      let pkg: { name?: string; scripts?: Record<string, string> } = {}
      try { pkg = JSON.parse(file.content) as typeof pkg } catch { continue }
      const nested = files.filter(item => path === '.' || item.path.startsWith(`${path}/`))
      const stories = nested.filter(item => /\.stories\.[jt]sx?$/.test(item.path)).length
      const kind = path.startsWith('apps/') ? 'app' : path.startsWith('packages/') ? 'library' : stories || pkg.scripts?.storybook ? 'storybook' : 'other'
      result.push({ path, name: pkg.name ?? (path === '.' ? 'root' : path.split('/').at(-1)!), kind, ...(pkg.name ? { packageName: pkg.name } : {}),
        stories, styleFiles: nested.filter(item => /\.(?:css|scss|sass|less)$/i.test(item.path)).map(item => item.path) })
    }
    return result.length ? result : [{ path: '.', name: 'root', kind: 'other', stories: 0, styleFiles: [] }]
  }

  async projectDesign(userId: string, projectId: string, subprojectPath: string): Promise<ProjectDesign> {
    const files = await this.scan(userId, projectId, subprojectPath)
    const tokens: ProjectDesign['tokens'] = []; const themes = new Set<string>(); const components: ProjectDesign['components'] = []
    for (const file of files) {
      if (/\.(?:css|scss|sass|less)$/i.test(file.path)) {
        const blocks = /(:root|\[data-theme\s*=\s*["']?([^\]"']+)["']?\])\s*\{([^}]*)\}/gms
        for (const block of file.content.matchAll(blocks)) {
          const theme = block[2]?.trim(); if (theme) themes.add(theme)
          for (const match of block[3]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
            const offset = (block.index ?? 0) + block[0].indexOf(block[3]!) + (match.index ?? 0)
            tokens.push({ name: match[1]!, value: match[2]!.trim(), file: file.path, line: file.content.slice(0, offset).split('\n').length,
              ...(theme ? { theme } : {}), source: file.path.endsWith('.scss') ? 'scss' : 'css' })
          }
        }
      }
      if (/\.json$/i.test(file.path) && /token|theme/i.test(file.path)) {
        try { const object = JSON.parse(file.content) as Record<string, unknown>; for (const [name, value] of Object.entries(object)) if (['string', 'number'].includes(typeof value)) tokens.push({ name, value: String(value), file: file.path, line: 1, source: 'json' }) } catch { /* invalid JSON is not design inventory */ }
      }
      if (/\.[jt]sx?$/.test(file.path) && /token|theme/i.test(file.path)) for (const match of file.content.matchAll(/(?:export\s+)?const\s+([\w$]+)\s*=\s*(["'`][^\n;]+|#[\da-fA-F]{3,8}|\d+(?:\.\d+)?)/g)) tokens.push({ name: match[1]!, value: match[2]!.replace(/^["'`]|["'`]$/g, ''), file: file.path, line: file.content.slice(0, match.index).split('\n').length, source: 'typescript' })
      if (/\.stories\.[jt]sx?$/.test(file.path)) components.push({ name: file.path.split('/').at(-1)!.replace(/\.stories\.[^.]+$/, ''), kind: 'story', file: file.path })
      else if (/\.[jt]sx?$/.test(file.path)) for (const match of file.content.matchAll(/export\s+(?:default\s+)?(?:function|class|const)\s+([A-Z][\w$]*)/g)) components.push({ name: match[1]!, kind: 'component', file: file.path })
    }
    return { tokens, themes: [...themes].sort(), components }
  }

  async projectGit(userId: string, projectId: string, operation: ProjectGitOperation): Promise<ProjectGitResult> {
    if (!this.deps.git) fail(501, 'project_git_unavailable')
    const machine = await this.projectMachine(userId, projectId)
    const workspace = buildGitWorkspaceId({ kind: 'project-machine', agentId: machine.agentId })
    if (operation.op === 'status') { const value = await this.deps.git.status(userId, projectId, workspace); return { op: 'status', branch: value.branch, ahead: value.ahead, behind: value.behind, files: value.changes.map(item => ({ path: item.path, index: item.staged ? 'M' : ' ', workingTree: item.staged ? ' ' : 'M' })) } }
    if (operation.op === 'branches') { const value = await this.deps.git.branches(userId, projectId, workspace, false); return { op: 'branches', branches: value.branches.map(item => ({ name: item.name, current: item.name === value.current, remote: item.remote })) } }
    if (operation.op === 'pull') { const value = await this.deps.git.pull(userId, projectId, workspace); return { op: 'pull', output: `pulled ${value.pulled}` } }
    if (operation.op === 'commit') { const value = await this.deps.git.commit(userId, projectId, workspace, { message: operation.message, paths: operation.files }); return { op: 'commit', commit: value.sha } }
    if (operation.op === 'push') { const value = await this.deps.git.push(userId, projectId, workspace); return { op: 'push', output: `${value.branch} ${value.sha}` } }
    await this.deps.git.createBranch(userId, projectId, workspace, operation.name); return { op: 'branch', name: operation.name }
  }
  standPreview(userId: string, projectId: string, operation: PreviewOperation) { return this.deps.standPreview ? this.deps.standPreview(userId, projectId, operation) : fail(503, 'stand_preview_unavailable') }
  createTransferTask(userId: string, args: CreateTransferTaskArgs) { return this.deps.transferTask ? this.deps.transferTask(userId, args) : fail(501, 'transfer_task_unavailable') }
  makeStand(userId: string, conversationId: string, operation: MakeStandOperation) { return this.deps.makeStand ? this.deps.makeStand(userId, conversationId, operation) : fail(501, 'make_stand_unavailable') }
  // Project notes are not hosted by Core yet; Make reports the 501 to the assistant.
  projectNotesRead(): Promise<{ content: string }> { return fail(501, 'project_notes_unavailable') }
  projectNotesUpdate(): Promise<{ content: string }> { return fail(501, 'project_notes_unavailable') }

  readonly machineFs: MakeMachineFs | null

  constructor(private readonly deps: LocalMakeCoreDeps) {
    const fs = deps.machineFs
    // Реестр отвечает синхронно, порт — обещанием: так же его читает отдельный процесс Make через RPC.
    this.machineFs = fs ? { list: fs.list, read: fs.read, isOnline: async (agentId) => fs.isOnline(agentId) } : null
  }

  conversation(userId: string, id: string) { return this.deps.db.chat.getConversation(userId, id) }
  conversationOwner(id: string) { return this.deps.db.chat.conversationOwner(id) }
  conversationProject(id: string) { return this.deps.db.chat.makeConversationProject(id) }
  isProjectViewer(userId: string, conversationId: string) { return this.deps.db.chat.isMakeProjectViewer(userId, conversationId) }
  async makeConversationIdsOf(owner: string): Promise<string[]> {
    // Make-разговоры живут в scope `make`: без явного scope список по умолчанию отдаёт только `chat`,
    // и квота на пользователя считалась по пустому списку (так было в server.ts до выделения порта).
    return (await this.deps.db.chat.listConversations(owner, { scope: 'make', includeCompleted: true })).filter((c) => c.assistantKind === 'make').map((c) => c.id)
  }
  taskLinks(conversationId: string, path?: string) { return this.deps.db.tasks.makeTaskLinks(conversationId, path) }
  linkableTasks(userId: string, conversationId: string) { return this.deps.db.tasks.makeLinkableTasks(userId, conversationId) }
  async linkTaskDesign(userId: string, projectId: string, taskId: string, args: MakeTaskDesignArgs): Promise<void> {
    await this.deps.db.tasks.linkTaskDesign(userId, projectId, taskId, args)
  }
  async unlinkTaskDesign(userId: string, projectId: string, taskId: string, linkId: string): Promise<void> {
    await this.deps.db.tasks.unlinkTaskDesign(userId, projectId, taskId, linkId)
  }
  async taskDesigns(userId: string, projectId: string, taskId: string) {
    const task = await this.deps.db.tasks.getCiTask(userId, projectId, taskId)
    return task ? task.designs ?? [] : null
  }
  project(userId: string, id: string) { return this.deps.db.projects.getProject(userId, id) }
  async userExists(name: string): Promise<boolean> { return Boolean(await this.deps.db.identity.getUser(name)) }
  boardChanged(projectId: string): void { this.deps.boardChanged?.(projectId) }
}
