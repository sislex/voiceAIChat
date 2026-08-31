// Опрос сервера, который встаёт вместе со вкладкой.
//
// Панели QA опрашивают состояние этапа каждые 1,5–2 секунды. Пока таймер стоял
// на голом `setInterval`, он крутился и в фоновой вкладке браузера: карточка,
// оставленная открытой на ночь, продолжала стучать в сервер. `document.hidden`
// это чинит, а `visibilitychange` возвращает опрос — и сразу дёргает один
// внеплановый запрос, чтобы на экране не висело устаревшее состояние.

import { useEffect, useRef } from 'react'

export interface PollingOptions {
  /** Опрос выключен целиком (ран терминальный, моста нет). */
  enabled: boolean
  intervalMs: number
}

export function usePolling(poll: () => void, { enabled, intervalMs }: PollingOptions): void {
  // Свежий колбэк через ref: иначе смена его идентичности перезапускала бы
  // таймер, а у панелей он пересоздаётся на каждом рендере.
  const pollRef = useRef(poll)
  pollRef.current = poll

  useEffect(() => {
    if (!enabled) return
    let timer: number | null = null
    const stop = (): void => {
      if (timer != null) window.clearInterval(timer)
      timer = null
    }
    const start = (): void => {
      stop()
      timer = window.setInterval(() => pollRef.current(), intervalMs)
    }
    const sync = (): void => {
      if (document.hidden) {
        stop()
        return
      }
      // Возврат на вкладку: сначала догоняем состояние, потом снова тикаем.
      pollRef.current()
      start()
    }
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', sync)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [enabled, intervalMs])
}
