import type { Meta, StoryObj } from '@storybook/react'
import { createFakeApi } from '../test/fakeApi'
import { MakeNotesDialog } from './MakeNotesDialog'

const meta: Meta<typeof MakeNotesDialog> = {
  title: 'Make/MakeNotesDialog',
  component: MakeNotesDialog,
  args: {
    conversationId: 'make-component-qa',
    api: createFakeApi([]),
    onClose: () => {}
  },
  parameters: { layout: 'fullscreen' }
}
export default meta
type Story = StoryObj<typeof MakeNotesDialog>

/** Загруженные настройки проекта со всеми вариантами stack и независимым Bootstrap UI Kit. */
export const Default: Story = {}
