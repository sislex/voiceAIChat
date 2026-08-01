// Сториз шапки чата задачи: иерархия, состояние рана и оба вида — развёрнутый и
// свёрнутый в строку. В проде шапку без активного рана видно редко, а свёрнутую
// раньше нельзя было получить вовсе.
import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
import { TaskChatHeader } from './TaskChatHeader'
import { makeTaskChatContext } from '../../test/fixtures'

const NOW = 1_000 + 12 * 60 * 1000

const meta: Meta<typeof TaskChatHeader> = {
  title: 'Chat/TaskChatHeader',
  component: TaskChatHeader,
  args: {
    context: makeTaskChatContext(),
    onOpenTask: fn(),
    now: () => NOW
  },
  // Свёрнутость объявляется параметром `taskHeaderCollapsed`, а выставляет её
  // витрина (декоратор в `.storybook/preview.tsx`): состояние общее для всех
  // чатов и лежит в localStorage.
  decorators: [(Story) => <div style={{ maxWidth: 900 }}><Story /></div>]
}
export default meta
type Story = StoryObj<typeof TaskChatHeader>

/** Ран идёт: синяя подсветка, таймер работы, кнопка «Лента рана». */
export const Running: Story = {
  args: { renderRunFeed: (runId) => <div className="taskchat-dim">Лента рана {runId}</div> }
}

/** Ран ждёт ответа модели — жёлтая подсветка, как у карточки на доске. */
export const AwaitingInput: Story = {
  args: {
    context: makeTaskChatContext({
      run: { id: 'run-1', status: 'awaiting_input', mode: 'plan', startedAt: 1_000, durationMs: null }
    })
  }
}

/** Ран завершён успехом: вместо таймера — итоговая длительность. */
export const Finished: Story = {
  args: {
    context: makeTaskChatContext({
      run: { id: 'run-1', status: 'success', mode: 'development', startedAt: 1_000, durationMs: 8 * 60 * 1000 }
    })
  }
}

/** Задача без рана: только иерархия, этап и машина. */
export const WithoutRun: Story = {
  args: { context: makeTaskChatContext({ run: null }) }
}

/** Свёрнута: одна строка — ключ задачи, статус рана и «Открыть задачу». */
export const Collapsed: Story = {
  args: { renderRunFeed: (runId) => <div className="taskchat-dim">Лента рана {runId}</div> },
  parameters: { taskHeaderCollapsed: true }
}
