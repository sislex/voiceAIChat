// Лёгкий hash-роутер (без зависимостей). Hash выбран намеренно: desktop грузит
// рендерер через file:// (loadFile), где history/pushState-пути не работают, а
// hash одинаково живёт и в web (есть SPA-fallback), и в Electron.
//
// path — часть после «#», всегда с ведущим «/» (пустой hash → «/»).
// navigate(to) — меняет hash (['/', 'projects', ...] → «#/projects…»).

import { useCallback, useSyncExternalStore } from 'react'

function currentPath(): string {
  if (typeof window === 'undefined') return '/'
  const raw = window.location.hash.replace(/^#/, '')
  return raw ? (raw.startsWith('/') ? raw : `/${raw}`) : '/'
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export interface HashRoute {
  /** Текущий путь, напр. «/projects/p1/settings». */
  path: string
  /** Сегменты пути без пустых, напр. ['projects','p1','settings']. */
  segments: string[]
  /** Перейти по пути (принимает «/x», «x» или «#/x»). */
  navigate: (to: string) => void
}

export function useHashRoute(): HashRoute {
  const path = useSyncExternalStore(subscribe, currentPath, () => '/')
  const navigate = useCallback((to: string) => {
    const clean = to.replace(/^#/, '')
    const target = `#${clean.startsWith('/') ? clean : `/${clean}`}`
    if (window.location.hash !== target) window.location.hash = target
  }, [])
  return { path, segments: path.split('/').filter(Boolean), navigate }
}
