// Страница «Мой аккаунт»: свои данные, ни одной административной кнопки.
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountPage, periodRange, toProfileEvents, toProfileUsage, toProfileUser } from './components/AccountPage'
import { readResources } from './clients/readResources'
import { UiProviders } from '@voicechat/ui-kit'
import type { RendererApi } from '@shared/ipc'
import type { UsageReport, UserProfileInfo } from '@shared/admin'

import { uiPerformance } from './lib/uiPerformance'
// @testCase T1
it('waits for the selected account tab data before measuring readiness', async () => {
  const p=uiPerformance(),mark=vi.spyOn(p,'mark')
  let complete!: (value:UsageReport)=>void
  const api=fakeApi({'usage:report':()=>new Promise<UsageReport>(r=>{complete=r})})
  p.begin('route');renderPage(api,'usage')
  await screen.findByTestId('account-page')
  await act(async()=>{await new Promise(r=>setTimeout(r,40))})
  expect(mark).not.toHaveBeenCalledWith('route','account_ready')
  await act(async()=>{complete(report)})
  await waitFor(()=>expect(mark).toHaveBeenCalledWith('route','account_ready'))
  p.hidden();mark.mockRestore()
})
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
    'agents:list': vi.fn(async () => profile.agents ?? []),
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
  // @testCase TC1
  it('reopening Account uses fresh data without a profile skeleton', async () => {
    const api = fakeApi()
    const first = renderPage(api, 'usage')
    await screen.findByTestId('usage-tab')
    await waitFor(() => expect(api['usage:report']).toHaveBeenCalledTimes(1))
    first.unmount()
    renderPage(api, 'usage')
    expect(screen.queryByTestId('account-skeleton')).toBeNull()
    await screen.findByTestId('usage-tab')
    expect(api['me:profile']).toHaveBeenCalledTimes(1)
    expect(api['usage:report']).toHaveBeenCalledTimes(1)
  })

  // @testCase TC3
  it('a late profile from a cleared session cannot replace the current identity', async () => {
    let finish!: (value: UserProfileInfo) => void
    const load = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValue({ ...profile, email: 'current@example.test' })
    const api = fakeApi({ 'me:profile': load })
    const old = renderPage(api, 'access')
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    old.unmount()
    readResources(api).clear()
    renderPage(api, 'access')
    expect(await screen.findByTestId('profile-head')).toHaveTextContent('current@example.test')
    await act(async () => { finish(profile) })
    expect(screen.getByTestId('profile-head')).toHaveTextContent('current@example.test')
    expect(screen.queryByText(profile.email!)).toBeNull()
  })

  // @testCase TC3
  it('history A → B → A shares cached A and ignores a late B response', async () => {
    let finish!: (value: Awaited<ReturnType<RendererApi['me:security']>>) => void
    const api = fakeApi()
    const original = api['me:security']
    api['me:security'] = vi.fn(async input => input?.group === 'machines'
      ? new Promise<Awaited<ReturnType<RendererApi['me:security']>>>(resolve => { finish = resolve }) : original(input))
    renderPage(api, 'history')
    await screen.findByTestId('history-tab')
    await userEvent.selectOptions(screen.getByLabelText('Тип событий'), 'machines')
    await waitFor(() => expect(api['me:security']).toHaveBeenCalledTimes(2))
    await userEvent.selectOptions(screen.getByLabelText('Тип событий'), 'all')
    await act(async () => { finish([{ id: 9, at: NOW, user: 'marina', type: 'login_failed', ip: '', userAgent: '', details: '' }]) })
    expect(screen.queryByText('Неверный пароль')).toBeNull()
    expect(api['me:security']).toHaveBeenCalledTimes(2)
  })

  // @testCase TC3
  it('usage keeps its period selector usable and ignores the abandoned period response', async () => {
    let finish!: (value: UsageReport) => void
    const api = fakeApi({ 'usage:report': vi.fn(async (input: Parameters<RendererApi['usage:report']>[0]) => input?.from === periodRange('7d', NOW).from
      ? new Promise<UsageReport>(resolve => { finish = resolve }) : report) })
    renderPage(api, 'usage')
    await screen.findByTestId('usage-tab')
    await userEvent.selectOptions(screen.getByLabelText('Период расхода'), '7d')
    await waitFor(() => expect(api['usage:report']).toHaveBeenCalledTimes(2))
    await userEvent.selectOptions(screen.getByLabelText('Период расхода'), 'month')
    await act(async () => { finish({ ...report, byModel: [{ ...report.byModel[0], model: 'abandoned-period-model' }] }) })
    expect(screen.queryByText('abandoned-period-model')).toBeNull()
    expect(api['usage:report']).toHaveBeenCalledTimes(2)
  })

  // @testCase TC3
  it('Overview retry repeats only the failed block', async () => {
    const api = fakeApi({ 'usage:report': vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(report) })
    renderPage(api)
    const alert = await screen.findByRole('alert')
    await userEvent.click(within(alert).getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(api['usage:report']).toHaveBeenCalledTimes(2))
    expect(api['me:profile']).toHaveBeenCalledTimes(1)
    expect(api['llm:access']).toHaveBeenCalledTimes(1)
    expect(api['me:security']).toHaveBeenCalledTimes(1)
  })

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

  it('показывает профиль, не дожидаясь тяжёлых данных обзора', async () => {
    const pending = new Promise<never>(() => {})
    const api = fakeApi({
      'llm:access': vi.fn(() => pending),
      'usage:report': vi.fn(() => pending),
      'me:security': vi.fn(() => pending)
    })
    renderPage(api)
    expect(await screen.findByTestId('profile-head')).toHaveTextContent('marina')
    expect(screen.getByTestId('profile-overview-events-skeleton-list')).toBeInTheDocument()
    expect(screen.getByTestId('profile-overview-usage-skeleton-list')).toBeInTheDocument()
  })

  it('на вкладке доступа не запрашивает расход, журнал и машины', async () => {
    const api = fakeApi()
    renderPage(api, 'access')
    await screen.findByTestId('access-tab')
    expect(api['llm:access']).toHaveBeenCalledTimes(1)
    expect(api['usage:report']).not.toHaveBeenCalled()
    expect(api['me:security']).not.toHaveBeenCalled()
    expect(api['agents:list']).not.toHaveBeenCalled()
  })

  it('полные данные машин запрашивает только после открытия их вкладки', async () => {
    const me = { ...profile, agents: undefined, machinesTotal: 2, machinesOnline: 1 }
    const api = fakeApi({ 'me:profile': vi.fn(async () => me) })
    renderPage(api, 'machines')
    await waitFor(() => expect(api['agents:list']).toHaveBeenCalledTimes(1))
    expect(await screen.findByTestId('machines-tab')).toHaveTextContent('MacBook')
    expect(api['usage:report']).not.toHaveBeenCalled()
    expect(api['me:security']).not.toHaveBeenCalled()
    expect(api['llm:access']).not.toHaveBeenCalled()
  })

  it('ошибка данных вкладки не скрывает уже загруженный профиль', async () => {
    const api = fakeApi({ 'llm:access': vi.fn(async () => { throw new Error('доступ недоступен') }) })
    renderPage(api, 'access')
    expect(await screen.findByTestId('profile-head')).toHaveTextContent('marina')
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить данные вкладки')
  })

  it('экспорт журнала отдаёт CSV хосту', async () => {
    const onExportCsv = vi.fn()
    renderPage(fakeApi(), 'history', vi.fn(), onExportCsv)
    await waitFor(() => expect(screen.getByTestId('history-tab')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Экспорт CSV' }))
    expect(onExportCsv.mock.calls[0][0]).toBe('security-marina.csv')
  })

  it('фильтр журнала перезапрашивает только выбранную группу', async () => {
    const api = fakeApi()
    renderPage(api, 'history')
    await screen.findByTestId('history-tab')
    await userEvent.selectOptions(screen.getByLabelText('Тип событий'), 'machines')
    await waitFor(() => expect(api['me:security']).toHaveBeenLastCalledWith({ limit: 200, group: 'machines' }))
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
