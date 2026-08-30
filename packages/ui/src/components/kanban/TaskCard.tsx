// Карточка задачи в стиле Jira: заголовок, чип эпика, метки, флаг, прогресс
// подзадач, снизу — иконка типа + ключ, срок, стори-поинты, приоритет, аватар.
// Клик (тап) — открывает модалку задачи; меню «⋯» — быстрые действия.
//
// Перенос карточка не реализует: геометрия доски известна только ей, поэтому
// карточка лишь сообщает о захвате (onGrab) и о клавишах (onCardKeys), а порог
// жеста, копию под пальцем и цель считает KanbanBoard. Захватить можно с ручки
// «⠿» (единственное место с touch-action: none — палец там не скроллит) или
// удержанием самой карточки; с клавиатуры карточка фокусируется (tabIndex).

import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { KanbanColumnSemanticType, Task } from '@shared/projects'
import { canStartMerge, isCurrentMergeSourceMerged } from '@shared/merge'
import { canStartCiRun, ciCardPulse, ciSummaryForTask, type CiRunSummary } from '@shared/ci'
import type { TaskModalTab } from './TaskModal'
import { ciStatusLabel, ciTone, fmtDuration } from '../ci/ciFormat'
import { Avatar, PriorityIcon, TypeIcon, dueState, epicColor, fmtDue, issueKey } from './kanbanMeta'
import { Button } from '@voicechat/ui-kit'
import { IconButton } from '@voicechat/ui-kit'
import { useConfirm } from '@voicechat/ui-kit'
import { useDismissibleMenu } from '../../lib/useDismissibleMenu'
import { ChatIcon, DotsIcon, FlagIcon, GripIcon } from '../icons'
import { formatDate } from '../../lib/dateFormat'

export interface TaskCardProps {
  task: Task
  projectName: string
  /** Все задачи доски — для чипа эпика и прогресса подзадач. */
  allTasks: Task[]
  /** Колонки со смыслом «done» — для прогресса и зачёркивания ключа. */
  doneColumnIds: ReadonlySet<string>
  columnSemanticType?: KanbanColumnSemanticType
  onOpen: (taskId: string, tab?: TaskModalTab) => void
  onUpdate: (taskId: string, fields: { flagged?: boolean; autoPilot?: boolean }) => void
  onDelete: (taskId: string) => void
  onMoveTop: (taskId: string) => void
  onMoveBottom: (taskId: string) => void
  /** Открыть связанный с задачей чат (кнопка на карточке). */
  onOpenChat?: (taskId: string) => void
  /** Сводка последнего CI-рана задачи (доска). */
  ciSummary?: CiRunSummary
  /** Запустить CI-воркфлоу для задачи. */
  onStartCi?: (taskId: string) => void | Promise<void>
  /** Запустить отдельную пред-разработческую подготовку. */
  onStartPreparation?: (taskId: string) => void | Promise<void>
  /** Параллельный запуск: сразу в работу, мимо очереди сервера. */
  onStartCiParallel?: (taskId: string) => void | Promise<void>
  /** Открыть ленту рана. */
  onOpenCiRun?: (runId: string) => void
  /** Убрать ожидающий ран из очереди CI. */
  onDequeueCiRun?: (runId: string) => void
  /** Доступна исключительно в awaiting_merge при серверно подтверждённых условиях. */
  onStartMerge?: (taskId: string) => void
  /** Фактические соседние колонки в полном проектном порядке. */
  previousColumn?: { id: string; name: string } | null
  nextColumn?: { id: string; name: string } | null
  /** Переместить карточку существующим сценарием доски. */
  onMoveToColumn?: (taskId: string, fromColumnId: string, targetColumnId: string) => void | Promise<void>

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
  const [launching, setLaunching] = useState<'queue' | 'parallel' | null>(null)
  const [movingStage, setMovingStage] = useState(false)
  const movingStageRef = useRef(false)

  async function moveToColumn(targetColumnId: string): Promise<void> {
    if (movingStageRef.current || !props.onMoveToColumn) return
    const fromColumnId = props.task.columnId
    movingStageRef.current = true
    setMovingStage(true)
    try {
      await props.onMoveToColumn(props.task.id, fromColumnId, targetColumnId)
    } finally {
      movingStageRef.current = false
      setMovingStage(false)
    }
  }

  async function launchCi(kind: 'queue' | 'parallel'): Promise<void> {
    if (launching) return
    setLaunching(kind)
    try {
      await (kind === 'queue' ? props.onStartCi?.(props.task.id) : props.onStartCiParallel?.(props.task.id))
    } finally {
      setLaunching(null)
    }
  }
  const { task, ciSummary } = props
  const confirm = useConfirm()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  useDismissibleMenu(menuOpen, menuRef, () => setMenuOpen(false))

