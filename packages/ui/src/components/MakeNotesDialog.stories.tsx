import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from '@storybook/test'
import { createFakeApi } from '../test/fakeApi'
import { MakeNotesDialog } from './MakeNotesDialog'

const api = createFakeApi([])

const meta: Meta<typeof MakeNotesDialog> = {
  title: 'Make/MakeNotesDialog',
  component: MakeNotesDialog,
  args: {
    conversationId: 'make-component-qa',
    api,
    onClose: () => {}
  },
  parameters: { layout: 'fullscreen' }
}
export default meta
type Story = StoryObj<typeof MakeNotesDialog>

/** Загруженные настройки проекта со всеми вариантами stack и независимым Bootstrap UI Kit. */
export const Default: Story = {}
// @testCase TC-UI-01
export const StackMenu: Story = {
  play: async () => {
    const body = within(document.body)
    const menu = await body.findByRole('combobox', { name: 'Стек интерфейса' })
    await expect(within(menu).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'React',
      'Angular',
      'Чистый HTML + CSS + JS',
      'Чистый HTML + CSS'
    ])
    const uiKit = body.getByRole('combobox', { name: 'Стилевая база' })
    await expect(within(uiKit).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Своя система',
      'Bootstrap 5.3'
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
