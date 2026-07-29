// Лента одного CI-рана: таймлайн разворачиваемых шагов (иконка статуса, таймер/
// длительность, exit_code, потоковый лог с автоскроллом), вызовы команд модели
// вложены под model_work, последний элемент — итог модели. Подписка на realtime
// при монтировании, отписка при закрытии; REST-подгрузка как фолбэк.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CiRunDetail, CiRunStep, CiLogLine, CiRunConclusion } from '@shared/ci'
import { CLAUDE_MODELS, CODEX_MODELS } from '@shared/types'
import { isTerminalCiStatus } from '@shared/ci'
import type { CiMetrics } from '../../remote/ciBridge'
import { ciStatusIcon, ciStatusLabel, ciTone, fmtDuration } from './ciFormat'
import { CiConsole } from './CiConsole'

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
  onCancel: (runId: string) => void
  onLoadMetrics?: (projectId: string) => void
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

  const renderStep = (step: CiRunStep, nested: boolean): JSX.Element => {
    const open = expanded[step.id] ?? (step.status === 'running' || step.status === 'failed')
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
            {step.kind === 'model_work' && step.status === 'failed' && run?.status === 'failed' && (
              <div className="ci-model-retry" data-testid="ci-model-retry">
                <strong>Модель завершилась с ошибкой. Финальные команды не запускались.</strong>
                <label>
                  Провайдер
                  <select className="sel" value={modelProvider} onChange={(e) => {
                    const provider = e.target.value === 'codex' ? 'codex' : 'claude'
                    setModelProvider(provider)
                    setModelName(provider === 'codex' ? 'gpt-5-codex' : 'sonnet')
                  }}>
                    <option value="claude">Claude</option>
                    <option value="codex">Codex</option>
                  </select>
                </label>
                <label>
                  Модель
                  <select className="sel" value={modelName} onChange={(e) => setModelName(e.target.value)}>
                    {(modelProvider === 'codex' ? CODEX_MODELS.filter((m) => m.id) : CLAUDE_MODELS).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </label>
                <button className="ci-btn" disabled={!props.onRetryFromStep || !modelName} onClick={() => props.onRetryFromStep?.(runId, { provider: modelProvider, model: modelName })}>
                  Повторить работу модели
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