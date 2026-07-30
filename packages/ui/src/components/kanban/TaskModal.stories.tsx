// Сториз карточки задачи: десктопные две колонки и мобильная раскладка (как в
// Jira). Мобильный вариант смотрится в отдельном вьюпорте — карточка перестраивается
// по matchMedia, поэтому важна именно ширина фрейма, а не размер контейнера.
import type { Meta, StoryObj } from '@storybook/react'
import { TaskModal } from './TaskModal'
import { makeBoard, makeCiSummary, makeDefaultColumns, makeMembers, makeTask } from './fixtures'

const columns = makeDefaultColumns()
const dev = columns[2]
const epic = makeTask({ id: 'ep1', type: 'epic', title: 'Платёжная система', columnId: dev.id })
const task = makeTask({
  id: 'task-1',
  title: 'Оплата картой: провести через 3-DS и показать результат пользователю',
  description: 'Пользователь платит картой, банк требует подтверждение — надо показать\nэкран 3-DS и вернуться в чек-аут с результатом.',
  acceptanceCriteria: '— успешная оплата ведёт на экран «Спасибо»\n— отказ банка показывает причину',
  columnId: dev.id,
  parentId: epic.id,
  assignee: 'bob',
  labels: ['payments', 'critical'],
  skills: ['react', 'fastify'],
  storyPoints: 5,
  dueDate: 1_700_600_000_000,
  priority: 'high',
  seq: 42
})
const child = makeTask({ id: 'child-1', parentId: task.id, columnId: columns[5].id, title: 'Форма ввода карты' })

const meta: Meta<typeof TaskModal> = {
  title: 'Kanban/TaskModal',
  component: TaskModal,
  args: {
    task,
    board: makeBoard(columns, [epic, task, child]),
    projectName: 'Голос Чат',
    members: makeMembers('admin', 'bob'),
    onUpdate: () => {},
    onDelete: () => {},
    onMoveToColumn: () => {},
    onOpenTask: () => {},
    onOpenChat: () => {},
    onClose: () => {},
    ciSummary: makeCiSummary(),
    onStartCi: () => {},
    onOpenCiRun: () => {}
  }
}
export default meta
type Story = StoryObj<typeof TaskModal>

const PHONE = {
  viewport: {
    viewports: {
      phone: { name: 'Телефон 390×844', styles: { width: '390px', height: '844px' }, type: 'mobile' }
    },
    defaultViewport: 'phone'
  }
}

/** Десктоп: основная колонка и правая панель деталей. */
export const Desktop: Story = {}

/** Телефон: во весь экран, статус и исполнитель сверху, «Подробности» свёрнуты. */
export const Phone: Story = { parameters: PHONE }

/** Телефон без родителя и подзадач — минимальная карточка. */
export const PhoneMinimal: Story = {
  args: {
    task: makeTask({ id: 'plain', title: 'Поправить отступ в шапке', columnId: dev.id }),
    board: makeBoard(columns, []),
    ciSummary: undefined
  },
  parameters: PHONE
}
