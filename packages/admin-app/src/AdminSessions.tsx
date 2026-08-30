// Сессии выбранного пользователя в админской карточке. Компонент тонкий: весь
// список, поиск и завершение живут в модуле «сессии и устройства», здесь только
// свой стор на пользователя и ленивая загрузка при раскрытии.
import { useEffect, useMemo, useState } from 'react'
import { SessionsPanel, createSessionsStore, type SessionsClient } from '@voicechat/sessions-app'

export interface AdminSessionsProps {
  client: SessionsClient
  /** Логин: при переключении пользователя нужен новый стор, а не чужой список. */
  user: string
}

export function AdminSessions({ client, user }: AdminSessionsProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const store = useMemo(() => createSessionsStore({ client }), [client, user])
  useEffect(() => () => store.actions.dispose(), [store])
  return (
    <details className="uadmin-sessions" data-testid="admin-sessions" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Сессии</summary>
      {open && <SessionsPanel store={store} readOnly />}
    </details>
  )
}
