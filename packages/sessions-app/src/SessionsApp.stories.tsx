import type { Meta, StoryObj } from '@storybook/react'
import { SessionsBulkActions, SessionsPanel } from './SessionsPanel'
import { createSessionsStore, type SessionsStore } from './store/sessionsStore'
import type { SessionsClient } from './contracts'
import { FIXTURE_NOW, makeSession, makeSessions } from './fixtures'
import './styles.css'

/** Клиент витрины: данные заданы, мутации только имитируются. */
function storeOf(sessions: () => Promise<ReturnType<typeof makeSessions>>, over: Partial<SessionsClient> = {}): SessionsStore {
  return createSessionsStore({
    client: {
      list: sessions,
      revoke: async () => undefined,
      revokeOthers: async () => undefined,
      rename: async () => undefined,
      setTrusted: async () => undefined,
      ...over
    },
    host: { now: () => FIXTURE_NOW }
  })
}

const meta = {
  title: 'Sessions/Devices',
  component: SessionsPanel,
  args: { store: storeOf(async () => makeSessions()), now: FIXTURE_NOW }
} satisfies Meta<typeof SessionsPanel>
export default meta
type Story = StoryObj<typeof meta>

/** Обычный список: текущее устройство, телефон, доверенный ноут, давний вход. */
export const Default: Story = {
  render: (args) => (
    <>
      <SessionsPanel {...args} />
      <SessionsBulkActions store={args.store} />
    </>
  )
}

/** Первый вход: одно устройство, массовых действий нет. */
export const SingleDevice: Story = {
  args: { store: storeOf(async () => [makeSession({ sid: 'current', current: true })]) }
}

/** Чужой список в админке: только чтение и завершение. */
export const ReadOnly: Story = { args: { readOnly: true } }

/** Список не пришёл: причина видна, есть «Повторить». */
export const LoadFailed: Story = {
  args: { store: storeOf(async () => { throw new Error('502 Bad Gateway') }) }
}

/** Пусто: объясняем, что будет дальше, а не констатируем пустоту. */
export const Empty: Story = { args: { store: storeOf(async () => []) } }

/** Разные платформы: появляется фильтр, у устройства видно соседние сессии. */
export const MixedPlatforms: Story = {
  args: {
    store: storeOf(async () => [
      makeSession({ sid: 'web-1', platform: 'web', current: true, deviceKey: 'dev-1', requests: 128, lastPath: '/api/projects' }),
      makeSession({ sid: 'web-2', platform: 'web', deviceKey: 'dev-1' }),
      makeSession({ sid: 'app', platform: 'desktop', deviceKey: 'dev-2', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/33.0.0 Chrome/130.0.0.0 Safari/537.36' })
    ])
  }
}

/** Завершённые входы: раздел закрыт по умолчанию и грузится при раскрытии. */
export const WithEnded: Story = {
  args: {
    store: storeOf(async () => makeSessions(), {
      listEnded: async () => [makeSession({ sid: 'gone', ended: true, endedAt: FIXTURE_NOW - 3 * 60 * 60_000 })],
      panic: async () => undefined
    })
  },
  render: (args) => (
    <>
      <SessionsPanel {...args} />
      <SessionsBulkActions store={args.store} />
    </>
  )
}
