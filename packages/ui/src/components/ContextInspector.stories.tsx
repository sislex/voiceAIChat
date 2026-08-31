// Сториз инспектора контекста: «что получит ИИ в следующем сообщении». В проде
// это вкладка настроек разговора, здесь — сам инспектор, чтобы видеть состояния
// (полный снимок, роль обычного пользователя, загрузка, ошибка) без сервера.
//
// Снимок приходит мостом `window.api['conversations:contextSnapshot']`, поэтому
// каждая сториз задаёт его через `withBridges`: своей вёрстки данных у экрана нет.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from '@storybook/test'
import type { ContextSnapshotItem, ConversationContextSnapshot, UserRole } from '@shared/types'
import { contextLockReason, isContextToggleable } from '@shared/contextGating'
import { ContextInspector } from './ContextInspector'
import { withBridges } from '../test/storyBridges'

const CONVERSATION_ID = 'story-chat'
const PERSONALIZATION = '## Персонализация пользователя\nОбращение к пользователю: Алексей.\nСтиль ответа: кратко.'
const INSTRUCTION = 'Если пользователь просит открыть терминал, добавь в конце ответа блок ```tool.'

function item(id: string, title: string, extra: Partial<ContextSnapshotItem> = {}): ContextSnapshotItem {
  const toggleable = isContextToggleable(id)
  return {
    id,
    title,
    type: 'Контекст',
    source: 'Настройки пользователя',
    scope: 'Следующий ход',
    priority: '3 · пользователь',
    description: `${title} — что это значит для ответа`,
    explanation: 'Пояснение сервера про этот источник.',
    configured: true,
    available: true,
    includedInNextTurn: true,
    toggleable,
    enabled: true,
    lockReason: toggleable ? null : contextLockReason(id),
    ...extra
  }
}

/** Снимок, похожий на настоящий: инструкции, проект, конфигурация и история. */
function snapshot(options: { viewerRole?: UserRole; personalizationEnabled?: boolean } = {}): ConversationContextSnapshot {
  const on = options.personalizationEnabled ?? true
  const size = (text: string) => ({ chars: text.length, approxTokens: Math.ceil(text.length / 4) })
  const previewText = [on ? PERSONALIZATION : '', INSTRUCTION].filter(Boolean).join('\n\n')
  return {
    schemaVersion: 1,
    conversationId: CONVERSATION_ID,
    generatedAt: new Date('2026-08-31T12:00:00Z').toISOString(),
    freshnessWarning: 'Снимок отражает сохранённую конфигурацию на момент формирования.',
    summary: {
      provider: 'claude',
      model: 'opus',
      permissionMode: { value: 'acceptEdits', displayName: 'Авто-правки файлов', explanation: 'Правки разрешены в пределах политики машины.' },
      kbMode: { value: 'auto', displayName: 'Автоматически', explanation: 'Документы выбираются по отправляемому сообщению.' }
    },
    groups: [
      { id: 'instructions', order: 1, title: 'Системные и прикладные инструкции', description: 'Закрытые тексты представлены метаданными.', items: [
        item('platform-instructions', 'Правила платформы', { source: 'Платформа', description: 'Безопасность, конфиденциальность и границы действий.' }),
        item('personalization', 'Предпочтения ответа', { description: 'обращение «Алексей», стиль кратко', enabled: on, includedInNextTurn: on, ...(on ? { size: size(PERSONALIZATION) } : {}) })
      ] },
      { id: 'chat-instructions', order: 2, title: 'Инструкции чата', description: 'Подсказки из общих настроек.', items: [
        item('instruction-console', 'Открывать терминал в чате', { type: 'Встроенная инструкция', size: size(INSTRUCTION), details: { 'Вид': 'console', 'Текст': INSTRUCTION } })
      ] },
      { id: 'conversation', order: 3, title: 'Настройки разговора', description: 'Эффективные значения с учётом наследования.', items: [
        item('llm', 'Модель и провайдер', { source: 'Разговор', description: 'claude · opus', inheritance: { effective: 'claude · opus', overriddenFrom: 'claude · sonnet' } }),
        item('machine', 'Машина выполнения', { source: 'Резолвер сервера', description: 'MacBook' }),
        item('permission-mode', 'Авто-правки файлов', { source: 'Эффективная политика сервера', description: 'Правки разрешены в пределах политики машины.' })
      ] },
      { id: 'history', order: 4, title: 'История и текущее сообщение', description: 'Серверные метаданные.', items: [
        item('conversation-history', 'История разговора', { description: '12 сообщений уже в сессии движка', explanation: 'Ход продолжает сессию движка (resume): история в промпт не пересобирается.' }),
        item('current-message', 'Текущее сообщение', { description: 'Сообщение ещё не отправлено серверу.', configured: false, available: false, includedInNextTurn: false })
      ] }
    ],
    viewerRole: options.viewerRole ?? 'admin',
    owner: 'alexey',
    foreign: false,
    lastTurn: {
      at: '12:41',
      provider: 'claude',
      model: 'opus',
      prompt: `${PERSONALIZATION}\n\n${INSTRUCTION}\n\nПользователь: почему падает гейт?`,
      chars: 420,
      approxTokens: 105,
      resumed: true,
      permissionMode: 'acceptEdits',
      attachments: 1,
      attachmentNames: ['макет-экрана.png'],
      kbSections: ['Соглашения / Гейт']
    },
    turnSizes: [
      { at: '12:41', model: 'opus', chars: 420, approxTokens: 105, resumed: true, costUsd: 0.00157 },
      { at: '12:20', model: 'opus', chars: 260, approxTokens: 65, resumed: false, costUsd: 0.00097 }
    ],
    disallowedTools: ['mcp__remote__bash'],
    cliMcpServers: [{ name: 'remote', detail: 'ws://agent', status: 'connected' }],
    changes: [
      { at: new Date('2026-08-31T12:35:00Z').getTime(), actor: 'alexey', itemId: 'personalization', enabled: false },
      { at: new Date('2026-08-31T12:36:00Z').getTime(), actor: 'alexey', itemId: 'personalization', enabled: true }
    ],
    warnings: [
      { itemId: 'machine', level: 'problem', text: 'Выбранная машина недоступна: команды и файловые инструменты в ход не попадут.' },
      { itemId: null, level: 'notice', text: 'Инструкций чата выключено для этого разговора: 1.' }
    ],
    promptPreview: {
      blocks: [
        ...(on ? [{ itemIds: ['personalization'], title: 'Персонализация пользователя', text: PERSONALIZATION, ...size(PERSONALIZATION) }] : []),
        { itemIds: ['instruction-console'], title: 'Открывать терминал в чате', text: INSTRUCTION, ...size(INSTRUCTION) }
      ],
      text: previewText,
      ...size(previewText),
      omitted: [
        'Правила платформы и приложения: их добавляет CLI движка, сервер их текст не хранит.',
        'История разговора: ход продолжает сессию движка, история заново не отправляется.',
        'AGENTS.md: файл читает исполнитель в рабочей директории машины.'
      ],
      costUsd: 0.00032
    }
  }
}

