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

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Board, ProjectMember, Task, TaskPriority, WorkItemType } from '@shared/projects'
import { normalizeAcceptanceCriteria, TASK_PRIORITIES } from '@shared/projects'
import type { ModifierPrompt } from '@shared/types'
import { Button } from '@voicechat/ui-kit'
import { Dialog } from '@voicechat/ui-kit'
import { IconButton } from '@voicechat/ui-kit'
import { Markdown } from '../Markdown'
import { useConfirm } from '@voicechat/ui-kit'
import { WandIcon } from '../icons'
import { PromptBuilder, type GenerateParams, type Suggestion } from '../prompt-builder/PromptBuilder'
import { applyNativeInputValue, useAiAssist } from '../prompt-builder/useAiAssist'
import { Avatar, PRIORITY_LABEL, TYPE_LABEL, TypeIcon, issueKey } from './kanbanMeta'
import { CiTaskSettings } from '../ci/CiTaskSettings'
import { FeaturePreviewSection } from '../preview/FeaturePreviewSection'
import { ManualQaPanel } from '../qa/ManualQaPanel'
import { QaStageRunPanel } from '../qa/QaStageRunPanel'
import type { AnyQaStageRun, QaRunStage } from '@shared/qa'
import { ComponentQaPanel } from '../qa/ComponentQaPanel'
import { KbUsageBrief } from '../kb/KbUsageBrief'
import { CiReport } from '../ci/CiReport'
import { MergePanel } from '../ci/MergePanel'
import { TaskRunFeed } from '../ci/TaskRunFeed'
import { TaskPreparationTab } from './TaskPreparationTab'
import type { TaskPreparationRun } from '@shared/qa'
import { useRemoteReport } from '../../lib/useRemoteReport'
import { ciStatusLabel, ciTone, fmtDuration } from '../ci/ciFormat'
import { canStartCiRun, isActiveCiStatus, type CiRunSummary, type CiTaskReport } from '@shared/ci'
import { AutomationProgressView } from './AutomationProgressView'
import { canStartMerge, isCurrentMergeSourceMerged } from '@shared/merge'
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
  onStartCi?: (taskId: string) => void | Promise<void>
  onStartPreparation?: (taskId: string) => void | Promise<void>
  initialTab?: 'preparation'
  loadPreparationRuns?: (taskId: string) => Promise<TaskPreparationRun[]>
  onRetryPreparation?: (runId: string) => Promise<TaskPreparationRun | void>
  onCancelPreparation?: (runId: string) => Promise<TaskPreparationRun | void>
  /** Параллельный запуск: сразу в работу, мимо очереди сервера. */
  onStartCiParallel?: (taskId: string) => void | Promise<void>
  onOpenCiRun?: (runId: string) => void
  onStartMerge?: (taskId: string, agentId?: string | null) => void

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
  /** Черновик новой задачи: карточка ничего не сохраняет до выбора действия. */
  draft?: boolean
  /** Действия создания, показанные в стандартной нижней панели карточки. */
  footer?: ReactNode
  /** Дополнительные проектные настройки черновика (например, движок и модель). */
  detailsExtra?: ReactNode
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
  const [launching, setLaunching] = useState<'queue' | 'parallel' | null>(null)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [criteria, setCriteria] = useState(() => normalizeAcceptanceCriteria(task.acceptanceCriteria))
  const [labelDraft, setLabelDraft] = useState('')
  const [skillDraft, setSkillDraft] = useState('')
  type TaskTab = 'general' | 'settings' | 'component_qa' | 'integration_tests' | 'automated_qa' | 'qa' | 'progress' | 'merge' | 'feed' | 'preparation'
  type ProgressTab = 'overview' | 'checks' | 'changes' | 'kb' | 'delivery' | 'resources'
  const preparationVisible = task.type === 'task' && ['backlog', 'preparation', 'ready'].includes(board.columns.find((item) => item.id === task.columnId)?.semanticType ?? '') && Boolean(task.taskPreparationRunId || task.taskPreparationStatus === 'running')
  const defaultTab = (): TaskTab => {
    if (task.taskPreparationStatus === 'running' || (props.initialTab === 'preparation' && preparationVisible)) return 'preparation'
    const stage = board.columns.find((item) => item.id === task.columnId)?.semanticType
    if (stage === 'component_qa' || stage === 'integration_tests' || stage === 'automated_qa') return stage
    return (props.ciSummary && isActiveCiStatus(props.ciSummary.status)) || task.activeMergeRunId ? 'feed' : 'general'
  }
  const [activeTab, setActiveTab] = useState<TaskTab>(defaultTab)
  const [progressTab, setProgressTab] = useState<ProgressTab>('overview')
  // Управляется только пользователем и живёт до закрытия карточки; обновления
  // ciSummary/отчёта не меняют раскрытие блока работы модели.
  const [modelWorkOpen, setModelWorkOpen] = useState(false)
  const [qaStageRuns, setQaStageRuns] = useState<Partial<Record<QaRunStage, AnyQaStageRun[]>>>({})
  useEffect(() => {
    if (props.draft || task.type !== 'task' || !window.qa?.listStageRuns) return
    let live = true
    void Promise.all((['component_qa','integration_tests','automated_qa'] as QaRunStage[]).map(async (stage) => [stage, await window.qa!.listStageRuns!(task.projectId, task.id, stage)] as const)).then((entries) => {
      if (!live) return
      const next = Object.fromEntries(entries) as Partial<Record<QaRunStage, AnyQaStageRun[]>>
      setQaStageRuns(next)
      const active = entries.find(([, runs]) => runs.some((run) => ['queued','running','awaiting_input'].includes(run.status)))
      if (active) setActiveTab(active[0])
    }).catch(() => {})
    return () => { live = false }
  }, [task.id])
  // Описание: просмотр (маркдаун) ↔ правка (textarea на 10 строк по кнопке).
  const [descEditing, setDescEditing] = useState(false)
  const [criteriaEditing, setCriteriaEditing] = useState(false)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const criteriaRef = useRef<HTMLTextAreaElement>(null)
  const descWrapRef = useRef<HTMLDivElement>(null)
  // Заголовок растёт под текст: на узком экране он занимает три-четыре строки, а
  // rows={1} со скроллом внутри поля прятал бы его конец.
  const titleGrow = useAutoGrow(title, 1, 6)

  async function launchCi(kind: 'queue' | 'parallel'): Promise<void> {
    if (launching) return
    setLaunching(kind)
    try {
      await (kind === 'queue' ? props.onStartCi?.(task.id) : props.onStartCiParallel?.(task.id))
    } finally {
      setLaunching(null)
    }
  }

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
    setCriteria(normalizeAcceptanceCriteria(task.acceptanceCriteria))
    setDescEditing(false)
    setLabelDraft('')
    setSkillDraft('')
    setActiveTab(defaultTab())
  }, [task.id])


  // Чат к задаче создаётся сам при первом открытии карточки: дальше в него
  // дублируются вопросы модели из CI-рана.
  const ensureChat = props.onEnsureChat
  useEffect(() => {
    if (!props.draft && task.type === 'task' && !task.chatId && ensureChat) ensureChat(task.id)
  }, [task.id, task.type, task.chatId, ensureChat, props.draft])

  // Использование БЗ — агрегат по ВСЕМ ранам задачи. Перечитываем, когда
  // меняется статус последнего рана: только что закончившийся ран добавил свои
  // обращения, и цифры в карточке обязаны это показать.
  const kbUsage = useRemoteReport(
    () => (!props.draft && task.type === 'task' ? window.ci?.getTaskKbUsage(task.projectId, task.id) : undefined),
    [task.id, task.projectId, task.type, props.ciSummary?.status]
  )
  // Отчёт по расходу — только когда ран задачи завершён: пока он идёт, цифры
  // меняются на глазах, и смотреть надо ленту, а не итог. Перечитываем по тому
  // же ключу, что и БЗ: закончившийся ран добавил свои ходы.
  const ciFinished = props.ciSummary != null && !isActiveCiStatus(props.ciSummary.status)
  const ciReport = useRemoteReport<CiTaskReport>(
    () => (!props.draft && task.type === 'task' && ciFinished ? window.ci?.getTaskReport(task.projectId, task.id) : undefined),
    [task.id, task.projectId, task.type, ciFinished, props.ciSummary?.status]
  )

  const column = board.columns.find((c) => c.id === task.columnId)
  const qaStageOrder: QaRunStage[] = ['component_qa','integration_tests','automated_qa']
  const workflowOrder = ['backlog','preparation','ready','development','component_qa','integration_tests','automated_qa','manual_qa','awaiting_merge','merge','done']
  const currentWorkflowIndex = workflowOrder.indexOf(column?.semanticType ?? '')
  const qaStageVisible = (stage: QaRunStage): boolean => qaStageRuns[stage]?.length ? true : currentWorkflowIndex >= workflowOrder.indexOf(stage)
  // Пока ран задачи идёт запуск недоступен; в семантическом «Готово» новый
  // запуск также запрещён — задача завершена, даже если старый ран терминальный.
  const canStartCi = column?.semanticType !== 'done' && column?.semanticType !== 'backlog' && column?.semanticType !== 'preparation' && canStartCiRun(props.ciSummary)
  const parent = task.parentId ? board.tasks.find((t) => t.id === task.parentId) : null
  const children = board.tasks.filter((t) => t.parentId === task.id)
  const key = issueKey(props.projectName, task)
  const activeCi = props.ciSummary && isActiveCiStatus(props.ciSummary.status) ? props.ciSummary : null
  const terminalCi = props.ciSummary && !isActiveCiStatus(props.ciSummary.status) ? props.ciSummary : null
  const activeOperation = activeCi?.slotProgress.phase || (task.activeMergeRunId ? 'Мерж выполняется' : null)
  const terminalResult = terminalCi && ['failed', 'timeout', 'cancelled'].includes(terminalCi.status)
    ? terminalCi.slotProgress.phase || ciStatusLabel(terminalCi.status)
    : null
  const currentState = [column?.name ?? 'Без статуса', activeOperation ?? terminalResult].filter(Boolean).join(' · ')
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

  const headActions = props.draft ? null : mobile ? (
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
      title={props.draft ? 'Создание задачи' : (
        <span className="task-modal-heading" data-testid="task-modal-heading" aria-live="polite" title={`${key} · ${task.title} (${currentState})`}>
          <span className="task-modal-heading__key">{key} ·</span>
          <textarea
            className="task-modal-heading__title"
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
          <span className="task-modal-heading__state">({currentState})</span>
        </span>
      )}
      ariaLabel={props.draft ? 'Создание задачи' : `${key} · ${task.title} (${currentState})`}
      size="lg"
      onClose={props.onClose}
      onEscape={requestClose}
      testId="task-modal"
      className="jmodal-frame"
      actions={headActions}
      footer={props.footer}
    >
      {!props.draft && <nav className="task-tabs" role="tablist" aria-label="Разделы карточки">
        {([
          ['general','Общее'],['settings','Настройки'],
          ...(preparationVisible ? [['preparation','Подготовка к разработке'] as const] : []),
          ...qaStageOrder.filter(qaStageVisible).map((stage) => [stage, stage === 'component_qa' ? 'Component QA' : stage === 'integration_tests' ? 'Интеграционные тесты' : 'Automated QA'] as const),
          ['qa','Ручное QA'],['progress','Ход выполнения'],['merge','Merge'],['feed','Лента рана']
        ] as Array<readonly [TaskTab, string]>).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={activeTab === id} className={activeTab === id ? 'task-tab task-tab--active' : 'task-tab'} onClick={() => setActiveTab(id)}>{label}</button>
        ))}
      </nav>}
      <div className={`jmodal jmodal--tab-${activeTab}`} onFocusCapture={(event) => {
        const label = (event.target as HTMLElement).getAttribute('aria-label') ?? ''
        const field: keyof TaskUpdateFields | null = label.includes('Заголовок') ? 'title' : label.includes('Описание') ? 'description' : label.includes('Критерии') ? 'acceptanceCriteria' : label.includes('Приоритет') ? 'priority' : label.includes('Исполнитель') ? 'assignee' : label.includes('Стори') ? 'storyPoints' : label.includes('Срок') ? 'dueDate' : null
        props.onSelectedFieldChange?.(field)
      }}>
        <div className="jmodal-main">
          {task.activeMergeRunId && <p className="task-merge-hint">Идёт merge-ран — прогресс во вкладке «Merge».</p>}
          {parent && (
            <button className="jmodal-breadcrumb" onClick={() => props.onOpenTask(parent.id)}>
              <TypeIcon type={parent.type} /> {issueKey(props.projectName, parent)} · {parent.title}
            </button>
          )}
          {props.draft && (
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
          )}
          {mobile && (
            <div className="jmodal-quick" data-testid="task-modal-quick">
              {statusField}
              {assigneeField}
            </div>
          )}
          <section className="task-content-block" aria-label="Описание и критерии приёмки">
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
          <div className="jmodal-desc-head">
            <h3 className="jmodal-h">Критерии приёмки</h3>
            {!criteriaEditing && <IconButton size="sm" aria-label="Изменить критерии приёмки" title="Изменить критерии приёмки" onClick={() => setCriteriaEditing(true)}>✏️</IconButton>}
          </div>
          {criteriaEditing ? <textarea
            ref={criteriaRef}
            className="login-input jmodal-desc"
            aria-label="Критерии приёмки"
            aria-describedby="task-criteria-help"
            placeholder="Что должно быть выполнено…"
            rows={10}
            value={criteria}
            onChange={(e) => {
              const raw = e.target.value
              const next = normalizeAcceptanceCriteria(raw)
              const start = e.target.selectionStart
              const end = e.target.selectionEnd
              setCriteria(next)
              requestAnimationFrame(() => {
                const el = criteriaRef.current
                if (!el) return
                const delta = next.length - raw.length
                el.setSelectionRange(Math.max(0, start + delta), Math.max(0, end + delta))
              })
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              const el = e.currentTarget
              const start = el.selectionStart
              const end = el.selectionEnd
              const before = criteria.slice(0, start)
              const line = before.slice(before.lastIndexOf('\n') + 1)
              const emptyItem = /^\d+\.\s*$/.test(line)
              const prefix = emptyItem ? '\n' : e.shiftKey ? '\n   ' : `\n${(criteria.match(/^\d+\. /gm) ?? []).length + 1}. `
              const lineStart = emptyItem ? before.lastIndexOf('\n') + 1 : start
              const next = criteria.slice(0, lineStart) + prefix + criteria.slice(end)
              const cursor = lineStart + prefix.length
              setCriteria(next)
              requestAnimationFrame(() => criteriaRef.current?.setSelectionRange(cursor, cursor))
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text')
              if (!pasted.includes('\n')) return
              e.preventDefault()
              const el = e.currentTarget
              const merged = criteria.slice(0, el.selectionStart) + pasted + criteria.slice(el.selectionEnd)
              const next = normalizeAcceptanceCriteria(merged)
              setCriteria(next)
              requestAnimationFrame(() => criteriaRef.current?.setSelectionRange(next.length, next.length))
            }}
            onBlur={() => {
              const normalized = normalizeAcceptanceCriteria(criteria)
              setCriteria(normalized)
              if (normalized !== task.acceptanceCriteria) props.onUpdate(task.id, { acceptanceCriteria: normalized })
              setCriteriaEditing(false)
            }}
          /> : criteria.trim() ? <div className="jmodal-desc-view task-criteria-view" data-testid="task-criteria-view"><Markdown>{normalizeAcceptanceCriteria(criteria)}</Markdown></div> : <button className="jmodal-desc-empty" onClick={() => setCriteriaEditing(true)}>Добавьте критерии приёмки…</button>}
          <span id="task-criteria-help" className="vc-sr-only">Enter создаёт новый критерий, Shift+Enter — перенос внутри критерия.</span>
          </section>
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
              {props.detailsExtra}
              {!props.draft && <p className="jmodal-dates">
                Статус: {column?.name ?? '—'}
                <br />Создано: {new Date(task.createdAt).toLocaleDateString('ru')}
                <br />Обновлено: {new Date(task.updatedAt).toLocaleDateString('ru')}
              </p>}
            </div>
          )}
          {task.type === 'task' && column?.semanticType !== 'backlog' && column?.semanticType !== 'preparation' && (props.onStartCi || props.ciSummary) && (
            <div className="jmodal-ci" data-testid="task-modal-ci">
              <div className="jmodal-ci-head">
                <span className="ci-task-title">CI-ран</span>
                {props.ciSummary && (
                  <span className={`lozenge ci-lozenge--${ciTone(props.ciSummary.status)}`}>{ciStatusLabel(props.ciSummary.status)}</span>
                )}
              </div>
              {props.ciSummary && (
                props.ciSummary.progress
                  ? <AutomationProgressView progress={props.ciSummary.progress} />
                  : <p className="jcard-ci-phase">
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
                    после завершения постановка в очередь снова доступна. */}
                {props.onStartCi && canStartCi && (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={launching === 'queue'}
                    disabled={launching !== null}
                    title="Добавить задачу в очередь выполнения. Если свободный слот есть, выполнение начнётся сразу"
                    onClick={() => void launchCi('queue')}
                  >{launching === 'queue' ? 'Добавляем в очередь…' : 'В очередь'}</Button>
                )}
                {props.onStartCiParallel && canStartCi && (
                  <Button
                    size="sm"
                    loading={launching === 'parallel'}
                    disabled={launching !== null}
                    title="Запустить задачу сразу, минуя общую очередь. Машина будет выбрана автоматически с учётом загрузки"
                    onClick={() => void launchCi('parallel')}
                  >Параллельно</Button>
                )}
              </div>
            </div>
          )}
        </aside>
        {!props.draft && <section className="task-tab-panel" data-testid="task-settings-panel" hidden={activeTab !== 'settings'}>
          <div className="task-settings-stack">
            <CiTaskSettings section="machine" projectId={task.projectId} taskId={task.id} mergeMachineBound={task.mergeMachineBound} />
            <CiTaskSettings section="model" projectId={task.projectId} taskId={task.id} />
            <CiTaskSettings section="commands" projectId={task.projectId} taskId={task.id} />
            <FeaturePreviewSection projectId={task.projectId} taskId={task.id} />
          </div>
        </section>}
        {!props.draft && <>
        <section className="task-tab-panel" data-testid="task-preparation-panel" hidden={activeTab !== 'preparation'}>{preparationVisible && <TaskPreparationTab projectId={task.projectId} taskId={task.id} liveRunId={task.taskPreparationRunId} liveStatus={task.taskPreparationStatus} loadRuns={props.loadPreparationRuns} onRetry={props.onRetryPreparation} onCancel={props.onCancelPreparation} />}</section>
        {qaStageOrder.map((stage) => qaStageVisible(stage) && <section key={stage} className="task-tab-panel" hidden={activeTab !== stage}>{stage === 'component_qa'
          ? <ComponentQaPanel projectId={task.projectId} taskId={task.id} active={Boolean(props.ciSummary && isActiveCiStatus(props.ciSummary.status)) || Boolean(task.activeMergeRunId)} onFixStarted={(runId) => { setActiveTab('feed'); props.onOpenCiRun?.(runId) }} />
          : <QaStageRunPanel projectId={task.projectId} taskId={task.id} stage={stage} />}</section>)}
        <section className="task-tab-panel" hidden={activeTab !== 'qa'}><ManualQaPanel projectId={task.projectId} taskId={task.id} activeRun={Boolean(props.ciSummary && isActiveCiStatus(props.ciSummary.status)) || Boolean(task.activeMergeRunId)} onFixStarted={(runId) => { setActiveTab('feed'); props.onOpenCiRun?.(runId) }} /></section>
        <section className="task-tab-panel" hidden={activeTab !== 'progress'}>
          {props.ciSummary?.progress && <AutomationProgressView progress={props.ciSummary.progress} />}
          {(() => {
            const progress = props.ciSummary?.progress
            const status = progress?.status ?? (props.ciSummary?.status === 'awaiting_input' ? 'waiting' : props.ciSummary?.status)
            const statusLabel = status === 'queued' ? 'ожидает запуска'
              : status === 'running' ? 'выполняется'
              : status === 'waiting' ? 'ожидает ответа'
              : status === 'success' ? 'завершена'
              : status === 'cancelled' ? 'отменена'
              : status === 'failed' || status === 'timeout' ? 'завершилась ошибкой'
              : 'ожидает запуска'
            const stage = progress?.currentStep ?? progress?.stage ?? props.ciSummary?.slotProgress.phase
            const percent = progress?.percent ?? (status === 'success' ? 100 : status === 'queued' ? 0 : null)
            const detailId = 'task-model-work-detail'
            return <section className="task-model-work" data-testid="task-model-work">
              <button className="task-model-work__toggle" aria-expanded={modelWorkOpen} aria-controls={detailId} onClick={() => setModelWorkOpen((open) => !open)}>
                <strong>Работа модели</strong>
                <span className={`task-model-work__status task-model-work__status--${status ?? 'queued'}`}>{statusLabel}</span>
                <span className={`task-model-work__bar${percent == null ? ' task-model-work__bar--indeterminate' : ''}`} role="progressbar" aria-label="Прогресс работы модели" aria-valuemin={percent == null ? undefined : 0} aria-valuemax={percent == null ? undefined : 100} aria-valuenow={percent ?? undefined} aria-valuetext={percent == null ? statusLabel : `${percent}% — ${statusLabel}`}>
                  {percent != null && <span style={{ width: `${percent}%` }} />}
                </span>
                {stage && <span className="task-model-work__stage" title={stage}>{stage}</span>}
                <span className="task-model-work__chevron" aria-hidden="true">⌄</span>
              </button>
              {modelWorkOpen && <div className="task-model-work__detail task-progress-detail" id={detailId}>
                {ciReport.report?.runs[0] ? <><h4>{ciReport.report.runs[0].provider} · {ciReport.report.runs[0].model}</h4><p>Попыток исправления: {ciReport.report.runs[0].fixAttempts}</p><ul>{ciReport.report.runs[0].stages.map((modelStage) => <li key={`${modelStage.kind}:${modelStage.model}`}>{modelStage.kind} · {modelStage.model} · {modelStage.totals.requests} запросов</li>)}</ul></> : <p className="task-tab-empty">Данных о работе модели пока нет.</p>}
              </div>}
            </section>
          })()}
          <nav className="task-subtabs" role="tablist" aria-label="Ход выполнения">
            {([['overview','Обзор'],['checks','Проверки'],['changes','Изменения'],['kb','База знаний'],['delivery','Результат и доставка'],['resources','Ресурсы']] as const).map(([id,label]) => <button key={id} role="tab" aria-selected={progressTab === id} className={progressTab === id ? 'task-tab task-tab--active' : 'task-tab'} onClick={() => setProgressTab(id)}>{label}</button>)}
          </nav>
          {progressTab === 'overview' && <CiReport report={ciReport.report} loading={ciReport.loading} error={ciReport.error} onOpenRun={props.onOpenCiRun} testId="task-modal-report" />}
          <div hidden={progressTab !== 'kb'}>{kbUsage.report && <KbUsageBrief title="База знаний" note={kbUsage.report.runs ? `по ${kbUsage.report.runs} ранам задачи` : 'по ранам задачи'} totals={kbUsage.report.totals} sections={kbUsage.report.sections} loading={kbUsage.loading} error={kbUsage.error} testId="task-modal-kb-usage" />}</div>
          {progressTab === 'checks' && (ciReport.report?.runs[0]?.steps.length ? <ol className="task-progress-list">{ciReport.report.runs[0].steps.map((step) => <li key={step.id} data-status={step.status}><span>{step.title}</span><span>{ciStatusLabel(step.status)}{step.durationMs != null ? ` · ${fmtDuration(step.durationMs)}` : ''}</span></li>)}</ol> : <p className="task-tab-empty">Сервер не сообщил проверки для этого запуска.</p>)}
          {progressTab === 'changes' && <p className="task-tab-empty">Сведения о ветке, файлах и коммитах появятся, когда сервер включит их в отчёт запуска.</p>}
          {progressTab === 'delivery' && (ciReport.report?.runs[0] ? <dl className="task-progress-facts"><dt>Результат</dt><dd>{ciStatusLabel(ciReport.report.runs[0].status)}</dd><dt>Начало</dt><dd>{ciReport.report.runs[0].startedAt ? new Date(ciReport.report.runs[0].startedAt).toLocaleString('ru') : '—'}</dd><dt>Завершение</dt><dd>{ciReport.report.runs[0].finishedAt ? new Date(ciReport.report.runs[0].finishedAt).toLocaleString('ru') : '—'}</dd></dl> : <p className="task-tab-empty">Результата доставки пока нет.</p>)}
          {progressTab === 'resources' && (ciReport.report?.runs[0] ? <dl className="task-progress-facts"><dt>Общее время</dt><dd>{ciReport.report.runs[0].durationMs != null ? fmtDuration(ciReport.report.runs[0].durationMs) : '—'}</dd><dt>Запросы модели</dt><dd>{ciReport.report.runs[0].totals.requests}</dd><dt>Токены</dt><dd>{ciReport.report.runs[0].totals.inputTokens + ciReport.report.runs[0].totals.outputTokens}</dd><dt>Инструменты</dt><dd>{ciReport.report.runs[0].toolCalls ? Object.values(ciReport.report.runs[0].toolCalls).reduce((sum, value) => sum + value, 0) : '—'}</dd></dl> : <p className="task-tab-empty">Данных о ресурсах пока нет.</p>)}
        </section>
        <section className="task-tab-panel" data-testid="task-merge-tab" hidden={activeTab !== 'merge'}>
          <MergePanel
            projectId={task.projectId}
            taskId={task.id}
            runId={(task.activeMergeRunId ?? task.latestMergeRunId) ?? null}
            canStart={Boolean(props.onStartMerge) && canStartMerge({ semanticType: board.columns.find((column) => column.id === task.columnId)?.semanticType ?? 'custom', sourceBranch: task.mergeSourceBranch, alreadyMerged: isCurrentMergeSourceMerged({ sourceSha: task.mergeSourceSha, mergedSourceSha: task.mergedSourceSha, mergedSha: task.mergedSha }), hasActiveRun: Boolean(task.activeMergeRunId), permitted: task.mergePermitted, machineBound: task.mergeMachineBound })}
            onStartMerge={(agentId) => props.onStartMerge?.(task.id, agentId)}
          />
        </section>
        <section className="task-tab-panel" data-testid="task-run-feed-tab" hidden={activeTab !== 'feed'}>
          <h3 className="jmodal-h">Техническая лента</h3>
          {activeTab === 'feed' && <TaskRunFeed
            projectId={task.projectId}
            taskId={task.id}
            activeDevelopmentRunId={props.ciSummary && isActiveCiStatus(props.ciSummary.status) ? props.ciSummary.id : null}
            activeMergeRunId={task.activeMergeRunId}
          />}
        </section></>}
      </div>
    </Dialog>
    <PromptBuilder {...aiAssist.popupProps} />
    </>
  )
}
