import type { Meta, StoryObj } from '@storybook/react'
import { InviteScreen } from './InviteScreen'
import type { ProjectInvitationPreview } from '@shared/projects'

const preview: ProjectInvitationPreview = {
  projectId: 'p1',
  projectName: 'Редизайн лендинга',
  invitedBy: 'alice',
  role: 'member',
  expiresAt: Date.parse('2026-09-04T00:00:00Z')
}

const meta: Meta<typeof InviteScreen> = {
  title: 'Projects/InviteScreen',
  component: InviteScreen,
  args: { token: 'demo', loadPreview: async () => preview, onDone: () => {} },
  parameters: { layout: 'fullscreen' }
}
export default meta
type Story = StoryObj<typeof InviteScreen>

/** До входа: видно, куда зовут, дальше — вход или регистрация. */
export const Anonymous: Story = { args: { onLogin: () => {}, onSignup: () => {} } }

/** Вошедший: принять или отклонить прямо здесь. */
export const Authenticated: Story = { args: { onAccept: async () => 'p1', onDecline: async () => {} } }

/** Ссылка истекла или отозвана — состояние достижимо только ответом сервера. */
export const Invalid: Story = { args: { loadPreview: async () => null, onLogin: () => {} } }

/** Приглашение владельцем: роль видна до принятия. */
export const AsOwner: Story = {
  args: { loadPreview: async () => ({ ...preview, role: 'owner' }), onAccept: async () => 'p1', onDecline: async () => {} }
}

/** Телефон: карточка и кнопки во всю ширину. */
export const MobileViewport: Story = {
  args: { onAccept: async () => 'p1', onDecline: async () => {} },
  parameters: { viewport: { defaultViewport: 'mobile2' } }
}
