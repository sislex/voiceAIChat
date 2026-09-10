// Контейнер всплывающих панелей (тулы ToolFrame, полноэкранные настройки
// разговора): оверлей, dialog-семантика, Escape и клик по фону.
//
// Модальные окна экранов живут не здесь, а в components/ui/Dialog — но слой в
// общем стеке (useDialogStack) один и тот же, поэтому Esc всегда достаётся
// верхнему окну, а не всем сразу.

import { type ReactNode } from 'react'
import { useDialogStack } from '@voicechat/ui-kit'

export interface PopupFrameProps {
  title: string
  onClose?: () => void
  testId?: string
  /** Класс панели: у каждой панели своя геометрия (.ccobs, .convsettings). */
  panelClassName: string
  overlayClassName?: string
  /** Своя логика Esc (у тулов он сначала сворачивает разворот). По умолчанию — onClose. */
  onEscape?: () => void
  children: ReactNode
}

export function PopupFrame({ title, onClose, testId, panelClassName, overlayClassName = '', onEscape, children }: PopupFrameProps): JSX.Element {
  const { zIndex } = useDialogStack({ onEscape: onEscape ?? onClose })

  return (
    <div
      className={'ovl' + (overlayClassName ? ' ' + overlayClassName : '')}
      style={{ zIndex }}
      onClick={onClose}
      data-testid={testId}
    >
      <div className={panelClassName} onClick={(event) => event.stopPropagation()} role="dialog" aria-label={title}>
        {children}
      </div>
    </div>
  )
}
