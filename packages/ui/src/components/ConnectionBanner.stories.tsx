import type { Meta, StoryObj } from '@storybook/react'
import { ConnectionBanner } from './ConnectionBanner'
const meta: Meta<typeof ConnectionBanner> = { title: 'Shell/ConnectionBanner', component: ConnectionBanner, args: { since: Date.now() - 65000, onRetry: () => {} } }
export default meta
type Story = StoryObj<typeof ConnectionBanner>
export const Disconnected: Story = {}
export const Retrying: Story = { args: { since: Date.now() - 125000 } }
