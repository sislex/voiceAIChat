// Хост модуля «сессии и устройства»: собирает переносимый пакет
// @voicechat/sessions-app с мостом window.session этого приложения. Сам модуль
// про мосты не знает — здесь единственное место, где они встречаются.
import { useEffect, useMemo } from 'react'
import { useConfirm, useToast } from '@voicechat/ui-kit'
import { SessionsDialog, createSessionsStore, type SessionsClient } from '@voicechat/sessions-app'

export interface SessionsDialogHostProps {
  onClose: () => void
  /** Пользователь вышел на всех устройствах, включая это: увести на экран входа. */
  onSignedOut: () => void
}

export function SessionsDialogHost({ onClose, onSignedOut }: SessionsDialogHostProps): JSX.Element | null {
  const toast = useToast()
  const confirm = useConfirm()
  const bridge = window.session
  // Стор живёт столько же, сколько открытое окно: закрыли — отписались.
  const store = useMemo(() => {
    if (!bridge?.sessions || !bridge.revokeSession) return null
    const client: SessionsClient = {
      list: () => bridge.sessions!(),
      revoke: (sid) => bridge.revokeSession!(sid),
      ...(bridge.logoutAll
        ? { revokeOthers: () => bridge.logoutAll!(), revokeAll: () => bridge.logoutAll!({ includeCurrent: true }) }
        : {}),
      ...(bridge.renameSession ? { rename: (sid, label) => bridge.renameSession!(sid, label) } : {}),
      ...(bridge.trustSession ? { setTrusted: (sid, trusted) => bridge.trustSession!(sid, trusted) } : {}),
      ...(bridge.endedSessions ? { listEnded: () => bridge.endedSessions!() } : {}),
      ...(bridge.panicSessions ? { panic: () => bridge.panicSessions!() } : {})
    }
    return createSessionsStore({
      client,
      host: { onSignedOut },
      // Только «список устарел»: отзыв собственной сессии обрабатывает App —
      // он должен уводить на экран входа и с закрытым окном тоже.
      ...(bridge.onSessionsChanged
        ? { realtime: { subscribe: (listener) => bridge.onSessionsChanged!((event) => { if (event.type === 'update') listener({ type: 'sessions.update' }) }) } }
        : {}),
      notify: { success: (message) => toast.success(message), error: (message) => toast.error(message) }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => store?.actions.dispose(), [store])
  if (!store) return null
  return (
    <SessionsDialog
      store={store}
      onClose={onClose}
      confirm={(request) => confirm({ title: request.title, message: request.text, variant: request.variant })}
    />
  )
}
