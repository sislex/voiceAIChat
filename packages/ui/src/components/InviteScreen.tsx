// Ссылка из письма-приглашения: `#/invite/<token>`.
//
// Экран один на два случая, и это осознанно. Неавторизованный видит, куда его
// зовут (имя проекта и кто позвал — публичный превью отдаёт только это), и уходит
// входить или регистрироваться. Вошедший тем же экраном принимает или отклоняет:
// два разных экрана расходились бы текстами и состояниями ошибок.
import { useEffect, useState } from 'react'
import { Button, ErrorState } from '@voicechat/ui-kit'
import type { ProjectInvitationPreview } from '@shared/projects'

export interface InviteScreenProps {
  token: string
  /** Публичный превью по токену; null — приглашение недействительно или истекло. */
  loadPreview: (token: string) => Promise<ProjectInvitationPreview | null>
  /** Есть только у вошедшего: принять и отклонить. */
  onAccept?: (token: string) => Promise<string | null>
  onDecline?: (token: string) => Promise<void>
  /** Уйти на вход/регистрацию (для неавторизованного) или на главную. */
  onLogin?: () => void
  onSignup?: () => void
  onDone: () => void
  theme?: 'light' | 'dark' | 'green'
}

export function InviteScreen({ token, loadPreview, onAccept, onDecline, onLogin, onSignup, onDone, theme = 'light' }: InviteScreenProps): JSX.Element {
  const [preview, setPreview] = useState<ProjectInvitationPreview | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'invalid'>('loading')
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)

  useEffect(() => {
    let live = true
    void loadPreview(token)
      .then((data) => { if (!live) return; setPreview(data); setStatus(data ? 'ready' : 'invalid') })
      .catch(() => { if (live) setStatus('invalid') })
    return () => { live = false }
  }, [token, loadPreview])

  const authed = Boolean(onAccept)

  return (
    <div className="login-screen" data-theme={theme}>
      <div className="login-card invite-card" data-testid="invite-screen">
        <h1 className="login-title">Приглашение в проект</h1>

        {status === 'loading' && <p className="login-hint" role="status">Проверяю ссылку…</p>}

        {status === 'invalid' && (
          <ErrorState
            compact
            message="Приглашение недействительно"
            detail="Ссылка истекла или была отозвана. Попросите отправить приглашение заново."
          />
        )}

        {status === 'ready' && preview && (
          <>
            <p className="invite-project">«{preview.projectName}»</p>
            <p className="login-hint">
              Пригласил: <b>{preview.invitedBy}</b> · роль: {preview.role === 'owner' ? 'владелец' : 'участник'}
              {' · до '}
              <time dateTime={new Date(preview.expiresAt).toISOString()}>{new Date(preview.expiresAt).toLocaleDateString('ru-RU')}</time>
            </p>
            <div className="invite-actions">
              {authed ? (
                <>
                  <Button
                    fullWidth
                    loading={busy === 'accept'}
                    onClick={async () => {
                      setBusy('accept')
                      try { if (await onAccept!(token)) onDone() } finally { setBusy(null) }
                    }}
                  >
                    Принять приглашение
                  </Button>
                  {onDecline && (
                    <Button
                      fullWidth
                      variant="ghost"
                      loading={busy === 'decline'}
                      onClick={async () => {
                        setBusy('decline')
                        try { await onDecline(token); onDone() } finally { setBusy(null) }
                      }}
                    >
                      Отклонить
                    </Button>
                  )}
                </>
              ) : (
                <>
                  {onLogin && <Button fullWidth onClick={onLogin}>Войти и принять</Button>}
                  {onSignup && <Button fullWidth variant="secondary" onClick={onSignup}>Зарегистрироваться</Button>}
                </>
              )}
            </div>
          </>
        )}

        {status !== 'loading' && (
          <p className="login-hint">
            <button type="button" className="make-link" onClick={onDone}>{authed ? 'К проектам' : 'Ко входу'}</button>
          </p>
        )}
      </div>
    </div>
  )
}
