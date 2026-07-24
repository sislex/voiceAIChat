import { useState, type FormEvent } from 'react'

export interface LoginScreenProps {
  /** Вход по логину/паролю. */
  onLogin: (name: string, password: string) => void
  /** Текст ошибки прошлой попытки (null — нет). */
  error?: string | null
  /** Тема интерфейса (для обёртки). */
  theme?: 'light' | 'dark'
}

/** Экран входа многопользовательского режима (web). Пароль может быть пустым. */
export function LoginScreen({ onLogin, error, theme = 'light' }: LoginScreenProps): JSX.Element {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (name.trim()) onLogin(name.trim(), password)
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
        <button className="login-submit" type="submit" disabled={!name.trim()}>
          Войти
        </button>
        <p className="login-hint">Пользователи: admin, user (пароль пустой)</p>
      </form>
    </div>
  )
}
