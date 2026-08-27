// Второй фактор TOTP (auth-roadmap п.6): включение по коду из приложения-аутентификатора и отключение.
// QR не рисуем (нет зависимости) — даём otpauth-ссылку и ключ для ручного ввода; ссылку можно открыть на телефоне.
import { useEffect, useState } from 'react'
import { Button, Dialog, useToast } from '@voicechat/ui-kit'

interface TwoFactorApi { status(): Promise<{ enabled: boolean }>; setup(): Promise<{ secret: string; otpauth: string }>; enable(code: string): Promise<void>; disable(code: string): Promise<void> }

export function TwoFactorDialog({ api, onClose }: { api: TwoFactorApi; onClose: () => void }): JSX.Element {
  const toast = useToast()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { void api.status().then((s) => setEnabled(s.enabled)).catch((e) => toast.error(e instanceof Error ? e.message : String(e))) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<void>, ok: string): Promise<void> => {
    setBusy(true)
    try { await fn(); toast.success(ok); setCode(''); setSetup(null); setEnabled((await api.status()).enabled) } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const validCode = /^\d{6}$/.test(code.replace(/\s+/g, ''))
  return (
    <Dialog className="make-dialog" padded title="Двухфакторная защита" ariaLabel="Двухфакторная защита" size="sm" onClose={onClose} testId="two-factor-dialog">
      {enabled === null ? <p className="fsub">Загрузка…</p> : enabled ? (
        <>
          <p className="make-ideas-lead">Второй фактор включён: при входе после пароля нужен код из приложения-аутентификатора.</p>
          <label className="login-field"><span>Код для отключения</span><input className="login-input" inputMode="numeric" aria-label="Код для отключения" value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <Button size="sm" variant="danger" disabled={!validCode || busy} loading={busy} onClick={() => void run(() => api.disable(code.replace(/\s+/g, '')), 'Второй фактор выключен')}>Выключить 2FA</Button>
        </>
      ) : setup ? (
        <>
          <p className="make-ideas-lead">Добавьте ключ в Google Authenticator, 1Password или другое TOTP-приложение и введите код, чтобы включить защиту.</p>
          <p><a className="make-link" href={setup.otpauth}>Открыть в приложении-аутентификаторе</a></p>
          <p className="fsub">Ключ для ручного ввода: <code data-testid="two-factor-secret">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code></p>
          <label className="login-field"><span>Код из приложения</span><input className="login-input" inputMode="numeric" autoComplete="one-time-code" aria-label="Код из приложения" value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <Button size="sm" variant="primary" disabled={!validCode || busy} loading={busy} onClick={() => void run(() => api.enable(code.replace(/\s+/g, '')), 'Второй фактор включён')}>Включить 2FA</Button>
        </>
      ) : (
        <>
          <p className="make-ideas-lead">Второй фактор выключен. Включите, чтобы вход требовал одноразовый код помимо пароля — особенно важно для администратора.</p>
          <Button size="sm" variant="primary" loading={busy} onClick={() => { setBusy(true); void api.setup().then(setSetup).catch((e) => toast.error(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false)) }}>Настроить</Button>
        </>
      )}
    </Dialog>
  )
}
