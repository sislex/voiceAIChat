// Лента одного CI-рана: таймлайн разворачиваемых шагов (иконка статуса, таймер/
// длительность, exit_code, потоковый лог с автоскроллом), вызовы команд модели
// вложены под model_work, последний элемент — итог модели. Подписка на realtime
// при монтировании, отписка при закрытии; REST-подгрузка как фолбэк.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CiRunDetail, CiRunStep, CiLogLine, CiRunConclusion, CiInteraction, CiInteractionAnswer } from '@shared/ci'
import { DEFAULT_CI_CLAUDE_MODEL, isTerminalCiStatus } from '@shared/ci'
import type { LlmEngineOption } from '@shared/admin'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { TaskPreparationStep } from '@shared/qa'
import { allowedModels, isProviderAllowed } from '@shared/llmAccess'
import type { CiMetrics } from '../../remote/ciBridge'
import { ciLlmLabel, ciStageLabel, ciStatusIcon, ciStatusLabel, ciTone, fmtDuration } from './ciFormat'
import { CiConsole } from './CiConsole'
import { QuestionsForm } from '../QuestionsForm'
import { Button } from '@voicechat/ui-kit'
import { IconButton } from '@voicechat/ui-kit'
import { useConfirm } from '@voicechat/ui-kit'
import { Skeleton, RefreshIndicator } from '@voicechat/ui-kit'
import { EmptyState } from '@voicechat/ui-kit'
import { ErrorState } from '@voicechat/ui-kit'
import { loadView, type LoadStatus } from '../../lib/loadState'
import { useCommandSource } from '../../lib/useCommands'
import { KbUsageBrief } from '../kb/KbUsageBrief'
import { useRemoteReport } from '../../lib/useRemoteReport'

export function PreparationRunSteps({ steps, fallback }: { steps: TaskPreparationStep[]; fallback: string }): JSX.Element {
  return <ol className="ci-step-list" data-testid="task-preparation-feed" aria-live="polite">
    {steps.map((step) => <li key={step.id} className="ci-step">
      <details>
        <summary className="ci-step-head"><span className="ci-step-title">{step.name}</span><span className="ci-lozenge">{step.status}</span><span className="ci-step-dur">{step.durationMs == null ? '—' : fmtDuration(step.durationMs)}</span></summary>
        {step.error && <p role="alert">{step.error}</p>}
        <pre className="ci-console-pre">{step.log.map((event) => event.text).join('') || 'Лог шага пуст.'}</pre>
      </details>
    </li>)}
    {!steps.length && <li>{fallback}</li>}
  </ol>
}

export interface RunFeedCache {
  detail: CiRunDetail | null
  log: CiLogLine[]
  conclusion: CiRunConclusion | null
  /** Ошибка последней загрузки ленты: экран ошибки с «Повторить» вместо пустоты. */
  error?: string | null
  /** Идёт REST-подгрузка ленты: до первых шагов — скелетон, дальше — индикатор. */
  loading?: boolean
}

export interface RunFeedProps {
  runId: string
  cache: RunFeedCache | undefined
  metrics?: CiMetrics | null
  engines?: LlmEngineOption[]
  llmAccess?: UserLlmAccess[]
  onSubscribe: (runId: string) => void
  onUnsubscribe: (runId: string) => void
  onLoad: (runId: string) => void
  onRetry: (runId: string) => void
  onRetryFromStep?: (runId: string, selection?: { provider: 'claude' | 'codex'; model: string; llmEngineId?: string | null }) => void
  onDiscardAndRetry?: (runId: string) => void
  onCancel: (runId: string) => void
  onLoadMetrics?: (projectId: string) => void
  /** Ответить на паузу рана: уточнение модели или решение по плану. */
  onAnswerInteraction?: (runId: string, interactionId: string, answer: CiInteractionAnswer) => void
  now?: () => number
  download?: (filename: string, text: string) => void
}

/** Слово-подтверждение для необратимого отката рабочего репозитория. */
const DISCARD_CONFIRM_WORD = 'откатить'

function defaultDownload(filename: string, text: string): void {
  try {
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    /* headless */
  }
}

