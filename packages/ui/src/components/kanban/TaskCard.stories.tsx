// Сториз карточки задачи: каждый атрибут и edge-кейс по отдельности.
import type { Meta, StoryObj } from '@storybook/react'
import type { Task } from '@shared/projects'
import { TaskCard } from './TaskCard'
import { makeCiSummary, makeTask } from './fixtures'

const epic = makeTask({ id: 'ep1', type: 'epic', title: 'Платёжная система' })

const meta: Meta<typeof TaskCard> = {
  title: 'Kanban/TaskCard',
  component: TaskCard,
  args: {
    projectName: 'Голос Чат',
    allTasks: [epic],
    doneColumnIds: new Set(['done']),
    dragging: false,
    onOpen: () => {},
    onUpdate: () => {},
    onDelete: () => {},
    onMoveTop: () => {},
    onMoveBottom: () => {}
  },
  decorators: [
    (Story) => (
      <div className="jboard" style={{ padding: 16 }}>
        <div className="jcol" style={{ width: 272 }}>
          <div className="jcol-body" style={{ padding: '8px 6px' }}>
            <Story />
          </div>
        </div>
      </div>
    )
  ]
}
export default meta
type Story = StoryObj<typeof TaskCard>

/** Минимальная задача: только заголовок, тип и приоритет по умолчанию. */
export const Minimal: Story = {
  args: { task: makeTask({ title: 'Поправить отступ в шапке' }) }
}

/** С чипом эпика-родителя. */
export const WithEpicChip: Story = {
  args: { task: makeTask({ title: 'Интеграция платёжного шлюза', parentId: 'ep1' }) }
}

/** Помечена флагом — жёлтая карточка. */
export const Flagged: Story = {
  args: { task: makeTask({ title: 'Срочно: падает прод', flagged: true, priority: 'urgent' }) }
}

/** Все атрибуты сразу: эпик, метки, флаг, просроченный срок, поинты, аватар, подзадачи. */
export const AllAttributes: Story = {
  args: {
    task: makeTask({
      id: 'full',
      title: 'Оплата картой: полный сценарий с 3-DS подтверждением',
      parentId: 'ep1',
      labels: ['payments', 'critical'],
      storyPoints: 8,
      dueDate: Date.now() - 24 * 60 * 60 * 1000,
      flagged: true,
      assignee: 'bob',
      priority: 'high',
      seq: 42
    }),
    allTasks: [
      epic,
      makeTask({ id: 'ch1', parentId: 'full', columnId: 'done', title: 'Форма' }),
      makeTask({ id: 'ch2', parentId: 'full', columnId: 'wip', title: 'Шлюз' })
    ]
  }
}

/** В колонке «Готово» — ключ зачёркнут. */
export const DoneColumn: Story = {
  args: { task: makeTask({ title: 'Выпущено в прод', columnId: 'done', assignee: 'admin' }) }
}

/** Очень длинный заголовок и слово без пробелов. */
export const LongTitle: Story = {
  args: {
    task: makeTask({
      title:
        'Спроектировать и реализовать сценарий обработки переполнения текста, включая перенос строк и обрезание СловаБезПробеловКотороеОченьДлинное' +
        'ещёдлиннее'.repeat(8)
    })
  }
}

/** Состояние перетаскивания. */
export const Dragging: Story = {
  args: { task: makeTask({ title: 'Меня тащат' }), dragging: true }
}

/** Битые данные (через каст) — компонент не падает на уровне карточки. */
export const BrokenData: Story = {
  args: {
    task: {
      id: 'br', projectId: 'p1', columnId: 'x', type: 'task', parentId: 'ghost', title: 'Битая задача',
      description: '', acceptanceCriteria: '', priority: 'medium', assignee: null,
      labels: [], skills: [], storyPoints: null, dueDate: null, flagged: false, seq: 0, position: 0, createdAt: 1, updatedAt: 1
    } as Task

  }
}

// --- Состояния CI-рана: подсветка карточки и доступные действия ------------

/** Ран идёт: голубая рамка медленно «дышит», запуск недоступен — только лента. */
export const CiRunning: Story = {
  args: {
    task: makeTask({ title: 'Ран выполняется' }),
    ciSummary: makeCiSummary(),
    onStartCi: () => {},
    onOpenCiRun: () => {}
  }
}

/** Шаг упал, модель разбирается: медленное красное мигание. */
export const CiFixing: Story = {
  args: {
    task: makeTask({ title: 'Модель исправляет ошибку' }),
    ciSummary: makeCiSummary({ slotProgress: { done: 4, total: 6, phase: 'Модель исправляет ошибку', fixing: true } }),
    onStartCi: () => {},
    onOpenCiRun: () => {}
  }
}

/** Ран ждёт ответа пользователя: частое жёлтое мигание. */
export const CiAwaitingInput: Story = {
  args: {
    task: makeTask({ title: 'Есть вопросы к пользователю' }),
    ciSummary: makeCiSummary({ status: 'awaiting_input', awaitingInput: true, slotProgress: { done: 3, total: 6, phase: 'Модель ждёт ответа' } }),
    onStartCi: () => {},
    onOpenCiRun: () => {}
  }
}

/** Ран свалился окончательно: частое красное мигание. */
export const CiFailed: Story = {
  args: {
    task: makeTask({ title: 'Ран упал' }),
    ciSummary: makeCiSummary({ status: 'failed', modelActive: false, slotProgress: { done: 4, total: 6, phase: 'Финальные команды (1/2)' } }),
    onStartCi: () => {},
    onOpenCiRun: () => {}
  }
}

/** Разработка закончена, ждёт пересборки прода: статичная зелёная рамка. */
export const CiSuccess: Story = {
  args: {
    task: makeTask({ title: 'Готово к пересборке прода' }),
    ciSummary: makeCiSummary({ status: 'success', modelActive: false, slotProgress: { done: 6, total: 6, phase: 'Резюме' } }),
    onStartCi: () => {},
    onOpenCiRun: () => {}
  }
}
