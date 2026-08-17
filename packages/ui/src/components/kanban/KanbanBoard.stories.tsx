// Сториз изолированной канбан-доски: все состояния входных данных —
// от пустой доски и загрузки до битых данных и переполнения текстом.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { userEvent, within } from '@storybook/test'
import type { Board } from '@shared/projects'
import { KanbanBoard } from './KanbanBoard'
import { makeBoard, makeColumn, makeDefaultColumns, makeMembers, makeTask, noopHandlers } from './fixtures'

const meta: Meta<typeof KanbanBoard> = {
  title: 'Kanban/KanbanBoard',
  component: KanbanBoard,
  // В приложении доска живёт внутри .toolpage с ограниченной высотой
  // (ProjectPage → ToolFrame) — только тогда у колонки появляется свой
  // вертикальный скролл (.jcol-body { overflow-y: auto }). Без обёртки витрина
  // росла бы вниз, и в ColumnDensity скролл колонки было не увидеть.
  // 32px — паддинг рамки превью (.storybook/preview.tsx).
  decorators: [
    (Story) => (
      <div className="toolpage" style={{ height: 'calc(100vh - 32px)' }}>
        <Story />
      </div>
    )
  ],
  args: {
    projectName: 'Голос Чат',
    loading: false,
    members: makeMembers('admin', 'bob', 'carol'),
    currentUser: 'admin',
    ...noopHandlers()
  }
}
export default meta
type Story = StoryObj<typeof KanbanBoard>

/** Пусто: ни колонок, ни задач — подсказка про колонки и бокс «+ колонка». */
export const EmptyBoard: Story = {
  args: { board: makeBoard([], []) }
}

/** Одна колонка без задач: подсказка, чем её наполнить. */
export const SingleColumn: Story = {
  args: { board: makeBoard([makeColumn({ id: 'solo', name: 'Бэклог', semanticType: 'backlog' })], []) }
}

/** Много колонок — горизонтальный скролл. */
export const ManyColumns: Story = {
  args: {
    board: (() => {
      const cols = Array.from({ length: 10 }, (_, i) => makeColumn({ id: `mc${i}`, name: `Этап ${i + 1}`, position: (i + 1) * 1024 }))
      const tasks = cols.flatMap((c, i) => Array.from({ length: (i % 3) + 1 }, () => makeTask({ columnId: c.id })))
      return makeBoard(cols, tasks)
    })()
  }
}

/** Плотность: колонки с 0, 1 и 15 карточками (вертикальный скролл). */
export const ColumnDensity: Story = {
  args: {
    board: (() => {
      const empty = makeColumn({ id: 'd0', name: 'Пустая', position: 1024 })
      const one = makeColumn({ id: 'd1', name: 'Одна', position: 2048 })
      const many = makeColumn({ id: 'd15', name: 'Пятнадцать', position: 3072 })
      return makeBoard(
        [empty, one, many],
        [makeTask({ columnId: 'd1' }), ...Array.from({ length: 15 }, () => makeTask({ columnId: 'd15' }))]
      )
    })()
  }
}

/** Длинные тексты: имя проекта, колонок, задач, слово без пробелов, 8 меток. */
export const LongTitles: Story = {
  args: {
    projectName: 'Очень длинное название проекта голосового чата с искусственным интеллектом',
    board: (() => {
      const col = makeColumn({
        id: 'long',
        name: 'Колонка с чрезвычайно длинным названием, которое не помещается в шапку и должно обрезаться'
      })
      return makeBoard(
        [col],
        [
          makeTask({
            columnId: 'long',
            title:
              'Задача с очень длинным названием: нужно спроектировать, реализовать и протестировать сценарий обработки переполнения текста в карточке канбан-доски, включая перенос строк и обрезание слишком длинных строк без пробелов'
          }),
          makeTask({ columnId: 'long', title: 'Слово-без-пробелов-' + 'оченьдлинное'.repeat(12) }),
          makeTask({
            columnId: 'long',
            title: 'Восемь меток',
            labels: ['frontend', 'backend', 'инфраструктура', 'дизайн-система', 'критично-для-релиза', 'техдолг', 'исследование', 'документация']
          })
        ]
      )
    })()
  }
}

/** Загрузка (первая): скелетон колонок и карточек, геометрия — как у доски. */
export const Loading: Story = {
  args: { board: null, loading: true }
}

/** Ошибка без доски: сообщение, деталь под «Подробнее», «Повторить». */
export const ErrorState: Story = {
  args: { board: null, error: 'Не удалось загрузить доску: сервер недоступен', onRetry: () => {} }
}

