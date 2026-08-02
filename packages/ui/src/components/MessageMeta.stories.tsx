// Сториз иконки ⓘ у ответа: краткая сводка по наведению и панель «что ушло
// модели» по клику. Панель уходит порталом в document.body — поэтому play-функции
// ищут её во всём документе, а не в canvasElement.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from '@storybook/test'
import { MessageMeta } from './MessageMeta'
import { makeTurnMeta } from '../test/fixtures'

const meta: Meta<typeof MessageMeta> = {
  title: 'Chat/MessageMeta',
  component: MessageMeta,
  args: { meta: makeTurnMeta() },
  // Тултип позиционируется от строки подписей сообщения — воспроизводим её.
  decorators: [(Story) => <div className="msg ai"><div className="mfoot" style={{ paddingTop: 120 }}><span className="mtime">10:01</span><Story /></div></div>]
}
export default meta
type Story = StoryObj<typeof MessageMeta>

/** Обычный ход: иконка ⓘ. Сводка появляется по наведению, панель — по клику. */
export const Icon: Story = {}

/** Ход без деталей запроса (сохранён до появления `meta.request`): только метрики. */
export const OnlyMetrics: Story = {
  args: { meta: { durationMs: 1200, inputTokens: 800, outputTokens: 90 } }
}

/** Codex не сообщает стоимость хода — панель говорит об этом прямо. */
export const CodexWithoutCost: Story = {
  args: {
    meta: makeTurnMeta({
      costUsd: undefined,
      model: 'gpt-5-codex',
      request: { ...makeTurnMeta().request!, provider: 'codex', model: 'gpt-5-codex', resumed: false }
    })
  }
}

/** Ход прерван перезапуском сервера — статус видно и в сводке, и в панели. */
export const Interrupted: Story = { args: { meta: makeTurnMeta({ interrupted: true }) } }

/** Ход с автодобавленной базой знаний и вложениями. */
export const WithKbAndAttachments: Story = {
  args: {
    meta: makeTurnMeta({
      request: {
        ...makeTurnMeta().request!,
        attachments: ['/tmp/скриншот-1.png', '/tmp/лог-рана.txt'],
        kbContext: {
          confidence: 'high',
          sections: [
            { documentId: 'ui', title: 'ui.md', heading: 'Витрина Storybook', sourcePath: 'docs/kb/ui.md', anchor: '#storybook' },
            { documentId: 'testing', title: 'testing-operations.md', heading: 'Тестовая матрица', sourcePath: 'docs/kb/testing-operations.md', anchor: '#матрица' }
          ]
        }
      }
    })
  }
}

/** Сводка по наведению: модель, токены, размер запроса, время и стоимость. */
export const TooltipOnHover: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.hover(canvas.getByLabelText('Сведения об ответе').parentElement as HTMLElement)
    await expect(canvas.getByTestId('meta-tip')).toHaveTextContent('1.5k → 320')
  }
}

/** Панель «Что было отправлено модели»: промпт, контекст, окружение хода. */
export const DetailsOpen: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByLabelText('Сведения об ответе'))
    const dialog = within(document.body)
    await expect(await dialog.findByTestId('meta-overlay')).toBeInTheDocument()
    await expect(dialog.getByTestId('meta-prompt')).toHaveTextContent('Как дела?')
  }
}
