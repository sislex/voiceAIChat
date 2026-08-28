// Смена своего пароля (auth-roadmap пп.11–12): текущий + новый с политикой; при временном пароле — обязательный экран.
import { useState, type FormEvent } from 'react'
import { Button, Dialog, useToast } from '@voicechat/ui-kit'
import { checkPasswordPolicy } from '@shared/passwordPolicy'

interface Props {
  userName: string
  change: (input: { current: string; next: string }) => Promise<{ ok: true } | { error: string }>
  /** Обязательная смена (временный пароль): закрыть нельзя, только сменить или выйти. */
  forced?: boolean
  onDone: () => void
  onClose?: () => void
  onLogout?: () => void
}

export function ChangePasswordDialog({ userName, change, forced = false, onDone, onClose, onLogout }: Props): JSX.Element {
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const policy = next ? checkPasswordPolicy(next, { name: userName }) : null
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (policy) { setError(policy); return }
    setBusy(true); setError(null)
    try {
      const r = await change({ current, next })
      if ('error' in r) setError(r.error); else { toast.success('Пароль изменён; другие сессии завершены'); onDone() }
    } finally { setBusy(false) }
  }
  return (
    <Dialog className="make-dialog" padded title={forced ? 'Смените временный пароль' : 'Смена пароля'} ariaLabel="Смена пароля" size="sm" onClose={forced ? () => undefined : (onClose ?? onDone)} closeOnOverlay={!forced} testId="change-password">
      <form onSubmit={(e) => void submit(e)} className="login-card login-card--inline">
        {forced && <p className="make-ideas-lead">Администратор выдал временный пароль. Пока вы его не смените, доступно только чтение.</p>}
        <label className="login-field"><span>Текущий пароль</span><input className="login-input" type="password" autoComplete="current-password" aria-label="Текущий пароль" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus /></label>
        <label className="login-field"><span>Новый пароль</span><input className="login-input" type="password" autoComplete="new-password" aria-label="Новый пароль" value={next} onChange={(e) => setNext(e.target.value)} /></label>
        {next && policy && <p className="login-hint" role="status">{policy}</p>}
        {error && <p className="login-error" role="alert">{error}</p>}
        <div className="make-ask-actions">
          <Button variant="primary" type="submit" disabled={!current || !next || Boolean(policy) || busy} loading={busy}>Сменить пароль</Button>
          {forced && onLogout && <Button variant="ghost" type="button" onClick={onLogout}>Выйти</Button>}
        </div>
      </form>
    </Dialog>
  )
}
