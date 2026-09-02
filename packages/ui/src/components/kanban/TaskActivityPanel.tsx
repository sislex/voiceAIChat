// Вкладка «Активность» карточки — как в Jira: три ленты (комментарии, история,
// ворклог) с переключателем. Комментарии добавляют и правят и человек, и
// модель канбан-ассистента (запись модели помечена бейджем); историю пишет
// сервер сам при изменении полей, здесь она только читается.
import { useCallback, useEffect, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { TaskActivity, TaskComment, TaskWorklogEntry } from '@shared/projects'
import { Button, EmptyState, ErrorState, Skeleton, useConfirm, useToast } from '@voicechat/ui-kit'
import { formatDateTime } from '../../lib/dateFormat'

type ActivityApi = Pick<RendererApi,
  'tasks:activity' | 'tasks:commentAdd' | 'tasks:commentUpdate' | 'tasks:commentDelete' |
  'tasks:worklogAdd' | 'tasks:worklogUpdate' | 'tasks:worklogDelete'>

interface Props {
  projectId: string
  taskId: string
  api: ActivityApi
}

/** Человеческие подписи полей истории — коды контракта наружу не показываем. */
const FIELD_LABEL: Record<string, string> = {
  title: 'Название', description: 'Описание', acceptanceCriteria: 'Критерии приёмки',
  priority: 'Приоритет', assignee: 'Исполнитель', storyPoints: 'Оценка', dueDate: 'Срок',
  labels: 'Метки', skills: 'Навыки', type: 'Тип', flagged: 'Флаг', column: 'Этап'
}

/** «2 ч 30 м» из минут — формат Jira, привычный глазу. */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours && rest) return `${hours} ч ${rest} м`
  return hours ? `${hours} ч` : `${rest} м`
}

