// Единый контейнер всех popup приложения: overlay, dialog-семантика, Escape и клик по фону.

import { useEffect, type ReactNode } from 'react'

export interface PopupFrameProps {
  title: string
  onClose?: () => void
  testId?: string
  panelClassName?: string
  overlayClassName?: string
  closeOnEscape?: boolean
  children: ReactNode
}

export function PopupFrame({ title, onClose, testId, panelClassName = 'modal', overlayClassName = '', closeOnEscape = true, children }: PopupFrameProps): JSX.Element {
  useEffect(() => {
    if (!onClose || !closeOnEscape) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' && event.code !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, closeOnEscape])

  return (
    <div className={'ovl' + (overlayClassName ? ' ' + overlayClassName : '')} onClick={onClose} data-testid={testId}>
      <div className={panelClassName} onClick={(event) => event.stopPropagation()} role="dialog" aria-label={title}>
        {children}
      </div>
    </div>
  )
}
