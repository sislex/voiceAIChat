// Сториз карточки машины из настроек: разрешения, навыки и перевыпуск токена.
// Строка подключения в проде появляется один раз и только после реального
// перевыпуска — здесь это обычная сториз (токен, разумеется, выдуманный).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import { DEFAULT_AGENT_POLICY } from '@shared/agentProtocol'
import { AgentCard } from './AgentCard'
import { makeAgent, makeAndroidAgent, makeOfflineAgent, makePolicy } from '../test/fixtures'

const meta: Meta<typeof AgentCard> = {
  title: 'Machines/AgentCard',
  component: AgentCard,
  args: {
    agent: makeAgent({ id: 'm1', name: 'MacBook' }),
    onSetPolicy: fn(),
    onDelete: fn(),
    onRegenerateToken: fn(async () => 'vcagent:eyJzZXJ2ZXIiOiJ3czovL2xvY2FsaG9zdDo4Nzg3L2FnZW50In0')
  },
  decorators: [(Story) => <div style={{ maxWidth: 640 }}><Story /></div>]
}
export default meta
type Story = StoryObj<typeof AgentCard>

/** Свёрнутая карточка машины в сети — так выглядит список в настройках. */
export const Online: Story = {}

/** Офлайн: агент на машине не запущен, но разрешения править можно. */
export const Offline: Story = { args: { agent: makeOfflineAgent({ id: 'm2', name: 'Домашний ПК' }) } }

/** Пустая политика (машина только добавлена): всё разрешено, списки пусты. */
export const DefaultPolicy: Story = {
  args: { agent: makeAgent({ id: 'm3', name: 'Новая машина', policy: { ...DEFAULT_AGENT_POLICY } }) }
}

/** Карточка свёрнута — раскрывает её клик по имени машины (шапка карточки). */
async function expandCard(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement)
  // Имя в шапке идёт вместе со стрелкой «▸», поэтому ищем по подстроке.
  await userEvent.click(canvas.getByText(/▸/))
  await expect(canvas.getByText('Разрешения')).toBeInTheDocument()
}

/** Заполненная политика: каталоги, запреты, навыки — раскрыто. */
export const Expanded: Story = {
  args: { agent: makeAgent({ id: 'm1', name: 'MacBook', policy: makePolicy() }) },
  play: async ({ canvasElement }) => {
    await expandCard(canvasElement)
    await expect(within(canvasElement).getByText('build: npm run build')).toBeInTheDocument()
  }
}

/** Жёсткая политика: разрешены только свои паттерны, запись запрещена. */
export const RestrictedPolicy: Story = {
  args: {
    agent: makeAndroidAgent({
      name: 'Pixel (только чтение)',
      policy: makePolicy({ allowNetwork: false, allowWrite: false, allowPatterns: ['^git ', '^npm '], skills: [] })
    })
  },
  play: async ({ canvasElement }) => {
    await expandCard(canvasElement)
    await expect(within(canvasElement).getByText('^git')).toBeInTheDocument()
  }
}

/**
 * Перевыпуск токена: старая строка подключения перестаёт работать, новая
 * показывается один раз — её и надо скопировать на машину.
 */
export const RegeneratedToken: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expandCard(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Перевыпустить токен' }))
    await expect(await canvas.findByText(/Новая строка подключения/)).toBeInTheDocument()
  }
}
