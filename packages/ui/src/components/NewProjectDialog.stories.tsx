import type { Meta, StoryObj } from '@storybook/react'
import { NewProjectDialog } from './NewProjectDialog'
import { BUILTIN_PROJECT_TYPES, type ProjectTypeNode } from '@shared/projectTypes'

/** Встроенное дерево как узлы каталога — те же данные, что отдаёт сервер. */
const builtin: ProjectTypeNode[] = BUILTIN_PROJECT_TYPES.map((node) => ({
  ...node, builtin: true, ownerId: null, status: 'published', reviewNote: '',
  createdBy: 'system', createdAt: 0, updatedAt: 0
}))

/** Личный подтип пользователя — второй уровень под «Разработкой ПО». */
const withCustom: ProjectTypeNode[] = [
  ...builtin,
  {
    id: 'type-own-1', parentId: 'type-software', name: 'Бэкенд-сервис',
    description: 'Без веб-превью: сервис без собственного интерфейса.',
    features: { preview: false }, defaults: {}, builtin: false, ownerId: 'bob',
    status: 'private', reviewNote: '', createdBy: 'bob', createdAt: 0, updatedAt: 0
  }
]

const meta: Meta<typeof NewProjectDialog> = {
  title: 'Projects/NewProjectDialog',
  component: NewProjectDialog,
  args: { types: builtin, onCreate: () => {}, onClose: () => {} },
  parameters: { layout: 'fullscreen' }
}
export default meta
type Story = StoryObj<typeof NewProjectDialog>

/** Пустая форма: тип ещё не выбран, «Создать» недоступна. */
export const Empty: Story = {}

/** Личные подтипы стоят после встроенных, каскад уходит на второй уровень. */
export const WithCustomSubtype: Story = { args: { types: withCustom } }

/** Отправка идёт: кнопка занята и защищена от повторного нажатия. */
export const Creating: Story = { args: { busy: true } }

/**
 * Телефон: окно раскрывается на весь экран, кнопки подвала растягиваются в
 * колонку — иначе «Создать» и «Отмена» слишком мелкие для пальца.
 */
export const MobileViewport: Story = {
  parameters: { viewport: { defaultViewport: 'mobile2' } }
}
