// Сториз активности ответа: строка статуса и секции «как в консоли». Живой ход
// (спиннер + фраза «что происходит») в проде видно только пока модель работает —
// здесь это обычное состояние, задаваемое пропсом.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from '@storybook/test'
import { MessageActivity } from './MessageActivity'
import { ACTIVITY_LEGACY, makeActivity } from '../test/fixtures'

const meta: Meta<typeof MessageActivity> = {
  title: 'Chat/MessageActivity',
  component: MessageActivity,
  args: { activity: ACTIVITY_LEGACY, detailed: false },
  decorators: [(Story) => <div className="msg ai"><div className="bub" style={{ maxWidth: 720 }}><Story /></div></div>]
}
export default meta
type Story = StoryObj<typeof MessageActivity>

/** Свёрнуто: только счётчик действий — так выглядит завершённый ход по умолчанию. */
export const Count: Story = {}

/** Подробно: секция на каждое действие, детали раскрываются кликом. */
export const Detailed: Story = { args: { detailed: true } }

/** Команды шли на машину — у каждой секции метка «где». */
export const OnMachine: Story = { args: { detailed: true, execTarget: 'MacBook' } }

/** Живой ход: спиннер и фраза статуса вместо тишины. */
export const Live: Story = {
  args: { live: true, voice: 'thinking', activity: [makeActivity({ summary: 'Bash: npm test' })] }
}

/** Живой ход во время озвучки предыдущего ответа: фраза статуса другая. */
export const LiveWhileSpeaking: Story = {
  args: { live: true, voice: 'speaking', activity: [makeActivity({ kind: 'thinking', summary: 'Думаю над правкой' })] }
}

/** Много действий: 24 секции — проверка плотности длинного хода. */
export const ManySections: Story = {
  args: {
    detailed: true,
    activity: Array.from({ length: 24 }, (_, i) =>
      makeActivity({
        kind: i % 3 === 0 ? 'tool_use' : i % 3 === 1 ? 'tool_result' : 'thinking',
        summary: i % 3 === 1 ? `✓ результат шага ${i}` : `Bash: шаг ${i} очень длинной команды с аргументами --reporter=verbose --coverage`,
        detail: `подробности действия ${i}`
      })
    )
  }
}

/** Раскрытая секция: сырой stream-json и детали — по клику, как в проде. */
export const ExpandedSection: Story = {
  args: { detailed: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText('Bash: ls -la'))
    await expect(canvas.getByTestId('activity-raw')).toHaveTextContent('{"type":"assistant"}')
  }
}
