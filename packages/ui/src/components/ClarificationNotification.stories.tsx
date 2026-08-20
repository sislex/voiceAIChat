import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import { clarificationNotification, longClarificationNotification } from '../test/fixtures'
import { ClarificationNotification } from './ClarificationNotification'

const meta: Meta<typeof ClarificationNotification> = {
  id: 'chatai-clarification-notification',
  title: 'ChatAI/ClarificationNotification',
  component: ClarificationNotification,
  args: { notification: clarificationNotification, onOpen: fn(), onDismiss: fn() },
  decorators: [(Story) => <div style={{ maxWidth: 420 }}><Story /></div>]
}
export default meta
type Story = StoryObj<typeof ClarificationNotification>

export const Active: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Перейти к задаче' }))
    await expect(args.onOpen).toHaveBeenCalledWith(clarificationNotification)
  }
}
export const LongQuestion: Story = { args: { notification: longClarificationNotification } }
export const StaleAfterAnswer: Story = { args: { state: 'stale' } }
export const NavigationError: Story = { args: { error: 'Проект или вопрос временно недоступен. Повторите переход.' } }

