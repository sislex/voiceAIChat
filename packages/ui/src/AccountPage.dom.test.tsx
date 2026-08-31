// Страница «Мой аккаунт»: свои данные, ни одной административной кнопки.
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountPage, periodRange, toProfileEvents, toProfileUsage, toProfileUser } from './components/AccountPage'
import { UiProviders } from '@voicechat/ui-kit'
import type { RendererApi } from '@shared/ipc'
import type { UsageReport, UserProfileInfo } from '@shared/admin'

const NOW = Date.UTC(2026, 7, 31, 12, 0, 0)

const profile: UserProfileInfo = {
  name: 'marina',
  role: 'developer',
  blocked: false,
  createdAt: NOW - 86_400_000,
  email: 'marina@voicechat.team',
  lastLogin: NOW - 3_600_000,
  lastSeenAt: NOW - 60_000,
  liveSessions: 2,
  llmLimitUsd: 100,
  conversationCount: 7,
  agents: [
    { id: 'm1', name: 'MacBook', online: true, createdAt: 0, lastSeen: NOW, version: '2.7.4', telemetry: { os: { platform: 'darwin', release: '15.6' } } as never },
    { id: 'm2', name: 'Mac mini', online: false, createdAt: 0, lastSeen: NOW - 86_400_000 }
  ]
}

const report: UsageReport = {
  unit: 'day',
  conversationId: null,
  totals: { inputTokens: 1000, outputTokens: 400, cacheReadTokens: 0, costUsd: 12.5, costFromPrices: 9, messages: 30, interrupted: 2 },
  byBucket: [{ bucket: '2026-08-30', inputTokens: 1000, outputTokens: 400, cacheReadTokens: 0, costUsd: 12.5, costFromPrices: 9, messages: 30 }],
  byModel: [{ model: 'opus', inputTokens: 1000, outputTokens: 400, cacheReadTokens: 0, costUsd: 12.5, costFromPrices: 9, messages: 30 }],
  byConversation: []
}

function fakeApi(overrides: Partial<Record<string, unknown>> = {}): RendererApi {
  return {
    'me:profile': vi.fn(async () => profile),
    'me:security': vi.fn(async () => [{ id: 1, at: NOW - 600_000, user: 'marina', type: 'login' as const, ip: '10.0.0.1', userAgent: 'Chrome', details: 'новое устройство' }]),
    'llm:access': vi.fn(async () => [{ provider: 'codex' as const, modelId: '*' }]),
    'usage:report': vi.fn(async () => report),
    ...overrides
  } as unknown as RendererApi
}

function renderPage(api: RendererApi, tab: 'overview' | 'access' | 'machines' | 'usage' | 'history' = 'overview', onChangeTab = vi.fn(), onExportCsv = vi.fn()) {
  return render(
    <UiProviders>
      <AccountPage api={api} tab={tab} onChangeTab={onChangeTab} onClose={() => {}} onExportCsv={onExportCsv} now={NOW} />
    </UiProviders>
  )
}

describe('AccountPage — преобразование ответов сервера', () => {
  it('расход берёт большую из двух оценок и переносит прерванные', () => {
    const usage = toProfileUsage(report)
    expect(usage.spendUsd).toBe(12.5)
    expect(usage.interrupted).toBe(2)
    expect(usage.byModel[0].spendUsd).toBe(12.5)
  })

  it('ОС берётся из телеметрии, у офлайн-машины её нет', () => {
    const user = toProfileUser(profile)
    expect(user.machines[0]).toMatchObject({ platform: 'darwin', osRelease: '15.6', version: '2.7.4' })
    expect(user.machines[1].platform).toBeUndefined()
  })

  it('события получают человеческие подписи', () => {
    expect(toProfileEvents([{ id: 1, at: 0, user: 'marina', type: 'login_failed', ip: '', userAgent: '', details: '' }])[0].label).toBe('Неверный пароль')
  })

  it('период «месяц» считается от первого числа, а «всё время» — без границ', () => {
    expect(new Date(periodRange('month', NOW).from!).getDate()).toBe(1)
    expect(periodRange('all', NOW)).toEqual({})
    expect(periodRange('7d', NOW).from).toBe(NOW - 7 * 86_400_000)
  })
})

describe('AccountPage — экран', () => {
  it('показывает свой профиль и не показывает административных действий', async () => {
    renderPage(fakeApi())
    await waitFor(() => expect(screen.getByTestId('profile-head')).toBeInTheDocument())
    expect(screen.getByTestId('profile-head')).toHaveTextContent('marina@voicechat.team')
    expect(screen.queryByLabelText('Роль пользователя')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Заблокировать' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Удалить учётку' })).toBeNull()
  })

  it('матрица доступа своя и только для чтения', async () => {
    renderPage(fakeApi(), 'access')
    await waitFor(() => expect(screen.getByTestId('access-tab')).toBeInTheDocument())
    expect(screen.getByRole('switch', { name: 'Доступ к OpenAI Codex' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('switch', { name: 'Доступ к OpenAI Codex' })).toBeDisabled()
    expect(screen.queryByTestId('sticky-action-bar')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('журнал грузится только когда он нужен', async () => {
    const api = fakeApi()
    renderPage(api, 'machines')
    await waitFor(() => expect(screen.getByTestId('machines-tab')).toBeInTheDocument())
    expect(api['me:security']).not.toHaveBeenCalled()
  })

  it('экспорт журнала отдаёт CSV хосту', async () => {
    const onExportCsv = vi.fn()
    renderPage(fakeApi(), 'history', vi.fn(), onExportCsv)
    await waitFor(() => expect(screen.getByTestId('history-tab')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Экспорт CSV' }))
    expect(onExportCsv.mock.calls[0][0]).toBe('security-marina.csv')
  })

  it('смена периода перезапрашивает расход с новыми границами', async () => {
    const api = fakeApi()
    renderPage(api, 'usage')
    await waitFor(() => expect(screen.getByTestId('usage-tab')).toBeInTheDocument())
    await userEvent.selectOptions(screen.getByLabelText('Период расхода'), '7d')
    await waitFor(() => expect((api['usage:report'] as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1))
    const last = (api['usage:report'] as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]
    expect(last.from).toBe(NOW - 7 * 86_400_000)
  })

  it('ошибка профиля видна и повторяется кнопкой', async () => {
    const failing = fakeApi({ 'me:profile': vi.fn(async () => { throw new Error('нет связи') }) })
    renderPage(failing)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Не удалось загрузить профиль')
    await userEvent.click(within(alert).getByRole('button', { name: 'Повторить' }))
    expect((failing['me:profile'] as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1)
  })
})
