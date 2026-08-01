// Лента одного CI-рана: таймлайн разворачиваемых шагов (иконка статуса, таймер/
// длительность, exit_code, потоковый лог с автоскроллом), вызовы команд модели
// вложены под model_work, последний элемент — итог модели. Подписка на realtime
// при монтировании, отписка при закрытии; REST-подгрузка как фолбэк.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CiRunDetail, CiRunStep, CiLogLine, CiRunConclusion, CiInteraction, CiInteractionAnswer } from '@shared/ci'
import { CLAUDE_MODELS, CODEX_MODELS } from '@shared/types'
import { DEFAULT_CI_CLAUDE_MODEL, isTerminalCiStatus } from '@shared/ci'
import type { LlmEngineOption } from '@shared/admin'
import type { CiMetrics } from '../../remote/ciBridge'
import { ciStatusIcon, ciStatusLabel, ciTone, fmtDuration } from './ciFormat'
import { CiConsole } from './CiConsole'
import { QuestionsForm } from '../QuestionsForm'
import { Button } from '../ui/Button'
import { useConfirm } from '../ui/useConfirm'
import { Skeleton, RefreshIndicator } from '../ui/Skeleton'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { loadView, type LoadStatus } from '../../lib/loadState'
import { useCommandSource } from '../../lib/useCommands'
import { KbUsageBrief } from '../kb/KbUsageBrief'
import { useRemoteReport } from '../../lib/useRemoteReport'

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

  const renderStep = (step: CiRunStep, nested: boolean): JSX.Element => {
    const hasPending = interactionsOf(step.id).some((it) => it.status === 'pending')
    const open = expanded[step.id] ?? (hasPending || step.status === 'running' || step.status === 'failed')
    const tone = ciTone(step.status)
    const lines = logByStep.get(step.id) ?? []
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
                    {(props.engines ?? []).map((engine) => <option key={engine.id} value={engine.id}>{engine.name} · {engine.kind}</option>)}
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
                    {(modelProvider === 'codex' ? CODEX_MODELS : CLAUDE_MODELS).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </label>
                <Button disabled={!props.onRetryFromStep || (modelProvider === 'claude' && !modelName)} onClick={() => props.onRetryFromStep?.(runId, { provider: modelProvider, model: modelName, ...(llmEngineId ? { llmEngineId } : {}) })}>
                  Повторить работу модели
                </Button>
              </div>
            )}
            {step.kind === 'command' && step.status === 'failed' && step.exitCode === 66 && run?.status === 'failed' && (
              <div className="ci-model-retry" data-testid="ci-dirty-workspace">
                <strong>В рабочем репозитории есть локальные изменения.</strong>
                <span>Можно сохранить их для диагностики или безвозвратно откатить и начать workflow заново.</span>
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
                  Откатить изменения и начать заново
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
    <div className="ci-runfeed" data-testid="ci-runfeed">
      <div className="ci-runfeed-head">
        <span className={`ci-lozenge ci-lozenge--${run ? ciTone(run.status) : 'neutral'}`}>
          {run ? ciStatusLabel(run.status) : 'загрузка…'}
        </span>
        {run && <span className="ci-step-dur">{run.slotProgress.phase} · {run.slotProgress.done}/{run.slotProgress.total}</span>}
        {run && run.durationMs != null && <span className="ci-step-dur">{fmtDuration(run.durationMs)}</span>}
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

      {kbUsage.report && (
        <KbUsageBrief
          title="Использование базы знаний"
          note="в этом ране"
          mode={kbUsage.report.kbContextMode}
          totals={kbUsage.report.totals}
          sections={kbUsage.report.sections}
          loading={kbUsage.loading}
          error={kbUsage.error}
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
              <EmptyState
                compact
                icon="⏱"
                title="Шагов пока нет"
                description="Первый шаг появится, когда воркфлоу начнётся, — лента обновляется сама."
              />
            </li>
          )}
          {topSteps.roots.map((s) => renderStep(s, false))}
        </ul>
      )}
    </div>
    {consoleOpen && <CiConsole runId={runId} onClose={() => setConsoleOpen(false)} />}
    </>
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