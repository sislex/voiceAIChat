import { useCallback, useEffect, useState } from 'react'
import type { TaskPreparationRun } from '@shared/qa'
import { Button } from '@voicechat/ui-kit'

export interface TaskPreparationTabProps {
  projectId: string
  taskId: string
  liveRunId?: string | null
  liveStatus?: TaskPreparationRun['status'] | null
  loadRuns?: (taskId: string) => Promise<TaskPreparationRun[]>
  onRetry?: (runId: string) => Promise<TaskPreparationRun | void>
  onCancel?: (runId: string) => Promise<TaskPreparationRun | void>
  onAnswer?: (questionId: string, answer: string) => Promise<unknown>
  onExport?: (runId: string, format: 'md' | 'json') => Promise<void>
}

const STATUS_LABEL: Record<TaskPreparationRun['status'], string> = {
  queued: 'в очереди',
  running: 'выполняется',
  waiting_for_answer: 'ожидает ответа',
  validating: 'проверяется',
  completed: 'завершено',
  success: 'успешно',
  failed: 'ошибка',
  cancelled: 'отменён',
  blocked: 'заблокирован'
}

export function TaskPreparationTab(props: TaskPreparationTabProps): JSX.Element {
  const [runs, setRuns] = useState<TaskPreparationRun[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(props.liveRunId ?? null)
  const [loading, setLoading] = useState(Boolean(props.loadRuns))
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<'retry' | 'cancel' | 'answer' | null>(null)
  const [answer, setAnswer] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    if (!props.loadRuns) { setLoading(false); return }
    try {
      const next = await props.loadRuns(props.taskId)
      setRuns(next)
      setSelectedId((current) => {
        if (props.liveRunId && next.some((run) => run.id === props.liveRunId)) return props.liveRunId
        return current && next.some((run) => run.id === current) ? current : next[0]?.id ?? null
      })
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [props.loadRuns, props.taskId, props.liveRunId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!props.liveStatus || !['queued', 'running', 'waiting_for_answer', 'validating'].includes(props.liveStatus)) return
    const timer = window.setInterval(() => void refresh(), 1500)
    return () => window.clearInterval(timer)
  }, [props.liveStatus, refresh])

  const selected = runs.find((run) => run.id === selectedId) ?? runs[0] ?? null

  const act = async (kind: 'retry' | 'cancel'): Promise<void> => {
    if (!selected || pending) return
    setPending(kind)
    try {
      const next = await (kind === 'retry' ? props.onRetry?.(selected.id) : props.onCancel?.(selected.id))
      if (next) {
        setRuns((previous) => [next, ...previous.filter((run) => run.id !== next.id)])
        setSelectedId(next.id)
      }
      await refresh()
    } finally {
      setPending(null)
    }
  }

  const submitAnswer = async (questionId: string): Promise<void> => {
    if (!answer.trim() || pending || !props.onAnswer) return
    setPending('answer')
    try {
      await props.onAnswer(questionId, answer.trim())
      setAnswer('')
      await refresh()
    } finally {
      setPending(null)
    }
  }

  if (loading && runs.length === 0) return <p className="task-tab-empty">Загрузка истории подготовки…</p>
  if (error && runs.length === 0) return <div role="alert"><p>{error}</p><Button size="sm" onClick={() => void refresh()}>Повторить загрузку</Button></div>
  if (!selected) return <p className="task-tab-empty" data-testid="task-preparation-empty">Подготовка к разработке ещё не запускалась.</p>

  return (
    <div className="task-preparation-tab" data-testid="task-preparation-tab">
      <div className="jmodal-ci-head">
        <span className="ci-task-title">Подготовка к разработке</span>
        <span className="ci-lozenge">Статус: {STATUS_LABEL[selected.status]}</span>
        <span className="ci-lozenge">Фаза: {selected.phase ?? 'initialization'}</span>
        <span className="ci-lozenge">Длительность: {Math.round((selected.durationMs ?? 0) / 1000)} с</span>
      </div>
      {(selected.status === 'failed' || selected.status === 'blocked') && selected.error && <p role="alert">Причина остановки: {selected.error}</p>}
      {(selected.questions ?? []).filter((question) => question.status === 'open').map((question) => (
        <section key={question.questionId} data-testid="task-preparation-question">
          <h4>Требуется уточнение</h4>
          <p>{question.text}</p>
          <textarea aria-label="Ответ на вопрос подготовки" value={answer} onChange={(event) => setAnswer(event.target.value)} />
          <Button size="sm" loading={pending === 'answer'} disabled={!answer.trim()} onClick={() => void submitAnswer(question.questionId)}>Отправить ответ</Button>
        </section>
      ))}
      {(selected.gateResults?.length ?? 0) > 0 && (
        <div>
          <h4>Readiness-гейты</h4>
          <ul data-testid="task-preparation-gates">{(selected.gateResults ?? []).map((gate) => <li key={gate.code}>{gate.code}: {gate.status} — {gate.explanation}</li>)}</ul>
        </div>
      )}
      {selected.gateReasons.length > 0 && (
        <div>
          <h4>Непройденные условия готовности</h4>
          <ul data-testid="task-preparation-gate-reasons">{selected.gateReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
      )}
      <ol className="ci-console-pre" data-testid="task-preparation-feed" aria-live="polite">
        {selected.events?.length ? selected.events.map((event) => <li key={event.eventId}>#{event.sequence} · {event.phase} · {event.text}</li>) : <li>{selected.log || (selected.canCancel ? 'Ожидаем ответ модели…' : 'Лента этой попытки пуста.')}</li>}
      </ol>
      {selected.readiness && <section data-testid="task-preparation-brief"><h4>Development Brief</h4><pre className="ci-console-pre">{JSON.stringify(selected.readiness, null, 2)}</pre></section>}
      <div className="jmodal-ci-actions">
        {selected.canCancel && props.onCancel && <Button variant="danger" size="sm" loading={pending === 'cancel'} onClick={() => void act('cancel')}>Отменить</Button>}
        {selected.canRetry && props.onRetry && <Button variant="primary" size="sm" loading={pending === 'retry'} onClick={() => void act('retry')}>Повторить подготовку</Button>}
        {props.onExport && <><Button size="sm" onClick={() => void props.onExport?.(selected.id, 'md')}>Скачать Markdown</Button><Button size="sm" onClick={() => void props.onExport?.(selected.id, 'json')}>Скачать JSON</Button></>}
      </div>
      <h4>Предыдущие попытки</h4>
      <ol className="task-progress-list" data-testid="task-preparation-history">
        {runs.map((run) => (
          <li key={run.id}>
            <button type="button" aria-pressed={selected.id === run.id} onClick={() => setSelectedId(run.id)}>
              Попытка {run.attempt} · {new Date(run.createdAt).toLocaleString('ru')} · {STATUS_LABEL[run.status]}
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
