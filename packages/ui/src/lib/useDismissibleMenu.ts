import { useEffect, useRef, type RefObject } from 'react'

const MENU_OPEN_EVENT = 'voicechat:menu-open'

/**
 * Унифицированное поведение выпадающих меню: внешний pointerdown и Escape
 * закрывают меню, а открытие нового меню закрывает все ранее открытые.
 */
export function useDismissibleMenu(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  close: () => void
): void {
  const instanceRef = useRef<object>({})
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    if (!open) return

    const instance = instanceRef.current
    const closeOnOutsidePress = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) closeRef.current()
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeRef.current()
    }
    const closeOnOtherMenu = (event: Event): void => {
      if ((event as CustomEvent<object>).detail !== instance) closeRef.current()
    }

    document.dispatchEvent(new CustomEvent(MENU_OPEN_EVENT, { detail: instance }))
    document.addEventListener('pointerdown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener(MENU_OPEN_EVENT, closeOnOtherMenu)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener(MENU_OPEN_EVENT, closeOnOtherMenu)
    }
  }, [open, containerRef])
}
