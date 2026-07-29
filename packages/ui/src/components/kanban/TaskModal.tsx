// Модалка задачи в стиле Jira: слева заголовок/описание/критерии/подзадачи,
// справа панель деталей (статус, исполнитель, метки, родитель, приоритет,
// стори-поинты, срок, флаг). Поля сохраняются по blur/change — как в Jira.

import { useEffect, useRef, useState } from 'react'
import type { Board, ProjectMember, Task, TaskPriority, WorkItemType } from '@shared/projects'
import { TASK_PRIORITIES } from '@shared/projects'
import type { FeatureRun } from '@shared/features'
import type { ModifierPrompt } from '@shared/types'
import { ToolFrame } from '../ToolFrame'
import { WandIcon } from '../icons'
import { PromptBuilder, type GenerateParams, type Suggestion } from '../prompt-builder/PromptBuilder'
import { applyNativeInputValue, useAiAssist } from '../prompt-builder/useAiAssist'
import { Avatar, PRIORITY_LABEL, TYPE_LABEL, TypeIcon, issueKey } from './kanbanMeta'

export interface TaskUpdateFields {
  title?: string
  description?: string
  acceptanceCriteria?: string
  type?: WorkItemType
  parentId?: string | null
  priority?: TaskPriority
  assignee?: string | null
  labels?: string[]
  storyPoints?: number | null
  dueDate?: number | null
  flagged?: boolean
}

export interface TaskModalProps {
  task: Task
  board: Board
  projectName: string
  members: ProjectMember[]
  feature?: FeatureRun
  onUpdate: (taskId: string, fields: TaskUpdateFields) => void
  onDelete: (taskId: string) => void
  /** Смена статуса = перенос в конец выбранной колонки. */
  onMoveToColumn: (taskId: string, columnId: string) => void
  onStartFeature?: (itemId: string, type: WorkItemType) => void
  onOpenFeature?: (featureId: string) => void
  aiAssistPrompts?: ModifierPrompt[]
  onAiAssistPromptsChange?: (next: ModifierPrompt[]) => void
  generateAiAssist?: (params: GenerateParams) => Promise<Suggestion[]>
  /** Открыть другую задачу в этой же модалке (подзадача/родитель). */
  onOpenTask: (taskId: string) => void
  onClose: () => void
}

