// Карточка задачи в стиле Jira: заголовок, чип эпика, метки, флаг, прогресс
// подзадач, снизу — иконка типа + ключ, срок, стори-поинты, приоритет, аватар.
// Клик (тап) — открывает модалку задачи; меню «⋯» — быстрые действия.
//
// Перенос карточка не реализует: геометрия доски известна только ей, поэтому
// карточка лишь сообщает о захвате (onGrab) и о клавишах (onCardKeys), а порог
// жеста, копию под пальцем и цель считает KanbanBoard. Захватить можно с ручки
// «⠿» (единственное место с touch-action: none — палец там не скроллит) или
// удержанием самой карточки; с клавиатуры карточка фокусируется (tabIndex).

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { KanbanColumnSemanticType, Task } from '@shared/projects'
import { canStartMerge, isCurrentMergeSourceMerged } from '@shared/merge'
import { canStartCiRun, ciCardPulse, ciSummaryForTask, type CiRunSummary } from '@shared/ci'
import { AutomationProgressView } from './AutomationProgressView'
import { ciStatusLabel, ciTone, fmtDuration } from '../ci/ciFormat'
import { Avatar, PriorityIcon, TypeIcon, dueState, epicColor, fmtDue, issueKey } from './kanbanMeta'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { useConfirm } from '../ui/useConfirm'

export interface TaskCardProps {
  task: Task
  projectName: string
  /** Все задачи доски — для чипа эпика и прогресса подзадач. */
  allTasks: Task[]
  /** Колонки со смыслом «done» — для прогресса и зачёркивания ключа. */
  doneColumnIds: ReadonlySet<string>
  columnSemanticType?: KanbanColumnSemanticType
  onOpen: (taskId: string) => void
  onUpdate: (taskId: string, fields: { flagged?: boolean }) => void
  onDelete: (taskId: string) => void
  onMoveTop: (taskId: string) => void
  onMoveBottom: (taskId: string) => void
  /** Открыть связанный с задачей чат (кнопка на карточке). */
  onOpenChat?: (taskId: string) => void
  /** Сводка последнего CI-рана задачи (доска). */
  ciSummary?: CiRunSummary
  /** Запустить CI-воркфлоу для задачи. */
  onStartCi?: (taskId: string) => void
  /** Параллельный запуск: сразу в работу, мимо очереди сервера. */
  onStartCiParallel?: (taskId: string) => void
  /** Открыть ленту рана. */
  onOpenCiRun?: (runId: string) => void
  /** Убрать ожидающий ран из очереди CI. */
  onDequeueCiRun?: (runId: string) => void
  /** Доступна исключительно в awaiting_merge при серверно подтверждённых условиях. */
  onStartMerge?: (taskId: string) => void

  /** Захват указателем: доска решает, перенос это или клик/скролл.
      `immediate` — захват с ручки, удержание пальца не нужно. */
  onGrab?: (e: ReactPointerEvent<HTMLElement>, card: HTMLElement, immediate: boolean) => void
  /** Клавиши на карточке — клавиатурный перенос разбирает доска. */
  onCardKeys?: (e: KeyboardEvent<HTMLElement>, card: HTMLElement) => void
  /** Фокус ушёл с карточки — доска отменяет незавершённый клавиатурный перенос. */
  onCardBlur?: () => void
  /** Карточку несут указателем: на месте вставки доска рисует плейсхолдер. */
  dragging: boolean
  /** Карточка «взята» с клавиатуры: остаётся на месте и подсвечена. */
  grabbed?: boolean
}

/** Эпик-предок задачи (родитель истории или родитель родителя задачи). */
export function epicOf(task: Task, all: Task[]): Task | null {
  let cur: Task | null = task
  for (let i = 0; cur && i < 4; i++) {
    if (cur.type === 'epic') return cur.id === task.id ? null : cur
    cur = cur.parentId ? (all.find((t) => t.id === cur!.parentId) ?? null) : null
  }
  return null
}

