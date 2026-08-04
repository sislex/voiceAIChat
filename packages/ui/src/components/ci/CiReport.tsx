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
// плитках прочерки, а шаги и длительности показываются как обычно. Строки
// «Инструменты» у такого рана нет вовсе: ноль вызовов читался бы как поломка.

import { useMemo, useState } from 'react'
import type { CiRunReport, CiRunReportStep, CiTaskReport, CiUsageTotals } from '@shared/ci'
import { CI_USAGE_KIND_LABELS, ciAvgContextPerRequest, ciToolCallsTotal, ciToolCharsTotal, sumCiToolCalls, sumCiToolChars, topCiToolResponses } from '@shared/ci'
import { ciStatusIcon, ciStatusLabel, ciTone, fmtChars, fmtDuration, fmtTokens, fmtUsd } from './ciFormat'

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
  // Вызовы инструментов: у выбранного рана свои, у итога — сумма тех ранов, где
  // счётчик есть. null (ран до фичи) сохраняется как null: ноль читался бы как
  // «модель не вызвала ничего».
  const toolCalls = run ? run.toolCalls : sumCiToolCalls(runs.map((r) => r.toolCalls))
  // Объём ответов и самые тяжёлые из них — второй множитель цены хода: контекст
  // раздувают именно ответы, и они перечитываются на каждом следующем запросе.
  const toolChars = run ? run.toolChars : sumCiToolChars(runs.map((r) => r.toolChars))
  const heaviest = run ? run.toolResponses : topCiToolResponses(runs.flatMap((r) => r.toolResponses))
  const avgContext = totals ? ciAvgContextPerRequest(totals) : null
  // Не «запросы модели» (ходы CLI), а API-запросы на один инструментальный
  // вызов: это второй множитель цены и прямой сигнал, где выгоден батч.
  const apiRequestsPerToolCall = totals?.apiRequests && toolCalls && ciToolCallsTotal(toolCalls)
    ? totals.apiRequests / ciToolCallsTotal(toolCalls)
    : null
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
          note={totals?.costUnderstated
            ? 'оценка по прайсу, итог занижен: у части ходов модель неизвестна'
            : totals?.costEstimated ? 'оценка по прайсу' : undefined}
          testId={`${testId}-cost`}
        />
        <Tile
          label="Токены"
          value={fmtTokens(totals?.tokens ?? 0)}
          note={`вход ${fmtTokens(totals?.inputTokens ?? 0)} · выход ${fmtTokens(totals?.outputTokens ?? 0)} · кэш ${fmtTokens((totals?.cacheReadTokens ?? 0) + (totals?.cacheCreationTokens ?? 0))}${totals?.inputNormalized ? ' · вход приведён к «без кэша»' : ''}`}
          testId={`${testId}-tokens`}
        />
        <Tile label="Запросов к модели" value={fmtTokens(totals?.requests ?? 0)} testId={`${testId}-requests`} />
        {/* Цена хода = размер контекста × число запросов к API. Средний контекст
            на запрос — тот множитель, который и съедает 3/4 стоимости; максимум
            показывает, до чего он дорос к концу хода. Прочерк — когда CLI не
            сказал числа запросов (codex): ноль читался бы как «контекста нет». */}
        <Tile
          label="Контекст на запрос"
          value={avgContext == null ? '—' : fmtTokens(avgContext)}
          note={avgContext == null
            ? 'CLI не сообщил число запросов'
            : `макс ${fmtTokens(totals?.maxContextPerRequest ?? 0)} · запросов к API ${fmtTokens(totals?.apiRequests ?? 0)}`}
          testId={`${testId}-context`}
        />
        <Tile label="Время рана" value={fmtDuration(durationMs)} testId={`${testId}-duration`} />
        {/* Ноль — это «CLI не сказал длительность ни по одному ходу» (старые раны
            через исполнителя), а не «модель работала 0мс»: показываем прочерк. */}
        <Tile label="Работа модели" value={fmtDuration(totals?.modelActiveMs || null)} testId={`${testId}-model-time`} />
      </div>

      {toolCalls && <p className="ci-report__note" data-testid={`${testId}-tools`}>
        Инструменты: {ciToolCallsTotal(toolCalls)} вызовов, из них чтений {toolCalls.read}, правок {toolCalls.edit}
        {' '}(bash {toolCalls.bash} · read {toolCalls.read} · grep {toolCalls.grep} · edit {toolCalls.edit} · БЗ {toolCalls.kb})
        {apiRequestsPerToolCall != null && ` · API-запросов на вызов в среднем ${apiRequestsPerToolCall.toFixed(1)}`}
        {/* Отказ — не вид инструмента, а исход вызова: он уже посчитан своим
            видом, поэтому идёт отдельной припиской и только когда он был. */}
        {toolCalls.denied > 0 && ` · отказов ${toolCalls.denied}`}
        {/* Объём важнее счётчика: 40 окон read дешевле одного `npm ci`, чей вывод
            потом перечитывается на каждом следующем запросе хода. */}
        {toolChars && ciToolCharsTotal(toolChars) > 0 && (
          <> · ответами {fmtChars(ciToolCharsTotal(toolChars))} симв.
            {' '}(bash {fmtChars(toolChars.bash)} · read {fmtChars(toolChars.read)} · grep {fmtChars(toolChars.grep)} · БЗ {fmtChars(toolChars.kb)})
          </>
        )}
      </p>}
      {/* Три самых тяжёлых ответа за ран: у «контекст раздулся» должен быть
          виновник с именем, иначе резать нечего. */}
      {heaviest.length > 0 && <p className="ci-report__note" data-testid={`${testId}-heaviest`}>
        Самые тяжёлые ответы: {heaviest.map((r, i) => (
          <span key={`${r.at}-${i}`}>
            {i > 0 && '; '}
            {r.label || r.tool || r.kind} — {fmtChars(r.chars)} симв.
            {r.originalChars != null && r.originalChars > r.chars && ` (обрезано из ${fmtChars(r.originalChars)})`}
          </span>
        ))}
      </p>}
      {/* Доля важнее счётчика: «выдано 5 разделов» само по себе не говорит,
          пригодился ли хоть один. Раздел считается пригодившимся, когда модель
          открыла файл из его areas (ci/kbHit.ts). */}
      {kbHit && kbHit.sectionsDelivered > 0 && <p className="ci-report__note" data-testid={`${testId}-kb-hit`}>
        БЗ: выдано {kbHit.sectionsDelivered} разделов, пригодились {kbHit.sectionsHit}
        {' '}({Math.round((kbHit.sectionsHit / kbHit.sectionsDelivered) * 100)}% — модель открыла файлы из них)
      </p>}
      {/* Стадии рана: раз модель у них разная (разработка — на модели рана,
          актуализация БЗ и резюме — на дешёвой), в отчёте должно быть видно,
          чем каждая посчитана и во что обошлась. Строк нет у ранов до фичи
          расхода — там и разбивать нечего. */}
      {run && run.stages.length > 0 && (
        <table className="ci-report-steps" data-testid={`${testId}-stages`}>
          <caption className="ci-report__caption">Стадии рана</caption>
          <thead>
            <tr>
              <th scope="col">Стадия</th>
              <th scope="col">Модель</th>
              <th scope="col">Запросов</th>
              <th scope="col">Время модели</th>
              <th scope="col">Расход</th>
            </tr>
          </thead>
          <tbody>
            {run.stages.map((s) => (
              <tr key={`${s.kind} ${s.model}`}>
                <th scope="row">{CI_USAGE_KIND_LABELS[s.kind]}</th>
                <td>{s.model}</td>
                <td>{fmtTokens(s.totals.requests)}</td>
                <td>{fmtDuration(s.totals.modelActiveMs || null)}</td>
                <td>{stepUsage(s.totals)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
