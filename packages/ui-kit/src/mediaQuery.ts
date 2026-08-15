import { useEffect, useState } from 'react'

/** Общая мобильная граница Dialog и Toast; совпадает с styles.css. */
export const MOBILE_QUERY = '(max-width: 720px)'

function read(query: string): boolean {
  // jsdom не реализует matchMedia: без него считаем, что условие не выполнено,
  // то есть тесты по умолчанию «десктопные», пока сами не подставят мок.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(query).matches
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => read(query))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    // Значение могло измениться между первым рендером и подпиской (поворот экрана).
    setMatches(mql.matches)
    const onChange = (): void => setMatches(mql.matches)
    // addListener — для старых WebView (Safari < 14), где ещё нет addEventListener.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    mql.addListener(onChange)
    return () => mql.removeListener(onChange)
  }, [query])

  return matches
}