  const done = props.doneColumnIds.has(task.columnId)
  // Сервер выбирает состояние; helper сохраняет совместимость со stale payload.
  const visibleCiSummary = ciSummaryForTask(ciSummary, done)
  const developmentStage = !done && (props.columnSemanticType == null || props.columnSemanticType === 'development' || props.columnSemanticType === 'custom')
  const pulse = developmentStage ? ciCardPulse(visibleCiSummary) : null
  const latestFailed = task.latestRunResult?.outcome === 'failure'
  const failureTab: TaskModalTab = task.latestRunResult?.kind === 'preparation' ? 'preparation'
    : task.latestRunResult?.kind === 'component_qa' ? 'component_qa'
      : task.latestRunResult?.kind === 'integration_tests' ? 'integration_tests'
        : task.latestRunResult?.kind === 'automated_qa' ? 'automated_qa'
          : task.latestRunResult?.kind === 'manual_qa' ? 'qa'
            : task.latestRunResult?.kind === 'merge' ? 'merge' : 'feed'
  // В «Готово» запуск нового CI-рана запрещён: завершённая карточка остаётся
  // историей результата, а не точкой повторного выполнения.
  const qaStage = props.columnSemanticType === 'component_qa' || props.columnSemanticType === 'integration_tests' || props.columnSemanticType === 'automated_qa' || props.columnSemanticType === 'manual_qa' || props.columnSemanticType === 'testing' || props.columnSemanticType === 'qa_preparation'
  const readyStage = props.columnSemanticType === 'ready'
  const stoppedStage = props.columnSemanticType === 'cancelled' || props.columnSemanticType === 'decision_required'
  const canStart = (readyStage || developmentStage) && !done && canStartCiRun(ciSummary)

  const epic = epicOf(task, props.allTasks)
  const children = props.allTasks.filter((t) => t.parentId === task.id)
  const doneChildren = children.filter((t) => props.doneColumnIds.has(t.columnId))
  const key = issueKey(props.projectName, task)

