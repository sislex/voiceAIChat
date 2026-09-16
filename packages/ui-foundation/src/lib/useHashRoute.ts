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
  // Publish only accepted locations so unrelated renders cannot bypass a pending guard.
  const raw = (listeners.size ? acceptedHash : window.location.hash).replace(/^#/, '')
  return raw ? (raw.startsWith('/') ? raw : `/${raw}`) : '/'
}

// replaceState не порождает hashchange — подписчиков будим сами.
const listeners = new Set<() => void>()

let acceptedHash = ''
function allowNavigation(target: string, resume: () => void): boolean {
  return window.dispatchEvent(new CustomEvent('voicechat:before-navigate', { cancelable: true, detail: { target, resume } }))
}
function changed(): void {
  const target = window.location.hash
  const publish = (): void => { acceptedHash = target; listeners.forEach(cb => cb()) }
  const resume = (): void => { window.history.replaceState(null, '', target); publish() }
  if (target !== acceptedHash && !allowNavigation(target, resume)) {
    window.history.replaceState(null, '', acceptedHash || '#/')
    return
  }
  publish()
}
function subscribe(cb: () => void): () => void {
  if (!listeners.size) { acceptedHash = window.location.hash; window.addEventListener('hashchange', changed) }
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
    if (!listeners.size) window.removeEventListener('hashchange', changed)
  }
}

export interface NavigateOptions {
  /** Заменить текущую запись истории вместо добавления новой. */
  replace?: boolean
}

export interface HashRoute {
  /** Текущий путь, напр. «/projects/p1/settings». */
  path: string
  search: string
  /** Сегменты пути без пустых, напр. ['projects','p1','settings']. */
  segments: string[]
  /** Перейти по пути (принимает «/x», «x» или «#/x»). */
  navigate: (to: string, opts?: NavigateOptions) => void
}

export function useHashRoute(): HashRoute {
  const location = useSyncExternalStore(subscribe, currentPath, () => '/')
  const queryAt = location.indexOf('?')
  const path = queryAt < 0 ? location : location.slice(0, queryAt)
  const search = queryAt < 0 ? '' : location.slice(queryAt + 1)
  const navigate = useCallback((to: string, opts?: NavigateOptions) => {
    const clean = to.replace(/^#/, '')
    const target = `#${clean.startsWith('/') ? clean : `/${clean}`}`
    if (window.location.hash === target) return
    const proceed = (): void => {
      acceptedHash = target
      if (opts?.replace) {
        try {
          window.history.replaceState(null, '', target)
          listeners.forEach((cb) => cb())
          return
        } catch {
          // Older file:// hosts fall back to ordinary hash navigation.
        }
      }
      window.location.hash = target
    }
    if (allowNavigation(target, proceed)) proceed()
  }, [])
  return { path, search, segments: path.split('/').filter(Boolean), navigate }
}
