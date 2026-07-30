// Лента одного CI-рана: таймлайн разворачиваемых шагов (иконка статуса, таймер/
// длительность, exit_code, потоковый лог с автоскроллом), вызовы команд модели
// вложены под model_work, последний элемент — итог модели. Подписка на realtime
// при монтировании, отписка при закрытии; REST-подгрузка как фолбэк.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CiRunDetail, CiRunStep, CiLogLine, CiRunConclusion, CiInteraction, CiInteractionAnswer } from '@shared/ci'
import { CLAUDE_MODELS, CODEX_MODELS } from '@shared/types'
import { isTerminalCiStatus } from '@shared/ci'
import type { CiMetrics } from '../../remote/ciBridge'
import { ciStatusIcon, ciStatusLabel, ciTone, fmtDuration } from './ciFormat'
import { CiConsole } from './CiConsole'
import { QuestionsForm } from '../QuestionsForm'

export interface RunFeedCache {
  detail: CiRunDetail | null
  log: CiLogLine[]
  conclusion: CiRunConclusion | null
}

export interface RunFeedProps {
  runId: string
  cache: RunFeedCache | undefined
  metrics?: CiMetrics | null
  onSubscribe: (runId: string) => void
  onUnsubscribe: (runId: string) => void
  onLoad: (runId: string) => void
  onRetry: (runId: string) => void
  onRetryFromStep?: (runId: string, selection?: { provider: 'claude' | 'codex'; model: string }) => void
  onDiscardAndRetry?: (runId: string) => void
  onCancel: (runId: string) => void
  onLoadMetrics?: (projectId: string) => void
  /** Ответить на паузу рана: уточнение модели или решение по плану. */
  onAnswerInteraction?: (runId: string, interactionId: string, answer: CiInteractionAnswer) => void
  now?: () => number
  download?: (filename: string, text: string) => void
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
  const now = props.now ?? Date.now
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [autoscroll, setAutoscroll] = useState(true)
  const [modelProvider, setModelProvider] = useState<'claude' | 'codex'>('claude')
  const [modelName, setModelName] = useState('sonnet')
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

  useEffect(() => {
    if (!run) return
    setModelProvider(run.llmProvider)
    setModelName(run.llmModel)
  }, [run?.id, run?.llmProvider, run?.llmModel])

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
                  Провайдер
                  <select className="sel" value={modelProvider} onChange={(e) => {
                    const provider = e.target.value === 'codex' ? 'codex' : 'claude'
                    setModelProvider(provider)
                    setModelName(provider === 'codex' ? '' : 'sonnet')
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
                <button className="ci-btn" disabled={!props.onRetryFromStep || (modelProvider === 'claude' && !modelName)} onClick={() => props.onRetryFromStep?.(runId, { provider: modelProvider, model: modelName })}>
                  Повторить работу модели
                </button>
              </div>
            )}
            {step.kind === 'command' && step.status === 'failed' && step.exitCode === 66 && run?.status === 'failed' && (
              <div className="ci-model-retry" data-testid="ci-dirty-workspace">
                <strong>В рабочем репозитории есть локальные изменения.</strong>
                <span>Можно сохранить их для диагностики или безвозвратно откатить и начать workflow заново.</span>
                <button className="ci-btn" disabled={!props.onDiscardAndRetry} onClick={() => {
                  if (window.confirm('Все незакоммиченные и неотслеживаемые файлы в рабочем репозитории будут удалены. Продолжить?')) props.onDiscardAndRetry?.(runId)
                }}>
                  Откатить изменения и начать заново
                </button>
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
        <div className="ci-runfeed-actions">
          <label className="ci-mode-indicator"><input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} /> автоскролл</label>
          {running && <button className="ci-btn" onClick={() => props.onCancel(runId)}>Отменить</button>}
          <button className="ci-btn" onClick={() => props.onRetry(runId)}>Повторить весь воркфлоу</button>
          <button className="ci-btn" onClick={() => (props.onRetryFromStep ?? props.onRetry)(runId)} disabled={running} title="Перезапустить упавший шаг и всё после него в этом же ране">Повторить с упавшего шага</button>
          <button className="ci-btn" onClick={() => download(`ci-run-${runId}.log`, logText())}>Скачать лог</button>
          <button className="ci-btn" onClick={() => setConsoleOpen(true)}>Консоль</button>
        </div>
      </div>

      {cache?.conclusion && (
        <div className="ci-lozenge ci-lozenge--removed" data-testid="ci-conclusion" style={{ display: 'block', padding: '8px', textTransform: 'none' }}>
          {conclusionLabel(cache.conclusion)}: {cache.conclusion.summary}
        </div>
      )}

      <ul className="ci-steps">
        {topSteps.roots.length === 0 && <li className="ci-empty">Шагов пока нет.</li>}
        {topSteps.roots.map((s) => renderStep(s, false))}
      </ul>
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
              <button className="btn-primary" disabled={props.disabled} onClick={() => props.onAnswer({ decision: 'approved', text: comment })}>
                Одобрить и разрабатывать
              </button>
              <button className="ci-btn" disabled={props.disabled} onClick={() => props.onAnswer({ decision: 'rework', text: comment })}>
                На доработку
              </button>
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