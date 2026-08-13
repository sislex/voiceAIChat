// Загрузка отчёта-врезки в чужой экран: использование БЗ и расход модели в
// ленте рана и в карточке задачи. Поведение у всех одно: грузим по ключу, ошибку
// показываем текстом и НЕ роняем экран — отчёт никогда не важнее того, ради чего
// экран открыли.
//
// Моста может не быть вовсе (desktop без CI) — тогда отчёта просто нет.

import { useCallback, useEffect, useRef, useState } from 'react'

export interface RemoteReportState<T> {
  report: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useRemoteReport<T>(load: () => Promise<T> | undefined, deps: unknown[]): RemoteReportState<T> {
  const [state, setState] = useState<Omit<RemoteReportState<T>, 'reload'>>({ report: null, loading: true, error: null })
  const [revision, setRevision] = useState(0)
  const reportKey = useRef(deps[0])
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    let alive = true
    const request = load()
    if (!request) {
      setState({ report: null, loading: false, error: null })
      return
    }
    const keyChanged = reportKey.current !== deps[0]
    reportKey.current = deps[0]
    setState((prev) => keyChanged ? { report: null, loading: true, error: null } : { ...prev, loading: true, error: null })
    void request.then(
      (report) => {
        if (alive) setState({ report, loading: false, error: null })
      },
      (err: unknown) => {
        if (alive) setState((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : String(err) }))
      }
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, revision])
  return { ...state, reload }
}
