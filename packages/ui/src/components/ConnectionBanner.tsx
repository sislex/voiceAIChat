import { useEffect, useState } from 'react'
import { Button, useToast } from '@voicechat/ui-kit'
import type { RendererRealtimeBridge } from '@shared/ipc'

export function ConnectionBanner({ since, onRetry }: { since: number; onRetry: () => void }): JSX.Element {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  return <aside className="connection-banner" aria-label="Состояние соединения">
    <span role="status">Соединение потеряно — переподключаемся…</span>
    <time aria-label="Длительность отключения">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</time>
    <Button size="sm" onClick={onRetry}>Повторить</Button>
  </aside>
}
export function ConnectionStatus({ bridge }: { bridge: RendererRealtimeBridge | undefined }): JSX.Element | null {
  const [since, setSince] = useState<number | null>(null)
  const toast = useToast()
  useEffect(() => {
    if (!bridge?.onDisconnected) return
    let episode: number | null = null
    const off = bridge.onDisconnected(() => {
      if (episode === null) { episode = Date.now(); setSince(episode) }
    })
    const on = bridge.onConnected(() => {
      if (episode !== null) {
        episode = null
        setSince(null)
        toast.success('Соединение восстановлено', { duration: 2500 })
      }
    })
    return () => { off(); on() }
  }, [bridge, toast])
  return since === null ? null : <ConnectionBanner since={since} onRetry={() => bridge?.retry?.()} />
}
