// Лёгкий hash-роутер (без зависимостей). Hash выбран намеренно: desktop грузит
// рендерер через file:// (loadFile), где history/pushState-пути не работают, а
// hash одинаково живёт и в web (есть SPA-fallback), и в Electron.
//
// path — часть после «#», всегда с ведущим «/» (пустой hash → «/»).
// navigate(to) — меняет hash (['/', 'projects', ...] → «#/projects…»).
// navigate(to, { replace: true }) — без новой записи в истории: так пишутся
// адреса, на которые приложение перекидывает само (например «#/» → «#/chat/:id»),
// иначе кнопка «Назад» упирается в бесконечный редирект.

import { useCallback, useSyncExternalStore } from 'react'

function currentPath(): string {
  if (typeof window === 'undefined') return '/'
  const raw = window.location.hash.replace(/^#/, '')
  return raw ? (raw.startsWith('/') ? raw : `/${raw}`) : '/'
}

// replaceState не порождает hashchange — подписчиков будим сами.
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  window.addEventListener('hashchange', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('hashchange', cb)
  }
}

export interface NavigateOptions {
  /** Заменить текущую запись истории вместо добавления новой. */
  replace?: boolean
}

export interface HashRoute {
  /** Текущий путь, напр. «/projects/p1/settings». */
  path: string
  /** Сегменты пути без пустых, напр. ['projects','p1','settings']. */
  segments: string[]
  /** Перейти по пути (принимает «/x», «x» или «#/x»). */
  navigate: (to: string, opts?: NavigateOptions) => void
}

export function useHashRoute(): HashRoute {
  const path = useSyncExternalStore(subscribe, currentPath, () => '/')
  const navigate = useCallback((to: string, opts?: NavigateOptions) => {
    const clean = to.replace(/^#/, '')
    const target = `#${clean.startsWith('/') ? clean : `/${clean}`}`
    if (window.location.hash === target) return
    if (opts?.replace) {
      try {
        window.history.replaceState(null, '', target)
        listeners.forEach((cb) => cb())
        return
      } catch {
        // history недоступен (file:// в старых сборках) — обычный переход.
      }
    }
    window.location.hash = target
  }, [])
  return { path, segments: path.split('/').filter(Boolean), navigate }
}
