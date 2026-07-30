// Процесс-глобальный менеджер CI-ранов (по образцу TurnManager): последовательный
// прогон слот-за-слотом, потоковый лог, очередь на проект + лимит на сервер,
// отмена, откат задачи при Исходе B, снапшот для восстановления после reconnect.
// Работа модели и fix-loop подключаются хуками (реальная реализация — в Срезе 4).

import type { ServerMessage, CiRun, CiRunStep, CiStatus, CiSlot, CiSlotProgress, CiCommand } from '@voicechat/shared'
import { isTerminalCiStatus } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { CommandExecutor, CiModelContext, CiFixContext, CiModelWorkHook, CiModelSummaryHook, CiFixHook, CiRunPrimitives } from './types.js'
import { isReadOnlyCommand } from './console.js'
import type { CiConsoleExecResult } from '@voicechat/shared'

export interface CiRunManagerDeps {
  db: VoiceChatDb
  executor: CommandExecutor
  /** Дёрнуть обновление доски (сводка рана на карточке). */
  boardChanged: (projectId: string) => void
  now?: () => number
  modelWork?: CiModelWorkHook
  modelSummary?: CiModelSummaryHook
  attemptFix?: CiFixHook
}

type ResumePoint = { kind: 'command'; slot: CiSlot; index: number } | { kind: 'model' }

interface ActiveRun {
  userId: string
  projectId: string
  abort: AbortController
}

export interface CiRunManager {
  start(userId: string, projectId: string, taskId: string): { run: CiRun } | { error: string }
  retryFromFailed(userId: string, runId: string, model?: { provider: 'claude' | 'codex'; model: string }): { run: CiRun } | { error: string }
  discardChangesAndRetry(userId: string, runId: string): Promise<{ run: CiRun } | { error: string }>
  cancel(userId: string, runId: string): boolean
  subscribe(listener: (m: ServerMessage, ownerUserId: string) => void): () => void
  snapshot(userId: string, runId: string): void | ServerMessage
  activeRunIds(): string[]
  consoleExec(userId: string, runId: string, command: string, editMode: boolean): Promise<CiConsoleExecResult>
}

/** Слаг из заголовка задачи для ветки/пути. */
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'task'
  )
}

