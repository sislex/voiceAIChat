// Диалог «Сессии и устройства» — обёртка панели в модальное окно приложения.
// Отдельный компонент нужен, чтобы админка могла взять только панель, без окна.
import { useMemo } from 'react'
import { Dialog } from '@voicechat/ui-kit'
import { SessionsBulkActions, SessionsPanel, type SessionsConfirm } from './SessionsPanel'
import { DEFAULT_TEXTS, type SessionsTexts } from './texts'
import type { SessionsStore } from './store/sessionsStore'

export interface SessionsDialogProps {
  store: SessionsStore
  onClose: () => void
  texts?: Partial<SessionsTexts>
  locale?: string
  confirm?: SessionsConfirm
  now?: number
}

export function SessionsDialog({ store, onClose, texts: overrides, locale, confirm, now }: SessionsDialogProps): JSX.Element {
  const texts = useMemo(() => ({ ...DEFAULT_TEXTS, ...overrides }), [overrides])
  return (
    <Dialog
      className="vcs-dialog"
      padded
      size="md"
      title={texts.title}
      ariaLabel={texts.title}
      onClose={onClose}
      showClose
      testId="sessions-dialog"
      footer={<SessionsBulkActions store={store} texts={overrides} confirm={confirm} />}
    >
      <p className="vcs-lead">{texts.lead}</p>
      <SessionsPanel store={store} texts={overrides} locale={locale} confirm={confirm} now={now} />
    </Dialog>
  )
}
