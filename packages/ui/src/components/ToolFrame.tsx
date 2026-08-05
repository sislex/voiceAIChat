// Общая рамка тулов (консоль, проводник машины, наблюдатели CC/Codex): шапка с
// заголовком, кнопкой «на весь экран» и закрытием. Три варианта размещения —
// карточка внутри сообщения ('embedded'), модалка из меню ('modal') и полная
// страница в области контента ('page', без модального фона). В modal/embedded
// разворот на весь экран живёт здесь, а не в самих тулах.

import { useState, type ReactNode } from 'react'
import { PopupFrame } from './PopupFrame'
import { IconButton } from './ui/IconButton'
import { useDialogStack } from './ui/useDialogStack'
import type { UtilityVariant } from './machine'

/** Управление разворотом — для содержимого, которому нужен фуллскрин по клику. */
export interface ToolFrameControl {
  fullscreen: boolean
  setFullscreen: (v: boolean) => void
}

export interface ToolFrameProps {
  /** Заголовок в шапке; он же aria-label диалога/карточки. */
  title: string
  variant?: UtilityVariant | 'page'
  /** Закрытие: крестик в шапке и (для modal) клик по фону. Нет — крестика нет. */
  onClose?: () => void
  /** data-testid корня: оверлей в modal, карточка в embedded, регион в page. */
  testId?: string
  /** Свои кнопки в шапке слева от «на весь экран»; функция — если нужен разворот. */
  actions?: ReactNode | ((ctl: ToolFrameControl) => ReactNode)
  /**
   * Перехват Esc содержимым: вернул true — событие израсходовано (не сворачиваем
   * и не закрываем). Нужен там, где у Esc есть своё дело внутри тула: в консоли
   * машины он сначала очищает строку ввода. Своего слушателя содержимому не
   * завести — Esc забирает общий стек окон в фазе перехвата (`useDialogStack`).
   */
  onEscape?: () => boolean
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
  onEscape,
  children
}: ToolFrameProps): JSX.Element {
  const [fullscreen, setFullscreen] = useState(false)
  // Esc: сначала отдаём содержимому, потом сворачиваем разворот, потом закрываем.
  // Обработка идёт через общий стек окон, поэтому тул под открытой поверх него
  // модалкой не закрывается вместе с ней. В embedded без разворота слоя нет — Esc
  // остаётся глобальным хоткеем (отмена записи), и содержимое ловит его само.
  // В page Esc закрывает страницу (возврат навигацией).
  const handleEscape = (): void => {
    if (onEscape?.()) return
    if (fullscreen) setFullscreen(false)
    else onClose?.()
  }
  // Слой варианта modal держит PopupFrame — второй раз регистрировать нельзя.
  useDialogStack({
    active: variant === 'page' || (variant === 'embedded' && fullscreen),
    onEscape: handleEscape,
    lockScroll: false
  })

  const ctl: ToolFrameControl = { fullscreen, setFullscreen }

  const head = (
    <div className="mdhead">
      <h2 className="mdh">{title}</h2>
      <span className="util-head-btns">
        {typeof actions === 'function' ? actions(ctl) : actions}
        {variant !== 'page' && (
          <IconButton
            title={fullscreen ? 'Свернуть' : 'На весь экран'}
            aria-label={fullscreen ? 'Свернуть' : 'Развернуть на весь экран'}
            aria-pressed={fullscreen}
            onClick={() => setFullscreen((v) => !v)}
          >
            {/* Не эмодзи: 🗕 (U+1F5D5) в Chrome/macOS рисуется пустым квадратом. */}
            {fullscreen ? '▭' : '⛶'}
          </IconButton>
        )}
        {onClose && (
          <IconButton aria-label="Закрыть" title="Закрыть" onClick={onClose}>
            ✕
          </IconButton>
        )}
      </span>
    </div>
  )

  const body = typeof children === 'function' ? children(ctl) : children
  const extra = className ? ` ${className}` : ''

  if (variant === 'page') {
    return (
      <section className={`toolpage${extra}`} aria-label={title} data-testid={testId}>
        {head}
        {body}
      </section>
    )
  }

  if (variant === 'modal') {
    return (
      <PopupFrame
        title={title}
        onClose={onClose}
        onEscape={handleEscape}
        testId={testId}
        overlayClassName="ovl--anim"
        panelClassName={`ccobs ccobs--anim${fullscreen ? ' ccobs--fs' : ''}${extra}`}
      >
        {head}
        {body}
      </PopupFrame>
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
