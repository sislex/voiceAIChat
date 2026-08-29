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

/**
 * Телефонная ширина превью — пресет, которым пользуется человек за десктопом.
 *
 * Сам переключатель ширин на телефоне скрыт (`.make-devices { display: none }`),
 * поэтому при просмотре витрины с телефона кликать нечего: без проверки
 * сториз рисовала карточку ошибки «Unable to find … Телефон». В jsdom это не
 * видно — там нет раскладки, медиа-запрос не срабатывает и кнопка есть всегда.
 */
export const Mobile: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const preset = canvas.queryByRole('button', { name: 'Телефон' })
    if (preset) await userEvent.click(preset)
    else await expect(canvas.getByRole('tab', { name: 'Превью' })).toBeInTheDocument()
  }
}

/** Бинарный файл в дереве (загруженная картинка) открывается просмотром, а не редактором. */
export const BinaryFile: Story = {
  play: async ({ canvasElement }) => {
    await api['make:upload']({ conversationId: 'story-make', path: 'img/logo.png', dataBase64: 'iVBORw0KGgo=' })
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'Код' }))
    await userEvent.click((await canvas.findAllByRole('button', { name: /logo\.png/ }))[0]!)
    await expect(await canvas.findByTestId('make-binary')).toBeInTheDocument()
  }
}
