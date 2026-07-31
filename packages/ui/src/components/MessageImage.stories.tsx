// Сториз картинки, созданной моделью. Байты приходят через операции машины
// (`ops.read`) — сети нет: файла на диске у сториз тоже нет, поэтому фикстура
// отдаёт готовый base64. Состояния ожидания и ошибки в проде ловятся только на
// живом ходе, здесь это просто разные заглушки чтения.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from '@storybook/test'
import { MessageImage } from './MessageImage'
import { makeAgent, makeMachineOps, PLOT_SVG_BASE64 } from '../test/fixtures'

/** Чтение, которое никогда не отвечает — состояние «файл ещё не готов». */
const pendingOps = makeMachineOps({ read: () => new Promise(() => {}) })
/** Чтение с отказом — файла нет (или машина не отдала). */
const failingOps = makeMachineOps({
  read: async () => {
    throw new Error('Файл пустой или недоступен')
  }
})

const meta: Meta<typeof MessageImage> = {
  title: 'Chat/MessageImage',
  component: MessageImage,
  args: {
    image: { path: '/home/dev/out/plot.svg', agentId: 'm1' },
    ops: makeMachineOps(),
    agents: [makeAgent({ id: 'm1', name: 'MacBook' })]
  },
  decorators: [(Story) => <div className="msg ai"><div className="bub" style={{ maxWidth: 720 }}><Story /></div></div>]
}
export default meta
type Story = StoryObj<typeof MessageImage>

/** Готовая картинка: превью в рамке тула, клик разворачивает на весь экран. */
export const Ready: Story = {}

/** С подписью модели — она живёт под картинкой, а не в шапке рамки. */
export const WithCaption: Story = {
  args: { image: { path: '/home/dev/out/plot.svg', agentId: 'm1', caption: 'Ходов модели в день за последнюю неделю' } }
}

/** Файла ещё нет, ход завершён: плитка-заглушка «Загрузка картинки…». */
export const Loading: Story = { args: { ops: pendingOps } }

/** Ход идёт: та же плитка, но подпись честнее — «Рисую картинку…». */
export const LiveDrawing: Story = { args: { ops: pendingOps, live: true } }

/** Ход закончился, а файла нет: сообщение об ошибке и путь, по которому искали. */
export const ReadError: Story = { args: { ops: failingOps } }

/** Картинку создал сам CLI — она лежит на СЕРВЕРЕ, машина ни при чём. */
export const FromServer: Story = {
  args: {
    image: { path: '/var/lib/voicechat/users/admin/plot.svg' },
    agents: [],
    readServerFile: async (path) => ({ name: path.split('/').pop() ?? path, dataBase64: PLOT_SVG_BASE64 })
  }
}

/** Открыта из меню (`variant="modal"`): та же рамка, но как окно с крестиком. */
export const AsModal: Story = { args: { variant: 'modal', onClose: () => {} } }

/**
 * Развёрнутая картинка: в этом виде работают зум колесом, перетаскивание и сброс
 * двойным кликом — руками это самый неудобный для проверки экран.
 */
export const Fullscreen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByLabelText('Открыть картинку на весь экран'))
    await expect(canvas.getByTestId('image-surface')).toBeInTheDocument()
  }
}