export function createCiRunManager(deps: CiRunManagerDeps): CiRunManager {
  const now = deps.now ?? (() => Date.now())
  const listeners = new Set<(m: ServerMessage, ownerUserId: string) => void>()
  const active = new Map<string, ActiveRun>()
  const projectChains = new Map<string, Promise<void>>()

  // Серверный лимит одновременных ранов (значение читаем при каждом захвате).
  let running = 0
  const waiters: Array<() => void> = []
  async function acquireSlot(): Promise<void> {
    const limit = deps.db.getCiSettings().maxConcurrentRuns
    if (running < limit) {
      running++
      return
    }
    await new Promise<void>((res) => waiters.push(res))
    running++
  }
  function releaseSlot(): void {
    running--
    const next = waiters.shift()
    if (next) next()
  }

  function broadcast(m: ServerMessage, userId: string): void {
    for (const l of listeners) l(m, userId)
  }

  function emitRun(run: CiRun, userId: string): void {
    broadcast({ t: 'ci.run', runId: run.id, run }, userId)
    deps.boardChanged(run.projectId)
  }
  function emitStep(step: CiRunStep, userId: string): void {
    broadcast({ t: 'ci.step', runId: step.runId, step }, userId)
  }

  function start(userId: string, projectId: string, taskId: string): { run: CiRun } | { error: string } {
    const project = deps.db.getProject(userId, projectId)
    if (!project) return { error: 'Проект недоступен' }
    const task = deps.db.getCiTask(userId, projectId, taskId)
    if (!task) return { error: 'Задача не найдена' }
    const agentId = project.defaultAgentId
    const slots = deps.db.resolveTaskSlots(projectId, taskId)
    const llm = deps.db.resolveTaskLlmConfig(projectId, taskId)
    const total = slots.beforeModel.length + slots.afterModel.length + 2
    const run = deps.db.createCiRun({
      projectId,
      taskId,
      agentId,
      triggeredBy: userId,
      prevColumnId: task.columnId,
      llmProvider: llm.provider,
      llmModel: llm.model,
      slotProgress: { done: 0, total, phase: 'В очереди' }
    })
    const developmentColumnId = deps.db.getColumnIdBySemantic(projectId, 'development')
    if (developmentColumnId && developmentColumnId !== task.columnId) {
      deps.db.moveTask(userId, projectId, taskId, { columnId: developmentColumnId })
    }
    deps.db.addCiEvent({ projectId, runId: run.id, type: 'run.started', actorType: 'user', actorId: userId, payload: { taskId } })
    emitRun(run, userId)

    const ctl = new AbortController()
    active.set(run.id, { userId, projectId, abort: ctl })

    const prev = projectChains.get(projectId) ?? Promise.resolve()
    const chain = prev
      .then(() => acquireSlot())
      .then(() => execute(run.id, userId, ctl))
      .catch(() => {})
      .finally(() => {
        releaseSlot()
        active.delete(run.id)
      })
    projectChains.set(projectId, chain)
    return { run }
  }

  async function discardChangesAndRetry(userId: string, runId: string): Promise<{ run: CiRun } | { error: string }> {
    const detail = deps.db.getCiRun(userId, runId)
    if (!detail || detail.run.status !== 'failed') return { error: 'Действие доступно только для упавшего рана' }
    const dirtyStep = [...detail.steps].reverse().find((step) => step.kind === 'command' && step.status === 'failed' && step.exitCode === 66)
    if (!dirtyStep) return { error: 'Ран не остановлен из-за локальных изменений' }
    if ([...active.values()].some((a) => a.projectId === detail.run.projectId)) return { error: 'В проекте уже выполняется другой ран' }
    const project = deps.db.getProject(userId, detail.run.projectId)
    const task = deps.db.getCiTask(userId, detail.run.projectId, detail.run.taskId)
    const workspace = detail.run.workspaceId ? deps.db.getCiWorkspaceById(detail.run.workspaceId) : null
    if (!project || !task || !workspace || !detail.run.agentId) return { error: 'Рабочая директория рана недоступна' }
    const repoPath = `${workspace.path}/${slugify(task.title)}`
    const script = `test -d ${shq(`${repoPath}/.git`)} || { echo "Git-репозиторий не найден" >&2; exit 67; }; git -C ${shq(repoPath)} reset --hard HEAD; git -C ${shq(repoPath)} clean -fdx`
    const ctl = new AbortController()
    let result: Awaited<ReturnType<CommandExecutor['run']>>
    try {
      result = await deps.executor.run({ agentId: detail.run.agentId, script, workdir: workspace.path, env: {}, timeoutMs: 120_000, secrets: [] }, (data) => {
        const line = deps.db.appendCiLog(runId, dirtyStep.id, 'system', data)
        broadcast({ t: 'ci.log', runId, line }, userId)
      }, ctl.signal)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
    if (result.exitCode !== 0) return { error: `Не удалось откатить изменения (exit ${result.exitCode ?? 'unknown'})` }
    deps.db.addCiEvent({ projectId: detail.run.projectId, runId, type: 'workspace.discarded', actorType: 'user', actorId: userId, payload: { path: repoPath } })
    return start(userId, detail.run.projectId, detail.run.taskId)
  }

  function cancel(userId: string, runId: string): boolean {
    const a = active.get(runId)
    if (!a || a.userId !== userId) return false
    a.abort.abort()
    return true
  }

  /** Повтор с упавшего шага: тот же ран, переиспользуем рабочую директорию,
   *  перезапускаем стоп-шаг и всё после него; успешные ранее шаги сохраняются. */
  function retryFromFailed(userId: string, runId: string, model?: { provider: 'claude' | 'codex'; model: string }): { run: CiRun } | { error: string } {
    const detail = deps.db.getCiRun(userId, runId)
    if (!detail) return { error: 'Ран недоступен' }
    const run = detail.run
    if (!isTerminalCiStatus(run.status) || run.status === 'success' || run.status === 'cancelled') {
      return { error: 'Повтор с шага доступен только для упавшего рана' }
    }
    const failedModel = detail.steps
      .filter((st) => st.kind === 'model_work' && (st.status === 'failed' || st.status === 'timeout'))
      .sort((a2, b2) => b2.position - a2.position)[0]
    const failedCommand = detail.steps
      .filter((st) => st.kind === 'command' && st.commandId != null && (st.status === 'failed' || st.status === 'timeout'))
      .sort((a2, b2) => b2.position - a2.position)
      .find((st) => {
        const c = deps.db.getCiCommand(userId, st.commandId as string)
        return c ? !c.allowFailure : true
      })
    let resume: ResumePoint
    let eventPayload: Record<string, unknown>
    if (failedModel && (!failedCommand || failedModel.position > failedCommand.position)) {
      const provider = model?.provider ?? run.llmProvider
      const selectedModel = model ? model.model.trim() : run.llmModel
      if (provider !== 'claude' && provider !== 'codex') return { error: 'Неизвестный провайдер модели' }
      if (provider === 'claude' && !selectedModel) return { error: 'Модель Claude не выбрана' }
      deps.db.updateCiRun(run.id, { llmProvider: provider, llmModel: selectedModel })
      resume = { kind: 'model' }
      eventPayload = { step: 'model_work', provider, model: selectedModel }
    } else {
      if (!failedCommand || !failedCommand.slot) return { error: 'Не найден упавший шаг для повтора' }
      const failed = failedCommand
      const slot = failed.slot as CiSlot
      const slotIds = deps.db.resolveTaskSlots(run.projectId, run.taskId)[slot === 'before_model' ? 'beforeModel' : 'afterModel']
      const index = Math.max(0, slotIds.indexOf(failed.commandId as string))
      resume = { kind: 'command', slot, index }
      eventPayload = { slot, index }
    }

    const ctl = new AbortController()
    active.set(run.id, { userId, projectId: run.projectId, abort: ctl })
    deps.db.addCiEvent({ projectId: run.projectId, runId: run.id, type: 'run.retry_from_step', actorType: 'user', actorId: userId, payload: eventPayload })
    const queued = deps.db.updateCiRun(run.id, { status: 'queued' })!
    emitRun(queued, userId)

    const prev = projectChains.get(run.projectId) ?? Promise.resolve()
    const chain = prev
      .then(() => acquireSlot())
      .then(() => execute(run.id, userId, ctl, resume))
      .catch(() => {})
      .finally(() => {
        releaseSlot()
        active.delete(run.id)
      })
    projectChains.set(run.projectId, chain)
    return { run: queued }
  }

  function progress(runId: string, done: number, total: number, phase: string, userId: string): void {
    const run = deps.db.updateCiRun(runId, { slotProgress: { done, total, phase } })
    if (run) emitRun(run, userId)
  }

  // --- Выполнение одного командного шага ---
  async function runCommandStep(
    runId: string,
    userId: string,
    agentId: string | null,
    workspacePath: string,
    baseEnv: Record<string, string>,
    slot: CiSlot | null,
    position: number,
    command: CiCommand,
    initiatedBy: 'user' | 'system' | 'model',
    parentStepId: string | null,
    signal: AbortSignal
  ): Promise<{ status: CiStatus; exitCode: number | null; output: string }> {
    const step = deps.db.addCiRunStep({
      runId,
      slot,
      position,
      kind: parentStepId ? 'model_command' : 'command',
      parentStepId,
      initiatedBy,
      commandId: command.id,
      commandSnapshot: command.script,
      title: command.name,
      workdir: command.workdir || null,
      status: 'running'
    })
    const started = now()
    deps.db.updateCiRunStep(step.id, { startedAt: started })
    emitStep({ ...step, status: 'running', startedAt: started }, userId)

    const cwd = command.workdir ? `${workspacePath}/${command.workdir}` : workspacePath
    const settings = deps.db.getCiSettings()
    const timeoutMs = (command.timeoutSec ?? settings.defaultStepTimeoutSec) * 1000
    const collected: string[] = []
    const onChunk = (data: string): void => {
      collected.push(data)
      const line = deps.db.appendCiLog(runId, step.id, 'stdout', data)
      broadcast({ t: 'ci.log', runId, line }, userId)
    }
    let exitCode: number | null = null
    let timedOut = false
    try {
      if (!agentId) throw new Error('У проекта не задана машина по умолчанию для выполнения')
      const res = await deps.executor.run({ agentId, script: command.script, workdir: cwd, env: { ...baseEnv, ...command.env }, timeoutMs, secrets: [] }, onChunk, signal)
      exitCode = res.exitCode
      timedOut = res.timedOut
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const line = deps.db.appendCiLog(runId, step.id, 'system', msg + '\n')
      broadcast({ t: 'ci.log', runId, line }, userId)
      exitCode = null
    }
    const finished = now()
    const status: CiStatus = timedOut ? 'timeout' : exitCode === 0 ? 'success' : 'failed'
    const updated = deps.db.updateCiRunStep(step.id, { status, exitCode, finishedAt: finished, durationMs: finished - started })
    if (updated) emitStep(updated, userId)
    if (status === 'success' && command.isCleanup) {
      const run = deps.db.getCiRunRaw(runId)
      if (run?.workspaceId) deps.db.releaseCiWorkspace(run.workspaceId, step.id)
    }
    return { status, exitCode, output: collected.join('') }
  }

  function makePrimitives(runId: string, userId: string, agentId: string | null, workspacePath: string, env: Record<string, string>, signal: AbortSignal): CiRunPrimitives {
    return {
      runId,
      agentId,
      workspacePath,
      env,
      addStep: (a) => {
        const steps = deps.db.getCiRun(userId, runId)?.steps ?? []
        const position = steps.length
        const step = deps.db.addCiRunStep({ runId, slot: a.slot, position, kind: a.kind, parentStepId: a.parentStepId ?? null, initiatedBy: a.initiatedBy ?? 'model', commandId: a.commandId ?? null, commandSnapshot: a.commandSnapshot ?? null, title: a.title, workdir: a.workdir ?? null, status: 'running' })
        emitStep(step, userId)
        return step
      },
      finishStep: (stepId, status, exitCode) => {
        const upd = deps.db.updateCiRunStep(stepId, { status, exitCode: exitCode ?? null, finishedAt: now() })
        if (upd) emitStep(upd, userId)
      },
      log: (stepId, stream, chunk) => {
        const line = deps.db.appendCiLog(runId, stepId, stream, chunk)
        broadcast({ t: 'ci.log', runId, line }, userId)
      },
      runCommandById: async (commandId, parentStepId) => {
        const command = deps.db.getCiCommand(userId, commandId)
        if (!command) return { exitCode: null, timedOut: false, output: 'Команда не найдена' }
        const steps = deps.db.getCiRun(userId, runId)?.steps ?? []
        const r = await runCommandStep(runId, userId, agentId, workspacePath, env, null, steps.length, command, 'model', parentStepId, signal)
        return { exitCode: r.exitCode, timedOut: r.status === 'timeout', output: r.output }
      },
      recordFix: (a) => {
        const attempt = deps.db.addCiFixAttempt(a)
        broadcast({ t: 'ci.fix', runId, attempt }, userId)
      },
      suggest: (commandId, runStepId, reason, proposedScript) => {
        deps.db.addCiSuggestion({ commandId, runStepId, reason, proposedScript })
      }
    }
  }

  async function execute(runId: string, userId: string, ctl: AbortController, resume?: ResumePoint): Promise<void> {
    const runRow = deps.db.getCiRunRaw(runId)
    if (!runRow) return
    const project = deps.db.getProject(userId, runRow.projectId)
    const task = deps.db.getCiTask(userId, runRow.projectId, runRow.taskId)
    if (!project || !task) {
      finalize(runId, userId, 'failed')
      return
    }
    const agentId = project.defaultAgentId
    const machine = project.machines.find((m) => m.agentId === agentId)
    const repoRoot = machine?.featureReposRoot?.replace(/\/$/, '') || ''
    const projectSlug = slugify(project.name)
    const taskNumber = String(task.seq ?? 0)
    const slug = slugify(task.title)
    const branch = (project.ciBranchTemplate || 'feature/{task_number}-{slug}').replace('{task_number}', taskNumber).replace('{slug}', slug)
    const workspacePath = `${repoRoot}/${projectSlug}/${taskNumber}`
    const env: Record<string, string> = {
      TASK_NUMBER: taskNumber,
      TASK_KEY: `${projectSlug}-${taskNumber}`,
      SLUG: slug,
      BRANCH: branch,
      BASE_BRANCH: project.ciBaseBranch || 'main',
      REPO_URL: project.gitUrl ?? '',
      REPO_ROOT: repoRoot,
      WORKSPACE: workspacePath,
      PROJECT: projectSlug
    }
    const signal = ctl.signal

    const started = now()
    let run = deps.db.updateCiRun(runId, { status: 'running', startedAt: started })!
    emitRun(run, userId)

    // Рабочая директория: подготовка по стратегии повтора + запись workspace.
    const strategy = project.ciReuseStrategy || 'fail'
    const prep = strategy === 'clean' ? `rm -rf ${shq(workspacePath)}; mkdir -p ${shq(workspacePath)}` : strategy === 'fail' ? `if [ -d ${shq(workspacePath)} ] && [ -n "$(ls -A ${shq(workspacePath)} 2>/dev/null)" ]; then echo "Рабочая директория уже существует (стратегия fail)" >&2; exit 65; fi; mkdir -p ${shq(workspacePath)}` : `mkdir -p ${shq(workspacePath)}`
    if (!resume) {
      // Новый ран: создаём запись рабочей директории. При повторе — переиспользуем.
      const ws = deps.db.createCiWorkspace({ projectId: runRow.projectId, taskId: runRow.taskId, agentId: agentId ?? null, path: workspacePath })
      deps.db.updateCiRun(runId, { workspaceId: ws.id })
    }

    const slots = deps.db.resolveTaskSlots(runRow.projectId, runRow.taskId)
    const total = slots.beforeModel.length + slots.afterModel.length + 2
    const beforeLen = slots.beforeModel.length
    // Точка возобновления при «повторе с упавшего шага»: сколько шагов уже пройдено
    // и с какого номера нумеровать новые шаги (чтобы не пересекаться со старыми).
    let done = resume ? (resume.kind === 'model' ? beforeLen : resume.slot === 'before_model' ? resume.index : beforeLen + 1 + resume.index) : 0
    const posBase = resume ? (deps.db.getCiRun(userId, runId)?.steps.length ?? 0) : 0

    // Системный шаг подготовки директории (пропускаем при повторе — директория есть).
    if (!resume && repoRoot && agentId) {
      const prepStep = deps.db.addCiRunStep({ runId, slot: 'before_model', position: 0, kind: 'command', initiatedBy: 'system', title: 'Подготовка рабочей директории', status: 'running' })
      emitStep(prepStep, userId)
      const ps = now()
      try {
        const r = await deps.executor.run({ agentId, script: prep, workdir: repoRoot, env, timeoutMs: 60_000, secrets: [] }, (d) => {
          const line = deps.db.appendCiLog(runId, prepStep.id, 'stdout', d)
          broadcast({ t: 'ci.log', runId, line }, userId)
        }, signal)
        const st: CiStatus = r.exitCode === 0 ? 'success' : 'failed'
        const upd = deps.db.updateCiRunStep(prepStep.id, { status: st, exitCode: r.exitCode, finishedAt: now(), durationMs: now() - ps })!
        emitStep(upd, userId)
        if (st !== 'success') {
          rollbackAndFail(runId, userId, runRow.prevColumnId, 'script_error')
          return
        }
      } catch {
        deps.db.updateCiRunStep(prepStep.id, { status: 'failed', finishedAt: now() })
        rollbackAndFail(runId, userId, runRow.prevColumnId, 'no_access')
        return
      }
    }

    // Хелпер обработки одного слота команд.
    const runSlot = async (slot: CiSlot, commandIds: string[], phaseLabel: string, startIndex = 0): Promise<boolean> => {
      for (let i = startIndex; i < commandIds.length; i++) {
        if (signal.aborted) {
          finalize(runId, userId, 'cancelled')
          return false
        }
        progress(runId, done, total, `${phaseLabel} (${i + 1}/${commandIds.length})`, userId)
        const command = deps.db.getCiCommand(userId, commandIds[i])
        if (!command) {
          done++
          continue
        }
        const res = await runCommandStep(runId, userId, agentId, workspacePath, env, slot, posBase + done + 1, command, 'user', null, signal)
        if (res.status !== 'success' && !command.allowFailure) {
          // fix-loop (если подключён) на упавший шаг.
          const fixed = await tryFix(runId, userId, agentId, workspacePath, env, project, task, signal)
          if (!fixed) {
            const failStatus = res.status === 'timeout' ? 'timeout' : 'failed'
            if (slot === 'before_model') {
              // Слот «до» упал → модель не стартует. Откат задачи.
              rollbackAndFail(runId, userId, runRow.prevColumnId, 'script_error', failStatus)
              return false
            }
            // Слот «после» упал → ран failed, но резюме всё равно сформируется.
            deps.db.updateCiRun(runId, { status: failStatus })
            return false
          }
        }
        done++
      }
      return true
    }

    // 1) Слот «до».
    const beforeOk = await runSlot('before_model', slots.beforeModel, 'Подготовка', resume?.kind === 'command' && resume.slot === 'before_model' ? resume.index : resume ? slots.beforeModel.length : 0)
    if (!beforeOk) return
    if (signal.aborted) return finalize(runId, userId, 'cancelled')

    // 2) Работа модели (при повторе из слота «после» — уже сделана, пропускаем).
    const prim = makePrimitives(runId, userId, agentId, workspacePath, env, signal)
    let modelOk = true
    if (!(resume?.kind === 'command' && resume.slot === 'after_model')) {
      progress(runId, done, total, 'Модель работает', userId)
      const mwStep = deps.db.addCiRunStep({ runId, slot: null, position: posBase + done + 1, kind: 'model_work', initiatedBy: 'system', title: 'Работа модели', status: 'running' })
      emitStep(mwStep, userId)
      const mwStart = now()
      if (deps.modelWork) {
        const ctx: CiModelContext = { ...prim, run: deps.db.getCiRunRaw(runId)!, task, project, parentStepId: mwStep.id }
        try {
          modelOk = (await deps.modelWork(ctx)).ok
        } catch {
          modelOk = false
        }
      } else {
        const line = deps.db.appendCiLog(runId, mwStep.id, 'system', 'Работа модели пропущена (хук не подключён)\n')
        broadcast({ t: 'ci.log', runId, line }, userId)
      }
      const upd = deps.db.updateCiRunStep(mwStep.id, { status: modelOk ? 'success' : 'failed', finishedAt: now(), durationMs: now() - mwStart })!
      emitStep(upd, userId)
      if (!modelOk) {
        progress(runId, done, total, 'Ошибка модели — выберите другую модель и повторите шаг', userId)
        finalize(runId, userId, 'failed')
        return
      }
      done++
    }

    // 3) Слот «после» запускается только после успешной работы модели.
    let afterFailed = false
    if (signal.aborted) return finalize(runId, userId, 'cancelled')
    const afterOk = await runSlot('after_model', slots.afterModel, 'Финальные команды', resume?.kind === 'command' && resume.slot === 'after_model' ? resume.index : 0)
    if (!afterOk && !signal.aborted) afterFailed = true

    // 4) Резюме модели.
    if (!signal.aborted) {
      progress(runId, done, total, 'Резюме', userId)
      const sumStep = deps.db.addCiRunStep({ runId, slot: null, position: posBase + done + 1, kind: 'model_summary', initiatedBy: 'system', title: 'Резюме модели', status: 'running' })
      emitStep(sumStep, userId)
      let summaryText = 'Ран завершён.'
      if (deps.modelSummary) {
        const ctx: CiModelContext = { ...prim, run: deps.db.getCiRunRaw(runId)!, task, project, parentStepId: sumStep.id }
        try {
          summaryText = await deps.modelSummary(ctx)
        } catch {
          summaryText = 'Резюме недоступно.'
        }
      }
      const line = deps.db.appendCiLog(runId, sumStep.id, 'system', summaryText + '\n')
      broadcast({ t: 'ci.log', runId, line }, userId)
      const upd = deps.db.updateCiRunStep(sumStep.id, { status: 'success', finishedAt: now() })!
      emitStep(upd, userId)
      done++
    }

    if (signal.aborted) return finalize(runId, userId, 'cancelled')
    if (afterFailed) {
      rollbackTask(runId, userId, runRow.prevColumnId)
      finalize(runId, userId, 'failed')
    } else {
      finalize(runId, userId, modelOk ? 'success' : 'failed')
    }
  }

  async function tryFix(
    runId: string,
    userId: string,
    agentId: string | null,
    workspacePath: string,
    env: Record<string, string>,
    project: import('@voicechat/shared').ProjectDetail,
    task: import('@voicechat/shared').Task,
    signal: AbortSignal
  ): Promise<boolean> {
    if (!deps.attemptFix) return false
    const detail = deps.db.getCiRun(userId, runId)
    const failedStep = detail?.steps.slice().reverse().find((s) => s.status === 'failed' || s.status === 'timeout')
    if (!failedStep) return false
    const prim = makePrimitives(runId, userId, agentId, workspacePath, env, signal)
    const logTail = deps.db.getCiRunLog(userId, runId).filter((l) => l.stepId === failedStep.id).slice(-40).map((l) => l.chunk).join('')
    const ctx: CiFixContext = {
      ...prim,
      run: deps.db.getCiRunRaw(runId)!,
      task,
      project,
      parentStepId: failedStep.id,
      failedStep,
      logTail,
      rerunFailedStep: async () => {
        const command = failedStep.commandId ? deps.db.getCiCommand(userId, failedStep.commandId) : null
        if (!command) return { exitCode: null, timedOut: false }
        const r = await runCommandStep(runId, userId, agentId, workspacePath, env, failedStep.slot, failedStep.position, command, 'model', null, signal)
        return { exitCode: r.exitCode, timedOut: r.status === 'timeout' }
      }
    }
    try {
      const r = await deps.attemptFix(ctx)
      if (r.fixed) deps.db.updateCiRunStep(failedStep.id, { fixedByModel: true, status: 'success' })
      return r.fixed
    } catch {
      return false
    }
  }

  function rollbackTask(runId: string, userId: string, prevColumnId: string | null): void {
    const run = deps.db.getCiRunRaw(runId)
    if (!run || !prevColumnId) return
    try {
      deps.db.moveTask(userId, run.projectId, run.taskId, { columnId: prevColumnId })
    } catch {
      /* колонка могла исчезнуть — не критично */
    }
  }

  function rollbackAndFail(runId: string, userId: string, prevColumnId: string | null, _failureClass: string, status: CiStatus = 'failed'): void {
    rollbackTask(runId, userId, prevColumnId)
    finalize(runId, userId, status)
  }

  function finalize(runId: string, userId: string, status: CiStatus): void {
    const run0 = deps.db.getCiRunRaw(runId)
    const finished = now()
    const durationMs = run0?.startedAt ? finished - run0.startedAt : null
    const run = deps.db.updateCiRun(runId, { status, finishedAt: finished, durationMs: durationMs ?? undefined })
    if (run) {
      deps.db.addCiEvent({ projectId: run.projectId, runId, type: 'run.finished', actorType: 'system', payload: { status } })
      broadcast({ t: 'ci.done', runId, run }, userId)
      deps.boardChanged(run.projectId)
    }
  }

  function subscribe(listener: (m: ServerMessage, ownerUserId: string) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function snapshot(userId: string, runId: string): void | ServerMessage {
    const detail = deps.db.getCiRun(userId, runId)
    if (!detail) return
    const log = deps.db.getCiRunLog(userId, runId)
    return { t: 'ci.snapshot', runId, detail, log }
  }

  function activeRunIds(): string[] {
    return [...active.keys()]
  }

  async function consoleExec(userId: string, runId: string, command: string, editMode: boolean): Promise<CiConsoleExecResult> {
    const detail = deps.db.getCiRun(userId, runId)
    if (!detail) return { output: '', exitCode: null, rejected: true, message: 'Ран недоступен' }
    const run = detail.run
    if (editMode) {
      const owner = deps.db.getProject(userId, run.projectId)?.role === 'owner'
      if (!owner) return { output: '', exitCode: null, rejected: true, message: 'Режим редактирования — только для владельца проекта' }
      deps.db.addCiEvent({ projectId: run.projectId, runId, type: 'console.exec.edit', actorType: 'user', actorId: userId, payload: { command } })
    } else if (!isReadOnlyCommand(command)) {
      return { output: '', exitCode: null, rejected: true, message: 'В режиме только для чтения разрешён ограниченный набор команд (ls, cat, git status/log, …)' }
    }
    const ws = run.workspaceId ? deps.db.getCiWorkspaceById(run.workspaceId) : null
    const cwd = ws?.path ?? ''
    if (!run.agentId) return { output: '', exitCode: null, rejected: true, message: 'У рана нет машины выполнения' }
    const chunks: string[] = []
    try {
      const res = await deps.executor.run({ agentId: run.agentId, script: command, workdir: cwd, env: {}, timeoutMs: 30_000, secrets: [] }, (d) => chunks.push(d))
      return { output: chunks.join(''), exitCode: res.exitCode, rejected: false, message: '' }
    } catch (err) {
      return { output: chunks.join(''), exitCode: null, rejected: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  return { start, retryFromFailed, discardChangesAndRetry, cancel, subscribe, snapshot, activeRunIds, consoleExec }
}

/** shell-quote для системных префиксов раннера. */
function shq(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`
}
