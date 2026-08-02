// Единый экран ошибки загрузки.
//
// До него ошибка чтения в большинстве мест не показывалась вовсе: список
// оставался пустым, и пользователь не мог отличить «пусто» от «сломалось».
// Ошибки уходили только тостом (`fail(err, retry)` в сторе), а тост живёт
// секунды и не объясняет, почему экран пустой.
//
// Форма одна: короткое сообщение, техническая деталь под «Подробнее» (её
// нужно уметь скопировать, но она не должна быть первым, что видит человек) и
// кнопка «Повторить». Контейнер — `role="alert"`: ошибка появляется после
// действия и должна быть озвучена сразу.

import { Button } from './Button'

export interface ErrorStateProps {
  /** Короткое сообщение: что не удалось. */
  message?: string
  /** Техническая деталь (текст исключения) — под «Подробнее». */
  detail?: string | null
  /** Повторить чтение. Нет обработчика — нет кнопки. */
  onRetry?: () => void
  retryLabel?: string
  /** Плотный вариант: баннер над уже показанными данными, секция страницы. */
  compact?: boolean
  className?: string
  testId?: string
}

export function ErrorState({
  message = 'Не удалось загрузить данные',
  detail,
  onRetry,
  retryLabel = 'Повторить',
  compact = false,
  className,
  testId = 'error-state'
}: ErrorStateProps): JSX.Element {
  return (
    <div
      className={['vc-state', 'vc-state--error', compact && 'vc-state--compact', className].filter(Boolean).join(' ')}
      role="alert"
      data-testid={testId}
    >
      <span className="vc-state__ico" aria-hidden="true">
        ⚠
      </span>
      <p className="vc-state__title">{message}</p>
      {detail && (
        <details className="vc-state__detail">
          <summary>Подробнее</summary>
          <pre>{detail}</pre>
        </details>
      )}
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