export function RunFeed(props: RunFeedProps): JSX.Element {
  const { runId, cache } = props
  const confirm = useConfirm()
  const now = props.now ?? Date.now
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [autoscroll, setAutoscroll] = useState(true)
  const feedRef = useRef<HTMLDivElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  // Поток лога может молчать минутами: отдельный тик двигает длительность шага
  // и всего рана, не дожидаясь следующего серверного кадра.
  const [, setClockTick] = useState(0)
  const [llmEngineId, setLlmEngineId] = useState<string | null>(null)
  const [modelProvider, setModelProvider] = useState<'claude' | 'codex'>('claude')
  const [modelName, setModelName] = useState<string>(DEFAULT_CI_CLAUDE_MODEL)
  const loadedMetricsFor = useRef<string | null>(null)

  useEffect(() => {
    props.onSubscribe(runId)
    props.onLoad(runId)
    return () => props.onUnsubscribe(runId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const detail = cache?.detail ?? null
  const run = detail?.run ?? null
  const log = cache?.log ?? []
  const loadError = cache?.error ?? null
  // Лента приходит и пушем, и REST-подгрузкой: скелетон — только пока шагов нет,
  // дальше обновления не подменяют содержимое (см. lib/loadState.ts).
  const status: LoadStatus = cache?.loading ? 'loading' : loadError ? 'error' : detail ? 'ready' : 'loading'
  const view = loadView(status, detail != null)

  useEffect(() => {
    if (!run) return
    setLlmEngineId(run.llmEngineId ?? null)
    setModelProvider(run.llmProvider)
    setModelName(run.llmModel)
  }, [run?.id, run?.llmEngineId, run?.llmProvider, run?.llmModel])

  // Метрики (текущее vs типичное) — по projectId рана, один раз.
  useEffect(() => {
    if (run && props.onLoadMetrics && loadedMetricsFor.current !== run.projectId) {
      loadedMetricsFor.current = run.projectId
      props.onLoadMetrics(run.projectId)
    }
  }, [run, props])

  const topSteps = useMemo(() => {
    const steps = [...(detail?.steps ?? [])].sort((a, b) => a.position - b.position)
    const roots = steps.filter((s) => !s.parentStepId)
    const childrenOf = (id: string): CiRunStep[] => steps.filter((s) => s.parentStepId === id)
    return { roots, childrenOf }
  }, [detail])

  const running = run ? !isTerminalCiStatus(run.status) : false
  const executionLlm = detail?.executionLlm ?? (run ? {
    source: 'run' as const, stage: null, llmEngineId: run.llmEngineId ?? null,
    provider: run.llmProvider, model: run.llmModel || null,
    base: { llmEngineId: run.llmEngineId ?? null, provider: run.llmProvider, model: run.llmModel || null }
  } : null)
  const baseLlm = executionLlm?.base ?? null
  const executionDiffersFromBase = executionLlm?.source === 'stage'
    && (executionLlm.provider !== baseLlm?.provider || executionLlm.model !== baseLlm?.model)

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setClockTick((tick) => tick + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [running])

  // Отчёт по БЗ читаем один раз на ран и ещё раз, когда ран завершился: пока он
  // идёт, обращения копятся, и промежуточные цифры быстро устаревают.
  const kbUsage = useRemoteReport(
    () => window.ci?.getRunKbUsage(runId),
    [runId, running]
  )

  // Команда экрана в общем реестре: пока лента рана на экране, «Повторить
  // последний ран» доступен из палитры. Незавершённый ран повторять нечего —
  // тогда команда выключена (в шпаргалке её нет: у неё нет комбинации).
  useCommandSource(() => {
    if (!run) return []
    return [
      {
        id: 'ci.retry-run',
        title: 'Повторить последний ран',
        section: 'action',
        hint: `Задача ${run.taskId}`,
        keywords: ['ci', 'retry', 'перезапустить'],
        enabled: () => isTerminalCiStatus(run.status),
        run: () => props.onRetry(run.id)
      }
    ]
  })
  const logByStep = useMemo(() => {
    const m = new Map<string, CiLogLine[]>()
    for (const l of log) {
      const arr = m.get(l.stepId) ?? []
      arr.push(l)
      m.set(l.stepId, arr)
    }
    return m
  }, [log])

  const logText = (): string =>
    log.map((l) => `[${new Date(l.at).toISOString()}] ${l.stream}: ${l.chunk}`).join('\n')

  useEffect(() => {
    if (autoscroll && typeof endRef.current?.scrollIntoView === 'function') endRef.current.scrollIntoView({ block: 'end' })
  }, [autoscroll, log.length, detail?.steps.length, detail?.interactions?.length])

  const onFeedScroll = (): void => {
    const element = feedRef.current
    if (!element) return
    setAutoscroll(element.scrollHeight - element.scrollTop - element.clientHeight < 32)
  }

  const jumpToNew = (): void => {
    setAutoscroll(true)
    if (typeof endRef.current?.scrollIntoView === 'function') endRef.current.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }

  const download = props.download ?? defaultDownload
  const [consoleOpen, setConsoleOpen] = useState(false)

  const metricFor = (commandId: string | null): number | null => {
    if (!commandId || !props.metrics) return null
    return props.metrics.commands.find((c) => c.commandId === commandId)?.medianMs ?? null
  }

  // Паузы группируем по шагу, чтобы вопрос показывался внутри «Работы модели».
  const interactionsByStep = useMemo(() => {
    const map = new Map<string, CiInteraction[]>()
    for (const it of detail?.interactions ?? []) {
      const list = map.get(it.stepId) ?? []
      list.push(it)
      map.set(it.stepId, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.seq - b.seq)
    return map
  }, [detail?.interactions])
  const interactionsOf = (stepId: string): CiInteraction[] => interactionsByStep.get(stepId) ?? []

  // Меню моделей для повтора работы модели — общая форма обоих списков.
  const access = props.llmAccess ?? []
  const retryModels: Array<{ id: string; label: string }> = modelProvider === 'codex' ? allowedModels(access, 'codex') : allowedModels(access, 'claude')

  const renderStep = (step: CiRunStep, nested: boolean): JSX.Element => {
    const hasPending = interactionsOf(step.id).some((it) => it.status === 'pending')
    const open = expanded[step.id] ?? (hasPending || step.status === 'running' || step.status === 'failed')
    const tone = ciTone(step.status)
    const lines = logByStep.get(step.id) ?? []
    const fixes = (detail?.fixAttempts ?? []).filter((attempt) => attempt.runStepId === step.id)
    const typical = metricFor(step.commandId)
    const elapsed = step.startedAt ? (step.finishedAt ?? now()) - step.startedAt : null
    const pct = typical && elapsed ? Math.min(100, Math.round((elapsed / typical) * 100)) : null
    return (
      <li key={step.id} className={`ci-step${nested ? ' ci-step--nested' : ''}`}>
        <button className="ci-step-head" aria-expanded={open} onClick={() => setExpanded((e) => ({ ...e, [step.id]: !open }))}>
          <span className={`ci-step-icon ci-step-icon--${tone}`}>{ciStatusIcon(step.status)}</span>
          <span className="ci-step-title">{step.title}</span>
          {step.exitCode != null && step.exitCode !== 0 && <span className="ci-lozenge ci-lozenge--removed">exit {step.exitCode}</span>}
          {step.fixedByModel && <span className="ci-lozenge ci-lozenge--success">исправлено моделью</span>}
          <span className="ci-step-dur">{step.status === 'running' && elapsed != null ? fmtDuration(elapsed) : fmtDuration(step.durationMs)}</span>
        </button>
        {open && (
          <div className="ci-step-body">
            {typical != null && (
              <>
                <div className="ci-step-dur">Типично: {fmtDuration(typical)}{pct != null ? ` · текущее ${pct}%` : ''}</div>
                {pct != null && <div className="ci-metric-bar"><div className="ci-metric-fill" style={{ width: `${pct}%` }} /></div>}
              </>
            )}
            {lines.length > 0 && (
              <StepLog lines={lines} autoscroll={autoscroll} />
            )}
            {fixes.map((attempt) => (
              <section key={attempt.id} className="ci-fix-attempt" data-testid="ci-fix-attempt">
                <strong>Исправление {attempt.attemptNo}: {attempt.diagnosis || 'диагноз не указан'}</strong>
                <div>{attempt.action}</div>
                {attempt.changedFiles.length > 0 && <div>Изменённые файлы: {attempt.changedFiles.join(', ')}</div>}
                {attempt.failures.length > 0 && (
                  <ul>{attempt.failures.map((failure, index) => <li key={`${attempt.id}-failure-${index}`}>{failure.file ?? failure.packageName ?? 'Проверка'}{failure.testName ? ` · ${failure.testName}` : ''}: {failure.message}</li>)}</ul>
                )}
                {attempt.targetedTests.length > 0 && (
                  <ul>{attempt.targetedTests.map((test, index) => <li key={`${attempt.id}-test-${index}`}><code>{test.command}</code> — {test.timedOut ? 'таймаут' : `exit ${test.exitCode ?? '?'}`}</li>)}</ul>
                )}
                {attempt.fullRerun && <div>Полный повтор: {attempt.fullRerun.timedOut ? 'таймаут' : `exit ${attempt.fullRerun.exitCode ?? '?'}`}</div>}
              </section>
            ))}
            {interactionsOf(step.id).map((it) => (
              <InteractionCard
                key={it.id}
                interaction={it}
                disabled={!props.onAnswerInteraction}
                onAnswer={(answer) => props.onAnswerInteraction?.(runId, it.id, answer)}
              />
            ))}
            {step.kind === 'model_work' && step.status === 'failed' && run?.status === 'failed' && (
              <div className="ci-model-retry" data-testid="ci-model-retry">
                <strong>Модель завершилась с ошибкой. Финальные команды не запускались.</strong>
                <label>
                  Исполнитель
                  <select className="sel" aria-label="Исполнитель CI-рана" value={llmEngineId ?? ''} onChange={(e) => {
                    const id = e.target.value || null
                    setLlmEngineId(id)
                    const engine = props.engines?.find((item) => item.id === id)
                    if (engine) { setModelProvider(engine.kind); setModelName(engine.kind === 'codex' ? '' : DEFAULT_CI_CLAUDE_MODEL) }
                  }}>
                    <option value="">По умолчанию для роли</option>
                    {(props.engines ?? []).filter((engine) => isProviderAllowed(access, engine.kind)).map((engine) => <option key={engine.id} value={engine.id}>{engine.name} · {engine.kind}</option>)}
                  </select>
                </label>
                <label>
                  Провайдер
                  <select className="sel" value={modelProvider} onChange={(e) => {
                    const provider = e.target.value === 'codex' ? 'codex' : 'claude'
                    setModelProvider(provider)
                    setModelName(provider === 'codex' ? '' : DEFAULT_CI_CLAUDE_MODEL)
                  }}>
                    <option value="claude">Claude</option>
                    <option value="codex">Codex</option>
                  </select>
                </label>
                <label>
                  Модель
                  <select className="sel" value={modelName} onChange={(e) => setModelName(e.target.value)}>
                    {/* Модель рана может быть не из меню (дефолт CI, старая настройка,
                        пустая строка = модель из config.toml codex) — иначе селект
                        показал бы первый пункт, а повтор ушёл бы с другой моделью. */}
                    {!retryModels.some((m) => m.id === modelName) && (
                      <option value={modelName}>{modelName || 'По умолчанию (из codex)'}</option>
                    )}
                    {retryModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </label>
                <Button disabled={!props.onRetryFromStep || (modelProvider === 'claude' && !modelName)} onClick={() => props.onRetryFromStep?.(runId, { provider: modelProvider, model: modelName, ...(llmEngineId ? { llmEngineId } : {}) })}>
                  Повторить работу модели
                </Button>
              </div>
            )}
            {step.kind === 'command' && step.status === 'failed' && step.exitCode === 66 && run?.status === 'failed' && (
              <div className="ci-model-retry" data-testid="ci-dirty-workspace">
                <strong>Рабочая копия осталась с локальными изменениями — возможно, предыдущий ран был отменён до автоматической очистки.</strong>
                <span>Сохраните файлы для диагностики либо сбросьте рабочую копию и запустите workflow заново.</span>
                <Button disabled={!props.onDiscardAndRetry} onClick={() => {
                  // Файлы уходят безвозвратно — просим набрать слово, а не просто «ОК».
                  void confirm({
                    title: 'Откатить изменения и начать заново?',
                    message: 'Все незакоммиченные и неотслеживаемые файлы в рабочем репозитории будут удалены. Продолжить?',
                    variant: 'danger',
                    confirmLabel: 'Откатить и начать заново',
                    requireText: DISCARD_CONFIRM_WORD
                  }).then((ok) => {
                    if (ok) props.onDiscardAndRetry?.(runId)
                  })
                }}>
                  Сбросить рабочую копию
                </Button>
              </div>
            )}
            {topSteps.childrenOf(step.id).length > 0 && (
              <ul className="ci-steps ci-steps--nested">
                {topSteps.childrenOf(step.id).map((child) => renderStep(child, true))}
              </ul>
            )}
          </div>
        )}
      </li>
    )
  }

  return (
    <>
    <div className="ci-runfeed" data-testid="ci-runfeed" ref={feedRef} onScroll={onFeedScroll}>
      <div className="ci-runfeed-head">
        <span className={`ci-lozenge ci-lozenge--${run ? ciTone(run.status) : 'neutral'}`}>
          {run ? ciStatusLabel(run.status) : 'загрузка…'}
        </span>
        {run?.agentSelectionSource === 'explicit_bypass' && (
          <span className="ci-lozenge ci-lozenge--removed" title="Этот запуск не учитывает maxConcurrentRuns">мимо очереди</span>
        )}
        {run && (
          <span className="ci-run-progress">
            <span className="ci-step-dur">{run.slotProgress.phase} · {run.slotProgress.done}/{run.slotProgress.total}</span>
            <RunStepsPopover steps={topSteps.roots} progress={run.slotProgress} />
          </span>
        )}
        {run && <span className="ci-step-dur">{fmtDuration(run.durationMs ?? (run.startedAt ? now() - run.startedAt : null))}</span>}
        {view.refreshing && <RefreshIndicator label="Обновляем ленту…" />}
        <div className="ci-runfeed-actions">
          <label className="ci-mode-indicator"><input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} /> автоскролл</label>
          {running && <Button onClick={() => props.onCancel(runId)}>Отменить</Button>}
          <Button onClick={() => props.onRetry(runId)}>Повторить весь воркфлоу</Button>
          <Button onClick={() => (props.onRetryFromStep ?? props.onRetry)(runId)} disabled={running} title="Перезапустить упавший шаг и всё после него в этом же ране">Повторить с упавшего шага</Button>
          <Button onClick={() => download(`ci-run-${runId}.log`, logText())}>Скачать лог</Button>
          <Button onClick={() => setConsoleOpen(true)}>Консоль</Button>
        </div>
      </div>

      {run && executionLlm && (
        <section className="ci-run-llm" data-testid="ci-execution-llm" aria-label="Фактическая модель выполнения">
          {executionLlm.source === 'stage' ? (
            <>
              <div>Текущий этап: {ciStageLabel(executionLlm.stage)}</div>
              <div>Выполняется на: {ciLlmLabel(executionLlm)}</div>
              {executionDiffersFromBase && <div>Базовая модель рана: {ciLlmLabel(baseLlm)}</div>}
            </>
          ) : <div>Базовая модель рана: {ciLlmLabel(executionLlm)}</div>}
          {(detail?.stageRuns?.length ?? 0) > 1 && (
            <details>
              <summary>Фактические модели этапов</summary>
              <ul>{detail!.stageRuns!.map((stage) => <li key={stage.id}>{ciStageLabel(stage.stage)}: {ciLlmLabel(stage.llm)}</li>)}</ul>
            </details>
          )}
        </section>
      )}

      {kbUsage.report && (
        <KbUsageBrief
          title="Использование базы знаний"
          note="в этом ране"
          mode={kbUsage.report.kbContextMode}
          totals={kbUsage.report.totals}
          sections={kbUsage.report.sections}
          recent={kbUsage.report.recent}
          loading={kbUsage.loading}
          error={kbUsage.error}
          onRetry={kbUsage.reload}
          testId="ci-run-kb-usage"
        />
      )}

      {cache?.conclusion && (
        <div className="ci-lozenge ci-lozenge--removed" data-testid="ci-conclusion" style={{ display: 'block', padding: '8px', textTransform: 'none' }}>
          {conclusionLabel(cache.conclusion)}: {cache.conclusion.summary}
        </div>
      )}

      {view.state === 'skeleton' && (
        <div className="ci-steps ci-steps--skel" data-testid="ci-runfeed-skeleton" aria-busy="true">
          {/* Высота косточки — высота свёрнутого шага (.ci-step-head). */}
          <Skeleton variant="list" item="block" count={4} height={34} gap={6} />
        </div>
      )}
      {view.state === 'error' && (
        <ErrorState
          message="Не удалось загрузить ленту рана"
          detail={loadError}
          onRetry={() => props.onLoad(runId)}
        />
      )}
      {view.staleError && (
        <ErrorState
          compact
          className="ci-runfeed-error"
          message="Лента могла устареть: обновить не удалось"
          detail={loadError}
          onRetry={() => props.onLoad(runId)}
        />
      )}
      {view.state === 'data' && (
        <ul className="ci-steps">
          {topSteps.roots.length === 0 && (
            <li>
              {run && isTerminalCiStatus(run.status) && run.error ? (
                <ErrorState compact message="Ран завершился до первого шага" detail={run.error} />
              ) : (
                <EmptyState
                  compact
                  icon="⏱"
                  title="Шагов пока нет"
                  description="Первый шаг появится, когда воркфлоу начнётся, — лента обновляется сама."
                />
              )}
            </li>
          )}
          {topSteps.roots.map((s) => renderStep(s, false))}
        </ul>
      )}
      <div ref={endRef} aria-hidden="true" />
      {!autoscroll && <Button className="ci-runfeed-new" onClick={jumpToNew}>К новым событиям</Button>}
    </div>
    {consoleOpen && <CiConsole runId={runId} onClose={() => setConsoleOpen(false)} />}
    </>
  )
}

const RUN_STEPS_CLOSE_DELAY_MS = 140

/** Доступный popover со снимком фактических корневых шагов этого рана. */
function RunStepsPopover(props: { steps: CiRunStep[]; progress: { done: number; total: number } }): JSX.Element {
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeTimer = useRef<number | null>(null)
  const pointerFocus = useRef(false)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  const cancelClose = (): void => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const closeSoon = (): void => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => setOpen(false), RUN_STEPS_CLOSE_DELAY_MS)
  }

  useEffect(() => () => cancelClose(), [])

  useEffect(() => {
    if (!open) return
    const place = (): void => {
      const trigger = buttonRef.current?.getBoundingClientRect()
      const panel = panelRef.current?.getBoundingClientRect()
      if (!trigger || !panel) return
      const gutter = 8
      const roomBelow = window.innerHeight - trigger.bottom
      const top = roomBelow >= panel.height + gutter || trigger.top < roomBelow
        ? trigger.bottom + gutter
        : trigger.top - panel.height - gutter
      setPosition({
        top: Math.max(gutter, Math.min(top, window.innerHeight - panel.height - gutter)),
        left: Math.max(gutter, Math.min(trigger.right - panel.width, window.innerWidth - panel.width - gutter))
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, props.steps.length])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const panel = open && typeof document !== 'undefined' ? createPortal(
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label={'Шаги рана: ' + props.progress.done + ' из ' + props.progress.total}
      className="ci-run-steps-popover"
      data-testid="ci-run-steps-popover"
      style={{ ...(position ?? { top: 8, left: 8, visibility: 'hidden' as const }), maxHeight: 'calc(100dvh - 16px)', overflowX: 'hidden', overflowY: 'auto' }}
      onMouseEnter={cancelClose}
      onMouseLeave={closeSoon}
    >
      <div className="ci-run-steps-title">Шаги рана</div>
      <ol className="ci-run-steps-list">
        {props.steps.map((step, index) => {
          const current = step.status === 'running' || step.status === 'awaiting_input'
          return (
            <li key={step.id} className={'ci-run-step-summary ci-run-step-summary--' + ciTone(step.status) + (current ? ' is-current' : '')} aria-current={current ? 'step' : undefined}>
              <span className="ci-run-step-number">{index + 1}.</span>
              <span className="ci-run-step-name" style={{ overflowWrap: 'anywhere' }}>{step.title}</span>
              <span className="ci-run-step-status">
                <span aria-hidden>{ciStatusIcon(step.status)}</span>
                <span>{ciStatusLabel(step.status)}</span>
              </span>
            </li>
          )
        })}
      </ol>
    </div>,
    document.body
  ) : null

  return (
    <span className="ci-run-steps-trigger" onMouseEnter={() => { cancelClose(); setOpen(true) }} onMouseLeave={closeSoon}>
      <IconButton
        ref={buttonRef}
        size="sm"
        className="ci-run-steps-info"
        aria-label="Показать шаги рана"
        aria-expanded={open}
        aria-controls={id}
        title="Показать шаги рана"
        onPointerDown={() => { pointerFocus.current = true }}
        onFocus={() => { if (!pointerFocus.current) { cancelClose(); setOpen(true) } }}
        onBlur={closeSoon}
        onClick={() => { cancelClose(); setOpen((value) => !value); pointerFocus.current = false }}
      >
        <span aria-hidden className="ci-run-steps-info-icon">i</span>
      </IconButton>
      {panel}
    </span>
  )
}

function conclusionLabel(c: CiRunConclusion): string {
  const map: Record<string, string> = {
    no_access: 'Нет доступа',
    no_secret: 'Нет секрета',
    version_mismatch: 'Рассинхрон версий',
    script_error: 'Ошибка скрипта',
    external_unavailable: 'Внешний сервис недоступен',
    insufficient_permissions: 'Недостаточно прав',
    unknown: 'Неизвестно'
  }
  return map[c.failureClass] ?? c.failureClass
}

interface StepLogProps {
  lines: CiLogLine[]
  autoscroll: boolean
}

const LOG_CAP = 500

/**
 * Пауза рана внутри шага: уточняющие вопросы (та же форма, что в чате) либо
 * гейт плана с кнопками «Одобрить» / «На доработку». Отвеченная пауза
 * показывается статично — ответить могли и из связанного чата.
 */
function InteractionCard(props: {
  interaction: CiInteraction
  disabled: boolean
  onAnswer: (answer: CiInteractionAnswer) => void
}): JSX.Element {
  const it = props.interaction
  const [comment, setComment] = useState('')
  const pending = it.status === 'pending'

  if (it.kind === 'plan_approval') {
    return (
      <div className="ci-interaction" data-testid="ci-plan-gate">
        <strong className="ci-interaction-title">
          {pending ? 'План готов — нужно решение' : it.decision === 'approved' ? 'План одобрен' : 'План отправлен на доработку'}
        </strong>
        {it.planText && <pre className="ci-interaction-plan">{it.planText}</pre>}
        {pending ? (
          <>
            <input
              className="login-input"
              aria-label="Комментарий к плану"
              placeholder="Что поправить (для доработки)…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="ci-interaction-actions">
              <Button variant="primary" disabled={props.disabled} onClick={() => props.onAnswer({ decision: 'approved', text: comment })}>
                Одобрить и разрабатывать
              </Button>
              <Button disabled={props.disabled} onClick={() => props.onAnswer({ decision: 'rework', text: comment })}>
                На доработку
              </Button>
            </div>
          </>
        ) : (
          it.answerText && <p className="ci-interaction-answer">{it.answerText}</p>
        )}
      </div>
    )
  }

  return (
    <div className="ci-interaction" data-testid="ci-clarify">
      <strong className="ci-interaction-title">{pending ? 'Модель спрашивает' : 'Вопрос модели'}</strong>
      {pending ? (
        <QuestionsForm questions={it.questions} disabled={props.disabled} onSubmit={(text) => props.onAnswer({ text })} />
      ) : (
        <div className="qstatic">
          {it.questions.map((q, i) => (
            <p className="qstaticitem" key={i}>
              {q.q} <span className="qstaticopts">({q.options.join(' / ')})</span>
            </p>
          ))}
          {it.answerText
            ? <p className="ci-interaction-answer">Ответ: {it.answerText}</p>
            : <p className="ci-interaction-answer">Ответа не было — модель продолжила сама.</p>}
        </div>
      )}
    </div>
  )
}

function StepLog({ lines, autoscroll }: StepLogProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    if (autoscroll && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines, autoscroll])
  const capped = !showAll && lines.length > LOG_CAP
  const shown = capped ? lines.slice(-LOG_CAP) : lines
  return (
    <div className="ci-log" ref={ref}>
      {capped && (
        <div>
          … {lines.length - LOG_CAP} строк скрыто ·{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); setShowAll(true) }}>показать полностью</a>
        </div>
      )}
      {shown.map((l, i) => (
        <div key={`${l.seq}-${i}`} className={`ci-log-line ci-log-line--${l.stream}`}>{l.chunk}</div>
      ))}
    </div>
  )
}