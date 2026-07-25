// Общая рамка тулов (консоль, проводник машины, наблюдатели CC/Codex): шапка с
// заголовком, кнопкой «на весь экран» и закрытием. Два варианта размещения —
// карточка внутри сообщения ('embedded') и модалка из меню ('modal'); в обоих
// разворот на весь экран живёт здесь, а не в самих тулах.

import { useState, type MouseEvent, type ReactNode } from 'react'
import type { UtilityVariant } from './machine'

export interface ToolFrameProps {
  /** Заголовок в шапке; он же aria-label диалога/карточки. */
  title: string
  variant?: UtilityVariant
  /** Закрытие: крестик в шапке и (для modal) клик по фону. Нет — крестика нет. */
  onClose?: () => void
  /** data-testid корня: оверлей в modal, карточка в embedded. */
  testId?: string
  /** Содержимое тула (прямые дети рамки — раскладка колонкой). */
  children: ReactNode
}

/** Рамка тула: шапка + содержимое, с разворотом на весь экран. */
export function ToolFrame({
  title,
  variant = 'modal',
  onClose,
  testId,
  children
}: ToolFrameProps): JSX.Element {
  const [fullscreen, setFullscreen] = useState(false)
  const stop = (e: MouseEvent): void => e.stopPropagation()

  const head = (
    <div className="mdhead">
      <h2 className="mdh">{title}</h2>
      <span className="util-head-btns">
        <button
          className="xbtn"
          title={fullscreen ? 'Свернуть' : 'На весь экран'}
          aria-pressed={fullscreen}
          onClick={() => setFullscreen((v) => !v)}
        >
          {fullscreen ? '🗕' : '⛶'}
        </button>
        {onClose && (
          <button className="xbtn" aria-label="Закрыть" onClick={onClose}>
            ✕
          </button>
        )}
      </span>
    </div>
  )

  if (variant === 'modal') {
    return (
      <div className="ovl" onClick={onClose} data-testid={testId}>
        <div
          className={fullscreen ? 'ccobs ccobs--fs' : 'ccobs'}
          onClick={stop}
          role="dialog"
          aria-label={title}
        >
          {head}
          {children}
        </div>
      </div>
    )
  }
  // embedded: карточка в сообщении; fullscreen — фиксированный оверлей.
  return (
    <div
      className={fullscreen ? 'util-embed util-embed--fs' : 'util-embed'}
      role="group"
      aria-label={title}
      data-testid={testId}
    >
      {head}
      {children}
    </div>
  )
}
