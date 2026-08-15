// Сториз скелетона: варианты, геометрия «как у контента» и переключение на
// статичную подложку при `prefers-reduced-motion: reduce` (в браузере оно
// проверяется системной настройкой, поэтому здесь — только напоминание в docs).
import type { Meta, StoryObj } from '@storybook/react'
import { RefreshIndicator, Skeleton } from '@voicechat/ui-kit'
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

function Row({ title, children }: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <section style={{ marginBottom: 24, maxWidth: 420 }}>
      <p style={{ font: '600 12px/1.4 inherit', textTransform: 'uppercase', letterSpacing: '0.4px', opacity: 0.7 }}>{title}</p>
      {children}
    </section>
  )
}

/** Все варианты рядом: строка, блок, карточка, список. */
export const Variants: Story = {
  render: () => (
    <div>
      <Row title="line — строка текста">
        <div style={{ display: 'grid', gap: 8 }}>
          <Skeleton variant="line" width="64%" height={12} />
          <Skeleton variant="line" />
          <Skeleton variant="line" width="40%" />
        </div>
      </Row>
      <Row title="block — прямоугольник заданной высоты">
        <Skeleton variant="block" height={54} />
      </Row>
      <Row title="card — карточка со строками">
        <Skeleton variant="card" height={76} lines={3} />
      </Row>
      <Row title="list — n одинаковых элементов">
        <Skeleton variant="list" count={3} height={76} />
      </Row>
      <Row title="RefreshIndicator — повторная загрузка">
        <RefreshIndicator label="Обновляем список…" />
      </Row>
    </div>
  )
}

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
