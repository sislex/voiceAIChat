import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { SessionsDialog, describeUserAgent } from './SessionsDialog'

describe('SessionsDialog', () => {
  it('describeUserAgent: браузер и ОС', () => {
    expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36')).toBe('Chrome · macOS')
    expect(describeUserAgent('legacy')).toMatch(/до появления/)
  })
  it('показывает сессии, текущую без кнопки, завершает другую и «выйти на других»', async () => {
    const list = [
      { sid: 'a', user: 'u', createdAt: 1, lastSeen: 2, expiresAt: 9, ip: '1.1.1.1', userAgent: 'Chrome/1 Mac OS X', current: true },
      { sid: 'b', user: 'u', createdAt: 1, lastSeen: 2, expiresAt: 9, ip: '2.2.2.2', userAgent: 'Firefox/1 Windows' }
    ]
    const load = vi.fn(async () => [...list])
    const revoke = vi.fn(async (sid: string) => { const i = list.findIndex((s) => s.sid === sid); list.splice(i, 1) })
    const logoutAll = vi.fn(async () => { list.splice(1) })
    render(<SessionsDialog load={load} revoke={revoke} logoutAll={logoutAll} onClose={() => {}} />)
    expect(await screen.findByText('это устройство')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Завершить' })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Завершить' }))
    expect(revoke).toHaveBeenCalledWith('b')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Завершить' })).toBeNull())
    expect(screen.queryByRole('button', { name: /Выйти на других/ })).toBeNull()
  })
})