export function TaskActivityPanel({ projectId, taskId, api }: Props): JSX.Element {
  const toast = useToast()
  const confirm = useConfirm()
  const [view, setView] = useState<'comments' | 'history' | 'worklog'>('comments')
  const [activity, setActivity] = useState<TaskActivity | null>(null)
  const [failed, setFailed] = useState(false)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [minutes, setMinutes] = useState('')
  const [workComment, setWorkComment] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    try {
      setActivity(await api['tasks:activity']({ projectId, taskId }))
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [api, projectId, taskId])
  useEffect(() => { void reload() }, [reload])

  const run = async (action: () => Promise<unknown>, success?: string): Promise<void> => {
    setBusy(true)
    try {
      await action()
      await reload()
      if (success) toast.success(success)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  if (failed) return <ErrorState message="Не удалось загрузить активность" onRetry={() => void reload()} />
  if (!activity) return <Skeleton variant="list" count={3} item="block" height={48} gap={8} />

  const author = (name: string, via: 'user' | 'model'): JSX.Element =>
    <b className="task-act-author">{name}{via === 'model' && <span className="task-act-model" title="Запись добавила модель канбан-ассистента">модель</span>}</b>

  const commentRow = (comment: TaskComment): JSX.Element => <div role="listitem" key={comment.id} className="task-act-row" data-testid="task-comment">
    {editing?.id === comment.id
      ? <div className="task-act-edit">
          <textarea aria-label="Текст комментария" rows={3} value={editing.text} onChange={(event) => setEditing({ id: comment.id, text: event.target.value })} />
          <div className="task-act-actions">
            <Button size="sm" disabled={busy || !editing.text.trim()} onClick={() => void run(async () => {
              await api['tasks:commentUpdate']({ projectId, taskId, commentId: comment.id, text: editing.text })
              setEditing(null)
            }, 'Комментарий изменён')}>Сохранить</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Отмена</Button>
          </div>
        </div>
      : <>
          <div className="task-act-head">
            {author(comment.author, comment.via)}
            <time>{formatDateTime(new Date(comment.createdAt).toISOString())}</time>
            {comment.updatedAt !== null && <span className="task-act-edited" title={`Изменён ${formatDateTime(new Date(comment.updatedAt).toISOString())}`}>изменён</span>}
          </div>
          <p className="task-act-text">{comment.text}</p>
          <div className="task-act-actions">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing({ id: comment.id, text: comment.text })}>Изменить</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void (async () => {
              // Удаление необратимо — подтверждение, как везде в приложении.
              if (!(await confirm({ title: 'Удалить комментарий?', message: 'Восстановить его будет нельзя.', confirmLabel: 'Удалить' }))) return
              await run(() => api['tasks:commentDelete']({ projectId, taskId, commentId: comment.id }), 'Комментарий удалён')
            })()}>Удалить</Button>
          </div>
        </>}
  </div>

  const worklogRow = (entry: TaskWorklogEntry): JSX.Element => <div role="listitem" key={entry.id} className="task-act-row" data-testid="task-worklog-entry">
    <div className="task-act-head">
      {author(entry.author, 'user')}
      <b>{formatMinutes(entry.minutes)}</b>
      <time>{formatDateTime(new Date(entry.startedAt).toISOString())}</time>
    </div>
    {entry.comment && <p className="task-act-text">{entry.comment}</p>}
    {/* Кнопка видна всем: право удалять чужое (владелец, админ) знает сервер,
        и его отказ придёт словами — прятать кнопку по неполной догадке хуже. */}
    <div className="task-act-actions">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void (async () => {
        if (!(await confirm({ title: 'Удалить запись ворклога?', message: `${formatMinutes(entry.minutes)} будут вычтены из итога.`, confirmLabel: 'Удалить' }))) return
        await run(() => api['tasks:worklogDelete']({ projectId, taskId, entryId: entry.id }), 'Запись удалена')
      })()}>Удалить</Button>
    </div>
  </div>

  return <div className="task-activity-panel" data-testid="task-activity-panel">
    <div className="task-act-tabs" role="group" aria-label="Вид активности">
      <Button size="sm" variant={view === 'comments' ? 'primary' : 'ghost'} aria-pressed={view === 'comments'} onClick={() => setView('comments')}>Комментарии ({activity.comments.length})</Button>
      <Button size="sm" variant={view === 'history' ? 'primary' : 'ghost'} aria-pressed={view === 'history'} onClick={() => setView('history')}>История ({activity.history.length})</Button>
      <Button size="sm" variant={view === 'worklog' ? 'primary' : 'ghost'} aria-pressed={view === 'worklog'} onClick={() => setView('worklog')}>Ворклог ({formatMinutes(activity.totalMinutes)})</Button>
    </div>

    {view === 'comments' && <section aria-label="Комментарии">
      {activity.comments.length === 0
        ? <EmptyState title="Пока нет комментариев — напишите первый" description="Комментарии видит вся команда проекта; модель ассистента тоже может их оставлять." />
        : <div role="list" className="task-act-list">{activity.comments.map(commentRow)}</div>}
      <div className="task-act-composer">
        <textarea aria-label="Новый комментарий" rows={3} placeholder="Комментарий…" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <Button size="sm" disabled={busy || !draft.trim()} onClick={() => void run(async () => {
          await api['tasks:commentAdd']({ projectId, taskId, text: draft })
          setDraft('')
        }, 'Комментарий добавлен')}>Добавить</Button>
      </div>
    </section>}

    {view === 'history' && <section aria-label="История изменений">
      {activity.history.length === 0
        ? <EmptyState title="Изменений пока не было" description="История заполнится, когда поля карточки начнут меняться." />
        : <div role="list" className="task-act-list">{activity.history.map((event) => <div role="listitem" key={event.id} className="task-act-row" data-testid="task-history-event">
            <div className="task-act-head">
              {author(event.actor, event.via)}
              <span>{FIELD_LABEL[event.field] ?? event.field}</span>
              <time>{formatDateTime(new Date(event.at).toISOString())}</time>
            </div>
            <p className="task-act-text task-act-diff">
              <s>{event.from ?? '—'}</s> → <b>{event.to ?? '—'}</b>
            </p>
          </div>)}</div>}
    </section>}

    {view === 'worklog' && <section aria-label="Ворклог">
      {activity.worklog.length === 0
        ? <EmptyState title="Времени пока не записано" description="Записывайте затраченное время — итог считается по всем участникам." />
        : <div role="list" className="task-act-list">{activity.worklog.map(worklogRow)}</div>}
      <div className="task-act-composer task-act-worklog-form">
        <input aria-label="Затраченное время в минутах" type="number" min={1} placeholder="Минуты" value={minutes} onChange={(event) => setMinutes(event.target.value)} />
        <input aria-label="Комментарий к ворклогу" type="text" placeholder="Что делали (необязательно)" value={workComment} onChange={(event) => setWorkComment(event.target.value)} />
        <Button size="sm" disabled={busy || !(Number(minutes) > 0)} onClick={() => void run(async () => {
          await api['tasks:worklogAdd']({ projectId, taskId, minutes: Number(minutes), ...(workComment.trim() ? { comment: workComment.trim() } : {}) })
          setMinutes(''); setWorkComment('')
        }, 'Время записано')}>Записать</Button>
      </div>
    </section>}
  </div>
}
