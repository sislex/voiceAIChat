import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { InviteScreen } from './InviteScreen'
import { expectNoViolations } from '../test/a11y'
import type { ProjectInvitationPreview } from '@shared/projects'

const preview: ProjectInvitationPreview = {
  projectId: 'p1',
  projectName: 'Редизайн лендинга',
  invitedBy: 'alice',
  role: 'member',
  expiresAt: Date.parse('2026-09-04T00:00:00Z')
}

describe('InviteScreen — до входа', () => {
  it('показывает проект и кто позвал, ведёт на вход и регистрацию', async () => {
    const onLogin = vi.fn()
    const onSignup = vi.fn()
    render(<InviteScreen token="t1" loadPreview={async () => preview} onLogin={onLogin} onSignup={onSignup} onDone={vi.fn()} />)
    expect(await screen.findByText('«Редизайн лендинга»')).toBeInTheDocument()
    expect(screen.getByText(/alice/)).toBeInTheDocument()
    // Принять до входа нельзя — только войти или зарегистрироваться.
    expect(screen.queryByRole('button', { name: 'Принять приглашение' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Войти и принять' }))
    expect(onLogin).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    expect(onSignup).toHaveBeenCalled()
    await expectNoViolations()
  })

  it('недействительная ссылка объясняет причину, а не показывает пустоту', async () => {
    render(<InviteScreen token="bad" loadPreview={async () => null} onDone={vi.fn()} />)
    expect(await screen.findByText('Приглашение недействительно')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Войти и принять' })).not.toBeInTheDocument()
  })

  it('сбой запроса не оставляет вечный «проверяю ссылку»', async () => {
    render(<InviteScreen token="x" loadPreview={async () => { throw new Error('offline') }} onDone={vi.fn()} />)
    expect(await screen.findByText('Приглашение недействительно')).toBeInTheDocument()
  })
})

describe('InviteScreen — вошедший пользователь', () => {
  it('главное действие оформлено как основное, а не наравне с прочими', async () => {
    render(<InviteScreen token="t1" loadPreview={async () => preview} onAccept={async () => 'p1'} onDecline={async () => {}} onDone={vi.fn()} />)
    const accept = await screen.findByRole('button', { name: 'Принять приглашение' })
    expect(accept.className).toContain('vc-btn--primary')
    // Отклонение остаётся тихим: два акцентных действия рядом сбивают выбор.
    expect(screen.getByRole('button', { name: 'Отклонить' }).className).toContain('vc-btn--ghost')
  })

  it('вошедшему это модальное окно, а не экран поверх приложения', async () => {
    render(<InviteScreen token="t1" loadPreview={async () => preview} onAccept={async () => 'p1'} onDecline={async () => {}} onDone={vi.fn()} />)
    // `.login-screen` не перекрывает приложение: карточка рисовалась сквозь чат
    // вместе с композером. Модальность даёт только Dialog.
    expect(await screen.findByRole('dialog', { name: 'Приглашение в проект' })).toBeInTheDocument()
    expect(document.querySelector('.login-screen')).toBeNull()
  })

  it('неавторизованному остаётся отдельный экран входа, а не окно', async () => {
    render(<InviteScreen token="t1" loadPreview={async () => preview} onLogin={vi.fn()} onSignup={vi.fn()} onDone={vi.fn()} />)
    await screen.findByText('«Редизайн лендинга»')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('.login-screen')).not.toBeNull()
  })

  it('принимает приглашение и уходит в проект', async () => {
    const onAccept = vi.fn().mockResolvedValue('p1')
    const onDone = vi.fn()
    render(<InviteScreen token="t1" loadPreview={async () => preview} onAccept={onAccept} onDecline={vi.fn()} onDone={onDone} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Принять приглашение' }))
    expect(onAccept).toHaveBeenCalledWith('t1')
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('отказ сервера оставляет на экране, а не уводит молча', async () => {
    const onAccept = vi.fn().mockResolvedValue(null)
    const onDone = vi.fn()
    render(<InviteScreen token="t1" loadPreview={async () => preview} onAccept={onAccept} onDone={onDone} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Принять приглашение' }))
    await waitFor(() => expect(onAccept).toHaveBeenCalled())
    expect(onDone).not.toHaveBeenCalled()
  })

  it('отклоняет приглашение', async () => {
    const onDecline = vi.fn().mockResolvedValue(undefined)
    const onDone = vi.fn()
    render(<InviteScreen token="t1" loadPreview={async () => preview} onAccept={vi.fn()} onDecline={onDecline} onDone={onDone} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Отклонить' }))
    expect(onDecline).toHaveBeenCalledWith('t1')
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
})
