// Публикация галереи студии: опубликовать, скопировать ссылку, открыть
// страницу, закрыть паролем, снять. Отдельным файлом — потому что это цельный
// кусок с четырьмя состояниями (не опубликовано, опубликовано, под паролем,
// грузится), а панель и без него читается плохо. Логика — у панели.
import { Button } from '@voicechat/ui-kit'

interface Props {
  /** null — не опубликовано, undefined — состояние ещё грузится. */
  url: string | null | undefined
  views: number | null
  views7: number | null
  passwordProtected: boolean
  busy: boolean
  onPublish: () => void
  onCopyLink: () => void
  onOpenPage: () => void
  onPassword: () => void
  onUnpublish: () => void
}

export function ImageStudioShareBar({
  url, views, views7, passwordProtected, busy,
  onPublish, onCopyLink, onOpenPage, onPassword, onUnpublish
}: Props): JSX.Element | null {
  if (url === undefined) return null
  if (url === null) return <Button size="sm" variant="ghost" disabled={busy} onClick={onPublish}>Поделиться</Button>
  return <>
    <Button
      size="sm"
      variant="ghost"
      title={views !== null ? `Просмотров всего: ${views}${views7 !== null ? ` · за 7 дней: ${views7}` : ''}` : 'Скопировать ссылку'}
      onClick={onCopyLink}
    >Ссылка на галерею{views ? ` · ${views} 👁` : ''}</Button>
    <Button size="sm" variant="ghost" onClick={onOpenPage}>Открыть страницу</Button>
    <Button size="sm" variant="ghost" title={passwordProtected ? 'Пароль установлен — изменить или снять' : 'Закрыть галерею паролем для зрителей'} onClick={onPassword}>
      {passwordProtected ? 'Пароль 🔒' : 'Пароль…'}
    </Button>
    <Button size="sm" variant="ghost" onClick={onUnpublish}>Снять публикацию</Button>
  </>
}
