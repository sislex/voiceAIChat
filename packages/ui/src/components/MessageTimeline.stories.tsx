// Сториз ответа модели в трёх видах (минимально / кратко / подробно). Главное,
// что здесь видно и чего не видно в проде без живого хода: чередование абзацев
// текста с действиями по смещению `at` и таймингами секций.
import type { Meta, StoryObj } from '@storybook/react'
import { MessageTimeline } from './MessageTimeline'
import {
  ACTIVITY_INTERLEAVED,
  ACTIVITY_LEGACY,
  ACTIVITY_LIVE,
  MD_KITCHEN_SINK,
  T0,
  TEXT_WITH_ACTIVITY
} from '../test/fixtures'

const meta: Meta<typeof MessageTimeline> = {
  title: 'Chat/MessageTimeline',
  component: MessageTimeline,
  args: {
    text: TEXT_WITH_ACTIVITY,
    activity: ACTIVITY_INTERLEAVED,
    mode: 'brief',
    // Конец хода — граница длительностей завершённой секции.
    endMs: T0 + 45_000,
    execTarget: 'MacBook'
  },
  decorators: [(Story) => <div className="msg ai"><div className="bub" style={{ maxWidth: 720 }}><Story /></div></div>]
}
export default meta
type Story = StoryObj<typeof MessageTimeline>

/** Минимально: только текст ответа — действия спрятаны совсем. */
export const Minimal: Story = { args: { mode: 'minimal' } }

/** Кратко: секция действий сворачивается в строку «что · сколько · последнее». */
export const Brief: Story = {}

/** Подробно: каждое действие строкой между абзацами текста. */
export const Detailed: Story = { args: { mode: 'detailed' } }

/**
 * Живой ход: сверху статус со спиннером и счётчиком, в кратком виде время
 * последнего действия тикает раз в секунду (единственная сториз, где это видно).
 */
export const LiveBrief: Story = {
  args: { live: true, voice: 'thinking', text: 'Проверяю гейт пакета…', activity: ACTIVITY_LIVE, endMs: undefined }
}

/** Живой ход без текста в минимальном виде — остаётся строка статуса. */
export const LiveMinimal: Story = {
  args: { live: true, voice: 'thinking', mode: 'minimal', text: '', activity: ACTIVITY_LIVE }
}

/**
 * Старое сообщение: у действий нет смещений `at`, чередовать нечего — вид
 * откатывается к `MessageActivity` (секции после текста).
 */
export const LegacyWithoutOffsets: Story = {
  args: { mode: 'detailed', activity: ACTIVITY_LEGACY, text: 'Ответ, сохранённый до появления смещений.' }
}

/** Ход без действий: обычный markdown-ответ во всю ширину пузыря. */
export const NoActivity: Story = { args: { activity: [], text: MD_KITCHEN_SINK } }
