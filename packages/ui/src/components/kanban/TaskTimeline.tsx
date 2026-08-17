import { useEffect, useState } from 'react'
import type { TaskTimeline as Timeline, TaskTimelineAttempt, TaskTimelineStage, TaskTimelineStatus } from '@shared/timeline'

const STATUS: Record<TaskTimelineStatus, string> = {
  queued: 'В очереди', running: 'Выполняется', awaiting_input: 'Ждёт ответа',
  succeeded: 'Успешно', failed: 'Ошибка', cancelled: 'Отменено', skipped: 'Пропущено'
}
export function formatTimelineDuration(ms: number | null): string {
  if (ms == null) return 'Нет данных'
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} с`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч${minutes % 60 ? ` ${minutes % 60} мин` : ''}`
  const days = Math.floor(hours / 24)
  return `${days} д${hours % 24 ? ` ${hours % 24} ч` : ''}`
}
export function formatTimelineDate(value: string | null): string {
  return value == null ? 'Нет данных' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value))
}
function liveDuration(attempt: TaskTimelineAttempt, now: number): number | null {
  if (attempt.activeDuration == null) return null
  return attempt.activeDuration + attempt.activeIntervals.reduce((sum, interval) =>
    sum + (interval.finishedAt == null ? Math.max(0, now - Date.parse(interval.startedAt)) : 0), 0)
}
function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="task-timeline-field"><dt>{label}</dt><dd>{value}</dd></div>
}
function Attempt({ attempt, now }: { attempt: TaskTimelineAttempt; now: number }): JSX.Element {
  return <details className="task-timeline-attempt">
    <summary>Попытка {attempt.number} · {STATUS[attempt.status]}</summary>
    <dl>
      <Field label="Очередь" value={formatTimelineDuration(attempt.queueDuration)} />
      <Field label="Активная работа" value={formatTimelineDuration(liveDuration(attempt, now))} />
      <Field label="Ожидание пользователя" value={formatTimelineDuration(attempt.awaitingInputDuration)} />
      <Field label="Модель" value={attempt.model ?? 'Нет данных'} />
      <Field label="Машина" value={attempt.machine ?? attempt.executor ?? 'Нет данных'} />
      <Field label="Причина" value={attempt.reason?.message ?? attempt.reason?.code ?? 'Нет данных'} />
      <Field label="Связанные раны" value={attempt.runs.length ? attempt.runs.map((run) => `${run.kind}: ${run.id}`).join(', ') : 'Нет данных'} />
    </dl>
    {attempt.queueIntervals.length > 0 && <p>Интервалы очереди: {attempt.queueIntervals.map((item) => `${formatTimelineDate(item.startedAt)} — ${formatTimelineDate(item.finishedAt)}`).join('; ')}</p>}
    {attempt.awaitingInputIntervals.length > 0 && <p>Паузы awaiting_input: {attempt.awaitingInputIntervals.map((item) => `${formatTimelineDate(item.startedAt)} — ${formatTimelineDate(item.finishedAt)}`).join('; ')}</p>}
  </details>
}
function Stage({ stage, now }: { stage: TaskTimelineStage; now: number }): JSX.Element {
  const live = stage.activeDuration == null ? null : stage.activeDuration + stage.attempts.reduce((sum, attempt) =>
    sum + (liveDuration(attempt, now) ?? 0) - (attempt.activeDuration ?? 0), 0)
  return <details className="task-timeline-stage" data-stage-id={stage.id}>
    <summary>
      <span>{stage.title}</span><span>{STATUS[stage.status]}</span>
      <span>{formatTimelineDate(stage.startedAt)}</span><span>{formatTimelineDate(stage.finishedAt)}</span>
      <span>{formatTimelineDuration(live)}</span>
    </summary>
    <dl>
      <Field label="Попыток" value={String(stage.attemptCount)} />
      <Field label="Активное время" value={formatTimelineDuration(live)} />
      <Field label="Очередь" value={formatTimelineDuration(stage.queueDuration)} />
      <Field label="Ожидание пользователя" value={formatTimelineDuration(stage.awaitingInputDuration)} />
      <Field label="Успешные попытки" value={formatTimelineDuration(stage.successfulDuration)} />
      <Field label="Неуспешные попытки" value={formatTimelineDuration(stage.unsuccessfulDuration)} />
    </dl>
    {stage.attempts.map((attempt) => <Attempt key={attempt.id} attempt={attempt} now={now} />)}
  </details>
}
export function TaskTimeline({ projectId, taskId }: { projectId: string; taskId: string }): JSX.Element {
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [failed, setFailed] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    let live = true
    setTimeline(null); setFailed(false)
    const request = window.ci?.getTaskTimeline(projectId, taskId)
    if (!request) { setFailed(true); return () => { live = false } }
    void request.then((value) => { if (live) setTimeline(value) }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [projectId, taskId])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  if (failed) return <p role="alert">Не удалось загрузить временную шкалу.</p>
  if (!timeline) return <p>Загрузка временной шкалы…</p>
  const age = timeline.summary.finishedAt == null ? Math.max(0, now - Date.parse(timeline.summary.createdAt)) : null
  return <section className="task-timeline" aria-label="Временная шкала">
    <details className="task-timeline-summary" open>
      <summary>Сводка задачи</summary>
      <dl>
        <Field label="Создана" value={formatTimelineDate(timeline.summary.createdAt)} />
        <Field label="Первый запуск" value={formatTimelineDate(timeline.summary.firstStartedAt)} />
        <Field label="Завершена или отменена" value={formatTimelineDate(timeline.summary.finishedAt)} />
        <Field label="Полный календарный цикл" value={formatTimelineDuration(timeline.summary.calendarDuration)} />
        <Field label="Активное время" value={formatTimelineDuration(timeline.summary.activeDuration)} />
        <Field label="Очередь" value={formatTimelineDuration(timeline.summary.queueDuration)} />
        <Field label="Ожидание пользователя" value={formatTimelineDuration(timeline.summary.awaitingInputDuration)} />
        <Field label="Текущий возраст" value={formatTimelineDuration(age)} />
        <Field label="Последнее изменение" value={formatTimelineDate(timeline.summary.lastChangedAt)} />
      </dl>
    </details>
    <div className="task-timeline-stages">{timeline.stages.map((stage) => <Stage key={stage.id} stage={stage} now={now} />)}</div>
  </section>
}
