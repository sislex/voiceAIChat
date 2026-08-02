// Шапка чата, привязанного к задаче канбана: где мы в иерархии (проект/эпик/
// стори/задача), на каком этапе воркфлоу, сколько уже идёт работа, на какой
// машине и в какой папке. По клику разворачивается в ленту CI-рана — та же
// RunFeed, что и в модалке, поэтому вопрос модели виден и здесь.
//
// Шапка сама сворачивается в одну строку (ключ задачи + статус рана): на
// телефоне вместе с композером она съедала ленту сообщений. Открывается
// свёрнутой и состояние нигде не хранит — как и композер внизу.

import { useEffect, useState, type JSX } from 'react'
import type { TaskChatContext } from '@shared/projects'
import type { CiRunSummary } from '@shared/ci'
import { ciCardPulse, isTerminalCiStatus } from '@shared/ci'
import { RUN_MODE_LABEL, ciStatusLabel, ciTone, fmtDuration } from '../ci/ciFormat'
import { IconButton } from '../ui/IconButton'

export interface TaskChatHeaderProps {
  context: TaskChatContext
  /**
   * Живая сводка последнего рана задачи (тот же источник, что у доски): из неё
   * считается подсветка шапки. Нет сводки — берём статус из контекста, но флага
   * «модель чинит ошибку» там нет, и фикс выглядит как обычный ран.
   */
  summary?: CiRunSummary | null
  /** Открыть карточку задачи на доске. */
  onOpenTask: (projectId: string, taskId: string) => void
  /** Лента рана рендерится наружу — чтобы не тащить сюда весь мост CI. */
  renderRunFeed?: (runId: string) => JSX.Element
  /**
   * С какого состояния открыть шапку. В приложении дефолт и есть поведение
   * («свёрнута»), проп нужен витрине и тестам — иначе развёрнутый вид виден
   * только после клика.
   */
  defaultCollapsed?: boolean
  now?: () => number
}

/** Живая длительность работы: у активного рана тикает, у завершённого — итог. */
function useRunElapsed(startedAt: number | null, finished: boolean, now: () => number): number | null {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (finished || startedAt == null) return
    const t = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [finished, startedAt])
  void tick
  return startedAt == null ? null : now() - startedAt
}

export function TaskChatHeader(props: TaskChatHeaderProps): JSX.Element {
  const ctx = props.context
  const now = props.now ?? Date.now
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(props.defaultCollapsed ?? true)
  const toggleCollapsed = (): void => setCollapsed((prev) => !prev)
  const run = ctx.run
  const finished = run ? isTerminalCiStatus(run.status) : true
  const live = useRunElapsed(run?.startedAt ?? null, finished, now)
  const duration = run ? (finished ? run.durationMs : live) : null
  // Шапка подсвечивается как карточка задачи на доске: один расчёт, одни цвета.
  const pulse = ciCardPulse(props.summary ?? (run ? { status: run.status, slotProgress: { fixing: false } } : null))

  const collapseLabel = collapsed ? 'Развернуть виджет задачи' : 'Свернуть виджет задачи'

  return (
    <section
      className={['taskchat', collapsed && 'taskchat--collapsed', pulse && `taskchat--ci-${pulse}`].filter(Boolean).join(' ')}
      data-testid="task-chat-header"
    >
      <div className="taskchat-top">
        <IconButton
          className="taskchat-collapse"
          size="sm"
          aria-expanded={!collapsed}
          aria-label={collapseLabel}
          title={collapseLabel}
          data-testid="task-chat-collapse"
          onClick={toggleCollapsed}
        >
          {collapsed ? '▸' : '▾'}
        </IconButton>
        <span className="taskchat-crumbs">
          {/* Свёрнутая шапка оставляет только саму задачу: проект, эпик и стори
              видно на доске, а место в строке нужно ключу и заголовку. */}
          {!collapsed && (
            <>
              <span className="taskchat-crumb">{ctx.projectName}</span>
              {ctx.epic && <><span className="taskchat-sep">/</span><span className="taskchat-crumb">{ctx.epic.key} {ctx.epic.title}</span></>}
              {ctx.story && <><span className="taskchat-sep">/</span><span className="taskchat-crumb">{ctx.story.key} {ctx.story.title}</span></>}
              <span className="taskchat-sep">/</span>
            </>
          )}
          <strong className="taskchat-task">{ctx.task.key} {ctx.task.title}</strong>
        </span>
        {/* Статус рана виден и свёрнутым: ради него в шапку и смотрят. */}
        {collapsed && run && (
          <span className={`ci-lozenge ci-lozenge--${ciTone(run.status)}`}>{ciStatusLabel(run.status)}</span>
        )}
        <button className="taskchat-open" onClick={() => props.onOpenTask(ctx.projectId, ctx.task.id)}>
          Открыть задачу
        </button>
      </div>

      {!collapsed && (
        <div className="taskchat-meta">
          {ctx.columnName && <span className="lozenge lozenge-neutral" title="Этап воркфлоу">{ctx.columnName}</span>}
          {run && <span className={`ci-lozenge ci-lozenge--${ciTone(run.status)}`}>{ciStatusLabel(run.status)}</span>}
          {run && <span className="taskchat-dim">Режим: {RUN_MODE_LABEL[run.mode]}</span>}
          {duration != null && (
            <span className="taskchat-dim" data-testid="task-chat-elapsed">
              {finished ? 'Работа заняла' : 'В работе'} {fmtDuration(duration)}
            </span>
          )}
          {ctx.agentName && <span className="taskchat-dim" title="Машина разработки">🖥 {ctx.agentName}</span>}
          {ctx.workdir && <span className="taskchat-dim taskchat-dir" title={ctx.workdir}>📁 {ctx.workdir}</span>}
          {run && props.renderRunFeed && (
            <button className="taskchat-feed-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? 'Скрыть ленту рана' : 'Лента рана'}
            </button>
          )}
        </div>
      )}

      {!collapsed && open && run && props.renderRunFeed && (
        <div className="taskchat-feed">{props.renderRunFeed(run.id)}</div>
      )}
    </section>
  )
}
