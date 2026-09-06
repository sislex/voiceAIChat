import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from '@storybook/test'
import { createFakeApi } from '../test/fakeApi'
import { MakeNotesDialog } from './MakeNotesDialog'

const api = createFakeApi([])

const meta: Meta<typeof MakeNotesDialog> = {
  title: 'Make/MakeNotesDialog',
  component: MakeNotesDialog,
  args: {
    conversationId: 'story-make-notes',
    api,
    onClose: () => {}
  }
}

export default meta
type Story = StoryObj<typeof MakeNotesDialog>

// @testCase TC-UI-01
export const StackMenu: Story = {
  play: async () => {
    const body = within(document.body)
    const menu = await body.findByRole('combobox', { name: 'Стек интерфейса' })
    await expect(within(menu).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'React',
      'Angular',
      'Bootstrap',
      'Чистый HTML + CSS + JS',
      'Чистый HTML + CSS'
    ])
    await userEvent.selectOptions(menu, 'React')
    await userEvent.click(body.getByRole('button', { name: 'Сохранить' }))
    await expect(await body.findByTestId('make-stack-confirm')).toBeInTheDocument()
  }
}

export const Loading: Story = {
  args: {
    api: {
      ...api,
      'make:notes': () => new Promise(() => {})
    }
  }
}

export const LoadError: Story = {
  args: {
    api: {
      ...api,
      'make:notes': async () => { throw new Error('Не удалось загрузить настройки') }
    }
  }
}
