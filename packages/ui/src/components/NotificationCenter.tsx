import { useState } from 'react'
import { Button, Dialog, EmptyState, IconButton } from '@voicechat/ui-kit'
import { useNotifications, type ShellNotification } from '../lib/shellPreferences'

export function NotificationHistory({ items, onRead }: { items: ShellNotification[]; onRead: (id?: string) => void }): JSX.Element {
  return <div className="notification-history">
    {items.length ? <>
      <Button size="sm" onClick={() => onRead()}>Прочитать все</Button>
      <ul>{items.map(item => <li key={item.id} data-unread={!item.read}>
        <p>{item.text}</p><time dateTime={new Date(item.time).toISOString()}>{new Date(item.time).toLocaleString()}</time>
        {!item.read && <Button size="sm" variant="ghost" onClick={() => onRead(item.id)}>Прочитано</Button>}
      </li>)}</ul>
    </> : <EmptyState title="Уведомлений пока нет" description="Здесь сохраняются результаты действий и события проектов." />}
  </div>
}
export function NotificationCenter({ userId }: { userId: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [items, markRead] = useNotifications(userId)
  const unread = items.filter(item => !item.read).length
  return <>
    <IconButton aria-label={`Уведомления: ${unread} непрочитанных`} title="История уведомлений" onClick={() => setOpen(true)}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6" /></svg>{unread > 0 && <span>{unread}</span>}
    </IconButton>
    {open && <Dialog title="Уведомления" size="md" onClose={() => setOpen(false)}><NotificationHistory items={items} onRead={markRead} /></Dialog>}
  </>
}
