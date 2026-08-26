import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from '@storybook/test'
import { createFakeApi } from '../test/fakeApi'
import { MakePane } from './MakePane'

// Панель инструмента Make: превью проекта (iframe в витрине показывает страницу-заглушку
// про `srcdoc`-подобный адрес), редактор кода и история снимков. Данные — фейковый
// мост `createFakeApi` (в памяти), сеть не нужна.

const api = createFakeApi([])
const make = { onChanged: () => () => {} }

const meta: Meta<typeof MakePane> = {
  title: 'Make/MakePane',
  component: MakePane,
  parameters: { layout: 'fullscreen' },
  args: { conversationId: 'story-make', api, make, previewBase: 'about:blank#', onInsertToChat: () => {} },
  decorators: [(Story) => <div style={{ height: 640, display: 'flex' }}><Story /></div>]
}
export default meta
type Story = StoryObj<typeof MakePane>

/** Режим по умолчанию — превью с пресетами ширины. */
export const Preview: Story = {}

/** Режим «Код»: дерево файлов и редактор с открытым index.html. */
export const Code: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'Код' }))
    await expect(await canvas.findByLabelText('Содержимое index.html')).toBeInTheDocument()
  }
}

/** Режим «История» без снимков — подсказка, откуда они берутся. */
export const HistoryEmpty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'История' }))
    await expect(canvas.getByText('Снимков пока нет')).toBeInTheDocument()
  }
}

/** Телефонная ширина превью. */
export const Mobile: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Телефон' }))
  }
}
