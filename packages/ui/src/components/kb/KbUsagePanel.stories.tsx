// Сториз панели «Использование БЗ»: живое обращение, готовые числа, вкладка
// проекта и три состояния «почему пусто». Раньше эти состояния можно было увидеть
// только на реальном чате с настроенной базой знаний.
import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
import { KbUsagePanel } from './KbUsagePanel'
import { emptyKbUsageCache } from '../../lib/kbUsage'
import { makeKbProjectCache, makeKbQuery, makeKbStatus, makeKbUsageCache } from '../../test/fixtures'

const EMPTY_TOTALS = {
  queries: 0, delivered: 0, empty: 0, errors: 0, toolQueries: 0, sections: 0, documents: 0,
  chars: 0, estimatedTokens: 0, promptChars: 0, lastAt: null
}

const meta: Meta<typeof KbUsagePanel> = {
  title: 'KB/KbUsagePanel',
  component: KbUsagePanel,
  args: {
    conversationId: 'c1',
    projectId: 'p1',
    cache: makeKbUsageCache(),
    projectCache: makeKbProjectCache(),
    kbStatus: makeKbStatus(),
    mode: 'auto',
    onLoad: fn(),
    onLoadProject: fn(),
    onClose: fn(),
    onOpenDocument: fn(),
    onOpenKnowledgeBase: fn(),
    onOpenConversationSettings: fn()
  }
}
export default meta
type Story = StoryObj<typeof KbUsagePanel>

/** Обычное состояние: авто-контекст и два запроса модели через mcp__kb__*. */
export const WithUsage: Story = {}

/** Идёт обращение: в ленте «запрашивает…» до ответа базы. */
export const Pending: Story = {
  args: {
    cache: makeKbUsageCache({ recent: [makeKbQuery({ id: 'live', seq: 4, source: 'tool_search', status: 'pending', query: 'где живут ходы модели', chars: 0, sections: [] }), ...makeKbUsageCache().report!.recent] })
  }
}

/** Режим «по запросу модели»: авто-контекста нет, инструменты выданы. */
export const ManualMode: Story = {
  args: { mode: 'manual', cache: makeKbUsageCache({ kbContextMode: 'manual' }) }
}

/** БЗ выключена для чата: баннер с переходом в настройки, история под ним. */
export const ModeOff: Story = {
  args: { mode: 'off', cache: makeKbUsageCache({ kbContextMode: 'off' }) }
}

/** Обращений ещё не было — панель объясняет, когда они появятся. */
export const NoQueries: Story = {
  args: { cache: makeKbUsageCache({ recent: [], sections: [], totals: EMPTY_TOTALS }) }
}

/** Индекс базы знаний не смонтирован: это конфигурация, а не сбой. */
export const IndexUnavailable: Story = {
  args: {
    kbStatus: makeKbStatus({ available: false, documents: 0, chunks: 0 }),
    cache: makeKbUsageCache({ recent: [], sections: [], totals: EMPTY_TOTALS, available: false, toolEnabled: false })
  }
}

/** Первая загрузка: скелетон вместо чисел (данных ещё нет). */
export const Loading: Story = { args: { cache: { ...emptyKbUsageCache(), loading: true } } }
