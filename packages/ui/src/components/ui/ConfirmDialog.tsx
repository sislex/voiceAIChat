// Подтверждение опасного действия поверх общего окна Dialog — вместо нативного
// window.confirm, который не знает про тему, не тестируется кликом и в Electron
// выглядит чужим окном ОС.
//
// Две особенности против случайного «да»:
//   • автофокус на безопасном элементе (поле ввода, если оно есть, иначе
//     «Отмена»), а не на кнопке подтверждения: Enter сразу после открытия не
//     должен ничего удалять;
//   • requireText — для необратимого (удаление колонки со всеми задачами,
//     откат незакоммиченных файлов): кнопка включается, только когда набрано
//     название объекта. Сверяем без учёта регистра и внешних пробелов —
//     защита от «нажал не думая», а не тест на слепую печать.

import { useRef, useState, type ReactNode } from 'react'
import { Dialog } from './Dialog'

/** Что спрашиваем. Ровно этот объект принимает confirm() из useConfirm. */
export interface ConfirmRequest {
  /** Заголовок окна; он же вопрос («Удалить «Задача A»?»). */
  title: string
  /** Пояснение под заголовком: чем это обернётся. */
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** danger — красная кнопка подтверждения (удаление, откат). */
  variant?: 'danger' | 'default'
  /** Необратимая операция: подтверждение включается после ввода этого текста. */
  requireText?: string
}

export interface ConfirmDialogProps extends ConfirmRequest {
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Продолжить',
  cancelLabel = 'Отмена',
  variant = 'default',
  requireText,
  onConfirm,
  onCancel
}: ConfirmDialogProps): JSX.Element {
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const norm = (value: string): string => value.trim().toLocaleLowerCase()
  const armed = !requireText || norm(typed) === norm(requireText)

  const confirm = (): void => {
    if (armed) onConfirm()
  }

  return (
    <Dialog
      size="sm"
      testId="confirm-dialog"
      title={title}
      onClose={onCancel}
      // Фокус — на безопасном элементе. Поле подтверждения тоже безопасно и
      // сразу принимает набор, поэтому в режиме requireText оно первое.
      initialFocusRef={requireText ? inputRef : cancelRef}
      className="vc-confirm"
      footer={
        <>
          <button className="vc-confirm-btn" ref={cancelRef} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`vc-confirm-btn vc-confirm-btn--${variant === 'danger' ? 'danger' : 'primary'}`}
            disabled={!armed}
            onClick={confirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="mdbody vc-confirm-body">
        {message && <p className="vc-confirm-text">{message}</p>}
        {requireText && (
          <label className="vc-confirm-field">
            <span>
              Для подтверждения введите «{requireText}»
            </span>
            <input
              ref={inputRef}
              className="sel"
              value={typed}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                confirm()
              }}
            />
          </label>
        )}
      </div>
    </Dialog>
  )
}
