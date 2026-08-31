// Фоновый исполнитель планов канбан-ассистента: создаёт задачи, запускает
// разработку и проверки, ждёт merge и продолжает.
//
// Устроен как идемпотентный tick по образцу координатора автопрохода: каждый
// проход дочитывает состояние из БД и делает ровно то, что стало возможно.
// Поэтому рестарт сервера, отмена и параллельные события не ломают план —
// восстановление сводится к тому, чтобы снова начать тикать активные планы.

import {
  orchestrationItemReady,
  orchestrationStatusOf,
  type Orchestration,
  type OrchestrationItem
} from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { KanbanRunLaunchers } from '../mcp/kanbanMcp.js'

export const ORCHESTRATION_TICK_MS = 15_000

export interface OrchestrationManagerDeps {
  db: VoiceChatDb
  runs: () => KanbanRunLaunchers | undefined
  boardChanged?: (projectId: string) => void
  /** Прогресс плана для открытых клиентов владельца. */
  publish?: (plan: Orchestration) => void
  tickMs?: number
}

export interface OrchestrationManager {
  /**
   * Начать вести план (создан только что или подхвачен после рестарта).
   * Возвращает первый проход: вызывающий может сразу показать его результат.
   */
  track(planId: string): Promise<void>
  /** Один проход: вызывается таймером, тестом и сразу после создания плана. */
  tick(planId: string): Promise<void>
  cancel(owner: string, planId: string): Orchestration | null
  restore(): void
  dispose(): void
}

