// Presentational building blocks of the "Проект 19" task card: the stage rail
// with numbered circles, the status badge vocabulary, workflow snapshots and
// the "sent reworks" box. No data loading here — panels compose these around
// the functional legacy panels so both cards share one implementation of every
// action.
import type { ReactNode } from 'react'
import { Badge, Button } from '@voicechat/ui-kit'
import { formatDateTime } from '../../lib/dateFormat'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'
import { STAGE_STATUS_LABEL, isOpenByDefault, stageStatusTone, type StageStatus } from './taskCycles'

export function StageBadge({ status, label, testId }: { status: StageStatus; label?: string; testId?: string }): JSX.Element {
  return <Badge tone={stageStatusTone(status)} className={`new-task-stage-badge new-task-stage-badge--${status}`} {...(testId ? { testId } : {})}>{label ?? STAGE_STATUS_LABEL[status]}</Badge>
}

/** Heading of a process tab: eyebrow, title, explanation and the count badge. */
export function StageHeading({ eyebrow, title, description, badge }: { eyebrow: string; title: string; description?: string; badge?: ReactNode }): JSX.Element {
  return <header className="new-task-stage-heading">
    <div>
      <span className="new-task-eyebrow">{eyebrow}</span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
    </div>
    {badge}
  </header>
}

export function StageRail({ children, testId }: { children: ReactNode; testId?: string }): JSX.Element {
  return <div className="new-task-stage-rail" {...(testId ? { 'data-testid': testId } : {})}>{children}</div>
}

export interface StageCardProps {
  number: number
  status: StageStatus
  /** "Этап 2" / "Проход 3" — what the design prints above the title. */
  eyebrow: string
  title: string
  /** Extra badge text; by default the status label. */
  statusLabel?: string
  /** Workflow of the cycle: rendered as a chain of chips. */
  workflow?: string[]
  /** Cycle whose reworks this stage implements; null — the original statement. */
  cycle?: TaskReworkCycleViewModel | null
  /** Text of the "source" box when there is no cycle. */
  sourceTitle?: string
  sourceText?: string
  /** The stage is the one whose full panel is shown. */
  selected?: boolean
  onSelect?: () => void
  /** Draw the connector line below the number: not for the last stage. */
  connector?: boolean
  /** Collapsible details (feed, results); open state follows the status. */
  detailsSummary?: string
  detailsOpen?: boolean
  details?: ReactNode
  /** Always visible content of the stage (metrics, checks, actions). */
  children?: ReactNode
  testId?: string
}

/** One stage of the rail: number circle, title, status badge, cycle context and content. */
export function StageCard(props: StageCardProps): JSX.Element {
  const done = props.status === 'success'
  return <article
    className={`new-task-stage-card new-task-stage-card--${props.status}${props.selected ? ' new-task-stage-card--selected' : ''}`}
    aria-current={props.selected ? 'step' : undefined}
    {...(props.testId ? { 'data-testid': props.testId } : {})}
  >
    <div className="new-task-stage-index" aria-hidden="true">
      <i>{done ? '✓' : props.number}</i>
      {props.connector && <span />}
    </div>
    <div className="new-task-stage-content">
      <header>
        <div>
          <span className="new-task-eyebrow">{props.eyebrow}</span>
          <h4>{props.title}</h4>
        </div>
        <div className="new-task-stage-actions">
          <StageBadge status={props.status} {...(props.statusLabel ? { label: props.statusLabel } : {})} />
          {props.onSelect && !props.selected && <Button size="sm" variant="ghost" onClick={props.onSelect}>Показать</Button>}
        </div>
      </header>
      {props.workflow && props.workflow.length > 0 && <WorkflowSnapshot steps={props.workflow} />}
      {props.cycle
        ? <CycleReworks cycle={props.cycle} />
        : (props.sourceTitle || props.sourceText) && <SourceBox title={props.sourceTitle ?? 'Источник этапа'} text={props.sourceText ?? ''} />}
      {props.children}
      {props.details && <details className="new-task-stage-details" open={props.detailsOpen ?? isOpenByDefault(props.status)}>
        <summary>{props.detailsSummary ?? 'Лента и результаты этапа'}</summary>
        {props.details}
      </details>}
    </div>
  </article>
}

