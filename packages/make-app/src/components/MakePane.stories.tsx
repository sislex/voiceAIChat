import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from '@storybook/test'
import { createFakeApi } from '@voicechat/ui-foundation/test/fakeApi'
import { MakePane } from './MakePane'

// Make panel stories: project preview, code editor, and snapshot history. The showcase iframe
// displays a placeholder for the srcdoc-like URL. An in-memory createFakeApi bridge supplies data
// without network access.

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

/** Default preview mode with width presets. */
export const Preview: Story = {}

/** Code mode: file tree and editor with index.html open. */
export const Code: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'Код' }))
    await expect(await canvas.findByLabelText('Содержимое index.html')).toBeInTheDocument()
  }
}

/** Empty history mode explains where snapshots come from. */
export const HistoryEmpty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'История' }))
    await expect(canvas.getByText('Снимков пока нет')).toBeInTheDocument()
  }
}

/**
 * The phone-width preset is intended for desktop users. The width switcher is hidden on phones by
 * .make-devices { display: none }, so the story must not click an absent button. Without the
 * visibility check, mobile showcase visits displayed an element-not-found error. jsdom cannot
 * expose this because it has no layout or active media queries.
 */
export const Mobile: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const preset = canvas.queryByRole('button', { name: 'Телефон' })
    if (preset) await userEvent.click(preset)
    else await expect(canvas.getByRole('tab', { name: 'Превью' })).toBeInTheDocument()
  }
}

/** Opening a binary tree entry, such as an uploaded image, shows a viewer rather than the code editor. */
export const BinaryFile: Story = {
  play: async ({ canvasElement }) => {
    await api['make:upload']({ conversationId: 'story-make', path: 'img/logo.png', dataBase64: 'iVBORw0KGgo=' })
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'Код' }))
    await userEvent.click((await canvas.findAllByRole('button', { name: /logo\.png/ }))[0]!)
    await expect(await canvas.findByTestId('make-binary')).toBeInTheDocument()
  }
}
