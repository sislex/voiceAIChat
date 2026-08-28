import type { Meta, StoryObj } from '@storybook/react'
import { ProjectTypesSettings } from './ProjectTypesSettings'
import { BUILTIN_PROJECT_TYPES, type ProjectTypeNode } from '@shared/projectTypes'

const builtin: ProjectTypeNode[] = BUILTIN_PROJECT_TYPES.map((node) => ({
  ...node, builtin: true, ownerId: null, status: 'published', reviewNote: '',
  createdBy: 'system', createdAt: 0, updatedAt: 0, usageCount: node.id === 'type-software' ? 3 : 0
}))

const own = (over: Partial<ProjectTypeNode> = {}): ProjectTypeNode => ({
  id: 'own1', parentId: 'type-software', name: 'Бэкенд-сервис',
  description: 'Из проекта «API»', features: { preview: false }, defaults: {},
  builtin: false, ownerId: 'bob', status: 'private', reviewNote: '',
  createdBy: 'bob', createdAt: 0, updatedAt: 0, usageCount: 0, ...over
})

const meta: Meta<typeof ProjectTypesSettings> = {
  title: 'Projects/ProjectTypesSettings',
  component: ProjectTypesSettings,
  args: { types: [...builtin, own()], currentUsername: 'bob', onCreate: () => {}, onDelete: () => {}, onPublish: () => {}, onUnpublish: () => {} }
}
export default meta
type Story = StoryObj<typeof ProjectTypesSettings>

/** Обычный вид: встроенное дерево плюс личный подтип автора. */
export const Default: Story = {}

/** Отправлен на утверждение: править нельзя, отзывать нечего. */
export const Pending: Story = { args: { types: [...builtin, own({ status: 'pending' })] } }

/** Отклонён: автор видит причину и может исправить. */
export const Rejected: Story = { args: { types: [...builtin, own({ status: 'rejected', reviewNote: 'Дублирует «Веб-приложение»' })] } }

/** Опубликован и уже используется: удаление заблокировано с объяснением. */
export const PublishedInUse: Story = { args: { types: [...builtin, own({ status: 'published', usageCount: 4 })] } }

/** Чужие узлы — без кнопок управления. */
export const ForeignOnly: Story = { args: { types: [...builtin, own({ ownerId: 'carol', status: 'published' })] } }

/** Пусто: каталог без единого узла объясняет следующий шаг. */
export const Empty: Story = { args: { types: [] } }

/** Телефон: дерево, чипы и форма создания в одну колонку. */
export const MobileViewport: Story = { parameters: { viewport: { defaultViewport: 'mobile2' } } }
