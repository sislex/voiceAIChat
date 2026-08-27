// Единый примитив модального окна приложения: портал в document.body, оверлей и
// окно с dialog-семантикой, ловушка фокуса, Esc и клик по фону, блокировка
// скролла фона, полный экран на телефоне. Экраны дают только содержимое —
// своих оверлеев и position: fixed-контейнеров у них нет.
//
// Вложенность и слои — общий стек (useDialogStack): Esc закрывает верхнее окно,
// z-index выдаётся по глубине, скролл возвращается после последнего.
//
// Шапка собрана из тех же примитивов, что у ToolFrame (.mdhead/.mdh/.xbtn) —
// заголовок окна и заголовок тула выглядят одинаково не случайно.

import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { MOBILE_QUERY, useMediaQuery } from './mediaQuery'
import { IconButton } from './IconButton'
import { useDialogStack } from './useDialogStack'

/** Ширина окна: sm — короткая форма, md — настройки, lg — две колонки, full — почти весь экран. */
export type DialogSize = 'sm' | 'md' | 'lg' | 'full'

/** Что считаем интерактивным: и для автофокуса, и для ловушки Tab. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface DialogProps {
  /** Заголовок в шапке; он же имя окна для скринридера. */
  title: ReactNode
  /** Имя окна, если видимый заголовок для него слишком длинный. */
  ariaLabel?: string
  size?: DialogSize
  /** Закрытие: крестик, Esc, клик по фону. Нет — окно закрывает себя само. */
  onClose?: () => void
  /**
   * Своя логика запроса на закрытие (подтверждение несохранённого): используется
   * крестиком, Esc и кликом по фону вместо onClose.
   */
  onEscape?: () => void
  /** Клик по фону закрывает. Для форм с несохранёнными данными — false. */
  closeOnOverlay?: boolean
  /** Рисовать крестик в шапке (только вместе с onClose). */
  showClose?: boolean
  /** Подпись крестика — окна с собственной локализацией переопределяют. */
  closeLabel?: string
  /** Свои кнопки шапки, слева от крестика. */
  actions?: ReactNode
  /** Подвал: кнопки под содержимым, вне области прокрутки. */
  footer?: ReactNode
  /** Обернуть содержимое в `.vc-dialog-body` с отступами и своим скроллом — для окон без собственной раскладки. */
  padded?: boolean
  /** Куда ставить фокус при открытии; по умолчанию — первый интерактивный элемент. */
  initialFocusRef?: RefObject<HTMLElement>
  /** data-testid оверлея: клик по нему — это клик по фону. */
  testId?: string
  /** Доп. класс окна — для внутренней раскладки конкретного экрана. */
  className?: string
  children: ReactNode
}

export function Dialog({
  title,
  ariaLabel,
  size = 'md',
  onClose,
  onEscape,
  closeOnOverlay = true,
  showClose = true,
  closeLabel = 'Закрыть',
  actions,
  footer,
  padded = false,
  initialFocusRef,
  testId,
  className,
  children
}: DialogProps): JSX.Element {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const requestClose = onEscape ?? onClose
  const { zIndex, top } = useDialogStack({ onEscape: requestClose })
  // Телефон — полный экран. Граница 720px живёт в lib/mediaQuery.ts, потому что
  // раскладка карточки задачи смотрит на ту же ширину.
  const phone = useMediaQuery(MOBILE_QUERY)

  // Фокус: запоминаем открывашку до перевода фокуса внутрь и возвращаем его при
  // закрытии — иначе после Esc фокус висит в никуда и Tab начинает со страницы.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const nodes = panel ? [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)] : []
    // Первый элемент содержимого, а не шапки: на крестике Enter закрывал бы
    // окно сразу после открытия.
    const target = initialFocusRef?.current ?? nodes.find((node) => !headRef.current?.contains(node)) ?? nodes[0] ?? panel
    target?.focus()
    return () => {
      if (opener?.isConnected && typeof opener.focus === 'function') opener.focus()
    }
    // Окно живёт от открытия до закрытия: перезапускать эффект нечему.
  }, [])

  // Ловушка фокуса: Tab по кругу внутри верхнего окна. Перехват на window, потому
  // что уводить фокус может и элемент за пределами окна (страница под ним).
  useEffect(() => {
    if (!top) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const nodes = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (!nodes.length) return
      const edge = event.shiftKey ? nodes[nodes.length - 1] : nodes[0]
      const active = document.activeElement
      const escaped = !panel.contains(active)
      const atEdge = active === (event.shiftKey ? nodes[0] : nodes[nodes.length - 1])
      if (!escaped && !atEdge) return
      event.preventDefault()
      edge.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [top])

  // Клик по фону — это клик, у которого и нажатие, и отпускание пришлись на сам
  // оверлей: клик внутри окна всплывает до него же, а выделение текста мышью,
  // доведённое до края окна, иначе закрывало бы его.
  const startedOnOverlay = useRef(false)

  const label = ariaLabel ? { 'aria-label': ariaLabel } : { 'aria-labelledby': titleId }
  const closeButton = onClose && showClose && (
    <IconButton aria-label={closeLabel} title={closeLabel} onClick={requestClose}>
      ✕
    </IconButton>
  )

  return createPortal(
    <div
      className={`vc-dialog-overlay${phone ? ' vc-dialog-overlay--phone' : ''}`}
      style={{ zIndex }}
      data-testid={testId}
      onMouseDown={(event) => {
        startedOnOverlay.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (closeOnOverlay && startedOnOverlay.current && event.target === event.currentTarget) requestClose?.()
      }}
    >
      <div
        ref={panelRef}
        className={['vc-dialog', `vc-dialog--${size}`, phone && 'vc-dialog--phone', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        {...label}
        // Окно фокусируемо: если внутри нет ни одной кнопки, фокус всё равно уходит с фона.
        tabIndex={-1}
      >
        <div className="mdhead" ref={headRef}>
          <h2 className="mdh" id={titleId}>
            {title}
          </h2>
          {(actions || closeButton) && (
            <span className="util-head-btns">
              {actions}
              {closeButton}
            </span>
          )}
        </div>
        {padded ? <div className="vc-dialog-body">{children}</div> : children}
        {footer && <div className="vc-dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
