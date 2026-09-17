// Лента одного CI-рана: таймлайн разворачиваемых шагов (иконка статуса, таймер/
// длительность, exit_code, потоковый лог с автоскроллом), вызовы команд модели
// вложены под model_work, последний элемент — итог модели. Подписка на realtime
// при монтировании, отписка при закрытии; REST-подгрузка как фолбэк.

import type { DevelopmentPreviewStatus } from '@shared/developmentPreview'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { usePolling } from '@voicechat/ui-foundation/lib/usePolling'
import { createPortal } from 'react-dom'
import type { CiRunDetail, CiRunStep, CiLogLine, CiRunConclusion, CiInteraction, CiInteractionAnswer } from '@shared/ci'
import { DEFAULT_CI_CLAUDE_MODEL, isTerminalCiStatus } from '@shared/ci'
import type { LlmEngineOption } from '@shared/admin'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { TaskPreparationStep } from '@shared/qa'
import { allowedModels, isProviderAllowed } from '@shared/llmAccess'
import type { CiMetrics } from '../../remote/ciBridge'
import { ciLlmLabel, ciStageLabel, ciStatusIcon, ciStatusLabel, ciTone, fmtDuration } from './ciFormat'
import { matchesStep, logRows, lineAnchor, lineMatches, type StepFilter } from './ciFormat'
import { copyText } from '@voicechat/ui-foundation/lib/clipboard'
import { useToast } from '@voicechat/ui-kit'
import { AnsiText } from './AnsiText'
import { CiConsole } from './CiConsole'
import { fmtTokens, fmtUsd } from './ciFormat'
import { QuestionsForm } from '../QuestionsForm'
import { Button } from '@voicechat/ui-kit'
import { IconButton } from '@voicechat/ui-kit'
import { useConfirm } from '@voicechat/ui-kit'
import { Skeleton, RefreshIndicator } from '@voicechat/ui-kit'
import { EmptyState } from '@voicechat/ui-kit'
import { ErrorState } from '@voicechat/ui-kit'
import { loadView, type LoadStatus } from '@voicechat/ui-foundation/lib/loadState'
import { useCommandSource } from '@voicechat/ui-foundation/runtime'
import { KbUsageBrief } from '../kb/KbUsageBrief'
import { useRemoteReport } from '../../lib/useRemoteReport'