export function TaskCard(props: TaskCardProps): JSX.Element {
  const { task, ciSummary } = props
  const confirm = useConfirm()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  // Меню закрывается кликом мимо него.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const done = props.doneColumnIds.has(task.columnId)
  // Сервер выбирает состояние; helper сохраняет совместимость со stale payload.
  const visibleCiSummary = ciSummaryForTask(ciSummary, done)
  const pulse = ciCardPulse(visibleCiSummary)
  // В «Готово» запуск нового CI-рана запрещён: завершённая карточка остаётся
  // историей результата, а не точкой повторного выполнения.
  const canStart = !done && canStartCiRun(ciSummary)

  const epic = epicOf(task, props.allTasks)
  const children = props.allTasks.filter((t) => t.parentId === task.id)
  const doneChildren = children.filter((t) => props.doneColumnIds.has(t.columnId))
  const key = issueKey(props.projectName, task)

  return (
    <div
      ref={cardRef}
      className={`jcard${task.flagged ? ' jcard--flagged' : ''}${task.previewReady ? ' jcard--preview-running' : ''}${pulse ? ` jcard--ci-${pulse}` : ''}${props.dragging ? ' dragging' : ''}${props.grabbed ? ' jcard--grabbed' : ''}`}
      data-testid="task-card"
      data-task-id={task.id}
      tabIndex={0}
      onClick={() => props.onOpen(task.id)}
      onPointerDown={(e) => {
        // С кнопок, полей и меню внутри карточки перенос не начинаем.
        if ((e.target as HTMLElement).closest('button, input, select, textarea, a')) return
        if (cardRef.current) props.onGrab?.(e, cardRef.current, false)
      }}
      onKeyDown={(e) => {
        if (cardRef.current) props.onCardKeys?.(e, cardRef.current)
      }}
      onBlur={() => props.onCardBlur?.()}
    >
      <div className="jcard-top">
        <span
          className="jcard-grip"
          aria-hidden="true"
          onPointerDown={(e) => {
            e.stopPropagation()
            if (cardRef.current) props.onGrab?.(e, cardRef.current, true)
          }}
        >
          ⠿
        </span>
        <span className="jcard-title">{task.title}</span>
        <span className="jcard-menuwrap" ref={menuRef}>
          <IconButton
            className="jcard-reveal"
            size="sm"
            aria-label={`Действия с «${task.title}»`}
            title="Действия"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((v) => !v)
            }}
          >
            ⋯
          </IconButton>
          {menuOpen && (
            <div className="jcard-menu" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setMenuOpen(false); props.onOpen(task.id) }}>Открыть</button>
              <button onClick={() => { setMenuOpen(false); props.onUpdate(task.id, { flagged: !task.flagged }) }}>
                {task.flagged ? 'Снять флаг' : 'Добавить флаг'}
              </button>
              <button onClick={() => { setMenuOpen(false); props.onMoveTop(task.id) }}>В начало колонки</button>
              <button onClick={() => { setMenuOpen(false); props.onMoveBottom(task.id) }}>В конец колонки</button>
              <button
                className="jcard-menu-danger"
                onClick={() => {
                  setMenuOpen(false)
                  void confirm({ title: `Удалить «${task.title}»?`, variant: 'danger', confirmLabel: 'Удалить' }).then((ok) => {
                    if (ok) props.onDelete(task.id)
                  })
                }}
              >
                Удалить
              </button>
            </div>
          )}
        </span>
      </div>

      {(task.flagged || epic || task.labels.length > 0 || task.skills.length > 0) && (
        <div className="jcard-chips">
          {task.flagged && <span className="jcard-flag" title="Помечена флагом">⚑ Флаг</span>}
          {epic && (
            <span className="jcard-epic" style={{ color: epicColor(epic.id) }} title={`Эпик: ${epic.title}`}>
              <span className="jcard-epic-dot" style={{ background: epicColor(epic.id) }} />
              {epic.title}
            </span>
          )}
          {task.labels.map((l) => (
            <span key={l} className="jcard-label">{l}</span>
          ))}
          {task.skills.map((s) => (
            <span key={`skill-${s}`} className="jcard-skill" title={`Навык: ${s}`}>{s}</span>
          ))}
        </div>
      )}


      {children.length > 0 && (
        <div className="jcard-progress" title={`Подзадачи: ${doneChildren.length} из ${children.length}`}>
          <span className="jcard-progress-bar">
            <span className="jcard-progress-fill" style={{ width: `${Math.round((doneChildren.length / children.length) * 100)}%` }} />
          </span>
          <span className="jcard-progress-text">{doneChildren.length}/{children.length}</span>
        </div>
      )}

      {task.type === 'task' && props.onStartMerge && canStartMerge({
        semanticType: props.columnSemanticType ?? 'custom',
        sourceBranch: task.mergeSourceBranch,
        alreadyMerged: isCurrentMergeSourceMerged({ sourceSha: task.mergeSourceSha, mergedSourceSha: task.mergedSourceSha, mergedSha: task.mergedSha }),
        hasActiveRun: Boolean(task.activeMergeRunId),
        permitted: task.mergePermitted,
        machineBound: task.mergeMachineBound
      }) && (
        <div className="jcard-ci" data-testid="task-merge-panel" onClick={(e) => e.stopPropagation()}>
          <Button variant="primary" size="sm" onClick={() => props.onStartMerge?.(task.id)}>Мерж в main</Button>
        </div>
      )}

      {task.type === 'task' && (props.onStartCi || visibleCiSummary) && (
        <div className="jcard-ci" data-testid="task-ci-panel" onClick={(e) => e.stopPropagation()}>
          {visibleCiSummary && (() => {
            const ciSummary = visibleCiSummary
            const tone = ciTone(ciSummary.status)
            return (
              <>
                <div className="jcard-ci-row">
                  <span className={`ci-lozenge ci-lozenge--${tone}`}>{ciStatusLabel(ciSummary.status)}</span>
                </div>
                {ciSummary.progress
                  ? <AutomationProgressView progress={ciSummary.progress} compact />
                  : <p className="jcard-ci-phase">{ciSummary.slotProgress.phase} {ciSummary.slotProgress.done}/{ciSummary.slotProgress.total}{ciSummary.durationMs != null ? ` · ${fmtDuration(ciSummary.durationMs)}` : ''}</p>}
                {ciSummary.latestAttempt?.status === 'cancelled' && (
                  <div className="jcard-ci-row">
                    <button className="jcard-ci-phase" onClick={() => props.onOpenCiRun?.(ciSummary.latestAttempt!.id)}>Последняя попытка отменена</button>
                  </div>
                )}
              </>
            )
          })()}
          <div className="jcard-ci-row">
            {ciSummary && (
              <Button
                size="sm"
                className={ciSummary.awaitingInput ? 'jcard-ci-attention' : undefined}
                onClick={() => props.onOpenCiRun?.(ciSummary.id)}
              >
                {ciSummary.awaitingInput ? 'Ответить модели' : 'Лента рана'}
              </Button>
            )}
            {ciSummary?.status === 'queued' && props.onDequeueCiRun && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  void confirm({
                    title: 'Убрать задачу из очереди?',
                    message: 'Ожидающий ран будет отменён, а задача вернётся в TODO.',
                    variant: 'danger',
                    confirmLabel: 'Убрать из очереди'
                  }).then((ok) => {
                    if (ok) props.onDequeueCiRun?.(ciSummary.id)
                  })
                }}
              >
                Убрать из очереди
              </Button>
            )}
            {/* Пока ран идёт, запускать нечего — остаётся только лента. После
                завершения (успех, падение, отмена) кнопка возвращается: с карточки
                всегда можно запустить задачу заново. */}
            {canStart && props.onStartCi && (
              <Button variant="primary" size="sm" onClick={() => props.onStartCi?.(task.id)}>Выполнить</Button>
            )}
            {canStart && props.onStartCiParallel && (
              <Button size="sm" title="Запустить сразу, мимо очереди — машина подберётся по загрузке" onClick={() => props.onStartCiParallel?.(task.id)}>Параллельно</Button>
            )}
          </div>
        </div>
      )}

      {/* Клавиатурный перенос иначе не найти: подсказка видна только скринридеру. */}
      <span className="vc-sr-only">Пробел — взять задачу для переноса</span>

      <div className="jcard-foot">
        <span className="jcard-foot-left">
          <TypeIcon type={task.type} />
          <span className={`jcard-key${done ? ' jcard-key--done' : ''}`}>{key}</span>
          {props.onOpenChat && (
            <Button
              variant="ghost"
              size="sm"
              className="jcard-chat"
              iconLeft={<span aria-hidden="true">💬</span>}
              title={task.chatId ? 'Открыть связанный чат' : 'Создать связанный чат'}
              aria-label="Связанный чат"
              onClick={(e) => {
                e.stopPropagation()
                props.onOpenChat?.(task.id)
              }}
            >
              Чат
            </Button>
          )}
        </span>

        <span className="jcard-foot-right">
          {task.dueDate != null && (
            <span className={`jcard-due jcard-due--${dueState(task.dueDate)}`} title="Срок">
              {fmtDue(task.dueDate)}
            </span>
          )}
          {task.storyPoints != null && <span className="jcard-pts" title="Стори-поинты">{task.storyPoints}</span>}
          <PriorityIcon priority={task.priority} />
          {task.assignee ? (
            <Avatar username={task.assignee} />
          ) : (
            <span className="javatar javatar--none" title="Не назначено">?</span>
          )}
        </span>
      </div>
    </div>
  )
}