function toDateInput(ms: number | null): string {
  if (ms == null) return ''
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function fromDateInput(v: string): number | null {
  if (!v) return null
  const [y, m, d] = v.split('-').map(Number)
  return new Date(y, m - 1, d, 12).getTime()
}

export function TaskModal(props: TaskModalProps): JSX.Element {
  const { task, board } = props
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [criteria, setCriteria] = useState(task.acceptanceCriteria)
  const [labelDraft, setLabelDraft] = useState('')
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const aiAssist = useAiAssist({
    value: description,
    onChange: (value) => {
      if (descriptionRef.current) applyNativeInputValue(descriptionRef.current, value)
      else setDescription(value)
      props.onUpdate(task.id, { description: value })
    },
    prompts: props.aiAssistPrompts ?? [],
    onPromptsChange: props.onAiAssistPromptsChange,
    generate: props.generateAiAssist ?? (async () => [])
  })
  const aiAssistEnabled = !!props.generateAiAssist

  // Переключение на другую задачу (подзадачу) — сбросить черновики полей.
  useEffect(() => {
    setTitle(task.title)
    setDescription(task.description)
    setCriteria(task.acceptanceCriteria)
    setLabelDraft('')
  }, [task.id, task.title, task.description, task.acceptanceCriteria])

  const column = board.columns.find((c) => c.id === task.columnId)
  const parent = task.parentId ? board.tasks.find((t) => t.id === task.parentId) : null
  const children = board.tasks.filter((t) => t.parentId === task.id)
  const key = issueKey(props.projectName, task)
  const parentOptions = board.tasks.filter((p) =>
    p.id !== task.id && (task.type === 'story' ? p.type === 'epic' : task.type === 'task' ? p.type === 'epic' || p.type === 'story' : false)
  )

  const commitTitle = (): void => {
    const t = title.trim()
    if (t && t !== task.title) props.onUpdate(task.id, { title: t })
    else setTitle(task.title)
  }

  const addLabel = (): void => {
    const l = labelDraft.trim()
    if (!l) return
    if (!task.labels.includes(l)) props.onUpdate(task.id, { labels: [...task.labels, l] })
    setLabelDraft('')
  }

  return (
    <>
    <ToolFrame
      title={`${TYPE_LABEL[task.type]} · ${key}`}
      onClose={() => {
        if (aiAssist.popupProps.open) aiAssist.popupProps.onClose()
        else props.onClose()
      }}
      testId="task-modal"
      className="jmodal-frame"
      actions={
        <>
          <button
            className="renbtn"
            title={task.flagged ? 'Снять флаг' : 'Добавить флаг'}
            onClick={() => props.onUpdate(task.id, { flagged: !task.flagged })}
          >
            {task.flagged ? '⚑ Снять флаг' : '⚑ Флаг'}
          </button>
          <button
            className="delbtn"
            aria-label="Удалить задачу"
            title="Удалить задачу"
            onClick={() => {
              if (window.confirm(`Удалить «${task.title}»?`)) {
                props.onDelete(task.id)
                props.onClose()
              }
            }}
          >
            🗑
          </button>
        </>
      }
    >
      <div className="jmodal">
        <div className="jmodal-main">
          {parent && (
            <button className="jmodal-breadcrumb" onClick={() => props.onOpenTask(parent.id)}>
              <TypeIcon type={parent.type} /> {issueKey(props.projectName, parent)} · {parent.title}
            </button>
          )}
          <textarea
            className="jmodal-title"
            aria-label="Заголовок задачи"
            value={title}
            rows={1}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitTitle()
              }
            }}
          />
          <h3 className="jmodal-h">Описание</h3>
          <div className="ai-assist-wrap jmodal-desc-wrap">
            <textarea
              ref={descriptionRef}
              data-ai-assist={aiAssistEnabled ? '' : undefined}
              className="login-input jmodal-desc"
              aria-label="Описание задачи"
              placeholder="Добавьте описание…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => {
                if (description !== task.description) props.onUpdate(task.id, { description })
              }}
            />
            {aiAssistEnabled && (
              <button className="ai-assist-trigger jmodal-ai-trigger" {...aiAssist.triggerProps}>
                <WandIcon />
              </button>
            )}
          </div>
          <h3 className="jmodal-h">Критерии приёмки</h3>
          <textarea
            className="login-input jmodal-desc"
            aria-label="Критерии приёмки"
            placeholder="Что должно быть выполнено…"
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            onBlur={() => {
              if (criteria !== task.acceptanceCriteria) props.onUpdate(task.id, { acceptanceCriteria: criteria })
            }}
          />
          {children.length > 0 && (
            <>
              <h3 className="jmodal-h">Подзадачи</h3>
              <ul className="jmodal-children">
                {children.map((ch) => {
                  const chCol = board.columns.find((c) => c.id === ch.columnId)
                  return (
                    <li key={ch.id}>
                      <button className="jmodal-child" onClick={() => props.onOpenTask(ch.id)}>
                        <TypeIcon type={ch.type} />
                        <span className="jmodal-child-key">{issueKey(props.projectName, ch)}</span>
                        <span className="jmodal-child-title">{ch.title}</span>
                        <span className="jmodal-child-status">{chCol?.name ?? '—'}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          {props.feature && (
            <button className="jcard-feature" onClick={() => props.onOpenFeature?.(props.feature!.id)}>
              Фича #{props.feature.attempt} · {props.feature.status}
            </button>
          )}
          {task.type !== 'epic' && props.onStartFeature && (!props.feature || ['completed', 'cancelled', 'failed'].includes(props.feature.status)) && (
            <button className="jcard-feature-start" onClick={() => props.onStartFeature?.(task.id, task.type)}>
              {props.feature ? (props.feature.status === 'failed' ? 'Повторить фичу' : 'Новая фича') : 'Запустить фичу'}
            </button>
          )}
        </div>

        <aside className="jmodal-side">
          <label className="jmodal-field">
            Статус
            <select
              className="sel"
              aria-label="Статус"
              value={task.columnId}
              onChange={(e) => props.onMoveToColumn(task.id, e.target.value)}
            >
              {board.columns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="jmodal-field">
            Исполнитель
            <span className="jmodal-assignee">
              {task.assignee && <Avatar username={task.assignee} size={20} />}
              <select
                className="sel"
                aria-label="Исполнитель"
                value={task.assignee ?? ''}
                onChange={(e) => props.onUpdate(task.id, { assignee: e.target.value || null })}
              >
                <option value="">Не назначен</option>
                {props.members.map((m) => (
                  <option key={m.username} value={m.username}>{m.username}</option>
                ))}
              </select>
            </span>
          </label>
          <div className="jmodal-field">
            Метки
            <span className="jmodal-labels">
              {task.labels.map((l) => (
                <span key={l} className="jcard-label">
                  {l}
                  <button
                    className="jlabel-x"
                    aria-label={`Убрать метку ${l}`}
                    title="Убрать метку"
                    onClick={() => props.onUpdate(task.id, { labels: task.labels.filter((x) => x !== l) })}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                className="login-input jlabel-input"
                aria-label="Новая метка"
                placeholder="+ метка"
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addLabel()
                }}
                onBlur={addLabel}
              />
            </span>
          </div>
          {task.type !== 'epic' && (
            <label className="jmodal-field">
              Родитель
              <select
                className="sel"
                aria-label="Родитель"
                value={task.parentId ?? ''}
                onChange={(e) => props.onUpdate(task.id, { parentId: e.target.value || null })}
              >
                <option value="">Без родителя</option>
                {parentOptions.map((p) => (
                  <option key={p.id} value={p.id}>{TYPE_LABEL[p.type]} · {p.title}</option>
                ))}
              </select>
            </label>
          )}
          <label className="jmodal-field">
            Приоритет
            <select
              className="sel"
              aria-label="Приоритет"
              value={task.priority}
              onChange={(e) => props.onUpdate(task.id, { priority: e.target.value as TaskPriority })}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
              ))}
            </select>
          </label>
          <label className="jmodal-field">
            Стори-поинты
            <input
              className="login-input"
              aria-label="Стори-поинты"
              type="number"
              min="0"
              step="0.5"
              defaultValue={task.storyPoints ?? ''}
              key={`pts-${task.id}-${task.storyPoints}`}
              onBlur={(e) => {
                const v = e.target.value === '' ? null : Number(e.target.value)
                if (v !== task.storyPoints) props.onUpdate(task.id, { storyPoints: v })
              }}
            />
          </label>
          <label className="jmodal-field">
            Срок
            <input
              className="login-input"
              aria-label="Срок"
              type="date"
              value={toDateInput(task.dueDate)}
              onChange={(e) => props.onUpdate(task.id, { dueDate: fromDateInput(e.target.value) })}
            />
          </label>
          <p className="jmodal-dates">
            Статус: {column?.name ?? '—'}
            <br />Создано: {new Date(task.createdAt).toLocaleDateString('ru')}
            <br />Обновлено: {new Date(task.updatedAt).toLocaleDateString('ru')}
          </p>
        </aside>
      </div>
    </ToolFrame>
    <PromptBuilder {...aiAssist.popupProps} />
    </>
  )
}
