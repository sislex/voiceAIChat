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
  async operate(userId: string, projectId: string, taskId: string, operation: PreviewOperation, args: { idempotencyKey?: string; scenario?: string; agentId?: string } = {}): Promise<PreviewEnvironment> {
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
    const activeWorkspace = this.deps.db.findActiveCiWorkspace(projectId, taskId)
    const sourceWorkspace = activeWorkspace ?? this.deps.db.findLatestCiWorkspace(projectId, taskId)
    const targetAgentId = args.agentId ?? activeWorkspace?.agentId ?? task.agentId ?? project.defaultAgentId
    if (!targetAgentId) throw new Error('Выберите машину для тестового окружения')
    const machine = project.machines.find((item) => item.agentId === targetAgentId)
    if (!machine?.reposRoot) throw new Error('Для выбранной машины не настроен repos_root')
    if (!this.deps.isOnline(targetAgentId)) throw new Error('Машина не в сети')
    let workspacePath = activeWorkspace?.agentId === targetAgentId ? activeWorkspace.path : ''
    const expectedBranch = sourceWorkspace?.branch ?? null
    const expectedSha = sourceWorkspace?.commitSha ?? null
    if (workspacePath && (operation === 'start' || operation === 'rebuild') && expectedBranch && expectedSha) {
      let verificationOutput = ''
      const verified = await this.deps.executor.run({
        agentId: targetAgentId, workdir: workspacePath,
        script: '[ -z "$(git status --porcelain --untracked-files=all)" ] || { echo "Workspace содержит незакоммиченные изменения"; exit 76; }; [ "$(git branch --show-current)" = "$VC_PREVIEW_BRANCH" ] || { echo "Workspace находится не на ожидаемой ветке"; exit 77; }; [ "$(git rev-parse HEAD)" = "$VC_PREVIEW_SHA" ] || { echo "Локальный SHA не совпадает с ожидаемым"; exit 75; }; remote=$(git ls-remote --heads origin "refs/heads/$VC_PREVIEW_BRANCH" | awk "{print \\$1}"); [ -n "$remote" ] || { echo "Ветка отсутствует в origin"; exit 74; }; [ "$remote" = "$VC_PREVIEW_SHA" ] || { echo "Ожидаемый SHA не отправлен в origin"; exit 78; }',
        timeoutMs: 30_000, env: { VC_PREVIEW_BRANCH: expectedBranch, VC_PREVIEW_SHA: expectedSha }
      }, (chunk) => { verificationOutput += chunk })
      if (verified.exitCode !== 0 || verified.timedOut) throw new Error(verificationOutput.trim().split(/\r?\n/).filter(Boolean).at(-1) || `Не удалось проверить workspace ${workspacePath} на машине ${targetAgentId}`)
    }
    if (!workspacePath) {
      if (!project.gitUrl) throw new Error('Для проекта не настроен Git-репозиторий')
      const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 48)
      const branch = expectedBranch ?? (project.ciBranchTemplate || 'feature/{task_number}')
        .replace('{task_number}', String(task.seq)).replace('{slug}', slug(task.title))
      if (!expectedSha || !sourceWorkspace?.pushed) throw new Error(`Нельзя подготовить preview на машине ${targetAgentId}: результат разработки не зафиксирован и не подтверждён в origin`)
      const projectKey = slug(project.name || project.id) || project.id.replace(/[^a-z0-9]/gi, '').slice(0, 24)
      workspacePath = `${machine.reposRoot.replace(/\/$/, '')}/${projectKey}/${task.seq}`
      let output = ''
      const prepared = await this.deps.executor.run({
        agentId: targetAgentId,
        workdir: machine.path || machine.reposRoot,
        script: 'mkdir -p "$(dirname "$VC_PREVIEW_WORKSPACE")"; remote=$(git ls-remote --heads "$VC_PREVIEW_REPO_URL" "refs/heads/$VC_PREVIEW_BRANCH" | awk "{print \\$1}"); [ -n "$remote" ] || { echo "Ветка $VC_PREVIEW_BRANCH отсутствует в origin"; exit 74; }; [ "$remote" = "$VC_PREVIEW_SHA" ] || { echo "SHA origin/$VC_PREVIEW_BRANCH ($remote) не совпадает с ожидаемым $VC_PREVIEW_SHA"; exit 75; }; if [ ! -d "$VC_PREVIEW_WORKSPACE/.git" ]; then git clone --single-branch --branch "$VC_PREVIEW_BRANCH" "$VC_PREVIEW_REPO_URL" "$VC_PREVIEW_WORKSPACE"; else [ -z "$(git -C "$VC_PREVIEW_WORKSPACE" status --porcelain --untracked-files=all)" ] || { echo "Preview workspace содержит незакоммиченные изменения"; exit 76; }; git -C "$VC_PREVIEW_WORKSPACE" fetch origin "$VC_PREVIEW_BRANCH" && git -C "$VC_PREVIEW_WORKSPACE" checkout "$VC_PREVIEW_BRANCH" && git -C "$VC_PREVIEW_WORKSPACE" reset --hard "$VC_PREVIEW_SHA"; fi; [ "$(git -C "$VC_PREVIEW_WORKSPACE" rev-parse HEAD)" = "$VC_PREVIEW_SHA" ] || exit 75',
        timeoutMs: DEFAULT_PREVIEW_CONFIG.buildTimeoutMs,
        env: { VC_PREVIEW_ROOT: machine.reposRoot, VC_PREVIEW_WORKSPACE: workspacePath, VC_PREVIEW_BRANCH: branch, VC_PREVIEW_SHA: expectedSha, VC_PREVIEW_REPO_URL: project.gitUrl }
      }, (chunk) => { output += chunk })
      if (prepared.timedOut) throw new Error('Подготовка рабочей копии на выбранной машине превысила таймаут')
      if (prepared.exitCode !== 0) throw new Error(output.trim().split(/\r?\n/).filter(Boolean).at(-1) || 'Не удалось подготовить рабочую копию на выбранной машине')
    }
    if (!workspacePath.startsWith(machine.reposRoot.replace(/\/$/, '') + '/')) throw new Error('Workspace находится вне разрешённого repos_root')
    if (env && env.agentId !== targetAgentId) {
      if (env.state === 'running') throw new Error('Сначала остановите окружение перед сменой машины')
      env.agentId = targetAgentId; env.workspacePath = workspacePath; env.services = []; env.appUrl = null; env.storybookUrl = null
      env.branch = expectedBranch ?? env.branch; env.expectedCommitSha = expectedSha; env.gitStatus = expectedSha ? 'verified' : 'unknown'
      env.builtCommitSha = null; env.currentCommitSha = null; env.state = 'not_created'
    }
    const now = this.now()
    if (!env || env.state === 'removed') {
      env = {
        id: this.newId(), projectId, taskId, agentId: targetAgentId, workspacePath,
        branch: expectedBranch ?? '', expectedCommitSha: expectedSha, builtCommitSha: null, currentCommitSha: null, gitStatus: expectedSha ? 'verified' : 'unknown', state: 'not_created', staleReason: null,
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
    env.state = operation === 'rebuild' ? 'rebuilding' : operation === 'stop' ? 'stopping' : operation === 'remove' ? 'cleaning' : operation === 'seed' || operation === 'reset' ? 'seeding' : operation === 'health_check' || operation === 'reconcile' ? 'health_checking' : operation === 'docker_start' || operation === 'docker_install' ? 'starting' : 'building'
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
    if (result.exitCode !== 0) {
      const detail = output.trim().split(/\r?\n/).filter(Boolean).at(-1)
      throw new Error(detail || `Команда завершилась с кодом ${result.exitCode}`)
    }
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
      if (operation === 'docker_start' || operation === 'docker_install') {
        if (operation === 'docker_install') {
          await this.command(env, run, 'case "$(uname -s)" in Darwin) command -v brew >/dev/null 2>&1 || { echo "Для установки Docker Desktop требуется Homebrew"; exit 71; }; brew install --cask docker ;; Linux) command -v apt-get >/dev/null 2>&1 || { echo "Автоматическая установка Docker на этой Linux-системе не поддерживается"; exit 71; }; sudo -n apt-get update && sudo -n apt-get install -y docker.io docker-compose-plugin ;; *) echo "Автоматическая установка Docker на этой платформе не поддерживается"; exit 71 ;; esac', DEFAULT_PREVIEW_CONFIG.buildTimeoutMs, signal)
        }
        await this.command(env, run, 'case "$(uname -s)" in Darwin) open -a Docker ;; Linux) sudo -n systemctl start docker || sudo -n service docker start ;; *) echo "Автоматический запуск Docker на этой платформе не поддерживается"; exit 72 ;; esac; i=0; until docker info >/dev/null 2>&1; do i=$((i+1)); [ "$i" -ge 60 ] && { echo "Docker запущен, но Engine не стал доступен за 120 секунд"; exit 70; }; sleep 2; done', 150_000, signal)
        env.state = 'stopped'; env.healthStatus = 'unknown'; env.lastError = null
        this.deps.db.setTaskPreviewReady(env.projectId, env.taskId, false)
        run.status = 'success'; run.finishedAt = this.now(); env.updatedAt = this.now(); this.save(); return
      }
      const metadata = await this.command(env, run, 'printf "VC_BRANCH=%s\\nVC_SHA=%s\\n" "$(git branch --show-current)" "$(git rev-parse HEAD)"', 30_000, signal)
      const branch = metadata.match(/VC_BRANCH=([^\r\n]+)/)?.[1]?.trim()
      const sha = metadata.match(/VC_SHA=([0-9a-f]{7,64})/)?.[1]
      if (!branch || !sha) throw new Error('Не удалось определить branch и commit SHA')
      const expectedBranch = env.branch || null
      env.branch = branch; env.currentCommitSha = sha; run.commitSha = sha
      env.expectedCommitSha = env.expectedCommitSha ?? sha
      if (env.expectedCommitSha !== sha || (expectedBranch && expectedBranch !== branch)) {
        env.gitStatus = 'sha_mismatch'
        throw new Error(`Workspace ${env.workspacePath} на машине ${env.agentId} не совпадает с зафиксированным результатом разработки`)
      }
      env.gitStatus = 'verified'
      if (operation === 'start' || operation === 'rebuild') {
        await this.command(env, run, 'if ! command -v docker >/dev/null 2>&1; then echo "Docker не установлен"; exit 69; fi; if ! docker info >/dev/null 2>&1; then echo "Docker установлен, но не запущен"; exit 70; fi', 30_000, signal)
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
      this.deps.db.setTaskPreviewReady(env.projectId, env.taskId, env.state === 'running' && env.healthStatus === 'healthy')
      run.status = 'success'; run.finishedAt = this.now(); env.updatedAt = this.now(); this.save()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const cancelled = signal.aborted
      run.status = cancelled ? 'cancelled' : 'failed'; run.finishedAt = this.now()
      run.errorType = cancelled ? 'cancelled' : classify(operation, message); run.errorMessage = message
      env.state = 'failed'; env.healthStatus = 'unhealthy'; env.lastError = { type: run.errorType, message }; env.updatedAt = this.now()
      this.deps.db.setTaskPreviewReady(env.projectId, env.taskId, false); this.save()
    } finally { this.active.delete(env.id) }
  }
  async reconcile(): Promise<void> {
    for (const env of this.data.environments) {
      if (env.state === 'removed' || env.state === 'not_created') continue
      if (isPreviewBusy(env.state)) { env.state = 'failed'; env.lastError = { type: 'cancelled', message: 'Операция прервана рестартом сервера' } }
      if (!this.deps.isOnline(env.agentId)) { env.state = 'failed'; env.lastError = { type: 'machine_unavailable', message: 'Машина недоступна при reconciliation' } }
      this.deps.db.setTaskPreviewReady(env.projectId, env.taskId, env.state === 'running' && env.healthStatus === 'healthy')
    }
    this.save()
  }
}