const meta: Meta<typeof ContextInspector> = {
  title: 'Chat/ContextInspector',
  component: ContextInspector,
  args: {
    conversationId: CONVERSATION_ID,
    provider: 'claude',
    model: 'opus',
    permissionMode: 'acceptEdits',
    kbMode: 'auto',
    workdir: '/Users/alex/project',
    selectedSkillNames: []
  },
  decorators: [(Story) => <div style={{ maxWidth: 860 }}><Story /></div>]
}
export default meta
type Story = StoryObj<typeof ContextInspector>

/** Администратор: виден весь снимок, режим доступа правится прямо здесь. */
export const AdminFullView: Story = {
  decorators: [withBridges((bridges) => {
    bridges.api['conversations:contextSnapshot'] = async () => snapshot()
    bridges.api['conversations:setContextItem'] = async ({ enabled }) => snapshot({ personalizationEnabled: enabled })
  })]
}

/** Обычный пользователь: режим доступа только для чтения — это безопасность. */
export const DeveloperView: Story = {
  decorators: [withBridges((bridges) => {
    bridges.api['conversations:contextSnapshot'] = async () => snapshot({ viewerRole: 'developer' })
  })]
}

/** Источник выключен человеком: он ушёл из предпросмотра промпта. */
export const SourceDisabled: Story = {
  decorators: [withBridges((bridges) => {
    bridges.api['conversations:contextSnapshot'] = async () => snapshot({ personalizationEnabled: false })
  })]
}

/** Ожидание снимка: сервер считает эффективную конфигурацию. */
export const Loading: Story = {
  decorators: [withBridges((bridges) => {
    bridges.api['conversations:contextSnapshot'] = () => new Promise(() => {})
  })]
}

/** Разговор исчез (удалён в другой вкладке) — предложен повтор. */
export const Failed: Story = {
  decorators: [withBridges((bridges) => {
    bridges.api['conversations:contextSnapshot'] = async () => { throw new Error('Разговор больше недоступен.') }
  })]
}

/**
 * Подбор базы знаний по черновику — состояние достижимо только действием,
 * поэтому его доводит `play`: ввод текста и клик по «Показать подбор».
 */
export const KbPreviewByDraft: Story = {
  decorators: [withBridges((bridges) => {
    bridges.api['conversations:contextSnapshot'] = async () => snapshot()
    bridges.api['conversations:contextKbPreview'] = async ({ draft }) => ({
      mode: 'auto',
      text: `\n\n## База знаний\n### Соглашения / Гейт\n${draft}`,
      chars: 120,
      approxTokens: 30,
      confidence: 'high',
      sections: [{ documentId: 'conventions', title: 'Соглашения', anchor: 'гейт', chars: 120 }],
      emptyReason: null
    })
  })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const area = await canvas.findByRole('textbox', { name: /Черновик сообщения/ })
    await userEvent.type(area, 'Как запускается гейт?')
    await userEvent.click(canvas.getByRole('button', { name: 'Показать подбор' }))
    await expect(await canvas.findByTestId('context-kb-result')).toHaveTextContent('Соглашения')
  }
}
