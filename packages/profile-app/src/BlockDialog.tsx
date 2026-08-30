// Подтверждение блокировки с необязательной причиной.
//
// Причина уходит в журнал безопасности: через месяц вопрос «почему он
// заблокирован» задаёт уже другой администратор, и «администратор admin» без
// пояснения ему ничем не помогает.

import { useState } from 'react'
import { Button, Dialog } from '@voicechat/ui-kit'

export interface BlockDialogProps {
  userName: string
  /** Разблокировка тоже проходит через подтверждение: это смена прав доступа. */
  blocking: boolean
  onConfirm: (reason: string) => void
  onCancel: () => void
}

export function BlockDialog({ userName, blocking, onConfirm, onCancel }: BlockDialogProps): JSX.Element {
  const [reason, setReason] = useState('')
  return (
    <Dialog title={blocking ? `Заблокировать ${userName}?` : `Разблокировать ${userName}?`} size="sm" onClose={onCancel} testId="block-dialog">
      <p className="vcp-dialog__text">
        {blocking
          ? `Активные сессии ${userName} будут завершены, а новые подключения станут недоступны.`
          : `${userName} снова сможет входить и запускать ходы модели.`}
      </p>
      <label className="vcp-dialog__field">
        Причина <span>необязательно</span>
        <textarea
          aria-label="Причина"
          placeholder="Например: запрос службы безопасности"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="vcp-dialog__actions">
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant={blocking ? 'danger' : 'primary'} onClick={() => onConfirm(reason.trim())}>
          {blocking ? 'Заблокировать' : 'Разблокировать'}
        </Button>
      </div>
    </Dialog>
  )
}