export function createOrchestrationManager(deps: OrchestrationManagerDeps): OrchestrationManager {
  const timers = new Map<string, NodeJS.Timeout>()
  // Планы, которые сейчас тикают: два одновременных прохода запустили бы один
  // и тот же шаг дважды.
  const ticking = new Set<string>()
  const tickMs = deps.tickMs ?? ORCHESTRATION_TICK_MS

  const stop = (planId: string): void => {
    const timer = timers.get(planId)
    if (timer) clearInterval(timer)
    timers.delete(planId)
  }

  /** Задача шага: своя или унаследованная от create_task, от которого он зависит. */
  const taskOf = (item: OrchestrationItem, plan: Orchestration, seen = new Set<number>()): string | null => {
    if (item.taskId) return item.taskId
    if (seen.has(item.position)) return null
    seen.add(item.position)
    for (const position of item.dependsOn) {
      const source = plan.items.find((candidate) => candidate.position === position)
      // Цепочка может быть длиннее одного шага: create_task → run_ci → wait_merge.
      const found = source ? taskOf(source, plan, seen) : null
      if (found) return found
    }
    return null
  }

  /** Ветка задачи влита: merge-ран завершился успехом. */
  const merged = (plan: Orchestration, taskId: string): boolean =>
    deps.db.listMergeRuns(plan.owner, plan.projectId, taskId, 10)
      .some((run) => run.status === 'success')

  const startItem = async (plan: Orchestration, item: OrchestrationItem): Promise<void> => {
    const db = deps.db
    const fail = (message: string): void => db.updateOrchestrationItem(item.id, { status: 'failed', error: message })

    if (item.kind === 'create_task') {
      const payload = item.payload as { columnId?: string; title?: string; description?: string; acceptanceCriteria?: string; autoPilot?: boolean }
      const board = db.getBoard(plan.owner, plan.projectId)
      const columnId = payload.columnId ?? board?.columns[0]?.id
      if (!columnId) { fail('На доске нет колонок'); return }
      try {
        const created = db.createTask(plan.owner, plan.projectId, {
          columnId,
          title: payload.title ?? item.title,
          ...(payload.description ? { description: payload.description } : {}),
          ...(payload.acceptanceCriteria ? { acceptanceCriteria: payload.acceptanceCriteria } : {}),
          ...(payload.autoPilot !== undefined ? { autoPilot: payload.autoPilot } : {})
        })
        if (!created) { fail('Создать карточку не удалось'); return }
        db.updateOrchestrationItem(item.id, { status: 'done', taskId: created.id })
        deps.boardChanged?.(plan.projectId)
      } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
      return
    }

    const taskId = taskOf(item, plan)
    if (!taskId) { fail('У шага нет задачи'); return }

    if (item.kind === 'wait_merge') {
      // Ожидание — не работа: шаг остаётся pending и проверяется каждый тик.
      if (merged(plan, taskId)) db.updateOrchestrationItem(item.id, { status: 'done', taskId })
      return
    }

    const runner = deps.runs()
    if (!runner) { fail('Менеджеры ранов недоступны'); return }
    try {
      if (item.kind === 'run_ci') {
        const payload = item.payload as { launch?: 'queue' | 'parallel'; agentId?: string }
        const started = runner.startCi(plan.owner, plan.projectId, taskId, {
          launch: payload.launch ?? 'queue',
          ...(payload.agentId ? { agentId: payload.agentId } : {})
        })
        if ('error' in started) { fail(started.error); return }
        db.updateOrchestrationItem(item.id, { status: 'running', taskId, runId: started.run.id })
        return
      }
      if (item.kind === 'run_qa') {
        const payload = item.payload as { stage?: 'component_qa' | 'integration_tests' | 'automated_qa' }
        const run = await runner.startQa(plan.owner, plan.projectId, taskId, payload.stage ?? 'automated_qa')
        db.updateOrchestrationItem(item.id, { status: 'running', taskId, runId: run.id })
        return
      }
      const payload = item.payload as { agentId?: string }
      const run = await runner.startMerge(plan.owner, plan.projectId, taskId, payload.agentId ?? null)
      db.updateOrchestrationItem(item.id, { status: 'running', taskId, runId: run.id })
    } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
  }

  /** Завершился ли запущенный шагом ран; ищем по его id среди ранов задачи. */
  const settleRunning = (plan: Orchestration, item: OrchestrationItem): void => {
    const db = deps.db
    if (!item.runId || !item.taskId) return
    if (item.kind === 'run_ci') {
      const run = db.listCiRunsForTask(plan.owner, plan.projectId, item.taskId).find((candidate) => candidate.id === item.runId)
      if (!run) return
      if (run.status === 'success') db.updateOrchestrationItem(item.id, { status: 'done' })
      else if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'timeout') {
        db.updateOrchestrationItem(item.id, { status: 'failed', error: run.error ?? `Ран завершился со статусом ${run.status}` })
      }
      return
    }
    if (item.kind === 'run_merge') {
      const run = db.listMergeRuns(plan.owner, plan.projectId, item.taskId, 10).find((candidate) => candidate.id === item.runId)
      if (!run) return
      if (run.status === 'success') db.updateOrchestrationItem(item.id, { status: 'done' })
      else if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'timeout') {
        db.updateOrchestrationItem(item.id, { status: 'failed', error: run.error ?? `Merge завершился со статусом ${run.status}` })
      }
      return
    }
    // QA-этапы: терминальные статусы у всех трёх исполнителей одинаковые.
    const stage = (item.payload as { stage?: 'component_qa' | 'integration_tests' | 'automated_qa' }).stage ?? 'automated_qa'
    const run = db.listQaStageRuns(plan.owner, plan.projectId, item.taskId, stage).find((candidate) => candidate.id === item.runId)
    if (!run) return
    if (run.status === 'success') db.updateOrchestrationItem(item.id, { status: 'done' })
    else if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'gate_failed' || run.status === 'interrupted') {
      db.updateOrchestrationItem(item.id, { status: 'failed', error: `Этап ${stage} завершился со статусом ${run.status}` })
    }
  }

  const tick = async (planId: string): Promise<void> => {
    if (ticking.has(planId)) return
    ticking.add(planId)
    try {
      let plan = deps.db.getOrchestrationById(planId)
      if (!plan || plan.status !== 'running') { stop(planId); return }
      for (const item of plan.items.filter((candidate) => candidate.status === 'running')) settleRunning(plan, item)
      // Шаги запускаются волнами: create_task завершается мгновенно, и
      // зависящий от него run_ci обязан стартовать в этом же проходе, а не
      // ждать следующего тика. Цикл прерывается, как только проход перестал
      // что-либо менять (например, wait_merge ещё ждёт), и ограничен числом
      // шагов — на случай неожиданного состояния в БД.
      for (let pass = 0; pass <= plan.items.length; pass += 1) {
        const current = deps.db.getOrchestrationById(planId)!
        const ready = current.items.filter((item) => orchestrationItemReady(item, current.items))
        if (!ready.length) break
        const before = current.items.map((item) => `${item.id}:${item.status}`).join(',')
        for (const item of ready) await startItem(current, item)
        const after = deps.db.getOrchestrationById(planId)!.items.map((item) => `${item.id}:${item.status}`).join(',')
        if (before === after) break
      }
      const updated = deps.db.getOrchestrationById(planId)!
      const status = orchestrationStatusOf(updated.items)
      if (status !== 'running') {
        const failed = updated.items.find((item) => item.status === 'failed')
        deps.db.updateOrchestrationStatus(planId, status, failed?.error ?? null)
        stop(planId)
      }
      deps.publish?.(deps.db.getOrchestrationById(planId)!)
    } finally {
      ticking.delete(planId)
    }
  }

  const track = (planId: string): Promise<void> => {
    if (!timers.has(planId)) {
      const timer = setInterval(() => { void tick(planId) }, tickMs)
      timer.unref?.()
      timers.set(planId, timer)
    }
    return tick(planId)
  }

  return {
    track,
    tick,
    cancel: (owner, planId) => {
      const cancelled = deps.db.cancelOrchestration(owner, planId)
      stop(planId)
      if (cancelled) deps.publish?.(cancelled)
      return cancelled
    },
    restore: () => {
      for (const plan of deps.db.listActiveOrchestrations()) void track(plan.id)
    },
    dispose: () => {
      for (const planId of [...timers.keys()]) stop(planId)
    }
  }
}
