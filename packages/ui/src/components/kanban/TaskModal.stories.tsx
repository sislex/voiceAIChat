// Сториз карточки задачи: десктопные две колонки и мобильная раскладка (как в
// Jira). Мобильный вариант смотрится в отдельном вьюпорте — карточка перестраивается
// по matchMedia, поэтому важна именно ширина фрейма, а не размер контейнера.
import type { Meta, StoryObj } from '@storybook/react'
import { userEvent, within } from '@storybook/test'
import { TaskModal } from './TaskModal'
import { Button } from '@voicechat/ui-kit'
import { withBridges } from '../../test/storyBridges'
import { makeBoard, makeCiSummary, makeDefaultColumns, makeMembers, makeTask } from './fixtures'
import type { TaskImprovement } from '@shared/ci'
import type { TaskTimeline } from '@shared/timeline'
import type { TaskPreparationRun } from '@shared/qa'

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
// Описание, ради которого и нужен маркдаун: заголовок, список, инлайн-код и блок.
const markdownTask = makeTask({
  ...task,
  description: [
    '## Зачем',
    '',
    'Оплата картой падает на 3-DS: пользователь возвращается в чек-аут без результата.',
    '',
    '## Что сделать',
    '',
    '- показать экран 3-DS в модалке',
    '- вернуть результат в `checkout` и показать его пользователю',
    '- при отказе банка показать причину',
    '',
    '```ts',
    "const result = await pay({ card, threeDs: 'required' })",
    '```'
  ].join('\n')
})
const child = makeTask({ id: 'child-1', parentId: task.id, columnId: columns[5].id, title: 'Форма ввода карты' })

