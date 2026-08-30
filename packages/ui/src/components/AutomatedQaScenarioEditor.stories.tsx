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

/**
 * Непроверяемый шаг (круг 25): страница длиннее предела чтения. Текст отказа
 * длинный и на телефоне переносится — состояние достижимо только ответом
 * сервера, поэтому живёт в витрине.
 */
export const CheckBlockedUnverifiable: Story = {
  args: {
    ...ManyScenarios.args,
    onCheck: async () => ([
      { name: 'Вход', passed: true, blocked: null, steps: [], durationMs: 1400 },
      {
        name: 'Доска проекта', passed: false, durationMs: 21400, steps: [],
        blocked: 'Шаг «Открыть доску» проверить нельзя: Текст страницы прочитан не целиком (первые 20000 символов), ожидаемого текста «Задача создана» в этой части нет'
      }
    ])
  },
  play: async ({ canvasElement }) => {
    const button = [...canvasElement.querySelectorAll('button')].find((el) => el.textContent === 'Прогнать набор сейчас')
    button?.click()
  }
}

/**
 * Итог разового прогона набора. Состояние приходит только ответом сервера,
 * поэтому живёт в витрине: пройденный, провалившийся и заблокированный сразу.
 */
export const CheckResults: Story = {
  args: {
    ...ManyScenarios.args,
    onCheck: async () => ([
      { name: 'Вход', passed: true, blocked: null, steps: [], durationMs: 1400 },
      {
        name: 'Доска проекта', passed: false, blocked: null, durationMs: 2600,
        steps: [{ id: 's', title: 'Создать задачу', status: 'failed' as const, detail: 'локатор не найден', durationMs: 5000 }],
        pageErrors: ['Uncaught TypeError: Cannot read properties of undefined (reading \'columns\') at BoardView.tsx:142'],
        // Снимок приходит содержимым: у разового прогона нет рана в БД (круг 28).
        screenshot: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#e9e7dd"/><text x="20" y="100" font-family="sans-serif" font-size="20" fill="#4a4a44">Экран прогона</text></svg>')
      },
      { name: 'Настройки', passed: false, blocked: 'Стартовый адрес не открылся', steps: [], durationMs: 300 }
    ])
  },
  play: async ({ canvasElement }) => {
    const button = [...canvasElement.querySelectorAll('button')].find((el) => el.textContent === 'Прогнать набор сейчас')
    button?.click()
  }
}
