// Атрибутика Jira-карточек: иконки типов и приоритетов, ключи задач (PRJ-42),
// цвета аватаров/эпиков, форматирование сроков. Чистые функции — без стора.

import type { KanbanColumn, TaskPriority, WorkItemType } from '@shared/projects'

export const TYPE_LABEL: Record<WorkItemType, string> = { epic: 'Эпик', story: 'История', task: 'Задача' }
export const PRIORITY_LABEL: Record<TaskPriority, string> = { low: 'Низкий', medium: 'Средний', high: 'Высокий', urgent: 'Срочный' }

// Ключи задач живут в shared: их считает и сервер (контекст связанного чата).
export { issueKey, projectKey } from '@shared/projects'

/** «1 задача» / «3 задачи» / «7 задач». */
export function pluralTasks(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'задача'
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'задачи'
  return 'задач'
}

/**
 * Имя колонки как региона для скринридера: «Колонка «В работе», 3 задачи».
 * Считаем видимые под фильтром задачи — ровно то, что человек услышит, пройдя
 * колонку до конца. Скрытую колонку помечаем: иначе на слух она не отличается.
 */
export function columnRegionLabel(col: Pick<KanbanColumn, 'name' | 'hidden'>, visible: number): string {
  const count = visible === 0 ? 'задач нет' : `${visible} ${pluralTasks(visible)}`
  return `Колонка «${col.name}», ${count}${col.hidden ? ', скрыта' : ''}`
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Инициалы для аватара (до двух букв логина). */
export function initials(username: string): string {
  const parts = username.split(/[._\-\s]+/).filter(Boolean)
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : username.slice(0, 2)
  return two.toUpperCase()
}

/** Стабильный цвет аватара по логину. */
export function avatarColor(username: string): string {
  return `hsl(${hash(username) % 360}, 55%, 42%)`
}

// Палитра меток эпиков Jira.
const EPIC_COLORS = ['#8777d9', '#2684ff', '#00a3bf', '#57d9a3', '#ffc400', '#ff7452', '#f99cdb', '#6554c0', '#36b37e', '#ff991f']

/** Стабильный цвет эпика по id. */
export function epicColor(epicId: string): string {
  return EPIC_COLORS[hash(epicId) % EPIC_COLORS.length]
}

/** Короткая дата срока: «5 авг.». */
export function fmtDue(ms: number): string {
  return new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' }).format(new Date(ms))
}

/** Состояние срока: просрочен / сегодня-завтра / в будущем. */
export function dueState(ms: number, now = Date.now()): 'overdue' | 'soon' | 'ok' {
  const day = 24 * 60 * 60 * 1000
  if (ms < now - day + 1) return 'overdue'
  return ms - now < 2 * day ? 'soon' : 'ok'
}

/** Иконка типа Jira: цветной квадрат с глифом (эпик ⚡, история 🔖, задача ✓). */
export function TypeIcon({ type }: { type: WorkItemType }): JSX.Element {
  const bg = type === 'epic' ? '#904ee2' : type === 'story' ? '#63ba3c' : '#4bade8'
  return (
    <svg className="jtype" width="16" height="16" viewBox="0 0 16 16" role="img" aria-label={TYPE_LABEL[type]}>
      <title>{TYPE_LABEL[type]}</title>
      <rect width="16" height="16" rx="3" fill={bg} />
      {type === 'epic' && <path d="M8.7 3.5 5.6 8.2c-.2.3 0 .7.4.7h1.9l-.7 3.4c-.1.5.5.7.8.3l3.4-4.9c.2-.3 0-.7-.4-.7H9.2l.7-3.2c.1-.5-.5-.7-.8-.3z" fill="#fff" />}
      {type === 'story' && <path d="M5.5 3.5h5c.3 0 .5.2.5.5v8.2c0 .4-.5.6-.8.4L8 10.7l-2.2 1.9c-.3.2-.8 0-.8-.4V4c0-.3.2-.5.5-.5z" fill="#fff" />}
      {type === 'task' && <path d="M4.6 8.4 7 10.8l4.4-5.2" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
}

/** Иконка приоритета Jira: стрелки (срочный ↑↑, высокий ↑, средний =, низкий ↓). */
export function PriorityIcon({ priority }: { priority: TaskPriority }): JSX.Element {
  const label = `Приоритет: ${PRIORITY_LABEL[priority]}`
  return (
    <svg className={`jprio jprio--${priority}`} width="14" height="14" viewBox="0 0 14 14" role="img" aria-label={label}>
      <title>{label}</title>
      {priority === 'urgent' && (
        <g stroke="#cd1316" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7.2 7 3.6l4 3.6" />
          <path d="M3 11 7 7.4l4 3.6" />
        </g>
      )}
      {priority === 'high' && <path d="M3 9.4 7 5.6l4 3.8" stroke="#e9494a" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {priority === 'medium' && (
        <g stroke="#ea7d24" strokeWidth="2" strokeLinecap="round">
          <path d="M3 5.2h8" />
          <path d="M3 9.2h8" />
        </g>
      )}
      {priority === 'low' && <path d="M3 5.6 7 9.4l4-3.8" stroke="#4c9aff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
}

/** Аватар исполнителя: цветной круг с инициалами. */
export function Avatar({ username, size = 24 }: { username: string; size?: number }): JSX.Element {
  return (
    <span
      className="javatar"
      title={username}
      style={{ width: size, height: size, background: avatarColor(username), fontSize: Math.round(size * 0.42) }}
    >
      {initials(username)}
    </span>
  )
}
