import type { Meta, StoryObj } from '@storybook/react'
import { MobileNavigation } from './MobileNavigation'
const meta: Meta<typeof MobileNavigation> = { title: 'Shell/MobileNavigation', component: MobileNavigation, args: { preview: true, active: 'chat', onNavigate: () => {}, onMore: () => {} }, parameters: { viewport: { defaultViewport: 'mobile1' } } }
export default meta
type Story = StoryObj<typeof MobileNavigation>
export const Chat: Story = {}
export const Board: Story = { args: { active: 'board' } }
export const Machines: Story = { args: { active: 'machines' } }
export const Releases: Story = { args: { active: 'releases' } }
