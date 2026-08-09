import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PreviewConfig, PreviewEnvironment, PreviewErrorType, PreviewOperation, PreviewRun } from '@voicechat/shared'
import { isPreviewBusy, safePreviewResourceName } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { CommandExecutor } from '../ci/types.js'

export const DEFAULT_PREVIEW_CONFIG: PreviewConfig = {
  composeFile: 'compose.preview.yml',
  appService: 'app',
  appInternalPort: 3000,
  healthPath: '/api/health',
  storybook: 'optional',
  storybookService: 'storybook',
  storybookInternalPort: 6006,
  seedScenarios: [],
  buildTimeoutMs: 20 * 60_000,
  startTimeoutMs: 3 * 60_000,
  healthTimeoutMs: 60_000,
  healthIntervalMs: 2_000,
  healthAttempts: 30,
  portRange: { from: 18000, to: 19999 }
}

interface Stored { environments: PreviewEnvironment[]; idempotency: Record<string, string> }
interface Deps {
  db: VoiceChatDb
  executor: CommandExecutor
  storePath: string
  isOnline: (agentId: string) => boolean
  now?: () => number
  newId?: () => string
}
const trimLog = (value: string): string => value.length > 500_000 ? value.slice(-500_000) : value
const classify = (operation: PreviewOperation, message: string): PreviewErrorType => {
  if (/offline|не в сети/i.test(message)) return 'machine_unavailable'
  if (/port/i.test(message)) return 'port_allocation'
  if (/health/i.test(message)) return 'health_check'
  if (operation === 'seed' || operation === 'reset') return 'seed'
  if (operation === 'remove') return 'cleanup'
  return operation === 'start' || operation === 'rebuild' ? 'build' : 'docker'
}

