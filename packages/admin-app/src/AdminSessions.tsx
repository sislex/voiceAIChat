// Сессии выбранного пользователя в админской карточке. Компонент тонкий: весь
// список, поиск и завершение живут в модуле «сессии и устройства», здесь только
// свой стор на пользователя и ленивая загрузка при раскрытии.
import { useEffect, useMemo } from 'react'
import { SessionsBulkActions, SessionsPanel, createSessionsStore, type SessionsClient } from '@sislexa/identity/sessions-app/index'

export interface AdminSessionsProps {
  client: SessionsClient
  /** Логин: при переключении пользователя нужен новый стор, а не чужой список. */
  user: string
}

export function AdminSessions({ client, user }: AdminSessionsProps): JSX.Element {
  const store = useMemo(() => createSessionsStore({ client: { list: client.list, revoke: client.revoke, ...(client.revokeOthers ? { revokeOthers: client.revokeOthers } : {}) } }), [client, user])
  useEffect(() => () => store.actions.dispose(), [store])
  return (
    <section className="uadmin-sessions" data-testid="admin-sessions" aria-label="Сессии и устройства">
      <SessionsPanel store={store} />
      <SessionsBulkActions store={store} texts={{ revokeOthers: () => 'Завершить все, кроме текущей' }} />
    </section>
  )
}
