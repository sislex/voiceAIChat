// Открытая регистрация с подтверждением email: форма логин/email/пароль → письмо со ссылкой → экран «проверьте почту».
// Ссылка `#/verify/<token>` обрабатывается VerifyScreen: подтверждает email, создаёт учётку и входит.
import { useState, type FormEvent } from 'react'
import { Button } from '@voicechat/ui-kit'
import { checkPasswordPolicy } from '@shared/passwordPolicy'

export interface SignupApi {
  signup(input: { name: string; email: string; password: string }): Promise<{ ok: true; mailSent: boolean } | { error: string }>
  resend(email: string): Promise<void>
}

export function SignupScreen({ api, theme = 'light', onBack }: { api: SignupApi; theme?: 'light' | 'dark' | 'green'; onBack: () => void }): JSX.Element {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ email: string; mailSent: boolean } | null>(null)
  const [resent, setResent] = useState(false)
  const policy = password ? checkPasswordPolicy(password, { name }) : null
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (policy) { setError(policy); return }
    setBusy(true); setError(null)
    try {
      const r = await api.signup({ name: name.trim(), email: email.trim(), password })
      if ('error' in r) setError(r.error); else setSent({ email: email.trim(), mailSent: r.mailSent })
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) }
  }
  if (sent) {
    return (
      <div className="login-screen" data-theme={theme}>
        <div className="login-card" data-testid="signup-sent">
          <h1 className="login-title">Проверьте почту</h1>
          <p className="login-hint">Если адрес <b>{sent.email}</b> свободен, мы отправили на него письмо со ссылкой подтверждения. Ссылка действует 24 часа.</p>
          {!sent.mailSent && <p className="login-hint" role="status">На этом сервере почта не настроена — ссылку подтверждения администратор найдёт в логе сервера.</p>}
          <Button variant="ghost" type="button" disabled={resent} onClick={() => { void api.resend(sent.email).then(() => setResent(true)) }}>{resent ? 'Письмо отправлено повторно' : 'Отправить письмо ещё раз'}</Button>
          <p className="login-hint"><button type="button" className="make-link" onClick={onBack}>Ко входу</button></p>
        </div>
      </div>
    )
  }
  return (
    <div className="login-screen" data-theme={theme}>
      <form className="login-card" onSubmit={(e) => void submit(e)} data-testid="signup-form">
        <h1 className="login-title">Регистрация</h1>
        <label className="login-field"><span>Логин</span><input className="login-input" value={name} autoFocus autoComplete="username" aria-label="Логин" placeholder="латиница, цифры, . _ -" onChange={(e) => setName(e.target.value)} /></label>
        <label className="login-field"><span>Email</span><input className="login-input" type="email" value={email} autoComplete="email" aria-label="Email" onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="login-field"><span>Пароль</span><input className="login-input" type="password" value={password} autoComplete="new-password" aria-label="Пароль" onChange={(e) => setPassword(e.target.value)} /></label>
        {password && policy && <p className="login-hint" role="status">{policy}</p>}
        {error && <p className="login-error" role="alert">{error}</p>}
        <Button variant="primary" type="submit" disabled={!name.trim() || !emailOk || !password || Boolean(policy) || busy} loading={busy}>Зарегистрироваться</Button>
        <p className="login-hint">Уже есть учётная запись — <button type="button" className="make-link" onClick={onBack}>войти</button></p>
      </form>
    </div>
  )
}

export function VerifyScreen({ token, verify, theme = 'light', onDone, onBack }: { token: string; verify: (token: string) => Promise<{ ok: true } | { error: string }>; theme?: 'light' | 'dark' | 'green'; onDone: () => void; onBack: () => void }): JSX.Element {
  const [state, setState] = useState<'pending' | 'error'>('pending')
  const [error, setError] = useState('')
  const [started, setStarted] = useState(false)
  if (!started) { setStarted(true); void verify(token).then((r) => { if ('error' in r) { setError(r.error); setState('error') } else onDone() }).catch((e) => { setError(e instanceof Error ? e.message : String(e)); setState('error') }) }
  return (
    <div className="login-screen" data-theme={theme}>
      <div className="login-card" data-testid="verify-screen">
        <h1 className="login-title">Подтверждение email</h1>
        {state === 'pending' ? <p className="login-hint" role="status">Проверяю ссылку…</p> : <><p className="login-error" role="alert">{error}</p><p className="login-hint"><button type="button" className="make-link" onClick={onBack}>Ко входу</button></p></>}
      </div>
    </div>
  )
}
