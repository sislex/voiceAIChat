// Сториз панели студии картинок: галерея с происхождением, пустое состояние,
// мультивыбор и ошибка загрузки. Мосты — без сети: список из фикстуры, байты —
// прозрачный пиксель (превью важно фактом, не содержимым).
import type { Meta, StoryObj } from '@storybook/react'
import { userEvent, waitFor, within } from '@storybook/test'
import { ImageStudioPane } from './ImageStudioPane'
import { STUDIO_FILES, STUDIO_PIXEL_BASE64 } from '../test/fixtures/imageStudio'
import type { ImageStudioFile } from '@shared/imageStudio'

function storyApi(initial: ImageStudioFile[] = STUDIO_FILES, opts: { failList?: boolean } = {}) {
  let files = [...initial]
  return {
    'imgstudio:list': async () => {
      if (opts.failList) throw new Error('chat not found')
      return [...files]
    },
    'imgstudio:read': async ({ path }: { path: string }) => ({ path, dataBase64: STUDIO_PIXEL_BASE64 }),
    'imgstudio:upload': async ({ path }: { path: string }) => { files = [{ path, size: 3, updatedAt: Date.now() }, ...files]; return [...files] },
    'imgstudio:delete': async ({ path }: { path: string }) => { files = files.filter((file) => file.path !== path); return [...files] },
    'imgstudio:rename': async ({ from, to }: { from: string; to: string }) => { files = files.map((file) => file.path === from ? { ...file, path: to } : file); return [...files] },
    'imgstudio:generate': async ({ prompt }: { prompt: string }) => { const file = { path: 'новая.png', size: prompt.length, updatedAt: Date.now() }; files = [file, ...files]; return { file, files: [...files] } },
    'imgstudio:edit': async ({ path }: { path: string }) => { const file = { path: path.replace('.png', '-2.png'), size: 10, updatedAt: Date.now() }; files = [file, ...files]; return { file, files: [...files] } },
    'imgstudio:cancel': async () => ({ cancelled: false }),
    'imgstudio:publish': async () => ({ url: '/g/deadbeefdeadbeefdeadbeefdeadbeef/', publishedAt: 1, views: 0 }),
    'imgstudio:publication': async () => ({ url: null }),
    'imgstudio:unpublish': async () => ({ url: null })
  }
}

const meta: Meta<typeof ImageStudioPane> = {
  title: 'ImageStudio/ImageStudioPane',
  component: ImageStudioPane,
  args: { conversationId: 'story-conv', api: storyApi() as never },
  decorators: [(Story) => <div style={{ maxWidth: 520, minHeight: 480 }}><Story /></div>]
}
export default meta
type Story = StoryObj<typeof ImageStudioPane>

/** Галерея с правкой, оригиналом и загруженным руками файлом. */
export const Default: Story = {}

/** Пустая галерея: подсказка следующего шага и чипы-примеры промптов. */
export const Empty: Story = { args: { api: storyApi([]) as never } }

/** Режим множественного выбора с отмеченным файлом. */
export const MultiSelect: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Выбрать несколько' }))
    await userEvent.click(await canvas.findByRole('checkbox', { name: 'Выбрать кот.png' }))
    await waitFor(async () => { await canvas.findByRole('button', { name: 'Удалить выбранные (1)' }) })
  }
}

/** Галерея недоступна: ошибка с повтором вместо пустого экрана. */
export const LoadError: Story = { args: { api: storyApi([], { failList: true }) as never } }
