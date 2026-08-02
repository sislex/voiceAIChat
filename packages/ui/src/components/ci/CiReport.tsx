// Раздел «Отчёт» карточки задачи: во что обошёлся её ран(ы) — стоимость, токены
// с разбивкой по кэшу, число запросов к модели, время рана и суммарное время
// работы модели, плюс все шаги CI со статусом, попыткой и длительностью.
//
// Компонент — чистый: данные приходят пропсами (грузит их карточка через мост
// window.ci), состояние здесь только одно — выбранный ран. У задачи ранов бывает
// несколько (повтор после падения, отмена), поэтому переключатель показывает и
// каждый ран по отдельности, и итог по задаче: «сколько это стоило» — вопрос про
// задачу целиком, а «где время» — про конкретный ран.
//
// Расход у старых ранов пустой (строк `ci_run_usage` до фичи не было) — тогда в
// плитках прочерки, а шаги и длительности показываются как обычно.

import { useMemo, useState } from 'react'
import type { CiRunReport, CiRunReportStep, CiTaskReport, CiUsageTotals } from '@shared/ci'
import { ciStatusIcon, ciStatusLabel, ciTone, fmtDuration, fmtTokens, fmtUsd } from './ciFormat'

export interface CiReportProps {
  report: CiTaskReport | null
  loading?: boolean
  error?: string | null
  /** Открыть ленту выбранного рана (у отчёта своей ленты нет). */
  onOpenRun?: (runId: string) => void
  testId?: string
}

/** Выбран итог по всем ранам задачи, а не конкретный ран. */
const TASK_SCOPE = '\u0000task'

function Tile(props: { label: string; value: string; note?: string; testId?: string }): JSX.Element {
  return (
    <div className="ci-report-tile" data-testid={props.testId}>
      <span className="ci-report-tile__label">{props.label}</span>
      <span className="ci-report-tile__value">{props.value}</span>
      {props.note && <span className="ci-report-tile__note">{props.note}</span>}
    </div>
  )
}

/** Строка расхода в таблице: токены и деньги, если ходы модели вообще были. */
function stepUsage(usage: CiUsageTotals | null): string {
  if (!usage || !usage.requests) return '—'
  return `${fmtTokens(usage.tokens)} ток. · ${fmtUsd(usage.costUsd, usage.costEstimated)}`
}

