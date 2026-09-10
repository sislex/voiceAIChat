import { useId, useState } from 'react'
import { BROWSER_DIALOG_ANSWER_LIMIT, type BrowserDialogAnswer, type BrowserDialogInfo } from '@shared/browserDialogs'
import { Button } from '@voicechat/ui-kit'

/** Диалог блокирует только страницу Reader: чат и другие вкладки остаются доступны. */
export function BrowserSiteDialog({
  dialog,
  onAnswer
}: {
  dialog: BrowserDialogInfo
  onAnswer: (answer: BrowserDialogAnswer) => Promise<void>
}): JSX.Element {
  const titleId = useId()
  const [text, setText] = useState(dialog.defaultValue)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const leaving = dialog.type === 'beforeunload'
  const answer = async (accept: boolean): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onAnswer({
        dialogId: dialog.id,
        accept,
        ...(accept && dialog.type === 'prompt' && dirty ? { promptText: text } : {})
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ответ не отправлен')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="playwright-site-dialog-backdrop">
      <form
        className="playwright-site-dialog"
        role="dialog"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault()
          void answer(true)
        }}
      >
        <strong id={titleId}>{leaving ? 'Покинуть страницу?' : 'Диалог сайта'}</strong>
        <p>{leaving ? 'На странице могут остаться несохранённые изменения.' : dialog.message}</p>
        {dialog.messageTruncated && <p className="playwright-site-dialog-note">Показано начало сообщения.</p>}
        {dialog.type === 'prompt' && (
          <label>
            Ответ сайту
            <input
              autoFocus
              value={text}
              maxLength={BROWSER_DIALOG_ANSWER_LIMIT}
              disabled={busy}
              onChange={(event) => {
                setText(event.target.value)
                setDirty(true)
              }}
            />
          </label>
        )}
        {dialog.defaultValueTruncated && (
          <p className="playwright-site-dialog-note">
            Показано начало значения. Без изменений сохранится исходный текст.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="playwright-site-dialog-actions">
          {dialog.type !== 'alert' && (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void answer(false)}>
              {leaving ? 'Остаться' : 'Отмена'}
            </Button>
          )}
          <Button type="submit" disabled={busy}>
            {leaving ? 'Покинуть страницу' : 'ОК'}
          </Button>
        </div>
      </form>
    </div>
  )
}
