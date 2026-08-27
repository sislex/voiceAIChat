// Сессии пользователя (auth-roadmap п.4): устройства, с которых выполнен вход, «завершить» одну и «выйти на других».
// Данные — через мост window.session (web); в desktop моста нет, и пункт меню не показывается.
import { useEffect, useState } from 'react'
import type { SessionInfo } from '@shared/types'
import { Button, Dialog, EmptyState } from '@voicechat/ui-kit'
import { useToast } from '@voicechat/ui-kit'

interface Props {
  load: () => Promise<SessionInfo[]>
  revoke: (sid: string) => Promise<void>
  logoutAll: () => Promise<void>
  onClose: () => void
}

/** Короткое имя устройства из User-Agent — браузер и ОС, без версии движка. */
export function describeUserAgent(ua: string): string {
  if (!ua || ua === 'legacy') return 'Устройство (вход до появления списка сессий)'
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : ua.split('/')[0] ?? ua
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${browser} · ${os}` : browser
}

export function SessionsDialog({ load, revoke, logoutAll, onClose }: Props): JSX.Element {
  const toast = useToast()
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = async (): Promise<void> => { try { setSessions(await load()) } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } }
  useEffect(() => { void refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const fmt = (t: number): string => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const others = (sessions ?? []).filter((s) => !s.current)
  return (
    <Dialog className="make-dialog" padded title="Сессии и устройства" ariaLabel="Сессии и устройства" size="md" onClose={onClose} testId="sessions-dialog"
      footer={others.length > 0 ? <Button size="sm" variant="danger" loading={busy} onClick={() => { setBusy(true); void logoutAll().then(refresh).then(() => toast.success('Другие сессии завершены')).catch((e) => toast.error(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false)) }}>Выйти на других устройствах ({others.length})</Button> : undefined}>
      <p className="make-ideas-lead">Где вы вошли в ChatAI. Сессия живёт 30 дней с последней активности; завершённая — сразу теряет доступ.</p>
      {sessions === null ? <p className="fsub">Загрузка…</p> : sessions.length === 0 ? <EmptyState title="Сессий нет" /> : (
        <ul className="sessions-list" role="list">
          {sessions.map((s) => (
            <li key={s.sid} className={s.current ? 'sessions-item sessions-item--current' : 'sessions-item'}>
              <div>
                <strong>{describeUserAgent(s.userAgent)}</strong>{s.current && <span className="sessions-current">это устройство</span>}
                <small>{s.ip || 'адрес неизвестен'} · вход {fmt(s.createdAt)} · активность {fmt(s.lastSeen)}</small>
              </div>
              {!s.current && <Button size="sm" variant="ghost" onClick={() => { void revoke(s.sid).then(refresh).catch((e) => toast.error(e instanceof Error ? e.message : String(e))) }}>Завершить</Button>}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