export function PreparationRunSteps({ steps, fallback }: { steps: TaskPreparationStep[]; fallback: string }): JSX.Element {
  return <><p className="vc-sr-only" role="status">{steps.map(step => `${step.name}: ${step.status}`).join('; ')}</p>
  <ol className="ci-step-list" data-testid="task-preparation-feed">
    {steps.map((step) => <li key={step.id} className="ci-step">
      <details>
        <summary className="ci-step-head"><span className="ci-step-title">{step.name}</span><span className="ci-lozenge">{step.status}</span><span className="ci-step-dur">{step.durationMs == null ? '—' : fmtDuration(step.durationMs)}</span></summary>
        {step.error && <p role="alert">{step.error}</p>}
        <pre className="ci-console-pre">{step.log.map((event) => event.text).join('') || 'Лог шага пуст.'}</pre>
      </details>
    </li>)}
    {!steps.length && <li>{fallback}</li>}
  </ol></>
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
  onRetryFromStep?: (runId: string, selection?: { provider: 'claude' | 'codex'; model: string; llmEngineId?: string | null; stepId?: string }) => void
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

export function isDirtyWorkspaceFailureMessage(error: string | null | undefined): boolean {
  return Boolean(error && /Рабочая копия содержит локальные изменения/i.test(error))
}

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
  const toast = useToast()
  const [queueBusy, setQueueBusy] = useState(false)
  const now = props.now ?? Date.now
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [autoscroll, setAutoscroll] = useState(true)
  const [filter, setFilter] = useState<StepFilter>('all')
  const [search, setSearch] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const [allOpen, setAllOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [retryStepId, setRetryStepId] = useState<string | null>(null)
  const [targetLine, setTargetLine] = useState<string | null>(null)
  const [targetOffset, setTargetOffset] = useState<number | null>(null)
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
    setRetryStepId(null); setReportOpen(false); setFilter('all'); setSearch('')
    setExpanded({}); setAllOpen(false); setTargetLine(null); setTargetOffset(null)
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

  // Часы активного рана тикают только на видимой вкладке браузера: лента,
  // оставленная открытой в фоне, перерисовывалась каждую секунду впустую.
  usePolling(() => setClockTick((tick) => tick + 1), { enabled: running, intervalMs: 1_000 })

  // Отчёт по БЗ читаем один раз на ран и ещё раз, когда ран завершился: пока он
  // идёт, обращения копятся, и промежуточные цифры быстро устаревают.
  const kbUsage = useRemoteReport(
    () => window.ci?.getRunKbUsage(runId),
    [runId, running]
  )

  usePolling(() => props.onLoad(runId), { enabled: running && !!detail?.queue, intervalMs: 5000 })
  const queueAction = async (force: boolean, queuedRunId: string, taskId: string): Promise<void> => {
    if (!run || queueBusy) return
    setQueueBusy(true)
    try {
      if (force) {
        if (!(await confirm({ title: 'Запустить мимо очереди?', message: 'Запуск превысит общий лимит параллельных ранов и увеличит нагрузку на машину.', confirmLabel: 'Запустить мимо очереди' }))) return
        await window.ci?.startRun(run.projectId, taskId, { launch: 'parallel' })
      } else {
        const result = await window.ci?.dequeueRun(queuedRunId)
        if (result?.status !== 'removed') toast.info('Ран уже вышел из очереди. Обновляем состояние.')
      }
      props.onLoad(runId)
    } catch (error) { toast.error(String(error)) }
    finally { setQueueBusy(false) }
  }

  const usage = useRemoteReport(() => window.ci?.getRunReport(runId), [runId, run?.status, detail?.stageRuns?.length])
  usePolling(usage.reload, { enabled: running, intervalMs: 15_000 })

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

  const matches = useMemo(() => [...logByStep].flatMap(([stepId, lines]) =>
    logRows(lines).flatMap((text, index) => lineMatches(text, search).map((offset) => ({ stepId, line: index + 1, offset })))
  ), [logByStep, search])
  const revealLine = (stepId: string, line: number): void => {
    setFilter('all')
    setAutoscroll(false)
    setExpanded((current) => {
      const next = { ...current, [stepId]: true }
      let step = detail?.steps.find((item) => item.id === stepId)
      while (step?.parentStepId) {
        next[step.parentStepId] = true
        step = detail?.steps.find((item) => item.id === step!.parentStepId)
      }
      return next
    })
    setTargetLine(lineAnchor(stepId, line))
  }
  useEffect(() => {
    const revealHash = (): void => {
      const match = /^#step-(.+)-L(\d+)$/.exec(window.location.hash)
      if (match) revealLine(match[1], Number(match[2]))
    }
    revealHash()
    window.addEventListener('hashchange', revealHash)
    return () => window.removeEventListener('hashchange', revealHash)
  }, [runId, detail?.steps.length])
  useEffect(() => {
    if (!targetLine) return
    const row = document.getElementById(targetLine)
    const target = row?.querySelector('.ci-search-current') ?? row
    target?.scrollIntoView?.({ block: 'center' })
  }, [targetLine, targetOffset, expanded, log])
  const jumpMatch = (index: number): void => {
    if (!matches.length) return
    const next = (index + matches.length) % matches.length
    setMatchIndex(next)
    setTargetOffset(matches[next].offset)
    revealLine(matches[next].stepId, matches[next].line)
  }

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
    setTargetLine(null); setTargetOffset(null)
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
      <li key={step.id} className={`ci-step${nested ? ' ci-step--nested' : ''}${open ? ' ci-step--open' : ''}`}>
        <button className="ci-step-head" aria-expanded={open} onClick={() => setExpanded((e) => ({ ...e, [step.id]: !open }))}>
          {/* Шеврон — общий с лентами карточки: до него о том, что строка
              раскрывается, можно было только догадаться. */}
          <span className="vc-feed-caret" aria-hidden="true" />
          <span className={`ci-step-icon ci-step-icon--${tone}`}>{ciStatusIcon(step.status)}</span>
          <span className="ci-step-title">{step.title}</span>
          {step.exitCode != null && step.exitCode !== 0 && <span className="ci-lozenge ci-lozenge--removed">exit {step.exitCode}</span>}
          {step.fixedByModel && <span className="ci-lozenge ci-lozenge--success">исправлено моделью</span>}
          <span className="ci-step-dur">{step.status === 'running' && elapsed != null ? fmtDuration(elapsed) : fmtDuration(step.durationMs)}</span>
        </button>
        {open && (
          <div className="ci-step-body">
            {!running && run?.status !== 'success' && run?.status !== 'cancelled' && !step.parentStepId && (step.kind === 'model_work' || step.kind === 'command' && step.commandId != null) && <Button onClick={() => setRetryStepId(step.id)}>Повторить с этого шага</Button>}
            {typical != null && (
              <>
                <div className="ci-step-dur">Типично: {fmtDuration(typical)}{pct != null ? ` · текущее ${pct}%` : ''}</div>
                {pct != null && <div className="ci-metric-bar"><div className="ci-metric-fill" style={{ width: `${pct}%` }} /></div>}
              </>
            )}
            {lines.length > 0 && (
              <StepLog stepId={step.id} lines={lines} autoscroll={autoscroll && step.status === 'running'} search={search} targetLine={targetLine} targetOffset={targetOffset} onFollow={() => { setTargetLine(null); setTargetOffset(null); setAutoscroll(true) }} />
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
                previousPlan={(detail?.interactions ?? []).filter((previous) => previous.kind === 'plan_approval' && previous.seq < it.seq).sort((a, b) => b.seq - a.seq)[0]?.planText ?? undefined}
                disabled={!props.onAnswerInteraction}
                now={now}
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
                {topSteps.childrenOf(step.id).filter((child) => matchesStep(child, filter)).map((child) => renderStep(child, true))}
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
          <Button onClick={() => {
            const failed = [...topSteps.roots].reverse().find((step) => ['failed', 'timeout', 'interrupted'].includes(step.status) && (step.kind === 'model_work' || step.commandId != null))
            if (failed) setRetryStepId(failed.id)
          }} disabled={running} title="Предпросмотр повтора упавшего шага и следующих шагов">Повторить с упавшего шага</Button>
          <Button onClick={() => download(`ci-run-${runId}.log`, logText())}>Скачать лог</Button>
          <Button onClick={() => setConsoleOpen(true)}>Консоль</Button>
        </div>
      </div>

      <DevelopmentPreviewSummary runId={runId} lines={cache?.log ?? []} />
      {run && isDirtyWorkspaceFailureMessage(run.error) && (
        <section className="ci-retry-preview" role="alert" aria-label="Автопроход остановлен">
          <strong>Автопроход остановлен: рабочая копия содержит несохранённые изменения.</strong>
          <p>Ран {run.id}. Сохраните изменения или вручную продолжите подходящий шаг этого рана.</p>
          <p>Сброс рабочей копии может удалить изменения и выполняется только после явного подтверждения.</p>
        </section>
      )}

      {detail?.queue && <section className="ci-queue" aria-label="Очередь проекта">
        <h3>Очередь</h3>
        <p>Занято слотов сервера: {detail.queue.occupied} / {detail.queue.limit}. Позиции ниже — внутри проекта.</p>
        <ol>{detail.queue.waiting.map((item, index) => <li key={item.runId}>
          <span>{index + 1}. {item.title} · ожидание {fmtDuration(Math.max(0, now() - item.createdAt))}</span>
          <Button disabled={queueBusy} onClick={() => void queueAction(false, item.runId, item.taskId)}>Убрать из очереди</Button>
          <Button disabled={queueBusy} onClick={() => void queueAction(true, item.runId, item.taskId)}>Запустить мимо очереди</Button>
        </li>)}</ol>
        {!detail.queue.waiting.length && <p>Нет ожидающих ранов.</p>}
        <strong>Кто занят</strong>
        <ul>{detail.queue.busy.map((item) => <li key={item.runId}>{item.title} · {item.agentId ?? 'машина не выбрана'}{item.bypass ? ' · мимо лимита' : ''}</li>)}</ul>
      </section>}
      {retryStepId && <section className="ci-retry-preview" aria-label="Предпросмотр повтора">
        <label>Начать с шага <select value={retryStepId} onChange={(event) => setRetryStepId(event.target.value)}>
          {topSteps.roots.filter((step) => step.kind === 'model_work' || step.kind === 'command' && step.commandId != null).map((step) => <option key={step.id} value={step.id}>{step.title}</option>)}
        </select></label>
        <label>Движок повтора <select value={llmEngineId ?? ''} onChange={(event) => {
          const id = event.target.value || null
          setLlmEngineId(id)
          const engine = props.engines?.find((item) => item.id === id)
          if (engine) { setModelProvider(engine.kind); setModelName(engine.kind === 'codex' ? '' : DEFAULT_CI_CLAUDE_MODEL) }
        }}><option value="">По умолчанию</option>{(props.engines ?? []).filter((engine) => isProviderAllowed(access, engine.kind)).map((engine) => <option key={engine.id} value={engine.id}>{engine.name}</option>)}</select></label>
        <label>Провайдер повтора <select value={modelProvider} onChange={(event) => {
          const provider = event.target.value as 'claude' | 'codex'
          setModelProvider(provider); setLlmEngineId(null); setModelName(provider === 'codex' ? '' : DEFAULT_CI_CLAUDE_MODEL)
        }}><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
        <label>Модель повтора <select value={modelName} onChange={(event) => setModelName(event.target.value)}>
          {!retryModels.some((model) => model.id === modelName) && <option value={modelName}>{modelName || 'Из config.toml'}</option>}
          {retryModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
        </select></label>
        <p>Рабочая директория сохраняется. История предыдущих попыток остаётся в ленте.</p>
        <strong>Переиспользуется</strong>
        <ul>{topSteps.roots.filter((step) => step.position < (detail?.steps.find((item) => item.id === retryStepId)?.position ?? 0)).map((step) => <li key={step.id}>{step.title}</li>)}</ul>
        <strong>Перезапустится</strong>
        <ul>{topSteps.roots.filter((step) => step.position >= (detail?.steps.find((item) => item.id === retryStepId)?.position ?? 0)).map((step) => <li key={step.id}>{step.title}</li>)}</ul>
        <p>Последующие команды берутся из текущих настроек слотов; системная подготовка директории пропускается.</p>
        <Button disabled={running || !props.onRetryFromStep} onClick={() => {
          props.onRetryFromStep?.(runId, { stepId: retryStepId, provider: modelProvider, model: modelName, llmEngineId })
          setRetryStepId(null)
        }}>Подтвердить повтор</Button>
        <Button onClick={() => setRetryStepId(null)}>Закрыть предпросмотр</Button>
      </section>}
      {usage.report && <section className="ci-usage-summary" aria-label="Расход рана">
        <strong>{fmtTokens(usage.report.totals.tokens)} токенов · {fmtUsd(usage.report.totals.costUsd, usage.report.totals.costEstimated)}</strong>
        {usage.report.totals.costUnderstated && <span>Стоимость неполная: есть модели без цены.</span>}
        <div className="ci-usage-bar" role="img" aria-label="Доли токенов по стадиям">
          {usage.report.stages.map((stage, index) => <span key={`${stage.kind}-${stage.model}`} className={`ci-usage-segment ci-usage-segment--${index % 3}`} style={{ flexGrow: stage.totals.tokens }} title={`${ciStageLabel(stage.kind)} · ${stage.model}: ${fmtTokens(stage.totals.tokens)} ток., ${fmtUsd(stage.totals.costUsd, stage.totals.costEstimated)}`} />)}
        </div>
        <Button aria-expanded={reportOpen} onClick={() => { setReportOpen(!reportOpen); usage.reload() }}>Отчёт рана</Button>
        {reportOpen && <div className="ci-report-scroll"><table><caption>Расход по стадиям и моделям</caption>
          <thead><tr><th>Стадия</th><th>Модель</th><th>Токены</th><th>Стоимость</th></tr></thead>
          <tbody>{usage.report.stages.map((stage) => <tr key={`${stage.kind}-${stage.model}`}><th scope="row">{ciStageLabel(stage.kind)}</th><td>{stage.model}</td><td>{fmtTokens(stage.totals.tokens)}</td><td>{fmtUsd(stage.totals.costUsd, stage.totals.costEstimated)}</td></tr>)}</tbody>
        </table>{!usage.report.stages.length && <p>CLI не сообщил расход.</p>}</div>}
      </section>}
      {usage.error && <ErrorState compact message="Не удалось загрузить расход" detail={usage.error} onRetry={usage.reload} />}
      <div className="ci-feed-tools" role="search" aria-label="Поиск и фильтры ленты">
        <label>Шаги <select className="sel" value={filter} onChange={(event) => setFilter(event.target.value as StepFilter)}>
          <option value="all">Все</option><option value="failed">Упавшие</option>
          <option value="commands">Команды</option><option value="model">Ходы модели</option>
        </select></label>
        <input className="login-input" aria-label="Поиск по логу" placeholder="Поиск по логу" value={search} onChange={(event) => { setSearch(event.target.value); setMatchIndex(0) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); jumpMatch(matchIndex + (event.shiftKey ? -1 : 1)) } }} />
        <span role="status">{search ? `${matches.length ? Math.min(matchIndex + 1, matches.length) : 0} / ${matches.length}` : ''}</span>
        <Button disabled={!matches.length} onClick={() => jumpMatch(matchIndex - 1)}>Предыдущее</Button>
        <Button disabled={!matches.length} onClick={() => jumpMatch(matchIndex + 1)}>Следующее</Button>
        <Button onClick={() => {
          setAllOpen(!allOpen)
          setExpanded(Object.fromEntries((detail?.steps ?? []).map((step) => [step.id, !allOpen])))
        }}>{allOpen ? 'Свернуть всё' : 'Развернуть всё'}</Button>
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
          {topSteps.roots.filter((s) => matchesStep(s, filter) || topSteps.childrenOf(s.id).some((child) => matchesStep(child, filter))).map((s) => renderStep(s, false))}
          {topSteps.roots.length > 0 && !detail?.steps.some((step) => matchesStep(step, filter)) && <li>Нет шагов по выбранному фильтру.</li>}
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
  stepId: string
  lines: CiLogLine[]
  autoscroll: boolean
  search: string
  targetLine: string | null
  targetOffset: number | null
  onFollow: () => void
}

const LOG_CAP = 500

/**
 * Пауза рана внутри шага: уточняющие вопросы (та же форма, что в чате) либо
 * гейт плана с кнопками «Одобрить» / «На доработку». Отвеченная пауза
 * показывается статично — ответить могли и из связанного чата.
 */
export function InteractionCard(props: {
  interaction: CiInteraction
  previousPlan?: string
  now?: () => number
  disabled: boolean
  onAnswer: (answer: CiInteractionAnswer) => void
}): JSX.Element {
  const it = props.interaction
  const [comment, setComment] = useState('')
  const pending = it.status === 'pending'
  const [later, setLater] = useState(false)
  const [clock, setClock] = useState(props.now ?? Date.now)
  usePolling(() => setClock((props.now ?? Date.now)()), { enabled: pending, intervalMs: 1000 })
  const waiting = pending ? <p className="ci-interaction-wait">Ожидает ответа {fmtDuration(Math.max(0, clock - it.createdAt))}</p> : null

  if (it.kind === 'plan_approval') {
    return (
      <div className="ci-interaction" data-testid="ci-plan-gate">
        <strong className="ci-interaction-title">
          {pending ? 'План готов — нужно решение' : it.decision === 'approved' ? 'План одобрен' : 'План отправлен на доработку'}
        </strong>
        {waiting}
        {it.planText && <pre className="ci-interaction-plan">{it.planText}</pre>}
        {props.previousPlan != null && <details open><summary>Изменения плана</summary>
          <pre className="ci-plan-diff">{planDiff(props.previousPlan, it.planText ?? '').map((line, index) => <div key={index} className={line.kind === '+' ? 'ci-plan-added' : line.kind === '-' ? 'ci-plan-removed' : ''}>{line.kind} {line.text}</div>)}</pre>
        </details>}
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
      {waiting}
      {pending ? (
        later ? <div><p>Черновик сохранён в этой вкладке. Ран продолжает ждать ответа.</p><Button onClick={() => setLater(false)}>Ответить модели</Button></div>
        : <QuestionsForm key={it.id} questions={it.questions} draftKey={`ci-answer:${it.runId}:${it.id}`} onLater={() => setLater(true)} disabled={props.disabled} onSubmit={(text) => props.onAnswer({ text })} />
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

function DevelopmentPreviewSummary({ runId, lines }: {runId:string;lines:CiLogLine[]}): JSX.Element | null {
  const [error,setError]=useState<string|null>(null)
  const [busy,setBusy]=useState(false)
  let status: DevelopmentPreviewStatus | null=null
  for (const line of [...lines].reverse()) if (line.stream==='system' && line.chunk.startsWith('[development-preview] ')) {
    try { status=JSON.parse(line.chunk.slice('[development-preview] '.length)) as DevelopmentPreviewStatus; break } catch { /* incomplete stream frame */ }
  }
  if (!status) return null
  const live=status.state==='ready'||status.state==='checking'||status.state==='starting'
  const action=(operation:'restart'|'stop'):void=>{
    setBusy(true);setError(null)
    void window.ci?.developmentPreview?.(runId,operation).catch((e:unknown)=>setError(e instanceof Error?e.message:String(e))).finally(()=>setBusy(false))
  }
  const labels:Record<string,string>={off:'Выключено',prepare:'Подготовка',starting:'Запуск',ready:'Готово',checking:'Проверка',stopped:'Остановлено',expired:'Истекло',failed:'Ошибка',pending:'Ожидает проверки',passed:'Проверено',warning:'Предупреждение',skipped:'Пропущено',blocked:'Обязательная проверка заблокирована'}
  return <section className="ci-task-browser" aria-label="Тестовое окружение разработки" aria-live="polite">
    <strong>Docker preview: {labels[status.state]??status.state} · Браузер: {labels[status.browserResult]??status.browserResult}</strong>
    <span>Попытки: {status.attempt??0}/{status.maxAttempts??2} · БД: {status.database??'pending'}</span>
    {status.diagnostic && <p>{typeof status.diagnostic==='object'?status.diagnostic.code:String(status.diagnostic)}: {status.diagnostic.message}</p>}
    {(status.browserResult==='warning'||status.browserResult==='skipped') && <p>Работа продолжена согласно настройке «Продолжить при недоступности».</p>}
    {live && status.url && /^http:\/\/[a-zA-Z0-9-]+\.machine\.internal:\d+\//.test(status.url) ? <a href={status.url} target="_blank" rel="noreferrer">Открыть preview</a> : <span>Ссылка на окружение неактивна</span>}
    {status.evidence?.screenshots.filter((url)=>url.startsWith('/api/')).map((url)=><a key={url} href={url} target="_blank" rel="noreferrer">Снимок проверки</a>)}
    {live && window.ci?.developmentPreview && <><Button disabled={busy} onClick={()=>action('restart')}>Перезапустить окружение</Button><Button disabled={busy} onClick={()=>action('stop')}>Остановить окружение</Button></>}
    {error && <ErrorState compact message={error} />}
  </section>
}

/** Common prefix/suffix keeps repeated lines and ordering visible without quadratic work. */
export function planDiff(before: string, after: string): Array<{ kind: string; text: string }> {
  const oldLines = before.split('\n'), newLines = after.split('\n')
  let start = 0, end = 0
  while (start < Math.min(oldLines.length, newLines.length) && oldLines[start] === newLines[start]) start++
  while (end < Math.min(oldLines.length, newLines.length) - start && oldLines[oldLines.length - 1 - end] === newLines[newLines.length - 1 - end]) end++
  return [
    ...oldLines.slice(0, start).map((text) => ({ kind: ' ', text })),
    ...oldLines.slice(start, oldLines.length - end).map((text) => ({ kind: '-', text })),
    ...newLines.slice(start, newLines.length - end).map((text) => ({ kind: '+', text })),
    ...newLines.slice(newLines.length - end).map((text) => ({ kind: ' ', text }))
  ]
}

export function BrowserLogArtifact({ line }: { line: CiLogLine }): JSX.Element {
  const match = line.stream === 'system' ? /^Снимок страницы проверки: \/api\/ci\/runs\/([a-zA-Z0-9_-]+)\/browser-shots\/(\d+\.png)\s*$/.exec(line.chunk) : null
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const alive = useRef(true)
  const objectUrl = useRef<string | null>(null)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; if (objectUrl.current) URL.revokeObjectURL(objectUrl.current) }
  }, [line.seq])
  const load = async (): Promise<void> => {
    if (!match || loading) return
    setLoading(true); setError(null)
    try {
      const next = await window.ci?.getBrowserShot?.(match[1], match[2])
      if (!next) throw new Error('Screenshot transport is unavailable')
      if (!alive.current) { URL.revokeObjectURL(next); return }
      objectUrl.current = next
      setUrl(next)
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : String(err)) }
    finally { if (alive.current) setLoading(false) }
  }
  if (match) return <div>
    {url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Browser-check screenshot" style={{ maxWidth: '100%', height: 'auto' }} /></a>
      : <Button size="sm" loading={loading} onClick={() => void load()}>Открыть снимок {match[2]}</Button>}
    {error && <p role="alert">{error}</p>}
  </div>
  if (line.stream === 'system' && line.chunk.startsWith('Browser-check evidence: ')) {
    try {
      const evidence = JSON.parse(line.chunk.slice('Browser-check evidence: '.length)) as import('@shared/ci').CiBrowserEvidence
      if (['passed', 'blocked', 'infrastructure_error'].includes(evidence.status) && Array.isArray(evidence.viewports) && Array.isArray(evidence.missing)) {
        return <details><summary>Browser-check: {evidence.status} · {evidence.viewports.join(', ')} px</summary>
          <pre style={{ maxWidth: '100%', overflow: 'auto' }}>{JSON.stringify(evidence, null, 2)}</pre>
        </details>
      }
    } catch { /* Old or partial log lines remain readable. */ }
  }
  return <AnsiText>{line.chunk}</AnsiText>
}

function StepLog({ stepId, lines, autoscroll, search, targetLine, targetOffset, onFollow }: StepLogProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const toast = useToast()
  const [showAll, setShowAll] = useState(false)
  const [following, setFollowing] = useState(true)
  const [range, setRange] = useState<[number, number] | null>(null)
  const rows = useMemo(() => logRows(lines), [lines])
  const rawRows = useMemo(() => lines.map((line) => line.chunk).join('').split('\n'), [lines])
  useEffect(() => {
    if (autoscroll && following && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines, autoscroll, following])
  const targeted = targetLine?.startsWith(`step-${stepId}-L`)
  const capped = !showAll && !search && !targeted && rows.length > LOG_CAP
  const start = capped ? rows.length - LOG_CAP : 0
  const copy = async (text: string): Promise<void> => {
    const ok = await copyText(text)
    if (ok) toast.success('Скопировано'); else toast.error('Не удалось скопировать')
  }
  return <div className="ci-step-log">
    <div className="ci-log-tools">
      <Button size="sm" aria-pressed={following} onClick={() => {
        setFollowing(true)
        onFollow()
        ref.current?.scrollTo?.(0, ref.current.scrollHeight)
      }}>Следить</Button>
      <Button size="sm" disabled={!range} onClick={() => {
        if (range) void copy(rows.slice(Math.min(...range) - 1, Math.max(...range)).join('\n'))
      }}>Копировать диапазон{range ? ` ${Math.min(...range)}–${Math.max(...range)}` : ''}</Button>
      <span>Выберите строку; Shift — конец диапазона</span>
    </div>
    <div className="ci-log" ref={ref} role="log" aria-live="off" aria-label="Вывод шага" tabIndex={0} onScroll={() => {
      const el = ref.current
      if (el) setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 32)
    }}>
      {capped && <Button size="sm" onClick={() => setShowAll(true)}>Показать полностью · скрыто {start} строк</Button>}
      {rows.slice(start).map((text, index) => {
        const number = start + index + 1
        const id = lineAnchor(stepId, number)
        const offsets = lineMatches(text, search)
        const pieces: React.ReactNode[] = []
        let cursor = 0
        for (const offset of offsets) {
          pieces.push(text.slice(cursor, offset), <mark key={offset} className={targetLine === id && targetOffset === offset ? 'ci-search-current' : undefined} aria-current={targetLine === id && targetOffset === offset ? 'true' : undefined}>{text.slice(offset, offset + search.length)}</mark>)
          cursor = offset + search.length
        }
        pieces.push(text.slice(cursor))
        return <div key={number} id={id} className={`ci-log-line${targetLine === id ? ' ci-log-line--target' : ''}${range && number >= Math.min(...range) && number <= Math.max(...range) ? ' ci-log-line--selected' : ''}`}>
          <a className="ci-log-number" href={`#${id}`} aria-label={`Строка ${number}`} onClick={(event) => {
            setFollowing(false)
            setRange((current) => event.shiftKey && current ? [current[0], number] : [number, number])
          }}>{number}</a>
          <span className="ci-log-text">{search ? pieces : <AnsiText>{rawRows[number - 1] || '\u00a0'}</AnsiText>}</span>
          <Button size="sm" variant="ghost" aria-label={`Скопировать ссылку на строку ${number}`} onClick={() => void copy(`${window.location.href.split('#')[0]}#${id}`)}>Ссылка</Button>
        </div>
      })}
    </div>
    {lines.filter((line) => line.stream === 'system' && (line.chunk.startsWith('Снимок страницы проверки: ') || line.chunk.startsWith('Browser-check evidence: '))).map((line) => <BrowserLogArtifact key={line.seq} line={line} />)}
  </div>
}