/** Повторная загрузка: доска остаётся на месте, сверху — индикатор обновления. */
export const Refreshing: Story = {
  args: {
    board: makeBoard(makeDefaultColumns(), [makeTask({ columnId: 'col-development' })]),
    loading: true
  }
}

/** Ошибка поверх загруженной доски: данные остаются, ошибка — баннером. */
export const ErrorWithBoard: Story = {
  args: {
    board: makeBoard([makeColumn({ id: 'e1', name: 'Бэклог' })], [makeTask({ columnId: 'e1' })]),
    error: 'Не удалось сохранить изменение: повторите попытку',
    onRetry: () => {}
  }
}

/** Битые данные: рендер без падения, все фолбэки нормализации. */
export const BrokenData: Story = {
  args: {
    board: {
      columns: [
        { id: 'b1', projectId: 'p1', name: '', semanticType: 'что-то', position: 'наверх', hidden: 0, wipLimit: -5, createdAt: 1 }
      ],
      tasks: [
        { id: 'bt1', projectId: 'p1', columnId: 'b1', type: 'bug', parentId: 'ghost', title: '', description: 3,
          acceptanceCriteria: null, priority: 'критический', assignee: 42, labels: 'ui', storyPoints: -1,
          dueDate: 'завтра', flagged: 'да', seq: undefined, position: null, createdAt: 1, updatedAt: 1 },
        makeTask({ columnId: 'b1', title: 'Соседняя валидная задача', labels: ['ok'] })
      ]
    } as unknown as Board
  }
}

const epicBoard = (): Board => {
  const cols = makeDefaultColumns()
  const auth = makeTask({ id: 'ep-auth', type: 'epic', title: 'Авторизация', columnId: 'col-backlog' })
  const voice = makeTask({ id: 'ep-voice', type: 'epic', title: 'Голосовой ввод', columnId: 'col-backlog' })
  return makeBoard(cols, [
    auth,
    voice,
    makeTask({ id: 'st1', type: 'story', parentId: 'ep-auth', title: 'Вход по паролю', columnId: 'col-ready', assignee: 'bob' }),
    makeTask({ parentId: 'st1', title: 'Форма входа', columnId: 'col-development', assignee: 'bob' }),
    makeTask({ parentId: 'ep-voice', type: 'story', title: 'Запись с микрофона', columnId: 'col-development', assignee: 'carol' }),
    makeTask({ title: 'Задача без эпика', columnId: 'col-automated_qa' }),
    makeTask({ title: 'Готовая задача', columnId: 'col-done', assignee: 'admin' })
  ])
}

/** Свимлейны по эпикам (карточки эпиков скрыты, последняя дорожка — «Без эпика»). */
export const SwimlanesByEpic: Story = {
  args: { board: epicBoard(), defaultSwimlane: 'epic' }
}

/** Свимлейны по исполнителям («Не назначено» — последняя дорожка). */
export const SwimlanesByAssignee: Story = {
  args: { board: epicBoard(), defaultSwimlane: 'assignee' }
}

/** Превышенный WIP-лимит: подсветка шапки и счётчика 4/2. */
export const WipExceeded: Story = {
  args: {
    board: (() => {
      const col = makeColumn({ id: 'wip', name: 'Разработка', semanticType: 'development', wipLimit: 2 })
      return makeBoard([col], Array.from({ length: 4 }, () => makeTask({ columnId: 'wip' })))
    })()
  }
}

/** Карточка со всеми атрибутами + запущенная фича. */
export const FullFeaturedCard: Story = {
  args: {
    board: (() => {
      const cols = makeDefaultColumns()
      const epic = makeTask({ id: 'ep', type: 'epic', title: 'Платежи', columnId: 'col-backlog' })
      const story = makeTask({
        id: 'st',
        type: 'story',
        parentId: 'ep',
        title: 'Оплата картой: полный сценарий с 3-DS подтверждением',
        columnId: 'col-development',
        assignee: 'bob',
        labels: ['payments', 'critical'],
        storyPoints: 8,
        dueDate: Date.now() - 3 * 24 * 60 * 60 * 1000,
        flagged: true
      })
      return makeBoard(cols, [
        epic,
        story,
        makeTask({ id: 'sub1', parentId: 'st', title: 'Форма карты', columnId: 'col-done' }),
        makeTask({ id: 'sub2', parentId: 'st', title: 'Интеграция шлюза', columnId: 'col-done' }),
        makeTask({ id: 'sub3', parentId: 'st', title: 'Обработка отказов', columnId: 'col-development' })
      ])
    })()
  }
}

