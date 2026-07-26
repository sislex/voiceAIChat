// Общая рамка тулов (консоль, проводник машины, наблюдатели CC/Codex): шапка с
// заголовком, кнопкой «на весь экран» и закрытием. Два варианта размещения —
// карточка внутри сообщения ('embedded') и модалка из меню ('modal'); в обоих
// разворот на весь экран живёт здесь, а не в самих тулах.

import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import type { UtilityVariant } from './machine'

/** Управление разворотом — для содержимого, которому нужен фуллскрин по клику. */
export interface ToolFrameControl {
  fullscreen: boolean
  setFullscreen: (v: boolean) => void
}

export interface ToolFrameProps {
  /** Заголовок в шапке; он же aria-label диалога/карточки. */
  title: string
  variant?: UtilityVariant
  /** Закрытие: крестик в шапке и (для modal) клик по фону. Нет — крестика нет. */
  onClose?: () => void
  /** data-testid корня: оверлей в modal, карточка в embedded. */
  testId?: string
  /** Свои кнопки в шапке слева от «на весь экран»; функция — если нужен разворот. */
  actions?: ReactNode | ((ctl: ToolFrameControl) => ReactNode)
  /** Доп. класс корня — для тулов со своим фоном/раскладкой (напр. картинка). */
  className?: string
  /** Содержимое тула; функция — если ему нужно знать про разворот. */
  children: ReactNode | ((ctl: ToolFrameControl) => ReactNode)
}

/** Рамка тула: шапка + содержимое, с разворотом на весь экран. */
export function ToolFrame({
  title,
  variant = 'modal',
  onClose,
  testId,
  actions,
  className,
  children
}: ToolFrameProps): JSX.Element {
  const [fullscreen, setFullscreen] = useState(false)
  const stop = (e: MouseEvent): void => e.stopPropagation()

  // Esc: сначала сворачивает разворот, затем закрывает (для modal). Слушатель на
  // фазе перехвата и со stopPropagation — чтобы не сработали глобальные хоткеи
  // (отмена записи). В embedded без разворота Esc не трогаем — работают хоткеи.
  useEffect(() => {
    if (variant !== 'modal' && !fullscreen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' && e.code !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (fullscreen) setFullscreen(false)
      else onClose?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [variant, fullscreen, onClose])

  const ctl: ToolFrameControl = { fullscreen, setFullscreen }

  const head = (
    <div className="mdhead">
      <h2 className="mdh">{title}</h2>
      <span className="util-head-btns">
        {typeof actions === 'function' ? actions(ctl) : actions}
        <button
          className="xbtn"
          title={fullscreen ? 'Свернуть' : 'На весь экран'}
          aria-pressed={fullscreen}
          onClick={() => setFullscreen((v) => !v)}
        >
          {/* Не эмодзи: 🗕 (U+1F5D5) в Chrome/macOS рисуется пустым квадратом. */}
          {fullscreen ? '▭' : '⛶'}
        </button>
        {onClose && (
          <button className="xbtn" aria-label="Закрыть" title="Закрыть" onClick={onClose}>
            ✕
          </button>
        )}
      </span>
    </div>
  )

  const body = typeof children === 'function' ? children(ctl) : children
  const extra = className ? ` ${className}` : ''

  if (variant === 'modal') {
    return (
      <div className="ovl ovl--anim" onClick={onClose} data-testid={testId}>
        <div
          className={`ccobs ccobs--anim${fullscreen ? ' ccobs--fs' : ''}${extra}`}
          onClick={stop}
          role="dialog"
          aria-label={title}
        >
          {head}
          {body}
        </div>
      </div>
    )
  }
  // embedded: карточка в сообщении; fullscreen — фиксированный оверлей.
  return (
    <div
      className={`util-embed${fullscreen ? ' util-embed--fs' : ''}${extra}`}
      role="group"
      aria-label={title}
      data-testid={testId}
    >
      {head}
      {body}
    </div>
  )
}
