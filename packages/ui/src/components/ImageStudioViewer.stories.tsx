// Сториз лайтбокса студии: обычный просмотр и сравнение правки с исходником.
import type { Meta, StoryObj } from '@storybook/react'
import { userEvent, waitFor, within } from '@storybook/test'
import { ImageStudioViewer } from './ImageStudioViewer'
import { STUDIO_FILES, STUDIO_PIXEL_BASE64 } from '../test/fixtures/imageStudio'

const PREVIEW = `data:image/png;base64,${STUDIO_PIXEL_BASE64}`
const noop = (): void => undefined

function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${Math.round(bytes / 1024)} КБ` : `${bytes} Б`
}

const meta: Meta<typeof ImageStudioViewer> = {
  title: 'ImageStudio/ImageStudioViewer',
  component: ImageStudioViewer,
  args: {
    viewing: 'кот-2.png',
    files: STUDIO_FILES,
    previews: Object.fromEntries(STUDIO_FILES.map((file) => [file.path, PREVIEW])),
    dimensions: { 'кот-2.png': '512×512', 'кот.png': '512×512' },
    compare: false,
    formatBytes,
    canStep: true,
    onCompareChange: noop,
    onView: noop,
    onStep: noop,
    onUsePrompt: noop,
    onPickForEdit: noop,
    onVariate: noop,
    onDownload: noop,
    onDelete: noop,
    onClose: noop
  }
}
export default meta
type Story = StoryObj<typeof ImageStudioViewer>

/** Правка с происхождением: подпись «Из «кот.png» · промпт …» и все действия в шапке. */
export const Default: Story = {}

/** Сравнение с исходником: два кадра рядом, подписи под каждым. */
export const Compare: Story = { args: { compare: true } }

/** Кнопка сравнения доступна только когда исходник ещё в галерее. */
export const OpensCompare: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await waitFor(async () => { await body.findByRole('button', { name: 'Сравнить с исходником' }) })
    await userEvent.click(await body.findByRole('button', { name: 'Сравнить с исходником' }))
  }
}