/** Скрытые колонки: чекбокс «скрытые» в панели фильтров. */
export const HiddenColumns: Story = {
  args: {
    board: makeBoard(
      [
        makeColumn({ id: 'v1', name: 'Видимая', position: 1024 }),
        makeColumn({ id: 'h1', name: 'Скрытая', position: 2048, hidden: true })
      ],
      [makeTask({ columnId: 'v1' }), makeTask({ columnId: 'h1', title: 'Задача в скрытой колонке' })]
    )
  }
}

/** Доска с задачами в нескольких колонках — основа сториз про перенос. */
const dragBoard = (): Board => {
  const cols = makeDefaultColumns()
  return makeBoard(cols, [
    makeTask({ id: 'dr1', title: 'Починить авторизацию по токену', columnId: 'col-backlog', assignee: 'bob' }),
    makeTask({ id: 'dr2', title: 'Экран настроек: вкладка «Голос»', columnId: 'col-backlog' }),
    makeTask({ id: 'dr3', title: 'Перенести карточку пальцем', columnId: 'col-development', assignee: 'admin', labels: ['ui'] }),
    makeTask({ id: 'dr4', title: 'Скролл доски у края экрана', columnId: 'col-development' }),
    makeTask({ id: 'dr5', title: 'Озвучить перенос в aria-live', columnId: 'col-automated_qa', assignee: 'carol' })
  ])
}

/**
 * Карточка захвачена: так доска выглядит в середине переноса. Взято с
 * клавиатуры (Space) и сдвинуто стрелкой — карточка подсвечена и остаётся на
 * месте (иначе слетел бы фокус), а плейсхолдер показывает выбранное место.
 * Тот же плейсхолдер видно и при переносе пальцем — только там карточка уезжает
 * в приподнятую копию под пальцем, которую скриншотом не поймать.
 */
export const GrabbedCard: Story = {
  args: { board: dragBoard() },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement).getAllByTestId('task-card')[0]
    card?.focus()
    await userEvent.keyboard(' ')
    await userEvent.keyboard('{ArrowDown}')
  }
}

/**
 * Телефон: ручки захвата «⠿» видны всегда (ховера нет) и размером под палец —
 * тап по ручке поднимает карточку сразу, удержание на самой карточке 200 мс
 * делает то же, а обычный скролл колонки и доски при этом не ломается.
 */
export const MobileViewport: Story = {
  args: { board: dragBoard() },
  parameters: { viewport: { defaultViewport: 'mobile2' } }
}

/** Телефон в середине переноса: плейсхолдер и подсвеченная карточка на узком экране. */
export const MobileGrabbedCard: Story = {
  args: { board: dragBoard() },
  parameters: { viewport: { defaultViewport: 'mobile2' } },
  play: GrabbedCard.play
}

/**
 * Живая доска: перенос действительно меняет порядок — единственная сториз, где
 * можно потрогать жест руками (в том числе с телефона, открыв Storybook по
 * адресу машины). Ранг считается как на сервере: середина между соседями.
 */
function InteractiveBoard(): JSX.Element {
  const [board, setBoard] = useState<Board>(dragBoard)
  const STEP = 1024
  return (
    <KanbanBoard
      projectName="Голос Чат"
      loading={false}
      members={makeMembers('admin', 'bob', 'carol')}
      currentUser="admin"
      {...noopHandlers()}
      board={board}
      onReorderColumns={(order) =>
        setBoard((prev) => ({
          ...prev,
          columns: order.flatMap((id, i) => {
            const col = prev.columns.find((c) => c.id === id)
            return col ? [{ ...col, position: (i + 1) * STEP }] : []
          })
        }))
      }
      onMoveTask={(taskId, columnId, afterId, beforeId) =>
        setBoard((prev) => {
          const after = afterId ? prev.tasks.find((t) => t.id === afterId) : null
          const before = beforeId ? prev.tasks.find((t) => t.id === beforeId) : null
          const position =
            after && before
              ? (after.position + before.position) / 2
              : after
                ? after.position + STEP
                : before
                  ? before.position - STEP
                  : Math.max(0, ...prev.tasks.filter((t) => t.columnId === columnId && t.id !== taskId).map((t) => t.position)) + STEP
          return { ...prev, tasks: prev.tasks.map((t) => (t.id === taskId ? { ...t, columnId, position } : t)) }
        })
      }
    />
  )
}

export const Interactive: Story = {
  render: () => <InteractiveBoard />
}
