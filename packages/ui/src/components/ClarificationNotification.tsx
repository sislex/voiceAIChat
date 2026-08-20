import type { PreparationClarificationNotification } from '@shared/qa'
import { Button } from '@voicechat/ui-kit'

export type ClarificationNotificationState = 'active' | 'stale'

export interface ClarificationNotificationProps {
  notification: PreparationClarificationNotification
  state?: ClarificationNotificationState
  navigating?: boolean
  error?: string | null
  onOpen: (notification: PreparationClarificationNotification) => void
  onDismiss: (notification: PreparationClarificationNotification) => void
}

export function ClarificationNotification({ notification, state = 'active', navigating = false, error, onOpen, onDismiss }: ClarificationNotificationProps): JSX.Element {
  const stale = state === 'stale'
  return (
    <article className={`clarification-notification${stale ? ' clarification-notification--stale' : ''}`} aria-labelledby={`clarification-title-${notification.questionId}`}>
      <div className="clarification-notification__body">
        <h2 id={`clarification-title-${notification.questionId}`}>Требуется уточнение ТЗ</h2>
        <p className="clarification-notification__context">
          <strong>{notification.taskTitle}</strong>
          {notification.projectName ? <span>Проект: {notification.projectName}</span> : null}
        </p>
        <p className="clarification-notification__question">{notification.text}</p>
        {stale && <p className="clarification-notification__stale" role="status">Вопрос уже неактуален.</p>}
        {error && <p className="clarification-notification__error" role="alert">{error}</p>}
      </div>
      <div className="clarification-notification__actions">
        <Button size="sm" variant="primary" loading={navigating} disabled={stale} onClick={() => onOpen(notification)}>Перейти к задаче</Button>
        <Button size="sm" variant="ghost" onClick={() => onDismiss(notification)}>Закрыть</Button>
      </div>
    </article>
  )
}

export interface NotificationContainerProps {
  notifications: PreparationClarificationNotification[]
  navigatingId?: string | null
  errors?: Record<string, string>
  onOpen: (notification: PreparationClarificationNotification) => void
  onDismiss: (notification: PreparationClarificationNotification) => void
}

export function NotificationContainer({ notifications, navigatingId, errors = {}, onOpen, onDismiss }: NotificationContainerProps): JSX.Element | null {
  if (notifications.length === 0) return null
  return (
    <aside className="clarification-notifications" aria-label="Уведомления, требующие внимания" aria-live="polite">
      <div role="list">
        {notifications.map((notification) => (
          <div role="listitem" key={notification.questionId}>
            <ClarificationNotification notification={notification} navigating={navigatingId === notification.questionId} error={errors[notification.questionId]} onOpen={onOpen} onDismiss={onDismiss} />
          </div>
        ))}
      </div>
    </aside>
  )
}

