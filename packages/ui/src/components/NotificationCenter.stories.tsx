import type { Meta, StoryObj } from '@storybook/react'
import { NotificationHistory } from './NotificationCenter'
const meta: Meta<typeof NotificationHistory> = { title: 'Shell/NotificationCenter', component: NotificationHistory, args: { items: [], onRead: () => {} } }
export default meta
type Story = StoryObj<typeof NotificationHistory>
export const Empty: Story = {}
export const Unread: Story = { args: { items: [{ id: 'n1', text: 'Ран завершён', time: 1789250000000, source: 'run', kind: 'success', read: false }] } }
