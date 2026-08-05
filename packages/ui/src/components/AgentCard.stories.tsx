// Сториз редактора политики машины: каталоги, паттерны команд и навыки. В проде он
// раскрывается строкой таблицы «Машины» (сториз `Machines/MachineStatus`), здесь —
// сам по себе, чтобы видеть состояния политики без парка машин.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import { DEFAULT_AGENT_POLICY } from '@shared/agentProtocol'
import { AgentCard } from './AgentCard'
import { makeAgent, makeAndroidAgent, makeOfflineAgent, makePolicy } from '../test/fixtures'

const meta: Meta<typeof AgentCard> = {
  title: 'Machines/AgentCard',
  component: AgentCard,
  args: {
    agent: makeAgent({ id: 'm1', name: 'MacBook', policy: makePolicy() }),
    onSetPolicy: fn()
  },
  decorators: [(Story) => <div style={{ maxWidth: 640 }}><Story /></div>]
}
export default meta
type Story = StoryObj<typeof AgentCard>

/** Заполненная политика: разрешённый каталог, запреты и два навыка. */
export const FilledPolicy: Story = {}

/** Офлайн: агент на машине не запущен, но политику править можно — она живёт на сервере. */
export const Offline: Story = {
  args: { agent: makeOfflineAgent({ id: 'm2', name: 'Домашний ПК', policy: makePolicy() }) }
}

/** Пустая политика (машина только добавлена): всё разрешено, списки пусты. */
export const DefaultPolicy: Story = {
  args: { agent: makeAgent({ id: 'm3', name: 'Новая машина', policy: { ...DEFAULT_AGENT_POLICY } }) }
}

/** Жёсткая политика: разрешены только свои паттерны, навыков нет. */
export const RestrictedPolicy: Story = {
  args: {
    agent: makeAndroidAgent({
      name: 'Pixel (только чтение)',
      policy: makePolicy({ allowNetwork: false, allowWrite: false, allowPatterns: ['^git ', '^npm '], skills: [] })
    })
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('^git')).toBeInTheDocument()
  }
}

/** Новый навык: имя, команда, «Добавить» — политика уходит сразу, без «Сохранить». */
export const AddSkill: Story = {
  args: { agent: makeAgent({ id: 'm1', name: 'MacBook', policy: makePolicy({ skills: [] }) }) },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByPlaceholderText('Имя (напр. сборка)'), 'сборка')
    await userEvent.type(canvas.getByPlaceholderText('Команда (npm run build)'), 'npm run build')
    await userEvent.click(canvas.getByLabelText('Добавить навык'))
    await expect(args.onSetPolicy).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ skills: [{ name: 'сборка', command: 'npm run build' }] })
    )
  }
}
