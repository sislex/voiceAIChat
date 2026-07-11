import { useEffect, useRef } from 'react'

export interface HotkeyHandlers {
  /** Нажат пробел (push-to-talk): начать запись. */
  onPushStart: () => void
  /** Отпущен пробел: завершить запись. */
  onPushEnd: () => void
  /** Нажат Escape: стоп/отмена по текущему состоянию. */
  onEscape: () => void
  /** Горячие клавиши активны (например, выключить при открытом модале). */
  enabled?: boolean
}

/** Фокус в текстовом поле — тогда пробел/Esc не перехватываем. */
function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

/**
 * Глобальные горячие клавиши. Пробел (удержание) — push-to-talk запись, Esc —
 * стоп/отмена. Игнорируются при вводе в поля. Слушатели навешиваются один раз;
 * актуальные колбэки берутся из ref (без переподписки на каждый рендер).
 */
export function useHotkeys(handlers: HotkeyHandlers): void {
  const ref = useRef(handlers)
  ref.current = handlers
  // Пробел «зажат» — чтобы автоповтор keydown не рестартовал запись и чтобы
  // keyup завершал именно начатую пробелом запись.
  const spaceDown = useRef(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const h = ref.current
      if (h.enabled === false) return
      if (e.code === 'Escape' || e.key === 'Escape') {
        if (isTyping()) return
        e.preventDefault()
        h.onEscape()
        return
      }
      if (e.code === 'Space') {
        if (isTyping() || e.repeat || spaceDown.current) return
        e.preventDefault()
        spaceDown.current = true
        h.onPushStart()
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return
      if (!spaceDown.current) return
      spaceDown.current = false
      e.preventDefault()
      ref.current.onPushEnd()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])
}
