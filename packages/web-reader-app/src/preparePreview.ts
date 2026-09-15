/** Bound preparation independently of the host transport's own timeout. */
export function prepareReaderPreview(ensure: () => Promise<boolean>, signal: AbortSignal, timeoutMs = 15_000): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise(resolve => {
    const finish = (ok: boolean) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      resolve(ok)
    }
    const abort = () => finish(false)
    const timer = setTimeout(abort, timeoutMs)
    signal.addEventListener('abort', abort, { once: true })
    try { void Promise.resolve(ensure()).then(finish, abort) }
    catch { abort() }
  })
}
