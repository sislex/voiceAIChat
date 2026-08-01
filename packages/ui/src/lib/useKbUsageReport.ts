// Загрузка отчёта об использовании БЗ для врезов вне чата (лента рана, модалка
// задачи). Отдельный хук, потому что источников два, а поведение одно: грузим по
// ключу, ошибку показываем текстом и НЕ роняем экран — статистика базы знаний
// никогда не важнее того, ради чего экран открыли.
//
// Моста может не быть вовсе (desktop без CI) — тогда отчёта просто нет.

import { useEffect, useState } from 'react'

export interface KbUsageReportState<T> {
  report: T | null
  loading: boolean
  error: string | null
}

export function useKbUsageReport<T>(load: () => Promise<T> | undefined, deps: unknown[]): KbUsageReportState<T> {
  const [state, setState] = useState<KbUsageReportState<T>>({ report: null, loading: true, error: null })
  useEffect(() => {
    let alive = true
    const request = load()
    if (!request) {
      setState({ report: null, loading: false, error: null })
      return
    }
    setState((prev) => ({ ...prev, loading: true }))
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
  }, deps)
  return state
}
