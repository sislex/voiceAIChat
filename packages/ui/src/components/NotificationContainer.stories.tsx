import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import { clarificationNotification, longClarificationNotification } from '../test/fixtures'
import { NotificationContainer } from './ClarificationNotification'

const meta: Meta<typeof NotificationContainer> = {
  id: 'chatai-notification-container',
  title: 'ChatAI/NotificationContainer',
  component: NotificationContainer,
  args: { notifications: [clarificationNotification], onOpen: fn(), onDismiss: fn() }
}
export default meta
type Story = StoryObj<typeof NotificationContainer>

export const Single: Story = {}
export const MultipleTasks: Story = { args: { notifications: [clarificationNotification, longClarificationNotification] } }
export const Closed: Story = { args: { notifications: [] } }
export const RetryableNavigationError: Story = {
  args: { errors: { [clarificationNotification.questionId]: 'Не удалось открыть задачу. Повторите попытку.' } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Закрыть' }))
    await expect(args.onDismiss).toHaveBeenCalledWith(clarificationNotification)
  }
}
export const MobileLongQuestion: Story = {
  args: { notifications: [longClarificationNotification] },
  parameters: { viewport: { defaultViewport: 'mobile1' } }
}

