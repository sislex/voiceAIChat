import { useState, type FormEvent } from 'react'
import type React from 'react'
import { Button } from '@voicechat/ui-kit'
import { checkPasswordPolicy } from '@shared/passwordPolicy'

export interface LoginScreenProps {
  /** Вход по логину/паролю; `remember` — длинная сессия (auth-roadmap п.15). */
  onLogin: (name: string, password: string, remember: boolean) => void
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
  /** Запрос письма на подтверждённый email; ответ намеренно не сообщает, найден ли адрес. */
  onForgotPassword?: (email: string) => Promise<{ ok: true; message: string } | { error: string }>
  /** Открытая регистрация включена — показать ссылку «Зарегистрироваться». */
  onSignup?: () => void
}

/** Экран входа многопользовательского режима (web). Пароль может быть пустым. */
export function LoginScreen({ onLogin, error, theme = 'light', twoFactor = false, onCode, onCancelTwoFactor, onReset, onForgotPassword, onSignup }: LoginScreenProps): JSX.Element {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [resetMode, setResetMode] = useState(false)
  const [resetCode, setResetCode] = useState('')
  const [forgotMode, setForgotMode] = useState(false)
  const [email, setEmail] = useState('')
  const [forgotStatus, setForgotStatus] = useState<string | null>(null)
  const [forgotError, setForgotError] = useState<string | null>(null)
  const [forgotBusy, setForgotBusy] = useState(false)
  // UX входа (auth-roadmap п.14): показать пароль, предупреждение о Caps Lock, «запомнить меня».
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [remember, setRemember] = useState(true)
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => { if (typeof e.getModifierState === 'function') setCapsLock(e.getModifierState('CapsLock')) }
  const policy = resetMode && password ? checkPasswordPolicy(password, { name }) : null

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (name.trim()) onLogin(name.trim(), password, remember)
  }

  if (forgotMode && onForgotPassword) {
    return (
      <div className="login-screen" data-theme={theme}>
        <form className="login-card" onSubmit={(e) => {
          e.preventDefault()
          if (!email.trim() || forgotBusy) return
          setForgotBusy(true); setForgotError(null); setForgotStatus(null)
          void onForgotPassword(email.trim()).then((result) => {
            if ('error' in result) setForgotError(result.error)
            else setForgotStatus(result.message)
          }).finally(() => setForgotBusy(false))
        }} data-testid="forgot-password">
          <h1 className="login-title">Забыли пароль?</h1>
          <p className="login-hint">Введите подтверждённый email. Если адрес найден, мы отправим ссылку, действующую 1 час.</p>
          <label className="login-field"><span>Email</span><input className="login-input" type="email" value={email} autoFocus autoComplete="email" aria-label="Email" onChange={(e) => setEmail(e.target.value)} /></label>
          {forgotStatus && <p className="login-hint" role="status">{forgotStatus}</p>}
          {forgotError && <p className="login-error" role="alert">{forgotError}</p>}
          <Button variant="primary" type="submit" disabled={!email.trim() || forgotBusy}>{forgotBusy ? 'Отправляем…' : 'Отправить ссылку'}</Button>
          <Button variant="ghost" type="button" onClick={() => { setForgotMode(false); setForgotStatus(null); setForgotError(null) }}>Назад ко входу</Button>
        </form>
      </div>
    )
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
      <form className="login-card" onSubmit={submit} data-testid="login-form">
        <h1 className="login-title">Вход</h1>
        <label className="login-field">
          <span>Пользователь</span>
          <input
            className="login-input"
            data-testid="login-username"
            value={name}
            autoFocus
            autoComplete="username"
            aria-label="Пользователь"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="login-field">
          <span>Пароль</span>
          <span className="login-password">
            <input
              className="login-input"
              data-testid="login-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              autoComplete="current-password"
              aria-label="Пароль"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onKey}
              onKeyUp={onKey}
            />
            <button type="button" className="login-eye" data-testid="login-toggle-password" aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'} title={showPassword ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>{showPassword ? '🙈' : '👁'}</button>
          </span>
          {capsLock && <span className="login-caps" role="status">Включён Caps Lock</span>}
        </label>
        <label className="login-remember"><input type="checkbox" data-testid="login-remember" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Запомнить меня на этом устройстве <small>(иначе сессия — до закрытия браузера)</small></label>
        {error && (
          // Сценарий обязан уметь проверить и неудачный вход, а не только успех.
          <p className="login-error" role="alert" data-testid="login-error">
            {error}
          </p>
        )}
        <Button variant="primary" type="submit" disabled={!name.trim()} data-testid="login-submit">
          Войти
        </Button>
        {onSignup && <p className="login-hint">Нет учётной записи? <button type="button" className="make-link" onClick={onSignup}>Зарегистрироваться</button></p>}
        {(onReset || onForgotPassword) && <p className="login-hint">{onReset && <button type="button" className="make-link" onClick={() => { setResetMode(true); setPassword('') }}>Есть код сброса от администратора?</button>} {onForgotPassword && <button type="button" className="make-link" onClick={() => setForgotMode(true)}>Забыли пароль?</button>}</p>}
      </form>
    </div>
  )
}

export interface ResetPasswordScreenProps {
  token: string
  reset: (input: { token: string; password: string }) => Promise<{ ok: true } | { error: string }>
  theme?: 'light' | 'dark' | 'green'
  onDone: () => void
  onBack: () => void
}

export function ResetPasswordScreen({ token, reset, theme = 'light', onDone, onBack }: ResetPasswordScreenProps): JSX.Element {
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const policy = password ? checkPasswordPolicy(password) : null
  const mismatch = Boolean(repeat) && password !== repeat

  return (
    <div className="login-screen" data-theme={theme}>
      <form className="login-card" onSubmit={(e) => {
        e.preventDefault()
        if (!password || policy || mismatch || busy) return
        setBusy(true); setResetError(null)
        void reset({ token, password }).then((result) => {
          if ('error' in result) setResetError(result.error)
          else onDone()
        }).finally(() => setBusy(false))
      }} data-testid="reset-password-email">
        <h1 className="login-title">Новый пароль</h1>
        <p className="login-hint">Установите новый пароль. После смены все прежние сессии будут завершены.</p>
        <label className="login-field"><span>Новый пароль</span><input className="login-input" type="password" autoFocus autoComplete="new-password" value={password} aria-label="Новый пароль" onChange={(e) => setPassword(e.target.value)} /></label>
        <label className="login-field"><span>Повторите пароль</span><input className="login-input" type="password" autoComplete="new-password" value={repeat} aria-label="Повторите пароль" onChange={(e) => setRepeat(e.target.value)} /></label>
        {policy && <p className="login-hint" role="status">{policy}</p>}
        {mismatch && <p className="login-error" role="alert">Пароли не совпадают</p>}
        {resetError && <p className="login-error" role="alert">{resetError}</p>}
        <Button variant="primary" type="submit" disabled={!password || !repeat || Boolean(policy) || mismatch || busy}>{busy ? 'Сохраняем…' : 'Сменить пароль'}</Button>
        <Button variant="ghost" type="button" onClick={onBack}>Назад ко входу</Button>
      </form>
    </div>
  )
}
