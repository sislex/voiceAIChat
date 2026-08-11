// Модалка задачи в стиле Jira: слева заголовок/описание/критерии/подзадачи,
// справа панель деталей (статус, исполнитель, метки, родитель, приоритет,
// стори-поинты, срок, флаг). Поля сохраняются по blur/change — как в Jira.
//
// Описание — маркдаун: по умолчанию оно отрисовано (заголовки, списки, код), а
// правится по кнопке «Изменить» полем на 10 строк. Остальные поля правятся на
// месте, как и раньше.
//
// На телефоне раскладка — как в мобильной Jira: карточка на весь экран, статус и
// исполнитель сразу под заголовком, остальные поля — в свёрнутой секции
// «Подробности», а действия шапки (чат, флаг, удаление) — в ⋯-меню. Разметка
// разная, поэтому ширина проверяется через useMediaQuery, а не только в CSS.

import { useEffect, useRef, useState } from 'react'
import type { Board, ProjectMember, Task, TaskPriority, WorkItemType } from '@shared/projects'
import { TASK_PRIORITIES } from '@shared/projects'
import type { ModifierPrompt } from '@shared/types'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { IconButton } from '../ui/IconButton'
import { Markdown } from '../Markdown'
import { useConfirm } from '../ui/useConfirm'
import { WandIcon } from '../icons'
import { PromptBuilder, type GenerateParams, type Suggestion } from '../prompt-builder/PromptBuilder'
import { applyNativeInputValue, useAiAssist } from '../prompt-builder/useAiAssist'
import { Avatar, PRIORITY_LABEL, TYPE_LABEL, TypeIcon, issueKey } from './kanbanMeta'
import { CiTaskSettings } from '../ci/CiTaskSettings'
import { FeaturePreviewSection } from '../preview/FeaturePreviewSection'
import { ManualQaPanel } from '../qa/ManualQaPanel'
import { KbUsageBrief } from '../kb/KbUsageBrief'
import { CiReport } from '../ci/CiReport'
import { useRemoteReport } from '../../lib/useRemoteReport'
import { ciStatusLabel, ciTone, fmtDuration } from '../ci/ciFormat'
import { canStartCiRun, isActiveCiStatus, type CiRunSummary, type CiTaskReport } from '@shared/ci'
import { canStartMerge } from '@shared/merge'
import { MOBILE_QUERY, useMediaQuery } from '../../lib/mediaQuery'
import { useAutoGrow } from '../../lib/autoGrow'

export interface TaskUpdateFields {
  title?: string
  description?: string
  acceptanceCriteria?: string
  type?: WorkItemType
  parentId?: string | null
  priority?: TaskPriority
  assignee?: string | null
  labels?: string[]
  skills?: string[]
  storyPoints?: number | null
  dueDate?: number | null
  flagged?: boolean
}


export interface TaskModalProps {
  task: Task
  board: Board
  projectName: string
  members: ProjectMember[]
  onUpdate: (taskId: string, fields: TaskUpdateFields) => void
  onDelete: (taskId: string) => void
  /** Открыть связанный с задачей чат (кнопка в шапке модалки). */
  onOpenChat?: (taskId: string) => void
  /**
   * Создать связанный чат, не уходя с доски. Зовётся при первом открытии
   * карточки задачи, чтобы у неё сразу был чат (идемпотентно на сервере).
   */
  onEnsureChat?: (taskId: string) => void
  /** Сводка последнего CI-рана задачи и переходы в его ленту. */
  ciSummary?: CiRunSummary
  onStartCi?: (taskId: string) => void
  /** Параллельный запуск: сразу в работу, мимо очереди сервера. */
  onStartCiParallel?: (taskId: string) => void
  onOpenCiRun?: (runId: string) => void
  onStartMerge?: (taskId: string) => void