const meta: Meta<typeof TaskModal> = {
  title: 'Kanban/TaskModal',
  component: TaskModal,
  // Без мостов вкладки карточки показывали в витрине одни пустые состояния:
  // временная шкала, «Улучшения», настройки и лента рана грузят себя сами.
  decorators: [withBridges()],
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

// Промежуточная ширина: мобильная раскладка уже выключена (граница 720px), а
// места на две колонки и полосу вкладок ещё мало — самый узкий десктоп.
const TABLET = {
  viewport: {
    viewports: {
      tablet: { name: 'Планшет 820×1180', styles: { width: '820px', height: '1180px' }, type: 'tablet' }
    },
    defaultViewport: 'tablet'
  }
}

/** Десктоп: основная колонка и правая панель деталей. */
export const Desktop: Story = {}

/**
 * Описание в просмотре: маркдаун отрисован (заголовки, списки, `code`, блок кода),
 * а не показан сырым текстом в поле — так карточку читают, а не расшифровывают.
 */
export const DescriptionMarkdown: Story = { args: { task: markdownTask } }

/**
 * Описание в правке: та же карточка после кнопки «Изменить» — поле ровно на 10
 * строк, палочка AI-помощника и пара «Сохранить»/«Отмена».
 */
export const DescriptionEditing: Story = {
  args: { task: markdownTask, generateAiAssist: async () => [{ id: 's1', text: 'Черновик описания' }] },
  // Карточка уходит порталом в document.body — canvasElement тут пуст.
  play: async () => {
    await userEvent.click(await within(document.body).findByTestId('task-desc-edit'))
  }
}

/** Планшет: две колонки на 820px — самая узкая десктопная раскладка. */
export const Tablet: Story = { parameters: TABLET }

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

const at = (offsetMs: number): string => new Date(Date.UTC(2024, 0, 1, 9) + offsetMs).toISOString()

/** Шкала с тремя этапами: успех, идущий этап и падение — все три тона точек. */
const timeline: TaskTimeline = {
  version: 1, taskId: task.id, generatedAt: at(60 * 60_000),
  summary: {
    createdAt: at(0), firstStartedAt: at(60_000), finishedAt: null,
    calendarDuration: 60 * 60_000, activeDuration: 15 * 60_000,
    queueDuration: 2 * 60_000, awaitingInputDuration: 60_000, lastChangedAt: at(59 * 60_000)
  },
  stages: [
    {
      id: 'stage:development', type: 'development', title: 'Разработка', status: 'succeeded',
      queuedAt: at(0), startedAt: at(60_000), finishedAt: at(15 * 60_000),
      queueDuration: 60_000, activeDuration: 14 * 60_000, awaitingInputDuration: 0, calendarDuration: 14 * 60_000,
      attemptCount: 2, successfulDuration: 10 * 60_000, unsuccessfulDuration: 4 * 60_000,
      executor: 'bob', machine: 'mac-01', model: 'claude-opus-5', reason: null, workflowPosition: 20, dataComplete: true,
      runs: [{ id: 'run-2', kind: 'ci' }],
      attempts: [{
        id: 'ci:run-1', number: 1, status: 'failed', queuedAt: at(0), startedAt: at(60_000), finishedAt: at(5 * 60_000),
        queueIntervals: [], activeIntervals: [], awaitingInputIntervals: [],
        queueDuration: 60_000, activeDuration: 4 * 60_000, awaitingInputDuration: 0, calendarDuration: 4 * 60_000,
        executor: 'bob', machine: 'mac-01', model: 'claude-opus-5',
        reason: { code: 'tests_failed', message: 'Тесты упали' }, runs: [{ id: 'run-1', kind: 'ci' }], dataComplete: true
      }]
    },
    {
      id: 'stage:manual_qa', type: 'manual_qa', title: 'Ручное QA', status: 'running',
      queuedAt: at(15 * 60_000), startedAt: at(15 * 60_000), finishedAt: null,
      queueDuration: 0, activeDuration: 60_000, awaitingInputDuration: 60_000, calendarDuration: null,
      attemptCount: 1, successfulDuration: 0, unsuccessfulDuration: 0,
      executor: null, machine: null, model: null, reason: null, workflowPosition: 70, dataComplete: true,
      runs: [], attempts: []
    },
    {
      id: 'stage:merge', type: 'merge', title: 'Merge', status: 'failed',
      queuedAt: at(25 * 60_000), startedAt: at(25 * 60_000), finishedAt: at(27 * 60_000),
      queueDuration: 0, activeDuration: 2 * 60_000, awaitingInputDuration: 0, calendarDuration: 2 * 60_000,
      attemptCount: 1, successfulDuration: 0, unsuccessfulDuration: 2 * 60_000,
      executor: null, machine: null, model: null,
      reason: { code: 'conflict', message: 'Конфликт в app.css' }, workflowPosition: 90, dataComplete: true,
      runs: [], attempts: []
    }
  ]
}

/** Успешная попытка подготовки: сводка, шаги и Development Brief. */
const preparationRun: TaskPreparationRun = {
  id: 'prep-1', projectId: task.projectId, taskId: task.id, status: 'success', stage: 'brief_generation',
  phase: 'brief_generation', attempt: 2, log: '$ git checkout -b task/CHAT-248\n✓ workspace ready\n✓ implementation plan saved',
  events: [], questions: [], readiness: null, gateResults: [], gateReasons: [],
  machineId: 'mac-01', machineName: 'MacBook', provider: 'codex', model: 'gpt-5',
  durationMs: 258_000, canCancel: false, canRetry: true,
  maxAttempts: 3, error: null, finishedAt: 259_000,
  createdBy: 'admin', createdAt: 1, updatedAt: 1
} as TaskPreparationRun

const improvement = (over: Partial<TaskImprovement>): TaskImprovement => ({
  id: 'imp', taskId: task.id, projectId: task.projectId, runId: 'run-2', stepId: null,
  source: 'development', status: 'new', title: 'Улучшение', description: 'Подробности',
  acceptanceCriteria: '', createdTaskId: null, fingerprint: 'fp', evidence: [], occurrences: 1,
  suggestedAction: 'create_chatai_task', isNew: true, createdAt: 1, updatedAt: 1, ...over
})

// Вкладку открываем кликом: `initialTab` — публичный контракт диплинков
// (`TaskModalTab`), и внутренних разделов карточки в нём нет.
const openTab = (name: string | RegExp) => async (): Promise<void> => {
  await userEvent.click(await within(document.body).findByRole('tab', { name }))
}

/** Временная шкала: точки статуса, шеврон раскрытия и русские даты. */
export const Timeline: Story = {
  decorators: [withBridges((bridges) => { bridges.ci.getTaskTimeline = async () => timeline })],
  play: openTab('Временная шкала')
}

/** Улучшения: та же лента — статус точкой и словом, источник по-русски. */
export const Improvements: Story = {
  play: openTab(/Улучшения/),
  decorators: [withBridges((bridges) => {
    bridges.ci.listTaskImprovements = async () => [
      improvement({ id: 'i1', title: 'Кэшировать установку зависимостей', description: 'Каждый ран ставит зависимости с нуля — это две минуты на запуск.', stepId: 'install' }),
      improvement({ id: 'i2', title: 'Уточнить команду тестов', status: 'accepted', isNew: false, source: 'system', runId: null, suggestedAction: 'reconfigure_commands' }),
      improvement({ id: 'i3', title: 'Понизить таймаут merge-рана', status: 'rejected', isNew: false, source: 'merge', suggestedAction: 'support_ticket' })
    ]
  })]
}

/** Пустая лента улучшений — общий пустой экран, а не голый заголовок. */
export const ImprovementsEmpty: Story = { play: openTab(/Улучшения/) }

/** Подготовка к разработке: шапка попытки, сводка рана и его шаги. */
export const Preparation: Story = {
  args: {
    task: makeTask({ ...task, taskPreparationRunId: 'prep-1', taskPreparationStatus: 'success' }),
    loadPreparationRuns: async () => [preparationRun],
    onRetryPreparation: async () => {},
    onExportPreparation: async () => {}
  },
  play: openTab('Подготовка к разработке')
}

/** Подготовка, которая ждёт ответа: тон лозенги отличается от успеха и от ошибки. */
export const PreparationWaiting: Story = {
  args: {
    task: makeTask({ ...task, taskPreparationRunId: 'prep-1', taskPreparationStatus: 'waiting_for_answer' }),
    loadPreparationRuns: async () => [{ ...preparationRun, status: 'waiting_for_answer', phase: 'clarification', questions: [{ questionId: 'q1', attemptId: 'prep-1', text: 'Какой лимит попыток 3-DS считаем нормой?', material: true, status: 'open', answer: null, askedAt: 1, answeredAt: null, answeredBy: null }] }],
    onAnswerPreparation: async () => {}
  },
  play: openTab('Подготовка к разработке')
}

/** Ход выполнения: шапка рана с лозенгой и Live, дальше работа модели и отчёт. */
export const Progress: Story = { play: openTab('Ход выполнения') }

/** Настройки выполнения: машина, модель и команды одной колонкой. */
export const Settings: Story = { play: openTab('Настройки') }

/** Ручное QA: превью и сценарии проверки. */
export const ManualQa: Story = { play: openTab('Ручное QA') }

/** Merge: ветка задачи и её слияние в main. */
export const Merge: Story = {
  args: { task: makeTask({ ...task, mergeSourceBranch: 'task/CHAT-248', activeMergeRunId: 'merge-1' }), onStartMerge: () => {} },
  play: openTab('Merge')
}

/** Лента рана: технические события запуска с индикатором Live. */
export const RunFeed: Story = { play: openTab('Лента рана') }

/** Телефон: та же панель рана в одну колонку — сводка и шаги не разъезжаются. */
export const PreparationPhone: Story = {
  args: {
    task: makeTask({ ...task, taskPreparationRunId: 'prep-1', taskPreparationStatus: 'success' }),
    loadPreparationRuns: async () => [preparationRun]
  },
  parameters: PHONE,
  play: openTab('Подготовка к разработке')
}

/**
 * Черновик новой задачи: карточка ничего не сохраняет до подтверждения, вкладок
 * нет, а действия создания живут в стандартном подвале окна.
 */
export const Draft: Story = {
  args: {
    draft: true,
    task: makeTask({ id: 'draft', title: '', description: '', acceptanceCriteria: '', columnId: '', assignee: null, labels: [], skills: [], storyPoints: null, dueDate: null }),
    board: makeBoard(columns, []),
    ciSummary: undefined,
    footer: <>
      <Button>Отмена</Button>
      <Button variant="primary">Создать задачу</Button>
    </>
  }
}
