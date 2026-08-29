// Декларативные фикстуры для сториз (и, при желании, тестов) канбан-доски.
// Никакой связи с fakeApi: сториз нужны синхронные готовые объекты.

import type { Board, KanbanColumn, ProjectMember, Task } from '@shared/projects'
import type { CiRunSummary, CiStatus } from '@shared/ci'

let seq = 0

export function makeTask(over: Partial<Task> = {}): Task {
  seq += 1
  return {
    id: `t${seq}`,
    projectId: 'p1',
    columnId: 'c1',
    type: 'task',
    parentId: null,
    title: `Задача ${seq}`,
    description: '',
    acceptanceCriteria: '',
    priority: 'medium',
    assignee: null,
    labels: [],
    skills: [],
    storyPoints: null,

    dueDate: null,
    flagged: false,
    seq,
    position: seq * 1024,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over
  }
}

export function makeColumn(over: Partial<KanbanColumn> = {}): KanbanColumn {
  seq += 1
  return {
    id: `c${seq}`,
    projectId: 'p1',
    name: `Колонка ${seq}`,
    semanticType: 'custom',
    position: seq * 1024,
    hidden: false,
    wipLimit: null,
    createdAt: 1_700_000_000_000,
    ...over
  }
}

/** Полный системный QA-workflow нового проекта (как на сервере). */
export function makeDefaultColumns(): KanbanColumn[] {
  const names: Array<[string, KanbanColumn['semanticType']]> = [
    ['Бэклог', 'backlog'],
    ['Подготовка к разработке', 'preparation'],
    ['Ready for Development', 'ready'],
    ['Development', 'development'],
    ['Component QA', 'component_qa'],
    ['Создание интеграционных автотестов', 'integration_tests'],
    ['Automated QA', 'automated_qa'],
    ['Ручное QA', 'manual_qa'],
    ['Ожидает мержа', 'awaiting_merge'],
    ['Мерж', 'merge'],
    ['Готово', 'done'],
    ['Требуется решение', 'decision_required']
  ]
  return names.map(([name, semanticType], i) =>
    makeColumn({ id: `col-${semanticType}`, name, semanticType, position: (i + 1) * 1024 })
  )
}

export function makeBoard(columns: KanbanColumn[], tasks: Task[]): Board {
  return { columns, tasks }
}

export function makeMembers(...usernames: string[]): ProjectMember[] {
  return usernames.map((username) => ({ username, role: username === 'admin' ? 'owner' : 'member', addedAt: 1 }))
}

/** Колбэки-заглушки для сториз. */
export function noopHandlers() {
  return {
    onCreateColumn: () => {},
    onUpdateColumn: () => {},
    onSetColumnHidden: () => {},
    onReorderColumns: () => {},
    onDeleteColumn: () => {},
    onCreateTask: () => {},
    onUpdateTask: () => {},
    onMoveTask: () => {},
    onDeleteTask: () => {}
  }
}

/** Сводка последнего CI-рана задачи (для сториз состояний карточки). */
export function makeCiSummary(over: Partial<CiRunSummary> & { status?: CiStatus } = {}): CiRunSummary {
  return {
    id: 'run-1',
    taskId: 't1',
    status: 'running',
    error: null,
    slotProgress: { done: 2, total: 6, phase: 'Модель работает' },
    durationMs: 92_000,
    modelActive: true,
    awaitingInput: false,
    ...over
  }
}
