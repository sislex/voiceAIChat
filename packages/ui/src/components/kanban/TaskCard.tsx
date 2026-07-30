// Карточка задачи в стиле Jira: заголовок, чип эпика, метки, флаг, прогресс
// подзадач, снизу — иконка типа + ключ, срок, стори-поинты, приоритет, аватар.
// Клик — открывает модалку задачи; меню «⋯» — быстрые действия.

import { useEffect, useRef, useState } from 'react'
import type { Task } from '@shared/projects'
import { ciCardPulse, isActiveCiStatus, type CiRunSummary } from '@shared/ci'
import { ciStatusLabel, ciTone, fmtDuration } from '../ci/ciFormat'
import { Avatar, PriorityIcon, TypeIcon, dueState, epicColor, fmtDue, issueKey } from './kanbanMeta'

export interface TaskCardProps {
  task: Task
  projectName: string
  /** Все задачи доски — для чипа эпика и прогресса подзадач. */
  allTasks: Task[]
  /** Колонки со смыслом «done» — для прогресса и зачёркивания ключа. */
  doneColumnIds: ReadonlySet<string>
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
  /** Открыть ленту рана. */
  onOpenCiRun?: (runId: string) => void

  onDragStart: (taskId: string) => void
  onDragEnd: () => void
  dragging: boolean
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
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Меню закрывается кликом мимо него.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  // Состояние последнего рана: подсветка карточки и блокировка повторного запуска.
  const pulse = ciCardPulse(ciSummary)
  const ciActive = ciSummary != null && isActiveCiStatus(ciSummary.status)

  const epic = epicOf(task, props.allTasks)
  const children = props.allTasks.filter((t) => t.parentId === task.id)
  const doneChildren = children.filter((t) => props.doneColumnIds.has(t.columnId))
  const done = props.doneColumnIds.has(task.columnId)
  const key = issueKey(props.projectName, task)

  return (
    <div
      className={`jcard${task.flagged ? ' jcard--flagged' : ''}${pulse ? ` jcard--ci-${pulse}` : ''}${props.dragging ? ' dragging' : ''}`}
      draggable
      data-testid="task-card"
      onClick={() => props.onOpen(task.id)}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-task', task.id)
        e.dataTransfer.effectAllowed = 'move'
        props.onDragStart(task.id)
      }}
      onDragEnd={props.onDragEnd}
    >
      <div className="jcard-top">
        <span className="jcard-title">{task.title}</span>
        <span className="jcard-menuwrap" ref={menuRef}>
          <button
            className="jcard-menubtn"
            aria-label={`Действия с «${task.title}»`}
            title="Действия"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((v) => !v)
            }}
          >
            ⋯
          </button>
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
                  if (window.confirm(`Удалить «${task.title}»?`)) props.onDelete(task.id)
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

      {task.type === 'task' && (props.onStartCi || ciSummary) && (
        <div className="jcard-ci" data-testid="task-ci-panel" onClick={(e) => e.stopPropagation()}>
          {ciSummary && (() => {
            const tone = ciTone(ciSummary.status)
            const fillMod = tone === 'success' ? ' jcard-ci-fill--success' : tone === 'removed' ? ' jcard-ci-fill--removed' : ''
            const total = ciSummary.slotProgress.total || 1
            const pct = ciSummary.status === 'success' ? 100 : Math.round((ciSummary.slotProgress.done / total) * 100)
            return (
              <>
                <div className="jcard-ci-row">
                  <span className={`ci-lozenge ci-lozenge--${tone}`}>{ciStatusLabel(ciSummary.status)}</span>
                  <span className="jcard-ci-phase">{ciSummary.slotProgress.phase} {ciSummary.slotProgress.done}/{ciSummary.slotProgress.total}</span>
                  {ciSummary.durationMs != null && <span className="jcard-ci-phase">{fmtDuration(ciSummary.durationMs)}</span>}
                </div>
                <div className="jcard-ci-row">
                  <span className="jcard-ci-bar"><span className={`jcard-ci-fill${fillMod}`} style={{ width: `${pct}%` }} /></span>
                </div>
              </>
            )
          })()}
          <div className="jcard-ci-row">
            {ciSummary && (
              <button
                className={`jcard-ci-open${ciSummary.awaitingInput ? ' jcard-ci-open--attention' : ''}`}
                onClick={() => props.onOpenCiRun?.(ciSummary.id)}
              >
                {ciSummary.awaitingInput ? 'Ответить модели' : 'Лента рана'}
              </button>
            )}
            {/* Пока ран идёт, запускать нечего — остаётся только лента. */}
            {!ciActive && props.onStartCi && (
              <button className="jcard-ci-run" onClick={() => props.onStartCi?.(task.id)}>Выполнить</button>
            )}
          </div>
        </div>
      )}

      <div className="jcard-foot">
        <span className="jcard-foot-left">
          <TypeIcon type={task.type} />
          <span className={`jcard-key${done ? ' jcard-key--done' : ''}`}>{key}</span>
          {props.onOpenChat && (
            <button
              className={`jcard-chat${task.chatId ? ' jcard-chat--linked' : ''}`}
              title={task.chatId ? 'Открыть связанный чат' : 'Создать связанный чат'}
              aria-label="Связанный чат"
              onClick={(e) => {
                e.stopPropagation()
                props.onOpenChat?.(task.id)
              }}
            >
              <span aria-hidden="true">💬</span>
              <span>Чат</span>
            </button>
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
