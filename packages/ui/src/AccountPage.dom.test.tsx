// Страница «Мой аккаунт»: свои данные, ни одной административной кнопки.
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountPage } from './components/AccountPage'
import { periodRange } from '@sislexa/identity/account/AccountPage'
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
})
