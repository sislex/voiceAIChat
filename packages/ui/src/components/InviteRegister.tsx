// Саморегистрация по инвайт-ссылке (auth-roadmap п.8): `#/invite/<token>` открывается без входа,
// показывает роль из приглашения, принимает логин и пароль (политика — та же, что на сервере) и после успеха
// перезагружает страницу: cookie-сессия уже выставлена, приложение стартует как после обычного входа.
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@voicechat/ui-kit'
import { checkPasswordPolicy } from '@shared/passwordPolicy'

export interface InviteApi {
  inviteInfo(token: string): Promise<{ role: string; expiresAt: number; note: string } | null>
  register(input: { token: string; name: string; password: string }): Promise<{ ok: true } | { error: string }>
}

const ROLE_LABEL: Record<string, string> = { admin: 'администратор', developer: 'разработчик', tester: 'тестировщик', observer: 'наблюдатель' }

export function InviteRegister({ token, api, theme = 'light', onDone }: { token: string; api: InviteApi; theme?: 'light' | 'dark' | 'green'; onDone: () => void }): JSX.Element {
  const [info, setInfo] = useState<{ role: string; expiresAt: number; note: string } | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void api.inviteInfo(token).then(setInfo).catch(() => setInfo(null)) }, [token]) // eslint-disable-line react-hooks/exhaustive-deps
  const policy = password ? checkPasswordPolicy(password, { name }) : null
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (policy) { setError(policy); return }
    setBusy(true); setError(null)
    try {
      const r = await api.register({ token, name: name.trim(), password })
      if ('error' in r) setError(r.error); else onDone()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) }
  }
  return (
    <div className="login-screen" data-theme={theme}>
      <form className="login-card" onSubmit={(e) => void submit(e)} data-testid="invite-register">
        <h1 className="login-title">Регистрация</h1>
        {info === undefined ? <p className="login-hint">Проверяю приглашение…</p> : info === null ? (
          <p className="login-error" role="alert">Приглашение недействительно или истекло. Попросите администратора новую ссылку.</p>
        ) : (
          <>
            <p className="login-hint">Вас пригласили как «{ROLE_LABEL[info.role] ?? info.role}»{info.note ? ` · ${info.note}` : ''}. Ссылка действует до {new Date(info.expiresAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.</p>
            <label className="login-field"><span>Логин</span><input className="login-input" value={name} autoFocus autoComplete="username" aria-label="Логин" onChange={(e) => setName(e.target.value)} placeholder="латиница, цифры, . _ -" /></label>
            <label className="login-field"><span>Пароль</span><input className="login-input" type="password" value={password} autoComplete="new-password" aria-label="Пароль" onChange={(e) => setPassword(e.target.value)} /></label>
            {password && policy && <p className="login-hint" role="status">{policy}</p>}
            {error && <p className="login-error" role="alert">{error}</p>}
            <Button variant="primary" type="submit" disabled={!name.trim() || !password || Boolean(policy) || busy} loading={busy}>Создать учётную запись</Button>
          </>
        )}
        <p className="login-hint"><a href="#/">Уже есть учётная запись — войти</a></p>
      </form>
    </div>
  )
}