  /** Смена статуса = перенос в конец выбранной колонки. */
  onMoveToColumn: (taskId: string, columnId: string) => void
  aiAssistPrompts?: ModifierPrompt[]
  onAiAssistPromptsChange?: (next: ModifierPrompt[]) => void
  generateAiAssist?: (params: GenerateParams) => Promise<Suggestion[]>
  /** Открыть другую задачу в этой же модалке (подзадача/родитель). */
  onOpenTask: (taskId: string) => void
  onClose: () => void
  /** Focused editable field, for synchronized assistant context. */
  onSelectedFieldChange?: (field: keyof TaskUpdateFields | null) => void
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
  const confirm = useConfirm()
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [criteria, setCriteria] = useState(task.acceptanceCriteria)
  const [labelDraft, setLabelDraft] = useState('')
  const [skillDraft, setSkillDraft] = useState('')
  const [activeTab, setActiveTab] = useState<'general' | 'qa' | 'auto' | 'settings' | 'preview' | 'machine' | 'model' | 'chat'>('general')
  const [autoTab, setAutoTab] = useState<'development' | 'testing' | 'qa_create' | 'summary' | 'report' | 'kb_usage' | 'kb_updates'>('development')
  // Описание: просмотр (маркдаун) ↔ правка (textarea на 10 строк по кнопке).
  const [descEditing, setDescEditing] = useState(false)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const descWrapRef = useRef<HTMLDivElement>(null)
  // Заголовок растёт под текст: на узком экране он занимает три-четыре строки, а
  // rows={1} со скроллом внутри поля прятал бы его конец.
  const titleGrow = useAutoGrow(title, 1, 6)

  const mobile = useMediaQuery(MOBILE_QUERY)
  // «Подробности»: на телефоне свёрнуты, на десктопе это всегда открытая колонка.
  const [detailsOpen, setDetailsOpen] = useState(!mobile)
  useEffect(() => { setDetailsOpen(!mobile) }, [mobile])

  // ⋯-меню действий в шапке (только на телефоне): закрывается кликом мимо него.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])
  useEffect(() => { if (!mobile) setMenuOpen(false) }, [mobile])

