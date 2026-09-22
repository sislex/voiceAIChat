// Compare the public Skeleton primitive with real Core task content.
import { Skeleton } from '@voicechat/ui-kit'
import type { Meta, StoryObj } from '@storybook/react'
import { TaskCard } from '../kanban/TaskCard'
import { makeTask } from '../kanban/fixtures'

/** Обвязка настоящей карточки задачи: сравниваем скелетон именно с ней. */
const cardProps = {
  projectName: 'Голос Чат',
  allTasks: [],
  doneColumnIds: new Set<string>(),
  dragging: false,
  onOpen: () => {},
  onUpdate: () => {},
  onDelete: () => {},
  onMoveTop: () => {},
  onMoveBottom: () => {},
  onDragStart: () => {},
  onDragEnd: () => {}
}

const meta: Meta<typeof Skeleton> = {
  title: 'UI/Skeleton',
  component: Skeleton,
  parameters: {
    docs: {
      description: {
        component:
          'Скелетон показывается только на первой загрузке (данных ещё нет). ' +
          'При повторной загрузке содержимое остаётся на экране, а факт обновления ' +
          'показывает RefreshIndicator — правило в lib/loadState.ts. Анимация блика ' +
          'отключается медиазапросом prefers-reduced-motion: reduce.'
      }
    }
  }
}
export default meta
type Story = StoryObj<typeof Skeleton>

/**
 * Геометрия совпадает с контентом: слева косточки, справа настоящие карточки
 * задач той же высоты (70px). Разойдутся высоты — доска дёрнется в момент, когда
 * скелетон сменится данными, и это единственное, что здесь надо проверять глазами.
 */
export const MatchesContentGeometry: Story = {
  render: () => (
    <div className="jboard" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div className="jcol" style={{ width: 272 }}>
        <header className="jcol-head">
          <span className="jcol-name">скелетон</span>
        </header>
        <div className="jcol-body jcol-body--skel">
          <Skeleton variant="list" count={2} height={70} lines={2} itemClassName="jcard-skel" />
        </div>
      </div>
      <div className="jcol" style={{ width: 272 }}>
        <header className="jcol-head">
          <span className="jcol-name">данные</span>
        </header>
        <div className="jcol-body" style={{ padding: '0 6px 4px', gap: 8 }}>
          <TaskCard {...cardProps} task={makeTask({ id: 'g1', title: 'Настоящая карточка задачи' })} />
          <TaskCard {...cardProps} task={makeTask({ id: 'g2', title: 'И вторая — той же высоты' })} />
        </div>
      </div>
    </div>
  )
}
