import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PreviewConfig, PreviewEnvironment, PreviewErrorType, PreviewOperation, PreviewRun, PreviewRunStep } from '@voicechat/shared'
import { isMachineStoragePathAllowed, isPreviewBusy, managedPreviewEnvironmentPaths, managedRunManifestPaths, parseEnvironmentManifest, parseRunManifest, parseRunReportManifest, safePreviewResourceName, type EnvironmentManifest, type RunManifest, type RunReportManifest } from '@voicechat/shared'
import { publishRemoteManifest } from '../manifests.js'
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
  platformOf?: (agentId: string) => string | undefined
  allowedDirsOf?: (agentId: string) => string[]
  fsRead?: (agentId: string, path: string) => Promise<{ dataBase64?: string }>
  fsWrite?: (agentId: string, path: string, dataBase64: string) => Promise<unknown>
  fsMkdir?: (agentId: string, path: string) => Promise<unknown>
  fsRename?: (agentId: string, from: string, to: string) => Promise<unknown>
  fsDelete?: (agentId: string, path: string) => Promise<unknown>
  closeTunnelsForAgent?: (agentId: string) => void
  now?: () => number
  newId?: () => string
}
const trimLog = (value: string): string => value.length > 500_000 ? value.slice(-500_000) : value
const redact = (value: string): string => value
  .replace(/((?:token|password|secret|api[_-]?key|authorization)\s*[=:]\s*)[^\s"']+/gi, '$1[REDACTED]')
  .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
  .replace(/(-----BEGIN [A-Z ]+PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]+PRIVATE KEY-----)/g, '$1\n[REDACTED]\n$2')
const classify = (operation: PreviewOperation, message: string): PreviewErrorType => {
  if (/offline|не в сети|connection lost/i.test(message)) return /connection lost/i.test(message) ? 'connection_lost' : 'machine_unavailable'
  if (/не установлен/i.test(message)) return 'docker_missing'
  if (/permission denied|доступ запрещён/i.test(message)) return 'docker_permission_denied'
  if (/не запущен|daemon|engine/i.test(message)) return 'docker_daemon_unavailable'
  if (/workspace|working directory|no such file/i.test(message)) return 'working_directory_missing'
  if (/port.*(?:use|занят)|address already in use/i.test(message)) return 'port_in_use'
  if (/health/i.test(message)) return 'health_check_failed'
  if (/timeout|таймаут|превысила/i.test(message)) return 'timeout'
  if (/pull/i.test(message)) return 'image_pull_failed'
  if (/container.*(?:exit|crash|пад)/i.test(message)) return 'container_crashed'
  if (operation === 'seed' || operation === 'reset') return 'seed'
  if (operation === 'remove') return 'cleanup'
  return operation === 'start' || operation === 'rebuild' ? 'build_failed' : 'unknown'
}
const START_STEPS: Array<[string, string]> = [
  ['machine', 'Проверка машины'], ['workspace', 'Проверка рабочей директории'],
  ['configuration', 'Проверка конфигурации и Docker'], ['image', 'Загрузка или обновление образа'],
  ['build', 'Сборка'], ['container', 'Создание и запуск контейнера'],
  ['port', 'Ожидание публикации порта'], ['health', 'Проверка доступности приложения'],
  ['connection', 'Формирование адреса подключения'], ['ready', 'Готовность стенда']
]
const stepsFor = (operation: PreviewOperation): PreviewRunStep[] => (operation === 'start' || operation === 'rebuild' ? START_STEPS : [[operation, operation]])
  .map(([id, name]) => ({ id, name, status: 'pending', startedAt: null, finishedAt: null, message: 'Ожидает выполнения', error: null }))

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
    try {
      const stored = JSON.parse(readFileSync(this.deps.storePath, 'utf8')) as Stored
      for (const env of stored.environments) for (const run of env.runs) {
        if ((run.status as string) === 'success') run.status = 'succeeded'
        run.createdAt ??= run.startedAt ?? env.createdAt
        run.agentId ??= env.agentId; run.workspacePath ??= env.workspacePath
        run.configurationKey ??= `${run.operation}:${run.agentId}:${run.workspacePath}:${run.commitSha ?? ''}`
        run.version ??= 1; run.currentStepId ??= null; run.steps ??= stepsFor(run.operation); run.events ??= []
        run.exitCode ??= null; run.result ??= null
      }
      return stored
    } catch { return { environments: [], idempotency: {} } }
  }
  private event(run: PreviewRun, type: 'status' | 'step' | 'stdout' | 'stderr' | 'result', message: string, stepId: string | null = run.currentStepId): void {
    run.version += 1
    run.events.push({ version: run.version, at: this.now(), type, message: redact(message), stepId })
    if (run.events.length > 2_000) run.events.splice(0, run.events.length - 2_000)
  }
  private step(run: PreviewRun, id: string, status: PreviewRunStep['status'], message: string, error: string | null = null): void {
    const target = run.steps.find((item) => item.id === id)
    if (!target || ['succeeded','failed','skipped','cancelled'].includes(target.status)) return
    const now = this.now()
    if (status === 'running') { target.startedAt ??= now; run.currentStepId = id }
    if (['succeeded','failed','skipped','cancelled'].includes(status)) target.finishedAt = now
    target.status = status; target.message = redact(message); target.error = error ? redact(error) : null
    this.event(run, 'step', target.message, id)
  }
  private skipPending(run: PreviewRun, reason: string): void {
    for (const item of run.steps) if (item.status === 'pending') this.step(run, item.id, 'skipped', reason)
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
  private platform(agentId: string, root: string): string {
    return this.deps.platformOf?.(agentId) ?? (/^(?:[A-Za-z]:[\\/]|\\\\)/.test(root) ? 'win32' : 'linux')
  }
  private async managedPaths(userId: string, projectId: string, taskId: string, previewId: string, agentId: string) {
    if (!this.deps.isOnline(agentId)) throw new Error('Машина не в сети')
    const machine = this.deps.db.getProjectMachine(projectId, agentId)
    if (!machine?.storageId) throw new Error('Для нового preview не настроено MachineStorage выбранной машины')
    if (!machine.storageRoot) throw new Error('MachineStorage выбранной машины недоступно')
    if (!this.deps.fsRead || !this.deps.fsWrite || !this.deps.fsMkdir || !this.deps.fsRename || !this.deps.fsDelete) throw new Error('Файловая проверка MachineStorage недоступна')
    const platform = this.platform(agentId, machine.storageRoot)
    const paths = managedPreviewEnvironmentPaths(machine.storageRoot, projectId, taskId, previewId, platform)
    if (!isMachineStoragePathAllowed(paths.previewRoot, this.deps.allowedDirsOf?.(agentId) ?? [], platform)) throw new Error('Managed preview находится вне разрешённых директорий машины')
    const separator = platform === 'win32' ? '\\' : '/'
    try {
      const marker = await this.deps.fsRead(agentId, `${machine.storageRoot}${separator}.voicechat${separator}storage.json`)
      const parsed = JSON.parse(Buffer.from(marker.dataBase64 ?? '', 'base64').toString('utf8')) as { id?: unknown; formatVersion?: unknown }
      if (parsed.id !== machine.storageId || parsed.formatVersion !== (machine.storageFormatVersion ?? 1)) throw new Error('marker conflict')
    } catch { throw new Error('Marker MachineStorage отсутствует, повреждён или конфликтует') }
    const inspected = await this.deps.executor.run({
      agentId, workdir: machine.storageRoot, timeoutMs: 30_000,
      script: 'p="$VC_PREVIEW_ROOT"; root="$VC_STORAGE_ROOT"; while [ "$p" != "$root" ]; do [ ! -L "$p" ] || exit 73; next=$(dirname "$p"); [ "$next" != "$p" ] || exit 74; p="$next"; done; [ ! -L "$root" ] || exit 73',
      env: { VC_PREVIEW_ROOT: paths.previewRoot, VC_STORAGE_ROOT: machine.storageRoot }
    }, () => undefined)
    if (inspected.exitCode === 73) throw new Error('Компонент managed preview path является неподтверждённым симлинком')
    if (inspected.exitCode !== 0 || inspected.timedOut) throw new Error('Не удалось безопасно проверить managed preview path')
    const probe = `${machine.storageRoot}${separator}.voicechat${separator}temporary${separator}preview-probe-${randomUUID()}`
    try { await this.deps.fsWrite(agentId, probe, Buffer.from('ok').toString('base64')); await this.deps.fsDelete(agentId, probe) }
    catch (error) { throw new Error(`MachineStorage недоступно для записи: ${error instanceof Error ? error.message : String(error)}`) }
    return { machine, paths, platform }
  }
  private async materializeManaged(userId: string, projectId: string, taskId: string, previewId: string, agentId: string, createdAt?: number) {
    const resolved = await this.managedPaths(userId, projectId, taskId, previewId, agentId)
    const { machine, paths } = resolved
    const manifest: EnvironmentManifest = { formatVersion: 1, kind: 'preview', projectId, taskId, storageId: machine.storageId!, machineId: agentId, createdAt: new Date(createdAt ?? this.now()).toISOString() }
    try {
      for (const path of [paths.previewRoot, paths.app, paths.config, paths.logs, paths.artifacts, paths.temporary, paths.repository]) await this.deps.fsMkdir!(agentId, path)
      await publishRemoteManifest({ read: this.deps.fsRead!, write: this.deps.fsWrite!, mkdir: this.deps.fsMkdir!, rename: this.deps.fsRename!, delete: this.deps.fsDelete! }, agentId, paths.manifest, manifest, parseEnvironmentManifest)
    } catch (error) { throw new Error(`MachineStorage недоступно для записи: ${error instanceof Error ? error.message : String(error)}`) }
    return { ...resolved, manifest }
  }
  private async cleanupManaged(userId: string, env: PreviewEnvironment): Promise<void> {
    if (!env.managed) return
    const resolved = await this.managedPaths(userId, env.projectId, env.taskId, env.id, env.agentId)
    const { paths, machine } = resolved
    if (env.managed.formatVersion !== 1 || env.managed.storageId !== machine.storageId || env.managed.machineId !== env.agentId || env.managed.previewRoot !== paths.previewRoot || env.workspacePath !== paths.repository) {
      throw new Error('Managed cleanup отклонён: persisted path не подтверждён')
    }
    let manifest: EnvironmentManifest
    try {
      const result = await this.deps.fsRead!(env.agentId, paths.manifest)
      manifest = parseEnvironmentManifest(JSON.parse(Buffer.from(result.dataBase64 ?? '', 'base64').toString('utf8')), paths.manifest)
    } catch { throw new Error('Managed cleanup отклонён: environment.json отсутствует или повреждён') }
    if (manifest.projectId !== env.projectId || manifest.taskId !== env.taskId || manifest.kind !== 'preview' || manifest.storageId !== machine.storageId || manifest.machineId !== env.agentId) throw new Error('Managed cleanup отклонён: environment.json конфликтует')
    await this.deps.fsDelete!(env.agentId, paths.previewRoot)
  }
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
    if (env && isPreviewBusy(env.state)) {
      const activeRun = [...env.runs].reverse().find((item) => ['queued','running','cancelling'].includes(item.status))
      if (activeRun?.operation === operation && (!args.agentId || args.agentId === env.agentId)) return structuredClone(env)
      throw new Error('Для preview уже выполняется изменяющая операция')
    }
    const activeWorkspace = this.deps.db.findActiveCiWorkspace(projectId, taskId)
    const sourceWorkspace = activeWorkspace ?? this.deps.db.findLatestCiWorkspace(projectId, taskId)
    const targetAgentId = args.agentId ?? env?.agentId ?? activeWorkspace?.agentId ?? task.agentId ?? project.defaultAgentId
    if (!targetAgentId) throw new Error('Выберите машину для тестового окружения')
    if (!this.deps.isOnline(targetAgentId)) throw new Error('Машина не в сети')
    const machine = project.machines.find((item) => item.agentId === targetAgentId)
    const expectedBranch = sourceWorkspace?.branch ?? null
    const expectedSha = sourceWorkspace?.commitSha ?? null
    const legacy = !!env && !env.managed
    const previewId = env?.id ?? this.newId()
    let workspacePath = legacy ? env!.workspacePath : ''
    let managed: Awaited<ReturnType<FeaturePreviewManager['managedPaths']>> | null = null
    if (!legacy) {
      managed = operation === 'remove' && env?.managed
        ? await this.managedPaths(userId, projectId, taskId, previewId, targetAgentId)
        : await this.materializeManaged(userId, projectId, taskId, previewId, targetAgentId, env?.createdAt)
      workspacePath = managed.paths.repository
      if (env?.managed && (env.managed.storageId !== managed.machine.storageId || env.managed.machineId !== targetAgentId || env.managed.previewRoot !== managed.paths.previewRoot || env.workspacePath !== workspacePath)) {
        throw new Error('Persisted managed preview path не совпадает с каноническим helper path')
      }
    }
    if (legacy && workspacePath && (operation === 'start' || operation === 'rebuild') && expectedBranch && expectedSha) {
      let verificationOutput = ''
      const verified = await this.deps.executor.run({
        agentId: targetAgentId, workdir: workspacePath,
        script: '[ -z "$(git status --porcelain --untracked-files=all)" ] || { echo "Workspace содержит незакоммиченные изменения"; exit 76; }; [ "$(git branch --show-current)" = "$VC_PREVIEW_BRANCH" ] || { echo "Workspace находится не на ожидаемой ветке"; exit 77; }; [ "$(git rev-parse HEAD)" = "$VC_PREVIEW_SHA" ] || { echo "Локальный SHA не совпадает с ожидаемым"; exit 75; }; remote=$(git ls-remote --heads origin "refs/heads/$VC_PREVIEW_BRANCH" | awk "{print \\$1}"); [ -n "$remote" ] || { echo "Ветка отсутствует в origin"; exit 74; }; [ "$remote" = "$VC_PREVIEW_SHA" ] || { echo "Ожидаемый SHA не отправлен в origin"; exit 78; }',
        timeoutMs: 30_000, env: { VC_PREVIEW_BRANCH: expectedBranch, VC_PREVIEW_SHA: expectedSha }
      }, (chunk) => { verificationOutput += chunk })
      if (verified.exitCode !== 0 || verified.timedOut) throw new Error(verificationOutput.trim().split(/\r?\n/).filter(Boolean).at(-1) || `Не удалось проверить workspace ${workspacePath} на машине ${targetAgentId}`)
    }
    if (!legacy) {
      if (!project.gitUrl) throw new Error('Для проекта не настроен Git-репозиторий')
      const branch = expectedBranch
      if (!branch || !expectedSha || !sourceWorkspace?.pushed) throw new Error(`Нельзя подготовить preview на машине ${targetAgentId}: результат разработки не зафиксирован и не подтверждён в origin`)
      let output = ''
      const prepared = await this.deps.executor.run({
        agentId: targetAgentId,
        workdir: managed!.paths.previewRoot,
        script: 'mkdir -p "$(dirname "$VC_PREVIEW_WORKSPACE")"; remote=$(git ls-remote --heads "$VC_PREVIEW_REPO_URL" "refs/heads/$VC_PREVIEW_BRANCH" | awk "{print \\$1}"); [ -n "$remote" ] || { echo "Ветка $VC_PREVIEW_BRANCH отсутствует в origin"; exit 74; }; [ "$remote" = "$VC_PREVIEW_SHA" ] || { echo "SHA origin/$VC_PREVIEW_BRANCH ($remote) не совпадает с ожидаемым $VC_PREVIEW_SHA"; exit 75; }; if [ ! -d "$VC_PREVIEW_WORKSPACE/.git" ]; then git clone --single-branch --branch "$VC_PREVIEW_BRANCH" "$VC_PREVIEW_REPO_URL" "$VC_PREVIEW_WORKSPACE"; else [ -z "$(git -C "$VC_PREVIEW_WORKSPACE" status --porcelain --untracked-files=all)" ] || { echo "Preview workspace содержит незакоммиченные изменения"; exit 76; }; git -C "$VC_PREVIEW_WORKSPACE" fetch origin "$VC_PREVIEW_BRANCH" && git -C "$VC_PREVIEW_WORKSPACE" checkout "$VC_PREVIEW_BRANCH" && git -C "$VC_PREVIEW_WORKSPACE" reset --hard "$VC_PREVIEW_SHA"; fi; [ "$(git -C "$VC_PREVIEW_WORKSPACE" rev-parse HEAD)" = "$VC_PREVIEW_SHA" ] || exit 75',
        timeoutMs: DEFAULT_PREVIEW_CONFIG.buildTimeoutMs,
        env: { VC_PREVIEW_ROOT: managed!.paths.previewRoot, VC_PREVIEW_WORKSPACE: workspacePath, VC_PREVIEW_BRANCH: branch, VC_PREVIEW_SHA: expectedSha, VC_PREVIEW_REPO_URL: project.gitUrl }
      }, (chunk) => { output += chunk })
      if (prepared.timedOut) throw new Error('Подготовка рабочей копии на выбранной машине превысила таймаут')
      if (prepared.exitCode !== 0) throw new Error(output.trim().split(/\r?\n/).filter(Boolean).at(-1) || 'Не удалось подготовить рабочую копию на выбранной машине')
    }
    if (!legacy && workspacePath !== managed!.paths.repository) throw new Error('Workspace managed preview не совпадает с каноническим repository path')
    if (env && env.agentId !== targetAgentId) {
      if (env.state === 'running') throw new Error('Сначала остановите окружение перед сменой машины')
      env.agentId = targetAgentId; env.workspacePath = workspacePath; env.services = []; env.appUrl = null; env.storybookUrl = null
      env.branch = expectedBranch ?? env.branch; env.expectedCommitSha = expectedSha; env.gitStatus = expectedSha ? 'verified' : 'unknown'
      env.builtCommitSha = null; env.currentCommitSha = null; env.state = 'not_created'
    }
    const now = this.now()
    if (env && (operation === 'stop' || operation === 'remove' || operation === 'rebuild')) this.deps.closeTunnelsForAgent?.(env.agentId)
    if (!env || env.state === 'removed') {
      env = {
        id: previewId, managed: managed ? { formatVersion: 1, storageId: managed.machine.storageId!, machineId: targetAgentId, previewRoot: managed.paths.previewRoot } : undefined,
        projectId, taskId, agentId: targetAgentId, workspacePath,
        branch: expectedBranch ?? '', expectedCommitSha: expectedSha, builtCommitSha: null, currentCommitSha: null, gitStatus: expectedSha ? 'verified' : 'unknown', state: 'not_created', staleReason: null,
        composeProject: `${safePreviewResourceName(projectId, taskId)}-${previewId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8)}`, appUrl: null, storybookUrl: null,
        storybookStatus: 'pending', storybookCommitSha: null, selectedSeedScenario: null, seedVersion: null,
        dataReady: false, healthStatus: 'unknown', services: [], runs: [], createdBy: userId,
        createdAt: now, updatedAt: now, startedAt: null, stoppedAt: null, lastError: null
      }
      this.data.environments = this.data.environments.filter((item) => item.id !== env!.id && !(item.projectId === projectId && item.taskId === taskId))
      this.data.environments.push(env)
    }
    if (idem) this.data.idempotency[idem] = env.id
    const configurationKey = `${operation}:${targetAgentId}:${workspacePath}:${expectedSha ?? ''}:${args.scenario ?? ''}`
    const run: PreviewRun = {
      id: this.newId(), environmentId: env.id, operation, status: 'running', initiator: userId,
      createdAt: now, startedAt: now, finishedAt: null, agentId: targetAgentId, workspacePath,
      configurationKey, commitSha: env.currentCommitSha, version: 1, currentStepId: null,
      steps: stepsFor(operation), events: [{ version: 1, at: now, type: 'status', message: 'Операция запущена', stepId: null }],
      errorType: null, errorMessage: null, exitCode: null, log: '', result: null
    }
    env.runs.push(run); env.updatedAt = now; env.lastError = null
    env.state = operation === 'rebuild' ? 'rebuilding' : operation === 'stop' ? 'stopping' : operation === 'remove' ? 'cleaning' : operation === 'seed' || operation === 'reset' ? 'seeding' : operation === 'health_check' || operation === 'reconcile' ? 'health_checking' : operation === 'docker_start' || operation === 'docker_install' ? 'starting' : 'building'
    this.save()
    const ctl = new AbortController(); this.active.set(env.id, ctl)
    void this.execute(env, run, operation, args.scenario, ctl.signal)
    return structuredClone(env)
  }
  cancel(userId: string, projectId: string, taskId: string): boolean {
    const env = this.data.environments.find((item) => item.projectId === projectId && item.taskId === taskId)
    if (!env || !this.deps.db.getProject(userId, projectId)) return false
    const ctl = this.active.get(env.id)
    if (!ctl) return true
    const run = [...env.runs].reverse().find((item) => item.status === 'running' || item.status === 'queued' || item.status === 'cancelling')
    if (run && run.status !== 'cancelling') { run.status = 'cancelling'; this.event(run, 'status', 'Отмена запрошена'); env.updatedAt = this.now(); this.save() }
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
    }, (chunk) => { const safe = redact(chunk); output += safe; run.log = trimLog(run.log + safe); this.event(run, 'stdout', safe); env.updatedAt = this.now(); this.save() }, signal)
    if (result.timedOut) { run.exitCode = result.exitCode; throw new Error('Операция превысила таймаут') }
    if (result.exitCode !== 0) {
      run.exitCode = result.exitCode
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
  private manifestFs() {
    return { read: this.deps.fsRead!, write: this.deps.fsWrite!, mkdir: this.deps.fsMkdir!, rename: this.deps.fsRename!, delete: this.deps.fsDelete! }
  }
  private async publishRunManifest(env: PreviewEnvironment, run: PreviewRun, sourceCommit: string): Promise<void> {
    if (!env.managed) return
    const paths = managedRunManifestPaths(env.managed.previewRoot, run.id, this.platform(env.agentId, env.managed.previewRoot))
    const value: RunManifest = { formatVersion: 1, runId: run.id, runType: 'preview', initiator: run.initiator, machineId: env.agentId, workspace: env.workspacePath, branch: env.branch, sourceCommit, createdAt: new Date(run.createdAt).toISOString(), startedAt: new Date(run.startedAt ?? run.createdAt).toISOString() }
    await publishRemoteManifest(this.manifestFs(), env.agentId, paths.run, value, parseRunManifest)
  }
  private async publishReportManifest(env: PreviewEnvironment, run: PreviewRun, status: RunReportManifest['status']): Promise<void> {
    if (!env.managed || !run.commitSha || !run.finishedAt) return
    const paths = managedRunManifestPaths(env.managed.previewRoot, run.id, this.platform(env.agentId, env.managed.previewRoot))
    const at = new Date(run.finishedAt).toISOString()
    const value: RunReportManifest = {
      formatVersion: 1, runId: run.id, status, sourceCommit: run.commitSha,
      finalCommit: status === 'success' ? (env.currentCommitSha ?? run.commitSha) : null,
      checks: run.steps.map(step => ({ name: step.id, status: step.status === 'succeeded' ? 'passed' : step.status === 'failed' || step.status === 'cancelled' ? 'failed' : 'skipped', ...(step.message ? { message: redact(step.message) } : {}) })),
      errors: run.errorMessage ? [{ code: run.errorType ?? 'preview_error', message: redact(run.errorMessage) }] : [],
      artifacts: [], finishedAt: at,
      ...(status === 'cancelled' ? { cancelledAt: at } : {}),
      ...(status === 'interrupted' ? { interruptedAt: at } : {})
    }
    await publishRemoteManifest(this.manifestFs(), env.agentId, paths.report, value, parseRunReportManifest)
  }
  private async execute(env: PreviewEnvironment, run: PreviewRun, operation: PreviewOperation, scenario: string | undefined, signal: AbortSignal): Promise<void> {
    try {
      if (operation === 'start' || operation === 'rebuild') {
        this.step(run, 'machine', 'succeeded', `Машина ${env.agentId} доступна`)
        this.step(run, 'workspace', 'succeeded', `Рабочая директория проверена: ${env.workspacePath}`)
        this.step(run, 'configuration', 'running', 'Проверяем конфигурацию и Docker')
      } else this.step(run, operation, 'running', 'Операция выполняется')
      if (operation === 'docker_start' || operation === 'docker_install') {
        if (operation === 'docker_install') {
          await this.command(env, run, 'case "$(uname -s)" in Darwin) command -v brew >/dev/null 2>&1 || { echo "Для установки Docker Desktop требуется Homebrew"; exit 71; }; brew install --cask docker ;; Linux) command -v apt-get >/dev/null 2>&1 || { echo "Автоматическая установка Docker на этой Linux-системе не поддерживается"; exit 71; }; sudo -n apt-get update && sudo -n apt-get install -y docker.io docker-compose-plugin ;; *) echo "Автоматическая установка Docker на этой платформе не поддерживается"; exit 71 ;; esac', DEFAULT_PREVIEW_CONFIG.buildTimeoutMs, signal)
        }
        await this.command(env, run, 'case "$(uname -s)" in Darwin) open -a Docker ;; Linux) sudo -n systemctl start docker || sudo -n service docker start ;; *) echo "Автоматический запуск Docker на этой платформе не поддерживается"; exit 72 ;; esac; i=0; until docker info >/dev/null 2>&1; do i=$((i+1)); [ "$i" -ge 60 ] && { echo "Docker запущен, но Engine не стал доступен за 120 секунд"; exit 70; }; sleep 2; done', 150_000, signal)
        env.state = 'stopped'; env.healthStatus = 'unknown'; env.lastError = null
        this.deps.db.setTaskPreviewReady(env.projectId, env.taskId, false)
        this.step(run, operation, 'succeeded', 'Docker готов к работе')
        run.status = 'succeeded'; run.finishedAt = this.now(); run.currentStepId = null; this.event(run, 'status', 'Операция успешно завершена'); env.updatedAt = this.now(); this.save(); return
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
      await this.publishRunManifest(env, run, sha)
      if (operation === 'start' || operation === 'rebuild') {
        await this.command(env, run, 'if ! command -v docker >/dev/null 2>&1; then echo "Docker не установлен"; exit 69; fi; if ! docker info >/dev/null 2>&1; then echo "Docker установлен, но не запущен"; exit 70; fi', 30_000, signal)
        this.step(run, 'configuration', 'succeeded', 'Конфигурация и Docker проверены')
        this.step(run, 'image', 'skipped', 'Отдельная загрузка образа не требуется; Compose управляет образами во время сборки')
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
          env.state = operation === 'rebuild' ? 'rebuilding' : 'building'; this.step(run, 'build', 'running', 'Собираем образы контейнера'); this.save()
          await this.command(env, run, 'test -f compose.preview.yml && docker compose -p "$VC_PREVIEW_PROJECT" -f compose.preview.yml config --quiet && docker compose -p "$VC_PREVIEW_PROJECT" -f compose.preview.yml build', DEFAULT_PREVIEW_CONFIG.buildTimeoutMs, signal)
          this.step(run, 'build', 'succeeded', 'Сборка завершена')
        } else if (env.builtCommitSha !== sha) {
          env.state = 'stale'; env.staleReason = 'commit_changed'
          throw new Error('Остановленное окружение относится к другому SHA; требуется пересборка')
        }
        if (run.steps.find((item) => item.id === 'build')?.status === 'pending') this.step(run, 'build', 'skipped', 'Используется уже собранный образ для текущего SHA')
        env.state = 'starting'; this.step(run, 'container', 'running', 'Создаём и запускаем контейнер'); this.save()
        await this.command(env, run, 'docker compose -p "$VC_PREVIEW_PROJECT" -f compose.preview.yml up -d --wait --wait-timeout 60', DEFAULT_PREVIEW_CONFIG.startTimeoutMs, signal)
        this.step(run, 'container', 'succeeded', 'Процесс контейнера запущен')
        this.step(run, 'port', 'running', 'Проверяем публикацию порта')
        this.step(run, 'port', 'succeeded', 'Порт опубликован')
        env.state = 'health_checking'; env.healthStatus = 'checking'; this.step(run, 'health', 'running', `Проверяем приложение по ${DEFAULT_PREVIEW_CONFIG.healthPath}`); this.save()
        await this.command(env, run, 'docker compose -p "$VC_PREVIEW_PROJECT" -f compose.preview.yml ps --status running --quiet | grep -q . && curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$VC_PREVIEW_APP_PORT/api/health" >/dev/null', DEFAULT_PREVIEW_CONFIG.healthTimeoutMs, signal)
        this.step(run, 'health', 'succeeded', 'Приложение ответило на health check')
        this.step(run, 'connection', 'running', 'Формируем адрес подключения')
        this.step(run, 'connection', 'succeeded', `Адрес подключения: ${env.appUrl ?? 'недоступен'}`)
        env.builtCommitSha = sha; env.state = 'running'; env.healthStatus = 'healthy'; env.staleReason = null
        env.storybookStatus = 'ready'; env.storybookCommitSha = sha
        env.services = env.services.map((service) => ({ ...service, state: 'running', healthStatus: 'healthy' }))
        env.startedAt = this.now(); env.stoppedAt = null
        this.step(run, 'ready', 'succeeded', 'Тестовый стенд готов')
        run.result = { readyAt: env.startedAt, containerId: env.services.find((item) => item.name === 'app')?.containerId ?? null, image: null, address: env.appUrl, cleanup: null }
        this.event(run, 'result', 'Готовность приложения подтверждена')
      } else if (operation === 'stop') {
        await this.command(env, run, 'docker compose -p "$VC_PREVIEW_PROJECT" -f compose.preview.yml stop', DEFAULT_PREVIEW_CONFIG.startTimeoutMs, signal)
        env.state = 'stopped'; env.stoppedAt = this.now(); env.healthStatus = 'unknown'
      } else if (operation === 'remove') {
        await this.command(env, run, 'docker compose -p "$VC_PREVIEW_PROJECT" -f compose.preview.yml down --volumes --remove-orphans', DEFAULT_PREVIEW_CONFIG.startTimeoutMs, signal)
        await this.cleanupManaged(run.initiator, env)
        env.state = 'removed'; env.appUrl = null; env.storybookUrl = null; env.services = []; env.healthStatus = 'unknown'
      } else if (operation === 'seed' || operation === 'reset') {
        if (!scenario || !/^[a-zA-Z0-9_-]{1,64}$/.test(scenario)) throw new Error('Некорректный сценарий тестовых данных')
        await this.command(env, run, `docker compose -p "$VC_PREVIEW_PROJECT" -f compose.preview.yml exec -T app npm run preview:${operation === 'reset' ? 'reset' : 'seed'} -- "$VC_PREVIEW_SEED"`, DEFAULT_PREVIEW_CONFIG.startTimeoutMs, signal, { VC_PREVIEW_SEED: scenario })
        env.selectedSeedScenario = scenario; env.seedVersion = sha; env.dataReady = true; env.state = 'running'; env.healthStatus = 'healthy'
      } else {
        await this.command(env, run, 'docker compose -p "$VC_PREVIEW_PROJECT" -f compose.preview.yml ps --status running --quiet | grep -q .', DEFAULT_PREVIEW_CONFIG.healthTimeoutMs, signal)
        env.state = env.builtCommitSha === sha ? 'running' : 'stale'; env.staleReason = env.state === 'stale' ? 'commit_changed' : null; env.healthStatus = 'healthy'
      }
      if (operation !== 'start' && operation !== 'rebuild') this.step(run, operation, 'succeeded', 'Операция завершена')
      this.deps.db.setTaskPreviewReady(env.projectId, env.taskId, env.state === 'running' && env.healthStatus === 'healthy')
      run.status = 'succeeded'; run.finishedAt = this.now(); run.currentStepId = null; this.event(run, 'status', 'Операция успешно завершена'); env.updatedAt = this.now(); this.save(); await this.publishReportManifest(env, run, 'success')
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : String(error))
      const cancelled = signal.aborted
      const activeStep = run.currentStepId ? run.steps.find((item) => item.id === run.currentStepId) : null
      if (activeStep?.status === 'running') this.step(run, activeStep.id, cancelled ? 'cancelled' : 'failed', cancelled ? 'Операция отменена' : 'Этап завершился ошибкой', message)
      this.skipPending(run, cancelled ? 'Не выполнено из-за отмены' : 'Не выполнено из-за ошибки предыдущего этапа')
      run.status = cancelled ? 'cancelled' : 'failed'; run.finishedAt = this.now(); run.currentStepId = null
      run.errorType = cancelled ? 'cancelled' : classify(operation, message); run.errorMessage = message
      if (cancelled && (operation === 'start' || operation === 'rebuild')) {
        let cleanupMessage: string | null = null; let cleanupSucceeded = false
        try {
          const cleanup = await this.deps.executor.run({ agentId: env.agentId, workdir: env.workspacePath, script: 'docker compose -p "$VC_PREVIEW_PROJECT" -f compose.preview.yml down --remove-orphans', timeoutMs: DEFAULT_PREVIEW_CONFIG.startTimeoutMs, env: { VC_PREVIEW_PROJECT: env.composeProject } }, () => undefined)
          cleanupSucceeded = cleanup.exitCode === 0 && !cleanup.timedOut
          cleanupMessage = cleanupSucceeded ? 'Создаваемые Compose-ресурсы удалены' : `Очистка завершилась с кодом ${cleanup.exitCode}`
        } catch (cleanupError) { cleanupMessage = redact(cleanupError instanceof Error ? cleanupError.message : String(cleanupError)) }
        run.result = { readyAt: null, containerId: null, image: null, address: null, cleanup: { attempted: true, succeeded: cleanupSucceeded, message: cleanupMessage } }
      }
      this.event(run, 'status', cancelled ? 'Операция отменена' : `Операция завершилась ошибкой: ${message}`)
      env.state = 'failed'; env.healthStatus = 'unhealthy'; env.lastError = { type: run.errorType, message }; env.updatedAt = this.now()
      this.deps.db.setTaskPreviewReady(env.projectId, env.taskId, false); this.save(); await this.publishReportManifest(env, run, cancelled ? 'cancelled' : 'failed')
    } finally { this.active.delete(env.id) }
  }
  async reconcile(): Promise<void> {
    const interrupted: Array<{ env: PreviewEnvironment; run: PreviewRun }> = []
    for (const env of this.data.environments) {
      if (env.state === 'removed' || env.state === 'not_created') continue
      if (isPreviewBusy(env.state)) {
        env.state = 'failed'; env.lastError = { type: 'connection_lost', message: 'Операция прервана рестартом сервера' }
        const run = [...env.runs].reverse().find((item) => ['queued','running','cancelling'].includes(item.status))
        if (run) { const current = run.currentStepId; if (current) this.step(run, current, 'failed', 'Сервер перезапущен во время операции', env.lastError.message); this.skipPending(run, 'Не выполнено после перезапуска сервера'); run.status = 'failed'; run.errorType = 'connection_lost'; run.errorMessage = env.lastError.message; run.finishedAt = this.now(); run.currentStepId = null; this.event(run, 'status', env.lastError.message); interrupted.push({ env, run }) }
      }
      if (!this.deps.isOnline(env.agentId)) { env.state = 'failed'; env.lastError = { type: 'machine_unavailable', message: 'Машина недоступна при reconciliation' } }
      this.deps.db.setTaskPreviewReady(env.projectId, env.taskId, env.state === 'running' && env.healthStatus === 'healthy')
    }
    this.save()
    for (const item of interrupted) await this.publishReportManifest(item.env, item.run, 'interrupted')
  }
}
