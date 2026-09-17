import { useLayoutEffect, useState } from 'react'
import type { Settings } from '@shared/types'
export function effectiveTheme(mode: Settings['theme']): 'light' | 'dark' | 'green' {
  return mode === 'system' ? (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode
}
export function applyTheme(mode: Settings['theme']): 'light' | 'dark' | 'green' {
  const theme = effectiveTheme(mode)
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
  return theme
}
export function useShellTheme(mode: Settings['theme']): 'light' | 'dark' | 'green' {
  const [systemDark, setSystemDark] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches)
  useLayoutEffect(() => {
    applyTheme(mode)
    if (mode !== 'system' || typeof matchMedia !== 'function') return
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => { setSystemDark(media.matches); applyTheme(mode) }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [mode])
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
}
