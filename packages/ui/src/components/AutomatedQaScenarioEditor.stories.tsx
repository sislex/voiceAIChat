import type { Meta, StoryObj } from '@storybook/react'
import type { ProjectDetail } from '@shared/projects'
import type { AutomatedQaScenario } from '@shared/qa'
import { AutomatedQaScenarioEditor } from './AutomatedQaScenarioEditor'

const detail = (...scenarios: AutomatedQaScenario[]): ProjectDetail => ({ id: 'p1', automatedQaScenarios: scenarios } as unknown as ProjectDetail)

const meta = {
  title: 'Projects/Automated QA scenario',
  component: AutomatedQaScenarioEditor,
  args: { detail: detail(), isOwner: true, onUpdate: () => undefined }
} satisfies Meta<typeof AutomatedQaScenarioEditor>
export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}
export const Filled: Story = {
  args: {
    detail: detail({
      name: 'Вход и доска',
      startUrl: 'https://staging.example.com/#/projects/p1',
      steps: [
        { id: 's1', title: 'Открыть доску', action: { kind: 'wait', selector: '.jboard' } },
        { id: 's2', title: 'Создать задачу', action: { kind: 'click', selector: '#create' }, expectText: 'Новая задача' },
        { id: 's3', title: 'Ввести название', action: { kind: 'type', selector: 'input[name=title]', text: 'Проверка' }, expectAbsentText: 'Ошибка' }
      ]
    })
  }
}
export const ReadOnlyMember: Story = { args: { ...Filled.args, isOwner: false } }

/**
 * Адрес, в который раннер не пойдёт. Состояние достижимо только значением из
 * настроек проекта, поэтому живёт в витрине: изолированный Chromium работает на
 * сервере, и `localhost` с приватными сетями режет SSRF-гейт `validatePublicUrl`.
 */
export const InvalidStartUrl: Story = {
  args: { detail: detail({ name: 'Локальный стенд', startUrl: 'http://localhost:5173', steps: [{ id: 's1', title: 'Открыть доску', action: { kind: 'wait', selector: '.jboard' } }] }) }
}

/** Набор из нескольких сценариев: ради него круг 20 и делался. */
export const ManyScenarios: Story = {
  args: {
    detail: detail(
      { name: 'Вход', startUrl: 'https://staging.example.com/', steps: [{ id: 's1', title: 'Ввести логин', action: { kind: 'type', selector: '[data-testid="login-username"]', text: 'tester' }, expectText: 'Вход' }] },
      { name: 'Доска проекта', startUrl: 'https://staging.example.com/#/projects/p1', steps: [{ id: 's1', title: 'Создать задачу', action: { kind: 'click', selector: '[data-testid="create-task"]' }, expectText: 'Новая задача' }] },
      { name: 'Настройки', startUrl: 'https://staging.example.com/#/projects/p1/settings', steps: [{ id: 's1', title: 'Открыть вкладку', action: { kind: 'click', selector: '[data-testid="settings-tab"]' }, expectText: 'Общее' }] }
    )
  }
}