  // Правка открылась — курсор в конец текста: описание обычно дописывают.
  useEffect(() => {
    if (!descEditing) return
    const el = descriptionRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [descEditing])

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
    setDescEditing(false)
    setLabelDraft('')
    setSkillDraft('')
    setActiveTab('general')
  }, [task.id, task.title, task.description, task.acceptanceCriteria])


  // Чат к задаче создаётся сам при первом открытии карточки: дальше в него
  // дублируются вопросы модели из CI-рана.
  const ensureChat = props.onEnsureChat
  useEffect(() => {
    if (task.type === 'task' && !task.chatId && ensureChat) ensureChat(task.id)
  }, [task.id, task.type, task.chatId, ensureChat])

  // Использование БЗ — агрегат по ВСЕМ ранам задачи. Перечитываем, когда
  // меняется статус последнего рана: только что закончившийся ран добавил свои
  // обращения, и цифры в карточке обязаны это показать.
  const kbUsage = useRemoteReport(
    () => (task.type === 'task' ? window.ci?.getTaskKbUsage(task.projectId, task.id) : undefined),
    [task.id, task.projectId, task.type, props.ciSummary?.status]
  )
  // Отчёт по расходу — только когда ран задачи завершён: пока он идёт, цифры
  // меняются на глазах, и смотреть надо ленту, а не итог. Перечитываем по тому
  // же ключу, что и БЗ: закончившийся ран добавил свои ходы.
  const ciFinished = props.ciSummary != null && !isActiveCiStatus(props.ciSummary.status)
  const ciReport = useRemoteReport<CiTaskReport>(
    () => (task.type === 'task' && ciFinished ? window.ci?.getTaskReport(task.projectId, task.id) : undefined),
    [task.id, task.projectId, task.type, ciFinished, props.ciSummary?.status]
  )

  const column = board.columns.find((c) => c.id === task.columnId)
  // Пока ран задачи идёт запуск недоступен; в семантическом «Готово» новый
  // запуск также запрещён — задача завершена, даже если старый ран терминальный.
  const canStartCi = column?.semanticType !== 'done' && canStartCiRun(props.ciSummary)
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

  const startDescEdit = (): void => setDescEditing(true)

  const commitDescription = (): void => {
    if (description !== task.description) props.onUpdate(task.id, { description })
    setDescEditing(false)
  }

  const cancelDescEdit = (): void => {
    setDescription(task.description)
    setDescEditing(false)
  }

  // Запрос на закрытие карточки (Esc, крестик, клик по фону). Esc своим
  // обработчиком в поле не поймать — стек окон гасит событие на window в фазе
  // перехвата, поэтому открытая правка описания отвечает на него здесь: Esc
  // возвращает её в просмотр, а карточку закроет уже следующий. Крестика и
  // клика по фону это не касается — они сперва уводят фокус из поля, и правка
  // успевает закрыться сохранением (onBlur описания) до этой проверки.
  const requestClose = (): void => {
    if (descEditing) {
      cancelDescEdit()
      return
    }
    props.onClose()
  }

  const addLabel = (): void => {
    const l = labelDraft.trim()
    if (!l) return
    if (!task.labels.includes(l)) props.onUpdate(task.id, { labels: [...task.labels, l] })
    setLabelDraft('')
  }

  const addSkill = (): void => {
    const s = skillDraft.trim()
    if (!s) return
    if (!task.skills.includes(s)) props.onUpdate(task.id, { skills: [...task.skills, s] })
    setSkillDraft('')
  }

  const toggleFlag = (): void => props.onUpdate(task.id, { flagged: !task.flagged })

  const confirmDelete = async (): Promise<void> => {
    if (!(await confirm({ title: `Удалить «${task.title}»?`, variant: 'danger', confirmLabel: 'Удалить' }))) return
    props.onDelete(task.id)
    props.onClose()
  }

  // Статус и исполнитель: на телефоне — строкой под заголовком (как в Jira),
  // на десктопе — первыми полями правой панели. Разметка одна, место разное.
  const statusField = (
    <label className="jmodal-field jmodal-field--status">
      Статус
      <select
        className="sel jmodal-status"
        aria-label="Статус"
        value={task.columnId}
        onChange={(e) => props.onMoveToColumn(task.id, e.target.value)}
      >
        {board.columns.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </label>
  )

  const assigneeField = (
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
  )

  const headActions = mobile ? (
    <span className="jmodal-menuwrap" ref={menuRef}>
      <IconButton
        aria-label="Действия с задачей"
        title="Действия"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        ⋯
      </IconButton>
      {menuOpen && (
        <div className="jcard-menu jmodal-menu">
          {props.onOpenChat && (
            <button onClick={() => { setMenuOpen(false); props.onOpenChat?.(task.id) }}>
              💬 {task.chatId ? 'Открыть чат' : 'Создать чат'}
            </button>
          )}
          <button onClick={() => { setMenuOpen(false); toggleFlag() }}>
            {task.flagged ? '⚑ Снять флаг' : '⚑ Флаг'}
          </button>
          <button className="jcard-menu-danger" onClick={() => { setMenuOpen(false); void confirmDelete() }}>
            🗑 Удалить задачу
          </button>
        </div>
      )}
    </span>
  ) : (
    <>
      {props.onOpenChat && (
        <Button
          variant="ghost"
          size="sm"
          className="jmodal-chat-action"
          iconLeft={<span aria-hidden="true">💬</span>}
          title="Открыть связанный чат"
          onClick={() => props.onOpenChat?.(task.id)}
        >
          {task.chatId ? 'Открыть чат' : 'Создать чат'}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        iconLeft={<span aria-hidden="true">⚑</span>}
        title={task.flagged ? 'Снять флаг' : 'Добавить флаг'}
        onClick={toggleFlag}
      >
        {task.flagged ? 'Снять флаг' : 'Флаг'}
      </Button>

      <IconButton
        size="sm"
        aria-label="Удалить задачу"
        title="Удалить задачу"
        onClick={() => void confirmDelete()}
      >
        🗑
      </IconButton>
    </>
  )

  return (
    <>
    {/* Esc и клик по фону — забота Dialog. Пока сверху открыт AI-помощник, карточка
        их не получает: окна лежат в общем стеке (useDialogStack). Своего слушателя
        Esc у карточки нет — запрос на закрытие приходит в requestClose. */}
    <Dialog
      title={`${TYPE_LABEL[task.type]} · ${key}`}
      size="lg"
      onClose={props.onClose}
      onEscape={requestClose}
      testId="task-modal"
      className="jmodal-frame"
      actions={headActions}
    >
      <nav className="task-tabs" role="tablist" aria-label="Разделы карточки">
        {([['general','Общее'],['qa','Ручное QA'],['auto','Автошаги'],['settings','Настройки'],['preview','Тестовое окружение'],['machine','Машина выполнения'],['model','Движок модели'],['chat','Чат']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={activeTab === id} className={activeTab === id ? 'task-tab task-tab--active' : 'task-tab'} onClick={() => setActiveTab(id)}>{label}</button>
        ))}
      </nav>
      <div className={`jmodal jmodal--tab-${activeTab}`} onFocusCapture={(event) => {
        const label = (event.target as HTMLElement).getAttribute('aria-label') ?? ''
        const field: keyof TaskUpdateFields | null = label.includes('Заголовок') ? 'title' : label.includes('Описание') ? 'description' : label.includes('Критерии') ? 'acceptanceCriteria' : label.includes('Приоритет') ? 'priority' : label.includes('Исполнитель') ? 'assignee' : label.includes('Стори') ? 'storyPoints' : label.includes('Срок') ? 'dueDate' : null
        props.onSelectedFieldChange?.(field)
      }}>
        <div className="jmodal-main">
          {props.onStartMerge && canStartMerge({ semanticType: board.columns.find((column) => column.id === task.columnId)?.semanticType ?? 'custom', sourceBranch: task.mergeSourceBranch, alreadyMerged: Boolean(task.mergedSha), hasActiveRun: Boolean(task.activeMergeRunId), permitted: task.mergePermitted, machineBound: task.mergeMachineBound }) && (
            <Button variant="primary" onClick={() => props.onStartMerge?.(task.id)}>Мерж в main</Button>
          )}
          {parent && (
            <button className="jmodal-breadcrumb" onClick={() => props.onOpenTask(parent.id)}>
              <TypeIcon type={parent.type} /> {issueKey(props.projectName, parent)} · {parent.title}
            </button>
          )}
          <textarea
            className="jmodal-title"
            aria-label="Заголовок задачи"
            ref={titleGrow}
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
          {mobile && (
            <div className="jmodal-quick" data-testid="task-modal-quick">
              {statusField}
              {assigneeField}
            </div>
          )}
          <div className="jmodal-desc-head">
            <h3 className="jmodal-h">Описание</h3>
            {!descEditing && (
              <IconButton
                size="sm"
                className="jmodal-desc-edit"
                aria-label="Изменить описание"
                title="Изменить описание"
                data-testid="task-desc-edit"
                onClick={startDescEdit}
              >
                ✏️
              </IconButton>
            )}
          </div>
          {descEditing ? (
            // Ровно 10 строк, без useAutoGrow: описание длинное, и поле, растущее
            // под текст, увозило бы критерии приёмки и подзадачи за экран.
            <div className="ai-assist-wrap jmodal-desc-wrap" ref={descWrapRef}>
              <textarea
                ref={descriptionRef}
                data-ai-assist={aiAssistEnabled ? '' : undefined}
                className="login-input jmodal-desc"
                aria-label="Описание задачи"
                placeholder="Добавьте описание…"
                rows={10}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={(e) => {
                  // Уход на «Сохранить», «Отмена» или палочку AI — не уход из
                  // правки: иначе blur записал бы черновик раньше их клика (а по
                  // «Отмене» — вопреки ему).
                  if (e.relatedTarget && descWrapRef.current?.contains(e.relatedTarget)) return
                  commitDescription()
                }}
              />
              {aiAssistEnabled && (
                <button className="ai-assist-trigger jmodal-ai-trigger" {...aiAssist.triggerProps}>
                  <WandIcon />
                </button>
              )}
              <div className="jmodal-desc-actions">
                <Button size="sm" variant="primary" onClick={commitDescription}>Сохранить</Button>
                <Button size="sm" onClick={cancelDescEdit}>Отмена</Button>
              </div>
            </div>
          ) : description.trim() ? (
            <div className="jmodal-desc-view" data-testid="task-desc-view">
              <Markdown>{description}</Markdown>
            </div>
          ) : (
            <button className="jmodal-desc-empty" data-testid="task-desc-empty" onClick={startDescEdit}>
              Добавьте описание…
            </button>
          )}
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
          {task.type === 'task' && <ManualQaPanel projectId={task.projectId} taskId={task.id} />}
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
        </div>

        <aside className="jmodal-side">
          {mobile && (
            <button
              className="jmodal-side-toggle"
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen((v) => !v)}
            >
              <span className="jmodal-side-caret" aria-hidden>{detailsOpen ? '▾' : '▸'}</span>
              Подробности
            </button>
          )}
          {(!mobile || detailsOpen) && (
            <div className="jmodal-side-fields" data-testid="task-modal-details">
              {!mobile && statusField}
              {!mobile && assigneeField}
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
              <div className="jmodal-field">
                Навыки
                <span className="jmodal-labels jmodal-skills">
                  {task.skills.map((s) => (
                    <span key={s} className="jcard-skill">
                      {s}
                      <button
                        className="jlabel-x"
                        aria-label={`Убрать навык ${s}`}
                        title="Убрать навык"
                        onClick={() => props.onUpdate(task.id, { skills: task.skills.filter((x) => x !== s) })}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    className="login-input jlabel-input"
                    aria-label="Новый навык"
                    placeholder="+ навык"
                    value={skillDraft}
                    onChange={(e) => setSkillDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addSkill()
                    }}
                    onBlur={addSkill}
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
            </div>
          )}
          {task.type === 'task' && (props.onStartCi || props.ciSummary) && (
            <div className="jmodal-ci" data-testid="task-modal-ci">
              <div className="jmodal-ci-head">
                <span className="ci-task-title">CI-ран</span>
                {props.ciSummary && (
                  <span className={`lozenge ci-lozenge--${ciTone(props.ciSummary.status)}`}>{ciStatusLabel(props.ciSummary.status)}</span>
                )}
              </div>
              {props.ciSummary && (
                <p className="jcard-ci-phase">
                  {props.ciSummary.slotProgress.phase} {props.ciSummary.slotProgress.done}/{props.ciSummary.slotProgress.total}
                  {props.ciSummary.durationMs != null ? ` · ${fmtDuration(props.ciSummary.durationMs)}` : ''}
                </p>
              )}
              <div className="jmodal-ci-actions">
                {props.ciSummary && props.onOpenCiRun && (
                  <Button
                    size="sm"
                    className={props.ciSummary.awaitingInput ? 'jcard-ci-attention' : undefined}
                    onClick={() => props.onOpenCiRun?.(props.ciSummary!.id)}
                  >
                    {props.ciSummary.awaitingInput ? 'Ответить модели' : 'Лента рана'}
                  </Button>
                )}
                {/* Активный ран нельзя запустить второй раз — только смотреть ленту;
                    после завершения «Выполнить» снова доступна. */}
                {props.onStartCi && canStartCi && (
                  <Button variant="primary" size="sm" onClick={() => props.onStartCi?.(task.id)}>Выполнить</Button>
                )}
                {props.onStartCiParallel && canStartCi && (
                  <Button size="sm" title="Запустить сразу, мимо очереди — машина подберётся по загрузке" onClick={() => props.onStartCiParallel?.(task.id)}>Параллельно</Button>
                )}
              </div>
            </div>
          )}
          {task.type === 'task' && ciFinished && (
            <CiReport
              report={ciReport.report}
              loading={ciReport.loading}
              error={ciReport.error}
              onOpenRun={props.onOpenCiRun}
              testId="task-modal-report"
            />
          )}
          {task.type === 'task' && kbUsage.report && (
            <KbUsageBrief
              title="Использование БЗ"
              note={kbUsage.report.runs ? `по ${kbUsage.report.runs} ранам задачи` : 'по ранам задачи'}
              totals={kbUsage.report.totals}
              sections={kbUsage.report.sections}
              loading={kbUsage.loading}
              error={kbUsage.error}
              testId="task-modal-kb-usage"
            />
          )}
          {task.type === 'task' && <FeaturePreviewSection projectId={task.projectId} taskId={task.id} />}
          <CiTaskSettings projectId={task.projectId} taskId={task.id} />
        </aside>
        {activeTab === 'qa' && <section className="task-tab-panel"><ManualQaPanel projectId={task.projectId} taskId={task.id} /></section>}
        {activeTab === 'auto' && <section className="task-tab-panel">
          <nav className="task-subtabs" role="tablist" aria-label="Автоматические этапы">
            {([['development','Разработка'],['testing','Тестирование'],['qa_create','Создание ручного QA'],['summary','Резюме'],['report','Отчёт'],['kb_usage','Использование БЗ'],['kb_updates','Обновлённые разделы БЗ']] as const).map(([id,label]) => <button key={id} role="tab" aria-selected={autoTab === id} className={autoTab === id ? 'task-tab task-tab--active' : 'task-tab'} onClick={() => setAutoTab(id)}>{label}</button>)}
          </nav>
          {autoTab === 'report' && <CiReport report={ciReport.report} loading={ciReport.loading} error={ciReport.error} onOpenRun={props.onOpenCiRun} />}
          {autoTab === 'kb_usage' && kbUsage.report && <KbUsageBrief title="Использование БЗ" totals={kbUsage.report.totals} sections={kbUsage.report.sections} loading={kbUsage.loading} error={kbUsage.error} />}
          {autoTab === 'kb_updates' && <p className="task-tab-empty">Обновлённые разделы БЗ появятся после завершения рана.</p>}
          {!['report','kb_usage','kb_updates'].includes(autoTab) && <p className="task-tab-empty">Выберите исторический ран в ленте, чтобы увидеть статус, время, модель, результат, ошибки и журнал этапа «{autoTab}».</p>}
        </section>}
        {activeTab === 'settings' && <section className="task-tab-panel"><CiTaskSettings projectId={task.projectId} taskId={task.id} /></section>}
        {activeTab === 'preview' && <section className="task-tab-panel"><FeaturePreviewSection projectId={task.projectId} taskId={task.id} /></section>}
        {activeTab === 'machine' && <section className="task-tab-panel"><h3>Машина выполнения</h3><p>{task.agentId ? `Выбрана машина ${task.agentId}` : 'Машина проекта по умолчанию'}</p>{task.mergeMachineBound === false && <p className="task-tab-warning">Машина не привязана к проекту. Запуск merge заблокирован.</p>}</section>}
        {activeTab === 'model' && <section className="task-tab-panel"><h3>Движок модели</h3><p>Эффективная конфигурация и override задачи задаются ниже.</p><CiTaskSettings projectId={task.projectId} taskId={task.id} /></section>}
        {activeTab === 'chat' && <section className="task-tab-panel"><h3>Чат задачи</h3><p>Открывается существующий связанный разговор; повторное открытие не создаёт дубликат.</p><Button variant="primary" onClick={() => props.onOpenChat?.(task.id)}>Открыть чат</Button>{task.activeMergeStatus && <p>Merge-ран: {task.activeMergeStatus}</p>}</section>}
      </div>
    </Dialog>
    <PromptBuilder {...aiAssist.popupProps} />
    </>
  )
}
