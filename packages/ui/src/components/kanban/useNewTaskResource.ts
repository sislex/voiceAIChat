import { useCallback, useEffect, useRef, useState } from 'react'

/** Preserve the last snapshot; late responses cannot overwrite another task. */
export function useNewTaskResource<T>(key: string, fetcher: () => Promise<T>) {
  const loader = useRef(fetcher)
  loader.current = fetcher
  const generation = useRef(0)
  const [snapshot, setSnapshot] = useState<{ key: string; data: T } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    const request = ++generation.current
    setLoading(true)
    try {
      const data = await loader.current()
      if (request === generation.current) { setSnapshot({ key, data }); setError('') }
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally { if (request === generation.current) setLoading(false) }
  }, [key])
  useEffect(() => { setError(''); void refresh(); return () => { generation.current++ } }, [refresh])
  return { data: snapshot?.key === key ? snapshot.data : null, loading, error, refresh }
}
/** A synchronous lock also prevents duplicate clicks within the same render. */
export function useNewTaskAction(refresh: () => Promise<void>) {
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const act = async (action: () => Promise<unknown>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try { await action(); await refresh() }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      await refresh()
    } finally { lock.current = false; setBusy(false) }
  }
  return { busy, error, act }
}