export class FeaturePreviewManager {
  private data: Stored
  private active = new Map<string, AbortController>()
  private now: () => number
  private newId: () => string
  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? Date.now
    this.newId = deps.newId ?? randomUUID
    this.data = this.load()
  }
  private load(): Stored {
    try { return JSON.parse(readFileSync(this.deps.storePath, 'utf8')) as Stored }
    catch { return { environments: [], idempotency: {} } }
  }
  private save(): void {
    mkdirSync(dirname(this.deps.storePath), { recursive: true })
    const temp = `${this.deps.storePath}.tmp`
    writeFileSync(temp, JSON.stringify(this.data, null, 2))
    renameSync(temp, this.deps.storePath)
  }
  get(userId: string, projectId: string, taskId: string): PreviewEnvironment | null {
    if (!this.deps.db.getProject(userId, projectId)) return null
    const env = this.data.environments.find((item) => item.projectId === projectId && item.taskId === taskId) ?? null
    if (env) this.refreshStale(env)
    return env ? structuredClone(env) : null
  }
  private refreshStale(env: PreviewEnvironment): void {
    const workspace = this.deps.db.findActiveCiWorkspace(env.projectId, env.taskId)
    if (!workspace || workspace.path !== env.workspacePath || isPreviewBusy(env.state) || !env.builtCommitSha) return
    // Exact SHA is refreshed by explicit health/reconcile; a changed workspace record is immediately stale.
    if (workspace.agentId !== env.agentId && env.state === 'running') {
      env.state = 'stale'; env.staleReason = 'workspace_machine_changed'; env.updatedAt = this.now(); this.save()
    }
  }
  list(): PreviewEnvironment[] { return structuredClone(this.data.environments) }
  async operate(userId: string, projectId: string, taskId: string, operation: PreviewOperation, args: { idempotencyKey?: string; scenario?: string } = {}): Promise<PreviewEnvironment> {
    const project = this.deps.db.getProject(userId, projectId)
    if (!project) throw new Error('Проект не найден или нет доступа')
    const board = this.deps.db.getBoard(userId, projectId)
    const task = board?.tasks.find((item) => item.id === taskId)
    if (!task || task.type !== 'task') throw new Error('Задача не найдена')
    const idem = args.idempotencyKey ? `${userId}:${projectId}:${taskId}:${operation}:${args.idempotencyKey}` : null
    if (idem && this.data.idempotency[idem]) {
      const replay = this.data.environments.find((item) => item.id === this.data.idempotency[idem])
      if (replay) return structuredClone(replay)
    }
    let env = this.data.environments.find((item) => item.projectId === projectId && item.taskId === taskId)
    if (env && isPreviewBusy(env.state)) throw new Error('Для preview уже выполняется изменяющая операция')
    const workspace = this.deps.db.findActiveCiWorkspace(projectId, taskId)
    if (!workspace || !workspace.agentId) throw new Error('Активная рабочая директория задачи не найдена')
    const machine = project.machines.find((item) => item.agentId === workspace.agentId)
    if (!machine || !workspace.path.startsWith(machine.reposRoot + '/')) throw new Error('Workspace находится вне разрешённого repos_root')
    if (!this.deps.isOnline(workspace.agentId)) throw new Error('Машина не в сети')
    const now = this.now()
    if (!env || env.state === 'removed') {
      env = {
        id: this.newId(), projectId, taskId, agentId: workspace.agentId, workspacePath: workspace.path,
        branch: '', builtCommitSha: null, currentCommitSha: null, state: 'not_created', staleReason: null,
        composeProject: safePreviewResourceName(projectId, taskId), appUrl: null, storybookUrl: null,
        storybookStatus: 'pending', storybookCommitSha: null, selectedSeedScenario: null, seedVersion: null,
        dataReady: false, healthStatus: 'unknown', services: [], runs: [], createdBy: userId,
        createdAt: now, updatedAt: now, startedAt: null, stoppedAt: null, lastError: null
      }
      this.data.environments = this.data.environments.filter((item) => item.id !== env!.id && !(item.projectId === projectId && item.taskId === taskId))
      this.data.environments.push(env)
    }
    if (idem) this.data.idempotency[idem] = env.id
    const run: PreviewRun = {
      id: this.newId(), environmentId: env.id, operation, status: 'running', initiator: userId,
      commitSha: env.currentCommitSha, startedAt: now, finishedAt: null, errorType: null, errorMessage: null, log: ''
    }
    env.runs.push(run); env.updatedAt = now; env.lastError = null
    env.state = operation === 'rebuild' ? 'rebuilding' : operation === 'stop' ? 'stopping' : operation === 'remove' ? 'cleaning' : operation === 'seed' || operation === 'reset' ? 'seeding' : operation === 'health_check' || operation === 'reconcile' ? 'health_checking' : 'building'
    this.save()
    const ctl = new AbortController(); this.active.set(env.id, ctl)
    void this.execute(env, run, operation, args.scenario, ctl.signal)
    return structuredClone(env)
  }
  cancel(userId: string, projectId: string, taskId: string): boolean {
    const env = this.get(userId, projectId, taskId)
    if (!env) return false
    const ctl = this.active.get(env.id)
    if (!ctl) return false
    ctl.abort(); return true
  }
  private async command(env: PreviewEnvironment, run: PreviewRun, script: string, timeoutMs: number, signal: AbortSignal, extraEnv: Record<string, string> = {}): Promise<string> {
    let output = ''
    const result = await this.deps.executor.run({
      agentId: env.agentId, workdir: env.workspacePath, script, timeoutMs,
      env: {
        VC_PREVIEW_PROJECT: env.composeProject,
        VC_PREVIEW_APP_PORT: String(env.services.find((service) => service.name === 'app')?.hostPort ?? DEFAULT_PREVIEW_CONFIG.portRange.from),
        VC_PREVIEW_STORYBOOK_PORT: String(env.services.find((service) => service.name === 'storybook')?.hostPort ?? DEFAULT_PREVIEW_CONFIG.portRange.from + 1),
        ...extraEnv
      }
    }, (chunk) => { output += chunk; run.log = trimLog(run.log + chunk); env.updatedAt = this.now(); this.save() }, signal)
    if (result.timedOut) throw new Error('Операция превысила таймаут')
    if (result.exitCode !== 0) throw new Error(`Команда завершилась с кодом ${result.exitCode}`)
    return output
  }
  private async allocatePort(env: PreviewEnvironment, run: PreviewRun, signal: AbortSignal, excluded: number[]): Promise<number> {
    const output = await this.command(
      env,
      run,
      `node -e 'const net=require("net");const from=Number(process.env.VC_PORT_FROM);const to=Number(process.env.VC_PORT_TO);const used=new Set((process.env.VC_PORT_USED||"").split(",").filter(Boolean).map(Number));let p=from;const next=()=>{while(used.has(p)&&p<=to)p++;if(p>to)process.exit(73);const s=net.createServer();s.once("error",()=>{p++;next()});s.listen(p,"127.0.0.1",()=>{console.log("VC_ALLOCATED_PORT="+p);s.close()})};next()' `,
      30_000,
      signal,
      {
        VC_PORT_FROM: String(DEFAULT_PREVIEW_CONFIG.portRange.from),
        VC_PORT_TO: String(DEFAULT_PREVIEW_CONFIG.portRange.to),
        VC_PORT_USED: excluded.join(',')
      }
    )
    const port = Number(output.match(/VC_ALLOCATED_PORT=(\d+)/)?.[1])
    if (!Number.isInteger(port)) throw new Error('port allocation failed')
    return port
  }
  private async execute(env: PreviewEnvironment, run: PreviewRun, operation: PreviewOperation, scenario: string | undefined, signal: AbortSignal): Promise<void> {
    try {
      const metadata = await this.command(env, run, 'printf "VC_BRANCH=%s\\nVC_SHA=%s\\n" "$(git branch --show-current)" "$(git rev-parse HEAD)"', 30_000, signal)
      const branch = metadata.match(/VC_BRANCH=([^\r\n]+)/)?.[1]?.trim()
      const sha = metadata.match(/VC_SHA=([0-9a-f]{7,64})/)?.[1]
      if (!branch || !sha) throw new Error('Не удалось определить branch и commit SHA')
      env.branch = branch; env.currentCommitSha = sha; run.commitSha = sha
      if (operation === 'start' || operation === 'rebuild') {
        if (!env.services.length) {
          const used = this.data.environments.flatMap((item) => item.services.map((service) => service.hostPort))
          const appPort = await this.allocatePort(env, run, signal, used)
          const storybookPort = await this.allocatePort(env, run, signal, [...used, appPort])
          env.services = [
            { name: 'app', internalPort: DEFAULT_PREVIEW_CONFIG.appInternalPort, hostPort: appPort, url: `http://127.0.0.1:${appPort}`, containerId: null, state: 'created', healthStatus: 'unknown' },
            { name: 'storybook', internalPort: DEFAULT_PREVIEW_CONFIG.storybookInternalPort ?? 6006, hostPort: storybookPort, url: `http://127.0.0.1:${storybookPort}`, containerId: null, state: 'created', healthStatus: 'unknown' }
          ]
          env.appUrl = env.services[0]!.url
          env.storybookUrl = env.services[1]!.url
        }
        if (operation === 'rebuild' || !env.builtCommitSha) {
          env.state = operation === 'rebuild' ? 'rebuilding' : 'building'; this.save()
          await this.command(env, run, 'test -f compose.preview.yml && docker compose -p "$VC_PREVIEW_PROJECT" -f compose.preview.yml config --quiet && docker compose -p "$VC_PREVIEW_PROJECT" -f compose.preview.yml build', DEFAULT_PREVIEW_CONFIG.buildTimeoutMs, signal)
        } else if (env.builtCommitSha !== sha) {
          env.state = 'stale'; env.staleReason = 'commit_changed'
          throw new Error('Остановленное окружение относится к другому SHA; требуется пересборка')
        }
        env.state = 'starting'; this.save()
        await this.command(env, run, 'docker compose -p "$VC_PREVIEW_PROJECT" -f compose.preview.yml up -d --wait --wait-timeout 60', DEFAULT_PREVIEW_CONFIG.startTimeoutMs, signal)
        env.state = 'health_checking'; env.healthStatus = 'checking'; this.save()
        await this.command(env, run, 'docker compose -p "$VC_PREVIEW_PROJECT" -f compose.preview.yml ps --status running --quiet | grep -q .', DEFAULT_PREVIEW_CONFIG.healthTimeoutMs, signal)
        env.builtCommitSha = sha; env.state = 'running'; env.healthStatus = 'healthy'; env.staleReason = null
        env.storybookStatus = 'ready'; env.storybookCommitSha = sha
        env.services = env.services.map((service) => ({ ...service, state: 'running', healthStatus: 'healthy' }))
        env.startedAt = this.now(); env.stoppedAt = null
      } else if (operation === 'stop') {
        await this.command(env, run, 'docker compose -p "$VC_PREVIEW_PROJECT" -f compose.preview.yml stop', DEFAULT_PREVIEW_CONFIG.startTimeoutMs, signal)
        env.state = 'stopped'; env.stoppedAt = this.now(); env.healthStatus = 'unknown'
      } else if (operation === 'remove') {
        await this.command(env, run, 'docker compose -p "$VC_PREVIEW_PROJECT" -f compose.preview.yml down --volumes --remove-orphans', DEFAULT_PREVIEW_CONFIG.startTimeoutMs, signal)
        env.state = 'removed'; env.appUrl = null; env.storybookUrl = null; env.services = []; env.healthStatus = 'unknown'
      } else if (operation === 'seed' || operation === 'reset') {
        if (!scenario || !/^[a-zA-Z0-9_-]{1,64}$/.test(scenario)) throw new Error('Некорректный сценарий тестовых данных')
        await this.command(env, run, `docker compose -p "$VC_PREVIEW_PROJECT" -f compose.preview.yml exec -T app npm run preview:${operation === 'reset' ? 'reset' : 'seed'} -- "$VC_PREVIEW_SEED"`, DEFAULT_PREVIEW_CONFIG.startTimeoutMs, signal, { VC_PREVIEW_SEED: scenario })
        env.selectedSeedScenario = scenario; env.seedVersion = sha; env.dataReady = true; env.state = 'running'; env.healthStatus = 'healthy'
      } else {
        await this.command(env, run, 'docker compose -p "$VC_PREVIEW_PROJECT" -f compose.preview.yml ps --status running --quiet | grep -q .', DEFAULT_PREVIEW_CONFIG.healthTimeoutMs, signal)
        env.state = env.builtCommitSha === sha ? 'running' : 'stale'; env.staleReason = env.state === 'stale' ? 'commit_changed' : null; env.healthStatus = 'healthy'
      }
      run.status = 'success'; run.finishedAt = this.now(); env.updatedAt = this.now(); this.save()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const cancelled = signal.aborted
      run.status = cancelled ? 'cancelled' : 'failed'; run.finishedAt = this.now()
      run.errorType = cancelled ? 'cancelled' : classify(operation, message); run.errorMessage = message
      env.state = 'failed'; env.healthStatus = 'unhealthy'; env.lastError = { type: run.errorType, message }; env.updatedAt = this.now(); this.save()
    } finally { this.active.delete(env.id) }
  }
  async reconcile(): Promise<void> {
    for (const env of this.data.environments) {
      if (env.state === 'removed' || env.state === 'not_created') continue
      if (isPreviewBusy(env.state)) { env.state = 'failed'; env.lastError = { type: 'cancelled', message: 'Операция прервана рестартом сервера' } }
      if (!this.deps.isOnline(env.agentId)) { env.state = 'failed'; env.lastError = { type: 'machine_unavailable', message: 'Машина недоступна при reconciliation' } }
    }
    this.save()
  }
}