export function CiReport(props: CiReportProps): JSX.Element | null {
  const report = props.report
  const runs = report?.runs ?? []
  // Пусто — ран не выбирали: показываем свежий (там шаги и время, за которыми
  // отчёт обычно и открывают). Итог по задаче — отдельная кнопка переключателя.
  const [scope, setScope] = useState<string>('')
  const selected = scope || runs[0]?.runId
  const run: CiRunReport | null = runs.find((r) => r.runId === selected) ?? null
  const totals: CiUsageTotals | null = run ? run.totals : (report?.totals ?? null)
  const durationMs = run ? run.durationMs : (report?.durationMs ?? null)
  const kbHit = run?.kbHit ?? (!run
    ? runs.reduce<{ sectionsDelivered: number; sectionsHit: number } | null>((sum, item) => item.kbHit
      ? { sectionsDelivered: (sum?.sectionsDelivered ?? 0) + item.kbHit.sectionsDelivered, sectionsHit: (sum?.sectionsHit ?? 0) + item.kbHit.sectionsHit }
      : sum, null)
    : null)

  // Вложенные вызовы команд моделью — под своим шагом, как в ленте рана.
  const tree = useMemo(() => {
    const steps = run?.steps ?? []
    const roots = steps.filter((s) => !s.parentStepId)
    const childrenOf = (id: string): CiRunReportStep[] => steps.filter((s) => s.parentStepId === id)
    return { roots, childrenOf }
  }, [run])

  const testId = props.testId ?? 'ci-report'
  if (props.error) {
    return (
      <div className="ci-report" data-testid={testId}>
        <div className="ci-report__head"><span className="ci-task-title">Отчёт</span></div>
        <p className="ci-report__empty">Отчёт прочитать не удалось: {props.error}</p>
      </div>
    )
  }
  if (!report || !runs.length) {
    if (props.loading) {
      return (
        <div className="ci-report" data-testid={testId}>
          <div className="ci-report__head"><span className="ci-task-title">Отчёт</span></div>
          <p className="ci-report__empty">Считаем расход…</p>
        </div>
      )
    }
    return null
  }

  const stepRow = (step: CiRunReportStep, nested: boolean): JSX.Element => (
    <tr key={step.id} className={nested ? 'ci-report-row--nested' : undefined}>
      <th scope="row">
        <span className="ci-report-step">
          <span className={`ci-step-icon ci-step-icon--${ciTone(step.status)}`} aria-hidden="true">{ciStatusIcon(step.status)}</span>
          {step.title}
          {step.fixedByModel && <span className="ci-lozenge ci-lozenge--success">исправлено моделью</span>}
        </span>
      </th>
      <td>{ciStatusLabel(step.status)}{step.exitCode != null && step.exitCode !== 0 ? ` (код ${step.exitCode})` : ''}</td>
      <td>{step.attempt}</td>
      <td>{fmtDuration(step.durationMs)}</td>
      <td>{stepUsage(step.usage)}</td>
    </tr>
  )

  return (
    <div className="ci-report" data-testid={testId}>
      <div className="ci-report__head">
        <span className="ci-task-title">Отчёт</span>
        <span className="ci-report__note">{runs.length > 1 ? `по ${runs.length} ранам задачи` : 'по рану задачи'}</span>
      </div>

      {runs.length > 1 && (
        <div className="ci-report__runs" role="group" aria-label="Раны задачи">
          <button
            aria-pressed={run === null}
            className={`ci-report__run${run === null ? ' is-active' : ''}`}
            onClick={() => setScope(TASK_SCOPE)}
          >
            Итог по задаче
          </button>
          {runs.map((r, i) => (
            <button
              key={r.runId}
              aria-pressed={run?.runId === r.runId}
              className={`ci-report__run${run?.runId === r.runId ? ' is-active' : ''}`}
              onClick={() => setScope(r.runId)}
            >
              Ран {runs.length - i} · {ciStatusLabel(r.status)}
            </button>
          ))}
        </div>
      )}

      <div className="ci-report__tiles" data-testid={`${testId}-tiles`}>
        <Tile
          label="Стоимость"
          value={fmtUsd(totals?.costUsd ?? null, totals?.costEstimated)}
          note={totals?.costEstimated ? 'оценка по прайсу' : undefined}
          testId={`${testId}-cost`}
        />
        <Tile
          label="Токены"
          value={fmtTokens(totals?.tokens ?? 0)}
          note={`вход ${fmtTokens(totals?.inputTokens ?? 0)} · выход ${fmtTokens(totals?.outputTokens ?? 0)} · кэш ${fmtTokens((totals?.cacheReadTokens ?? 0) + (totals?.cacheCreationTokens ?? 0))}`}
          testId={`${testId}-tokens`}
        />
        <Tile label="Запросов к модели" value={fmtTokens(totals?.requests ?? 0)} testId={`${testId}-requests`} />
        <Tile label="Время рана" value={fmtDuration(durationMs)} testId={`${testId}-duration`} />
        <Tile label="Работа модели" value={fmtDuration(totals?.modelActiveMs ?? null)} testId={`${testId}-model-time`} />
      </div>

      {kbHit && <p className="ci-report__note" data-testid={`${testId}-kb-hit`}>
        БЗ: выдано {kbHit.sectionsDelivered} разделов, задето {kbHit.sectionsHit} файлов из них
      </p>}
      {run ? (
        <>
          <table className="ci-report-steps" data-testid={`${testId}-steps`}>
            <caption className="ci-report__caption">
              Шаги рана
              {run.fixAttempts > 0 ? ` · правок модели: ${run.fixAttempts}` : ''}
              {props.onOpenRun && (
                <button className="ci-report__link" onClick={() => props.onOpenRun?.(run.runId)}>Лента рана</button>
              )}
            </caption>
            <thead>
              <tr>
                <th scope="col">Шаг</th>
                <th scope="col">Статус</th>
                <th scope="col">Попытка</th>
                <th scope="col">Длительность</th>
                <th scope="col">Расход</th>
              </tr>
            </thead>
            <tbody>
              {tree.roots.flatMap((s) => [stepRow(s, false), ...tree.childrenOf(s.id).map((c) => stepRow(c, true))])}
            </tbody>
          </table>
          {!run.steps.length && <p className="ci-report__empty">Шагов в этом ране не было.</p>}
        </>
      ) : (
        <table className="ci-report-steps" data-testid={`${testId}-runs`}>
          <caption className="ci-report__caption">Раны задачи</caption>
          <thead>
            <tr>
              <th scope="col">Ран</th>
              <th scope="col">Статус</th>
              <th scope="col">Запросов</th>
              <th scope="col">Длительность</th>
              <th scope="col">Расход</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={r.runId}>
                <th scope="row">
                  <span className="ci-report-step">
                    <span className={`ci-step-icon ci-step-icon--${ciTone(r.status)}`} aria-hidden="true">{ciStatusIcon(r.status)}</span>
                    Ран {runs.length - i}
                  </span>
                </th>
                <td>{ciStatusLabel(r.status)}</td>
                <td>{fmtTokens(r.totals.requests)}</td>
                <td>{fmtDuration(r.durationMs)}</td>
                <td>{stepUsage(r.totals)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