  return (
    <div
      ref={cardRef}
      className={`jcard jcard--stage-${props.columnSemanticType ?? 'custom'}${done ? ' jcard--compact' : ''}${task.flagged ? ' jcard--flagged' : ''}${developmentStage && task.previewReady ? ' jcard--preview-running' : ''}${pulse ? ` jcard--ci-${pulse}` : ''}${latestFailed && !done ? ' jcard--latest-failed' : ''}${props.dragging ? ' dragging' : ''}${props.grabbed ? ' jcard--grabbed' : ''}`}
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
          <GripIcon />
        </span>
        <span className="jcard-key jcard-key--head">{key}</span>
        <span className="jcard-title" title={task.title}>{task.title}</span>
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
            <DotsIcon />
          </IconButton>
          {menuOpen && (
            <div className="jcard-menu" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setMenuOpen(false); props.onOpen(task.id) }}>Открыть</button>
              <button onClick={() => { setMenuOpen(false); props.onUpdate(task.id, { flagged: !task.flagged }) }}>
                {task.flagged ? 'Снять флаг' : 'Добавить флаг'}
              </button>
              <button onClick={() => { setMenuOpen(false); props.onUpdate(task.id, { autoPilot: !task.autoPilot }) }}>
                {task.autoPilot ? 'Выключить автопроход' : 'Включить автопроход'}
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

      {latestFailed && !done && !stoppedStage && (
        <button
          type="button"
          className="jcard-latest-failure"
          title="Последний этап завершился с ошибкой. Открыть ленту рана"
          aria-label="Последний этап завершился с ошибкой. Открыть ленту рана"
          onClick={(event) => { event.stopPropagation(); props.onOpen(task.id, failureTab) }}
        >
          <span aria-hidden="true">⚠</span> Последний этап завершился с ошибкой
        </button>
      )}

      {!done && !stoppedStage && (task.flagged || task.autoPilot || epic || (props.columnSemanticType === 'backlog' && task.labels.length > 0) || (readyStage && task.skills.length > 0)) && (
        <div className="jcard-chips">
          {task.flagged && <span className="jcard-flag" title="Помечена флагом"><FlagIcon filled /> Флаг</span>}
          {task.autoPilot && <span className="jcard-label" title="Автоматический проход конвейера">Автопроход</span>}
          {/* Цвет эпика носит только точка: как подпись он не проходит по
              контрасту — палитра яркая, и, например, `#00a3bf` даёт на карточке
              2.6:1 при норме 4.5. Текст красится токеном. */}
          {epic && (
            <span className="jcard-epic" title={`Эпик: ${epic.title}`}>
              <span className="jcard-epic-dot" style={{ background: epicColor(epic.id) }} />
              {epic.title}
            </span>
          )}
          {props.columnSemanticType === 'backlog' && task.labels.map((l) => (
            <span key={l} className="jcard-label">{l}</span>
          ))}
          {readyStage && task.skills.map((s) => (
            <span key={`skill-${s}`} className="jcard-skill" title={`Навык: ${s}`}>{s}</span>
          ))}
        </div>
      )}


      {props.columnSemanticType === 'backlog' && children.length > 0 && (
        <div className="jcard-progress" title={`Подзадачи: ${doneChildren.length} из ${children.length}`}>
          <span className="jcard-progress-bar">
            <span className="jcard-progress-fill" style={{ width: `${Math.round((doneChildren.length / children.length) * 100)}%` }} />
          </span>
          <span className="jcard-progress-text">{doneChildren.length}/{children.length}</span>
        </div>
      )}

      {task.type === 'task' && props.columnSemanticType === 'awaiting_merge' && props.onStartMerge && canStartMerge({
        semanticType: props.columnSemanticType ?? 'custom',
        sourceBranch: task.mergeSourceBranch,
        alreadyMerged: isCurrentMergeSourceMerged({ sourceSha: task.mergeSourceSha, mergedSourceSha: task.mergedSourceSha, mergedSha: task.mergedSha }),
        hasActiveRun: Boolean(task.activeMergeRunId),
        permitted: task.mergePermitted,
        machineBound: task.mergeMachineBound
      }) && (
        <div className="jcard-ci" data-testid="task-merge-panel" onClick={(e) => e.stopPropagation()}>
          {task.mergeSourceBranch && <code className="jcard-stage-branch">{task.mergeSourceBranch}</code>}
          <Button variant="primary" size="sm" onClick={() => props.onStartMerge?.(task.id)}>Мерж</Button>
        </div>
      )}

      {task.type === 'task' && props.columnSemanticType === 'backlog' && props.onStartPreparation && (
        <div className="jcard-ci" data-testid="task-preparation-panel" onClick={(e) => e.stopPropagation()}>
          <Button variant="primary" size="sm" onClick={() => void props.onStartPreparation?.(task.id)}>Начать подготовку</Button>
        </div>
      )}
      {task.type === 'task' && props.columnSemanticType === 'preparation' && (
        <div className="jcard-ci" data-testid="task-preparation-panel" onClick={(e) => e.stopPropagation()}>
          <div className="jcard-ci-row"><span className="ci-lozenge">{task.taskPreparationStatus === 'running' ? 'Подготовка выполняется' : task.taskPreparationStatus === 'failed' ? 'Подготовка не прошла' : 'Подготовка'}</span></div>
          {task.taskPreparationError && <p className="jcard-ci-phase">{task.taskPreparationError}</p>}
          <Button variant="ghost" size="sm" onClick={() => props.onOpen(task.id, 'preparation')}>Подробнее</Button>
          {task.taskPreparationStatus !== 'running' && props.onStartPreparation && <Button size="sm" onClick={() => void props.onStartPreparation?.(task.id)}>Повторить</Button>}
        </div>
      )}
      {task.type === 'task' && readyStage && (
        <div className="jcard-stage-content" data-testid="task-ready-panel" onClick={(e) => e.stopPropagation()}>
          {task.agentId && <span className="jcard-stage-machine">Машина: {task.agentId}</span>}
          {canStart && props.onStartCi && (
            <Button variant="primary" size="sm" loading={launching === 'queue'} disabled={launching !== null} onClick={() => void launchCi('queue')}>В очередь</Button>
          )}
        </div>
      )}
      {task.type === 'task' && qaStage && (
        <div className="jcard-stage-content" data-testid="task-qa-run-panel" onClick={(e) => e.stopPropagation()}>
          <span>{props.columnSemanticType === 'component_qa' ? 'Component QA' : props.columnSemanticType === 'integration_tests' ? 'Интеграционные тесты' : props.columnSemanticType === 'manual_qa' ? 'Ручное QA' : 'Automated QA'}</span>
          {task.latestRunResult && <span className={`jcard-stage-verdict jcard-stage-verdict--${task.latestRunResult.outcome}`}>{task.latestRunResult.outcome === 'success' ? 'Пройдено' : task.latestRunResult.outcome === 'active' ? 'Проверяется' : 'Не пройдено'}</span>}
          <Button variant="ghost" size="sm" onClick={() => props.onOpen(task.id)}>Лента рана</Button>
        </div>
      )}
      {task.type === 'task' && props.columnSemanticType === 'merge' && (
        <div className="jcard-stage-content" data-testid="task-merge-status">
          {task.mergeSourceBranch && <code className="jcard-stage-branch">{task.mergeSourceBranch}</code>}
          <span>{task.activeMergeRunId ? 'Мерж выполняется' : 'Ожидает повторного мержа'}</span>
        </div>
      )}
      {task.type === 'task' && done && (
        <div className="jcard-stage-content jcard-stage-content--done" data-testid="task-done-summary" onClick={(e) => e.stopPropagation()}>
          {task.mergeSourceBranch && <code className="jcard-stage-branch">{task.mergeSourceBranch}</code>}
          {task.doneAt && <time dateTime={new Date(task.doneAt).toISOString()}>{new Date(task.doneAt).toLocaleDateString('ru')}</time>}
          {task.latestRunResult && <button type="button" className="jcard-stage-link" onClick={() => props.onOpen(task.id, failureTab)}>Ран</button>}
        </div>
      )}
      {task.type === 'task' && stoppedStage && (
        <div className="jcard-stage-stop" data-testid="task-stop-reason">
          {task.taskPreparationError ?? (props.columnSemanticType === 'cancelled' ? 'Выполнение отменено' : 'Требуется решение пользователя')}
        </div>
      )}
      {task.type === 'task' && developmentStage && (props.onStartCi || visibleCiSummary) && (
        <div className="jcard-ci" data-testid="task-ci-panel" onClick={(e) => e.stopPropagation()}>
          {visibleCiSummary && (() => {
            const ciSummary = visibleCiSummary
            const tone = ciTone(ciSummary.status)
            return (
              <>
                <div className="jcard-ci-row">
                  <span className={`ci-lozenge ci-lozenge--${tone}`}>{ciStatusLabel(ciSummary.status)}</span>
                </div>
                {ciSummary.error && ciSummary.status !== 'success'
                  ? <p className="jcard-ci-phase" role="alert">{ciSummary.error}</p>
                  : ciSummary.progress
                  ? <div className="jcard-run-progress">
                      <div className="jcard-run-progress__meta"><span>{ciSummary.progress.stage}</span><span>шаг {ciSummary.progress.completedSteps + 1} из {ciSummary.progress.totalSteps}</span>{ciSummary.durationMs != null && <span>{fmtDuration(ciSummary.durationMs)}</span>}</div>
                      <span className="jcard-run-progress__bar"><span style={{ width: `${ciSummary.progress.percent ?? 0}%` }} /></span>
                    </div>
                  : <p className="jcard-ci-phase">{ciSummary.slotProgress.phase} · шаг {ciSummary.slotProgress.done} из {ciSummary.slotProgress.total}{ciSummary.durationMs != null ? ` · ${fmtDuration(ciSummary.durationMs)}` : ''}</p>}
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
              <Button
                variant="primary"
                size="sm"
                loading={launching === 'queue'}
                disabled={launching !== null}
                title="Добавить задачу в очередь выполнения. Если свободный слот есть, выполнение начнётся сразу"
                onClick={() => void launchCi('queue')}
              >{launching === 'queue' ? 'Добавляем в очередь…' : 'В очередь'}</Button>
            )}
            {canStart && props.onStartCiParallel && (
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

      {!done && !stoppedStage && <div className="jcard-stage-actions" aria-label="Переход между этапами" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          disabled={movingStage || !props.previousColumn || !props.onMoveToColumn}
          title={props.previousColumn ? `Перейти влево в «${props.previousColumn.name}»` : 'Предыдущего этапа нет'}
          aria-label={props.previousColumn ? `Перейти влево в колонку «${props.previousColumn.name}»` : 'Перейти влево: предыдущего этапа нет'}
          onClick={() => { if (props.previousColumn) void moveToColumn(props.previousColumn.id) }}
        >←</button>
        <button
          type="button"
          disabled={movingStage || !props.nextColumn || !props.onMoveToColumn}
          title={props.nextColumn ? `Перейти вправо в «${props.nextColumn.name}»` : 'Следующего этапа нет'}
          aria-label={props.nextColumn ? `Перейти вправо в колонку «${props.nextColumn.name}»` : 'Перейти вправо: следующего этапа нет'}
          onClick={() => { if (props.nextColumn) void moveToColumn(props.nextColumn.id) }}
        >→</button>
      </div>}

      {/* Клавиатурный перенос иначе не найти: подсказка видна только скринридеру. */}
      <span className="vc-sr-only">Пробел — взять задачу для переноса</span>

      <div className="jcard-foot">
        <span className="jcard-foot-left">
          <TypeIcon type={task.type} />
          {props.onOpenChat && (
            <Button
              variant="ghost"
              size="sm"
              className="jcard-chat"
              iconLeft={<ChatIcon />}
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
          {/* В подписи только «29 авг.» — год виден лишь в подсказке. */}
          {task.dueDate != null && (
            <span className={`jcard-due jcard-due--${dueState(task.dueDate)}`} title={`Срок: ${formatDate(task.dueDate)}`}>
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
