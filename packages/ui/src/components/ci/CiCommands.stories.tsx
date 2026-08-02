// Сториз страницы «Команды»: справочник, форма правки, глобальные настройки,
// инбокс предложений модели и отчёт по занятому месту. Все данные — пропсами из
// общих фикстур, сеть не нужна.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import { CiCommands } from './CiCommands'
import { makeCommand, makeCommands, makeGlobalSettings, makeSuggestion, makeWorkspace } from '../../test/fixtures'

const meta: Meta<typeof CiCommands> = {
  title: 'CI/CiCommands',
  component: CiCommands,
  parameters: { layout: 'fullscreen' },
  args: {
    commands: makeCommands(),
    settings: makeGlobalSettings(),
    suggestions: [],
    workspaces: [],
    role: 'admin',
    projects: [{ id: 'p1', name: 'Голос Чат' }, { id: 'p2', name: 'Витрина' }],
    onCreate: fn(async () => makeCommand({ id: 'cmd-new', name: 'новая' })),
    onUpdate: fn(async () => {}),
    onDelete: fn(async () => {}),
    onUsage: fn(async () => ({ projects: [{ id: 'p1', name: 'Голос Чат' }], tasks: [{ id: 't1', title: 'Сториз чата' }] })),
    onSaveSettings: fn(async () => {}),
    onResolveSuggestion: fn(async () => {}),
    onClose: fn()
  }
}
export default meta
type Story = StoryObj<typeof CiCommands>

/** Справочник заполнен, команда не выбрана — форма подсказывает, что делать. */
export const Reference: Story = {}

/** Команд ещё нет: пустота объясняет, зачем команда, и предлагает создать первую. */
export const Empty: Story = { args: { commands: [] } }

/** Первая загрузка справочника: косточки в высоту ряда таблицы. */
export const Loading: Story = { args: { commands: [], status: 'loading' } }

/** Ошибка загрузки: сообщение, деталь под «Подробнее», «Повторить». */
export const LoadError: Story = {
  args: { commands: [], status: 'error', error: 'HTTP 500: не удалось прочитать справочник', onRetry: fn() }
}

/** Ошибка обновления при показанном списке — баннером, а не вместо данных. */
export const StaleError: Story = { args: { status: 'error', error: 'HTTP 503: сервер перезагружается', onRetry: fn() } }

/** Предложения модели: причина, предлагаемый скрипт, «Принять» / «Отклонить». */
export const WithSuggestions: Story = {
  args: {
    suggestions: [
      makeSuggestion(),
      makeSuggestion({ id: 'sug-2', commandId: 'cmd-3', occurrences: 1, reason: 'Тесты падают из-за общего порта 8787 — стоит задать PORT в команде.', proposedScript: 'PORT=8799 npm test' })
    ]
  }
}

/** Отчёт по месту: активная копия и осиротевшая (cleanup не выполнялся). */
export const WithWorkspaces: Story = {
  args: {
    workspaces: [
      makeWorkspace(),
      makeWorkspace({ id: 'ws-2', taskId: 't9', taskTitle: 'Канбан: перенос пальцем', orphaned: true, sizeBytes: 1_530 * 1024 * 1024 }),
      makeWorkspace({ id: 'ws-3', taskId: 't8', taskTitle: null, state: 'released', sizeBytes: null })
    ]
  }
}

/** Роль user: глобальные настройки CI только для чтения. */
export const ReadOnlySettings: Story = { args: { role: 'user' } }

/** Выбор команды в списке заполняет форму правки её скриптом и флагами. */
export const SelectCommand: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText('storybook'))
    const form = within(canvas.getByTestId('ci-command-form'))
    await expect(form.getByText('Правка команды')).toBeInTheDocument()
    await expect(form.getByDisplayValue('npm run -w @voicechat/ui build-storybook')).toBeInTheDocument()
  }
}

/** Раскрытие глобальных настроек CI (свёрнуты по умолчанию). */
export const SettingsExpanded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Глобальные настройки CI/ }))
    await expect(canvas.getByTestId('ci-settings')).toHaveTextContent('Макс. попыток исправления')
  }
}
