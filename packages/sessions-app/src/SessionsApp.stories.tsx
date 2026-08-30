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