/** Chain "Подготовка → Development → …" — the workflow fixed for one cycle. */
export function WorkflowSnapshot({ steps, title = 'Workflow этого цикла' }: { steps: string[]; title?: string }): JSX.Element {
  return <div className="new-task-workflow-snapshot">
    <b>{title}</b>
    <div>{steps.map((step, index) => <span key={`${step}-${index}`}>{step}{index < steps.length - 1 && <i aria-hidden="true"> →</i>}</span>)}</div>
  </div>
}

/** Reworks a stage implements: number, first line as title, the rest as detail. */
export function CycleReworks({ cycle, title = 'Отправлены доработки' }: { cycle: TaskReworkCycleViewModel; title?: string }): JSX.Element {
  const [head, ...rest] = cycle.description.split('\n')
  return <div className="new-task-sent-reworks">
    <b>{title}</b>
    <div>
      <span>№ {cycle.sequence}</span>
      <div>
        <strong>{head || 'Без описания'}</strong>
        {rest.join('\n').trim() && <small>{rest.join('\n').trim()}</small>}
        {cycle.criteria.length > 0 && <small>Критерии: {cycle.criteria.join('; ')}</small>}
        <small>{cycle.createdBy} · {formatDateTime(cycle.createdAt)}</small>
      </div>
    </div>
  </div>
}

export function SourceBox({ title, text }: { title: string; text: string }): JSX.Element {
  return <div className="new-task-source-box"><b>{title}</b><span>{text}</span></div>
}

export interface StageAttempt {
  id: string
  label: string
  status: StageStatus
  at?: number | null
  note?: string
}

/**
 * Attempts inside one stage. The selected attempt is the one whose functional
 * panel is rendered below; the others switch to it on click.
 */
export function AttemptList({ attempts, selectedId, onSelect, ariaLabel }: { attempts: StageAttempt[]; selectedId?: string | null; onSelect?: (id: string) => void; ariaLabel: string }): JSX.Element | null {
  if (attempts.length < 2) return null
  return <div className="new-task-attempts" role="group" aria-label={ariaLabel}>
    {attempts.map((attempt) => <button
      key={attempt.id} type="button"
      className={`new-task-attempt${attempt.id === selectedId ? ' new-task-attempt--selected' : ''}`}
      aria-pressed={attempt.id === selectedId}
      onClick={() => onSelect?.(attempt.id)}
    >
      <span>{attempt.label}</span>
      <StageBadge status={attempt.status} />
      {attempt.at != null && <small>{formatDateTime(attempt.at)}</small>}
      {attempt.note && <small>{attempt.note}</small>}
    </button>)}
  </div>
}

/** Design "checks" list: a pair of named checks with pass/fail marks. */
export function CheckList({ checks }: { checks: Array<{ id: string; title: string; note: string; ok: boolean | null }> }): JSX.Element {
  return <div className="new-task-checks">
    {checks.map((check) => <div key={check.id}>
      <i className={check.ok === false ? 'new-task-check-bad' : check.ok === true ? 'new-task-check-ok' : ''} aria-hidden="true">{check.ok === false ? '!' : check.ok === true ? '✓' : '·'}</i>
      <span><b>{check.title}</b><small>{check.note}</small></span>
    </div>)}
  </div>
}

/** Metric tiles of the design: four short figures under a stage header. */
export function MetricTiles({ items }: { items: Array<{ label: string; value: string }> }): JSX.Element {
  return <div className="new-task-metric-tiles">
    {items.map((item) => <article key={item.label}><small>{item.label}</small><b>{item.value}</b></article>)}
  </div>
}
