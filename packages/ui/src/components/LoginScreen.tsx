import { useState, type FormEvent } from 'react'
import { Button } from '@voicechat/ui-kit'
import { checkPasswordPolicy } from '@shared/passwordPolicy'

export interface LoginScreenProps {
  /** Вход по логину/паролю. */
  onLogin: (name: string, password: string) => void
  /** Текст ошибки прошлой попытки (null — нет). */
  error?: string | null
  /** Тема интерфейса (для обёртки). */
  theme?: 'light' | 'dark' | 'green'
  /** Второй фактор (auth-roadmap п.6): пароль принят, ждём код из приложения-аутентификатора. */
  twoFactor?: boolean
  onCode?: (code: string) => void
  onCancelTwoFactor?: () => void
  /** Сброс пароля кодом от администратора (auth-roadmap п.10). */
  onReset?: (name: string, code: string, password: string) => void
}

/** Экран входа многопользовательского режима (web). Пароль может быть пустым. */
export function LoginScreen({ onLogin, error, theme = 'light', twoFactor = false, onCode, onCancelTwoFactor, onReset }: LoginScreenProps): JSX.Element {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [resetMode, setResetMode] = useState(false)
  const [resetCode, setResetCode] = useState('')
  const policy = resetMode && password ? checkPasswordPolicy(password, { name }) : null

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (name.trim()) onLogin(name.trim(), password)
  }

  if (resetMode && onReset) {
    return (
      <div className="login-screen" data-theme={theme}>
        <form className="login-card" onSubmit={(e) => { e.preventDefault(); if (name.trim() && resetCode.trim() && !policy) onReset(name.trim(), resetCode.trim(), password) }} data-testid="login-reset">
          <h1 className="login-title">Сброс пароля</h1>
          <p className="login-hint">Введите код, который выдал администратор, и новый пароль.</p>
          <label className="login-field"><span>Пользователь</span><input className="login-input" value={name} autoFocus autoComplete="username" aria-label="Пользователь" onChange={(e) => setName(e.target.value)} /></label>
          <label className="login-field"><span>Код от администратора</span><input className="login-input" value={resetCode} autoComplete="one-time-code" aria-label="Код от администратора" onChange={(e) => setResetCode(e.target.value.toUpperCase())} /></label>
          <label className="login-field"><span>Новый пароль</span><input className="login-input" type="password" value={password} autoComplete="new-password" aria-label="Новый пароль" onChange={(e) => setPassword(e.target.value)} /></label>
          {password && policy && <p className="login-hint" role="status">{policy}</p>}
          {error && <p className="login-error" role="alert">{error}</p>}
          <Button variant="primary" type="submit" disabled={!name.trim() || !resetCode.trim() || !password || Boolean(policy)}>Сменить пароль и войти</Button>
          <Button variant="ghost" type="button" onClick={() => { setResetMode(false); setPassword('') }}>Назад ко входу</Button>
        </form>
      </div>
    )
  }
  if (twoFactor) {
    return (
      <div className="login-screen" data-theme={theme}>
        <form className="login-card" onSubmit={(e) => { e.preventDefault(); if (/^\d{6}$/.test(code.replace(/\s+/g, ''))) onCode?.(code.replace(/\s+/g, '')) }}>
          <h1 className="login-title">Код подтверждения</h1>
          <p className="login-hint">Введите 6 цифр из приложения-аутентификатора.</p>
          <label className="login-field">
            <span>Код</span>
            <input className="login-input" value={code} autoFocus inputMode="numeric" autoComplete="one-time-code" aria-label="Код подтверждения" maxLength={7} onChange={(e) => setCode(e.target.value)} />
          </label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <Button variant="primary" type="submit" disabled={!/^\d{6}$/.test(code.replace(/\s+/g, ''))}>Подтвердить</Button>
          <Button variant="ghost" type="button" onClick={onCancelTwoFactor}>Назад к паролю</Button>
        </form>
      </div>
    )
  }
  return (
    <div className="login-screen" data-theme={theme}>
      <form className="login-card" onSubmit={submit}>
        <h1 className="login-title">Вход</h1>
        <label className="login-field">
          <span>Пользователь</span>
          <input
            className="login-input"
            value={name}
            autoFocus
            autoComplete="username"
            aria-label="Пользователь"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="login-field">
          <span>Пароль</span>
          <input
            className="login-input"
            type="password"
            value={password}
            autoComplete="current-password"
            aria-label="Пароль"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
        <Button variant="primary" type="submit" disabled={!name.trim()}>
          Войти
        </Button>
        {onReset && <p className="login-hint"><button type="button" className="make-link" onClick={() => { setResetMode(true); setPassword('') }}>Есть код сброса от администратора?</button></p>}
      </form>
    </div>
  )
}
