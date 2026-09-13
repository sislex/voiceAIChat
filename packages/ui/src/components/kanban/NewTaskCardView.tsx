import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Badge, Button, Dialog, EmptyState, ErrorState, Skeleton } from '@voicechat/ui-kit'
import { usePolling } from '@voicechat/ui-foundation/lib/usePolling'
import { formatDateTime } from '../../lib/dateFormat'
import { fmtDuration } from '../ci/ciFormat'
import { CRITERION_STATE_LABEL, diffCriteria } from './criteriaDiff'
import { pluralRu } from './taskCycles'
import type { TaskCardCallbacks, TaskCardMakeLinkDraft, TaskCardTab, TaskCardVersion, TaskCardViewModel, TaskReworkCycleViewModel, TaskReworkDraft, TaskReworkSourcesState } from './TaskCardViewModel'

const RUN_LABELS = {
  queued: 'В очереди', running: 'Выполняется', waiting_for_answer: 'Ждёт ответа',
  success: 'Успешно', failed: 'Ошибка', cancelled: 'Отменён'
} as const

const WORKFLOW_STATE_LABEL = {
  passed: 'Завершено', current: 'Текущий этап', upcoming: 'Ожидает', failed: 'Ошибка'
} as const

export interface NewTaskCardViewProps {
  model: TaskCardViewModel
  activeTab: TaskCardTab
  version: TaskCardVersion
  reworkOpen: boolean
  reworkDraft: TaskReworkDraft
  reworkPending?: boolean
  reworkError?: string | null
  makeSourcesState?: TaskReworkSourcesState
  /** A Make link is being saved: the editor shows a spinner and blocks double submit. */
  makeLinkPending?: boolean
  onVersionChange(version: TaskCardVersion): void
  callbacks: TaskCardCallbacks
  /**
   * Содержимое вкладок, которые новая карточка не рисует сама: подготовка,
   * настройки, ход выполнения, QA, merge и лента рана. Контейнер собирает их из
   * функциональных панелей, обёрнутых в рейку этапов дизайна.
   */
  renderPanel?(tab: TaskCardTab): ReactNode
}

function FileRows({ files, onDelete, loadPreview }: {
  files: TaskCardViewModel['source']['attachments']
  onDelete?: (id: string) => void
  /** Байты картинки по требованию: показываем превью только когда его попросили. */
  loadPreview?: (fileId: string) => Promise<string>
}): JSX.Element {
  const [previews, setPreviews] = useState<Record<string, string>>({})
  if (!files.length) return <EmptyState title="Файлов пока нет" description="Добавленные материалы появятся здесь." />
  return <div className="new-task-files" role="list">{files.map((file) => {
    const image = Boolean(loadPreview) && file.status === 'ready' && (file.mimeType ?? '').startsWith('image/')
    return <div className={'new-task-file new-task-file--' + file.status} role="listitem" key={file.id}>
      {previews[file.id] && <img className="new-task-file-thumb" src={previews[file.id]} alt={file.name} loading="lazy" />}
      <span>{file.name}</span><small>{file.error ?? file.mimeType ?? 'Файл'}</small>
      {image && !previews[file.id] && <Button size="sm" variant="ghost" onClick={() => void loadPreview?.(file.id).then((src) => setPreviews((all) => ({ ...all, [file.id]: src })))}>Превью</Button>}
      {onDelete && file.status !== 'uploading' && <Button size="sm" variant="ghost" onClick={() => onDelete(file.id)}>Удалить</Button>}
    </div>
  })}</div>
}

/** Критерии приёмки с разметкой относительно первоначальной постановки. */
function CriteriaList({ source, current }: { source: string; current: string }): JSX.Element {
  const items = diffCriteria(source, current)
  if (!items.length) return <p className="new-task-muted">Критерии не заполнены</p>
  return <ol className="new-task-criteria">{items.map((item, index) =>
    <li key={index}>
      <span className={'new-task-criterion-state new-task-criterion-state--' + item.state}>{CRITERION_STATE_LABEL[item.state]}</span>
      <span>{item.text}</span>
    </li>
  )}</ol>
}

type MakeFilesState = { state: 'loading' | 'ready' | 'error'; paths: string[] }

/**
 * Inline editor of a Make link from the mock: project, scope (whole project or
 * chosen files) and the file list loaded on demand. Used both to create a link
 * and to replace an existing one.
 */
function MakeDesignEditor({ heading, initial, choices, pending, onLoadFiles, onCancel, onSave }: {
  heading: string
  initial: TaskCardMakeLinkDraft | null
  choices?: TaskReworkSourcesState
  pending?: boolean
  onLoadFiles?: (conversationId: string) => Promise<string[]>
  onCancel(): void
  onSave(draft: TaskCardMakeLinkDraft): void
}): JSX.Element {
  const items = choices?.items ?? []
  const [draft, setDraft] = useState<TaskCardMakeLinkDraft>(initial ?? { conversationId: items[0]?.conversationId ?? '', mode: 'whole_project', paths: [] })
  const [files, setFiles] = useState<MakeFilesState | null>(null)
  // The first project of the list becomes the default once the list arrives.
  useEffect(() => { if (!draft.conversationId && items[0]) setDraft((value) => ({ ...value, conversationId: items[0]!.conversationId })) }, [items.length])
  useEffect(() => {
    if (draft.mode !== 'files' || !draft.conversationId || !onLoadFiles) return
    let live = true
    setFiles({ state: 'loading', paths: [] })
    onLoadFiles(draft.conversationId)
      .then((paths) => { if (live) setFiles({ state: 'ready', paths }) })
      .catch(() => { if (live) setFiles({ state: 'error', paths: [] }) })
    return () => { live = false }
  }, [draft.mode, draft.conversationId])
  const valid = Boolean(draft.conversationId) && (draft.mode === 'whole_project' || draft.paths.length > 0)
  return <section className="new-task-section new-task-make-editor" aria-label={heading}>
    <header className="new-task-section-head">
      <div><small className="new-task-eyebrow">Живой источник для AI</small><h3>{heading}</h3></div>
      <Badge tone="running">Редактирование</Badge>
    </header>
    {choices?.state === 'loading' && <p role="status">Загружаем Make-проекты…</p>}
    {choices?.state === 'error' && <ErrorState compact message="Не удалось загрузить Make-проекты" detail={choices.error} />}
    {choices?.state === 'empty' && <EmptyState compact title="Нет доступных Make-проектов" description="Создайте Make-проект в этом проекте — он появится здесь." />}
    {items.length > 0 && <>
      <label className="new-task-field">Make-проект
        <select value={draft.conversationId} onChange={(event) => setDraft({ conversationId: event.target.value, mode: draft.mode, paths: [] })}>
          {items.map((item) => <option key={item.conversationId} value={item.conversationId}>{item.title}{item.own ? '' : ` · ${item.owner ?? 'общий'}`}</option>)}
        </select>
      </label>
      <fieldset className="new-task-fieldset">
        <legend>Объём связи</legend>
        <label><input type="radio" name="new-task-make-mode" checked={draft.mode === 'whole_project'} onChange={() => setDraft({ ...draft, mode: 'whole_project', paths: [] })} /> Весь Make-проект</label>
        <label><input type="radio" name="new-task-make-mode" checked={draft.mode === 'files'} onChange={() => setDraft({ ...draft, mode: 'files' })} /> Выбранные файлы</label>
      </fieldset>
      {draft.mode === 'files' && <div className="new-task-design-files" role="group" aria-label="Файлы Make-проекта">
        {files?.state === 'loading' && <p role="status">Загружаем файлы…</p>}
        {files?.state === 'error' && <p role="alert" className="new-task-source-error">Не удалось загрузить файлы</p>}
        {files?.state === 'ready' && !files.paths.length && <p className="new-task-muted">В проекте нет файлов</p>}
        {files?.state === 'ready' && files.paths.map((path) => <label key={path}>
          <input type="checkbox" checked={draft.paths.includes(path)} onChange={(event) => setDraft({ ...draft, paths: event.target.checked ? [...draft.paths, path].sort() : draft.paths.filter((item) => item !== path) })} />
          <span>{path}</span>
        </label>)}
      </div>}
    </>}
    <footer className="new-task-make-footer">
      <Button size="sm" onClick={onCancel}>Отмена</Button>
      <Button size="sm" variant="primary" disabled={!valid || pending} loading={pending} onClick={() => onSave(draft)}>Сохранить связь</Button>
    </footer>
  </section>
}

function MakeSourceCard({ source, onOpen, onUnlink, onReplace }: {
  source: TaskCardViewModel['makeSources'][number]
  onOpen(): void
  onUnlink?(): void
  /** Замена макета: открывает тот же редактор с текущими значениями. */
  onReplace?(): void
}): JSX.Element {
  const broken = source.paths.filter((path) => !path.available)
  return <article className="new-task-make" key={source.id}>
    <header>
      <div><small>Дизайн Make</small><h4>{source.title}</h4></div>
      <span className={'new-task-make-status new-task-make-status--' + (broken.length ? 'broken' : 'ok')}>{broken.length ? 'Файлы недоступны' : '● Доступен'}</span>
    </header>
    <dl className="new-task-make-facts">
      <div><dt>Режим</dt><dd>{source.mode === 'whole_project' ? 'Весь проект' : pluralRu(source.paths.length, 'файл', 'файла', 'файлов')}</dd></div>
      <div><dt>Обновлён</dt><dd>{source.updatedAt ? formatDateTime(source.updatedAt) : '—'}</dd></div>
      <div><dt>Доступ AI</dt><dd>Только чтение</dd></div>
    </dl>
    {source.mode === 'files' && <div className="new-task-make-files" role="list">{source.paths.map((path) =>
      <div className="new-task-make-file" role="listitem" key={path.path}>
        <span>▧ {path.path}</span>
        <small className={path.available ? '' : 'new-task-source-error'}>{path.available ? 'Доступен' : path.error ?? 'Недоступен'}</small>
      </div>
    )}</div>}
    <footer>
      <Button size="sm" variant="secondary" onClick={onOpen}>Открыть превью</Button>
      {onReplace && <Button size="sm" variant="secondary" onClick={onReplace}>Заменить</Button>}
      {onUnlink && <Button size="sm" variant="danger" onClick={onUnlink}>Удалить связь</Button>}
    </footer>
  </article>
}

/** Workflow with the timing of the mock: how long a passed stage took, a live counter for the current one. */
function WorkflowList({ steps }: { steps: TaskCardViewModel['workflow'] }): JSX.Element {
  const live = steps.find((step) => step.state === 'current' && step.startedAt != null)
  const [now, setNow] = useState(() => Date.now())
  usePolling(() => setNow(Date.now()), { enabled: Boolean(live), intervalMs: 1000 })
  return <ol className="new-task-workflow" role="list">{steps.map((step, index) => {
    const elapsed = step.state === 'current' && step.startedAt != null ? Math.max(0, now - step.startedAt) : null
    const text = step.state === 'passed' && step.durationMs != null ? fmtDuration(step.durationMs) : elapsed != null ? fmtDuration(elapsed) : null
    return <li className={'new-task-workflow-step new-task-workflow-step--' + step.state} key={step.id} role="listitem">
      <span className="new-task-workflow-num" aria-hidden="true">{step.state === 'passed' ? '✓' : index + 1}</span>
      <span className="new-task-workflow-body"><strong>{step.label}</strong><small>{WORKFLOW_STATE_LABEL[step.state]}</small></span>
      {text && <time className={'new-task-workflow-time' + (elapsed != null ? ' new-task-workflow-time--live' : '')} aria-label={(elapsed != null ? 'Прошло ' : 'Заняло ') + text}>
        {elapsed != null && <em aria-hidden="true" />}{text}
      </time>}
    </li>
  })}</ol>
}

/** Одна доработка очереди: чекбокс выбора, содержание и действия черновика. */
function DraftRow({ cycle, selected, onToggle, callbacks, pending, canSubmit }: { cycle: TaskReworkCycleViewModel; selected: boolean; onToggle(): void; callbacks: TaskCardCallbacks; pending?: boolean; canSubmit: boolean }): JSX.Element {
  // Заголовок строки — первая строка описания, остальное уходит в тело: иначе
  // однострочная доработка показывалась бы дважды подряд.
  const [title, ...rest] = cycle.description.split('\n')
  return <article className="new-task-rework-row new-task-rework-row--draft" role="listitem">
    <input type="checkbox" aria-label={'Выбрать ' + (title || 'доработку ' + cycle.sequence)} checked={selected} onChange={onToggle} />
    <div className="new-task-rework-content">
      <header>
        <span className="new-task-rework-num">№ {cycle.sequence}</span>
        <strong>{title || 'Без описания'}</strong>
        <span className="new-task-rework-badge new-task-rework-badge--draft">Черновик</span>
        <small>{formatDateTime(cycle.createdAt)}</small>
      </header>
      {rest.join('\n').trim() && <p>{rest.join('\n')}</p>}
      <small className="new-task-rework-counts">
        {pluralRu(cycle.criteria.length, 'критерий', 'критерия', 'критериев')} · ⌘ {pluralRu(cycle.makeSources.reduce((sum, source) => sum + (source.mode === 'whole_project' ? 1 : source.paths.length), 0), 'Make-файл', 'Make-файла', 'Make-файлов')} · {pluralRu(cycle.attachments.length, 'вложение', 'вложения', 'вложений')}
      </small>
      <footer className="new-task-rework-actions">
        <Button size="sm" variant="primary" disabled={!canSubmit || pending} onClick={() => void callbacks.onSubmitDraft?.(cycle.id)}>Отправить на доработку</Button>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => callbacks.onEditDraft?.(cycle.id)}>Изменить</Button>
        <Button size="sm" variant="danger" disabled={pending} onClick={() => void callbacks.onDeleteDraft?.(cycle.id)}>Удалить</Button>
      </footer>
    </div>
  </article>
}

/** Отправленный цикл — неизменяемая запись истории со ссылками на его этапы. */
function CycleRow({ cycle, callbacks }: { cycle: TaskReworkCycleViewModel; callbacks: TaskCardCallbacks }): JSX.Element {
  const [title, ...rest] = cycle.description.split('\n')
  return <article className="new-task-cycle-row" role="listitem">
    <strong className="new-task-cycle-num" aria-hidden="true">{cycle.sequence}</strong>
    <div>
      <header>
        <h4>{title || 'Без описания'}</h4>
        <span className={'new-task-rework-badge new-task-rework-badge--' + (cycle.merged ? 'merged' : 'sent')}>{cycle.merged ? 'Вмержено в main' : 'Отправлена'}</span>
        {cycle.merged && <span className="new-task-lock" title="Редактирование недоступно после мержа" aria-label="Редактирование недоступно после мержа">🔒</span>}
      </header>
      {rest.join('\n').trim() ? <p>{rest.join('\n')}</p> : <p>Принятые требования и результаты этого цикла сохранены неизменяемо.</p>}
      <div className="new-task-chips">
        <span>{cycle.createdBy}</span>
        <span>{formatDateTime(cycle.createdAt)}</span>
        {cycle.criteria.length > 0 && <span>{pluralRu(cycle.criteria.length, 'критерий', 'критерия', 'критериев')}</span>}
        {cycle.makeSources.map((source) => <span key={source.id}>⌘ {source.mode === 'whole_project' ? source.title : source.paths.map((path) => path.path).join(', ')}</span>)}
        {cycle.attachments.length > 0 && <span>{pluralRu(cycle.attachments.length, 'вложение', 'вложения', 'вложений')}</span>}
      </div>
      <footer>
        <Button size="sm" variant="ghost" onClick={() => callbacks.onOpenPreparationCycle ? callbacks.onOpenPreparationCycle(cycle.id) : callbacks.onChangeTab('preparation')}>Результат подготовки</Button>
        <Button size="sm" variant="ghost" onClick={() => callbacks.onChangeTab('progress')}>Ход выполнения →</Button>
      </footer>
    </div>
  </article>
}

export function NewTaskCardView(props: NewTaskCardViewProps): JSX.Element {
  const { model, activeTab, callbacks } = props
  const [criterion, setCriterion] = useState('')
  const [sourceOpen, setSourceOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [makeFiles, setMakeFiles] = useState<Record<string, MakeFilesState>>({})
  const [makeEditor, setMakeEditor] = useState<{ linkId: string | null; initial: TaskCardMakeLinkDraft | null } | null>(null)
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([])
  // The body is one scroll container for every tab: without a reset the QA tab
  // opened at the scroll position the user left in the previous one.
  const bodyRef = useRef<HTMLElement>(null)
  const activeTabRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [activeTab])
  const setDraft = (patch: Partial<TaskReworkDraft>): void => callbacks.onChangeReworkDraft({ ...props.reworkDraft, ...patch })
  const submit = (): void => {
    if (!props.reworkDraft.description.trim()) return
    void callbacks.onSubmitRework(props.reworkDraft, 'rework-' + model.taskId + '-' + Date.now())
  }
  const versionSwitch = <div className="task-version-switch" role="group" aria-label="Версия карточки">
    <Button size="sm" variant={props.version === 'new' ? 'primary' : 'ghost'} aria-pressed={props.version === 'new'} onClick={() => props.onVersionChange('new')}>Новая</Button>
    <Button size="sm" variant={props.version === 'legacy' ? 'primary' : 'ghost'} aria-pressed={props.version === 'legacy'} onClick={() => props.onVersionChange('legacy')}>Старая</Button>
  </div>
  const headerActions = <>
    {model.actions.canRework && <Button size="sm" variant="primary" onClick={callbacks.onStartRework}>↩ На доработку · цикл {model.nextCycleNumber}</Button>}
    {versionSwitch}
  </>
  const canLinkMake = Boolean(callbacks.onLinkMake)
  const saveMakeLink = (draft: TaskCardMakeLinkDraft): void => {
    if (!makeEditor) return
    const done = makeEditor.linkId ? callbacks.onReplaceMake?.(makeEditor.linkId, draft) : callbacks.onLinkMake?.(draft)
    void Promise.resolve(done).then(() => setMakeEditor(null)).catch(() => { /* The container shows the error and reconciles actual links. */ })
  }

  const makeBlock = makeEditor
    ? <MakeDesignEditor
      heading={makeEditor.linkId ? 'Заменить дизайн Make' : 'Связать дизайн Make'}
      initial={makeEditor.initial}
      {...(props.makeSourcesState ? { choices: props.makeSourcesState } : {})}
      {...(props.makeLinkPending !== undefined ? { pending: props.makeLinkPending } : {})}
      {...(callbacks.onLoadMakeFiles ? { onLoadFiles: callbacks.onLoadMakeFiles } : {})}
      onCancel={() => setMakeEditor(null)}
      onSave={saveMakeLink}
    />
    : model.makeSources.length > 0
      ? <>{model.makeSources.map((source) => <MakeSourceCard
        key={source.id} source={source}
        onOpen={() => callbacks.onOpenMake(source.conversationId)}
        {...(callbacks.onUnlinkMake ? { onUnlink: () => void callbacks.onUnlinkMake?.(source.id) } : {})}
        {...(callbacks.onReplaceMake ? { onReplace: () => setMakeEditor({ linkId: source.id, initial: { conversationId: source.conversationId, mode: source.mode, paths: source.paths.map((path) => path.path) } }) } : {})}
      />)}</>
      : <section className="new-task-section new-task-make-empty">
        <div className="new-task-design-icon" aria-hidden="true">⌘</div>
        <div>
          <small className="new-task-eyebrow">Дизайн Make</small>
          <h3>Дизайн не связан</h3>
          <p>Свяжите живой Make-проект целиком или выберите конкретные файлы. AI получит их только для чтения.</p>
        </div>
        {canLinkMake && <Button size="sm" variant="primary" onClick={() => setMakeEditor({ linkId: null, initial: null })}>Связать дизайн</Button>}
      </section>

  const overview = <div className="new-task-grid">
    <div className="new-task-column">
      <section className="new-task-section">
        <header className="new-task-section-head"><h3>Актуальная постановка</h3><span className="new-task-cycle-badge">Цикл {model.cycleNumber}</span></header>
        <p>{model.description || 'Описание не заполнено'}</p>
        <CriteriaList source={model.source.acceptanceCriteria} current={model.acceptanceCriteria} />
      </section>
      <section className="new-task-section">
        <header className="new-task-section-head">
          <h3>Первоначальная постановка</h3>
          <Button size="sm" variant="ghost" aria-expanded={sourceOpen} onClick={() => setSourceOpen((open) => !open)}>{sourceOpen ? 'Скрыть' : 'Показать'}</Button>
        </header>
        {sourceOpen && <><p>{model.source.description || 'Описание не заполнено'}</p><p className="new-task-muted">{model.source.acceptanceCriteria || 'Критерии не заполнены'}</p></>}
      </section>
      {model.cycles.length > 0 && <section className="new-task-section new-task-section--current">
        <header className="new-task-section-head">
          <h3>Изменения в текущем цикле</h3>
          {model.cycles[model.cycles.length - 1]!.preparationRunId && <Button size="sm" variant="ghost" onClick={() => callbacks.onChangeTab('preparation')}>План →</Button>}
        </header>
        <p>{model.cycles[model.cycles.length - 1]!.description}</p>
      </section>}
      <section className="new-task-section">
        <header className="new-task-section-head"><h3>Описание · файлы</h3></header>
        <label
          className={'new-task-drop' + (dragOver ? ' new-task-drop--over' : '')}
          onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragOver(false)
            for (const file of Array.from(event.dataTransfer?.files ?? [])) void callbacks.onUploadAttachment?.('source', file)
          }}
        >
          <span>Перетащите файлы сюда</span>
          <small>или выберите с компьютера · AI читает без изменения</small>
          <input aria-label="Добавить вложение исходной задачи" type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void callbacks.onUploadAttachment?.('source', file) }} />
        </label>
        <FileRows files={model.source.attachments} onDelete={(id) => void callbacks.onDeleteAttachment?.(id)} {...(callbacks.loadAttachment ? { loadPreview: callbacks.loadAttachment } : {})} />
      </section>
      {makeBlock}
    </div>
    <aside className="new-task-column new-task-side">
      <section className="new-task-section">
        <h3>Workflow</h3>
        <WorkflowList steps={model.workflow} />
      </section>
      <section className="new-task-section">
        <h3>Задача</h3>
        <dl className="new-task-facts">
          <div><dt>Исполнитель</dt><dd>{model.assignee ?? 'Не назначена'}</dd></div>
          <div><dt>Приоритет</dt><dd>{model.priority}</dd></div>
          {model.branch && <div><dt>Ветка</dt><dd>{model.branch}</dd></div>}
          {model.commit && <div><dt>Коммит</dt><dd>{model.commit.slice(0, 8)}</dd></div>}
        </dl>
      </section>
      <section className="new-task-section">
        <h3>Последний ран</h3>
        {model.runs[0]
          ? <button type="button" className="new-task-run-link" onClick={() => callbacks.onOpenRun(model.runs[0]!.id)}>{model.runs[0].title} · {RUN_LABELS[model.runs[0].status]}</button>
          : <p className="new-task-muted">Ранов пока нет</p>}
      </section>
      {model.actions.canRework && <Button variant="primary" fullWidth onClick={callbacks.onStartRework}>↩ На доработку · цикл {model.nextCycleNumber}</Button>}
    </aside>
  </div>

  const selectable = model.drafts.map((cycle) => cycle.id)
  const selected = selectedDrafts.filter((id) => selectable.includes(id))
  const allSelected = selectable.length > 0 && selected.length === selectable.length
  const reworks = <div className="new-task-cycles">
    <section className="new-task-queue" aria-label="Очередь доработок">
      <header className="new-task-queue-head">
        <div>
          <small className="new-task-eyebrow">Очередь требований</small>
          <h3>Сохранённые доработки</h3>
          <p>Соберите несколько замечаний и запустите их одним новым циклом.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={callbacks.onStartRework}>＋ Добавить</Button>
      </header>
      {model.drafts.length > 0 && <div className="new-task-bulk-bar">
        <label><input type="checkbox" checked={allSelected} onChange={() => setSelectedDrafts(allSelected ? [] : selectable)} /> Выбрать все доступные</label>
        <span>Выбрано: {selected.length}</span>
        <Button size="sm" variant="primary" loading={props.reworkPending} disabled={!selected.length || !model.actions.canRework} title={model.actions.canRework ? undefined : 'Отправка доступна после успешной разработки'} onClick={() => void callbacks.onSubmitDrafts?.(selected)}>Отправить выбранные на доработку</Button>
      </div>}
      {model.drafts.length === 0
        ? <EmptyState title="Очередь пуста" description="Добавьте доработку — она сохранится черновиком и отправится отдельным циклом." />
        : <div className="new-task-rework-list" role="list">
          {model.drafts.map((cycle) => <DraftRow key={cycle.id} cycle={cycle} pending={props.reworkPending} canSubmit={model.actions.canRework} selected={selected.includes(cycle.id)} onToggle={() => setSelectedDrafts((all) => all.includes(cycle.id) ? all.filter((id) => id !== cycle.id) : [...all, cycle.id])} callbacks={callbacks} />)}
        </div>}
    </section>
    <div className="new-task-history-separator" role="separator" aria-label="История запущенных циклов"><span>История запущенных циклов</span></div>
    <header className="new-task-section-head new-task-history-head">
      <div><small className="new-task-eyebrow">Неизменяемая история</small><h3>Циклы разработки</h3></div>
      <Badge>{pluralRu(model.cycles.length, 'цикл', 'цикла', 'циклов')}</Badge>
    </header>
    {model.cycles.length === 0
      ? <EmptyState title="Доработок пока не было" description="Отправленный цикл появится здесь вместе со ссылками на его подготовку и разработку." />
      : <div className="new-task-cycle-list" role="list">
        {[...model.cycles].sort((a, b) => b.sequence - a.sequence).map((cycle) => <CycleRow key={cycle.id} cycle={cycle} callbacks={callbacks} />)}
      </div>}
  </div>

  return <Dialog
    title={<span>
      <small className="new-task-key">{model.taskKey} · {model.projectName}</small>
      <span className="new-task-title" title={model.title}>{model.title}</span>
      <small className="new-task-stage-line">
        <span className={'new-task-stage new-task-stage--' + (model.stage.fallback ? 'fallback' : model.stage.semanticType)}>
          {model.stage.label}{model.stage.statusLabel ? ` · ${model.stage.statusLabel}` : ''}
        </span>
        <span className="new-task-cycle-badge">Цикл {model.cycleNumber}</span>
        {model.stage.note && <span className="new-task-muted">{model.stage.note}</span>}
      </small>
    </span>}
    ariaLabel={'Задача ' + model.taskKey}
    size="full"
    onClose={callbacks.onClose}
    closeOnOverlay={false}
    actions={headerActions}
    className="new-task-dialog"
    initialFocusRef={activeTabRef}
  >
    <div className="new-task-card">
      {model.actions.hasActiveRun && <div className="new-task-banner" role="status">
        <strong>Активный ран блокирует возврат</strong>
        <span>{model.actions.reworkBlockedReason ?? 'Остановите его или дождитесь завершения.'}</span>
        {model.actions.canStopRun && callbacks.onStopRun && <Button size="sm" variant="danger" onClick={() => void callbacks.onStopRun?.()}>Остановить ран</Button>}
      </div>}
      <nav className="new-task-tabs" aria-label="Разделы карточки" role="tablist">
        {model.tabs.map((tab) =>
          <Button key={tab.id} size="sm" variant="ghost" role="tab" aria-selected={tab.id === activeTab} {...(tab.id === activeTab ? { ref: activeTabRef } : {})} onClick={() => callbacks.onChangeTab(tab.id)}>
            {tab.label}
            {tab.count != null && tab.count > 0 && <span className="new-task-tab-count">{tab.count}</span>}
            {tab.live && <span className="new-task-tab-live" aria-label="идёт сейчас" />}
          </Button>
        )}
      </nav>
      <main className="new-task-body" ref={bodyRef}>
        {props.reworkError && !props.reworkOpen && <ErrorState compact message={props.reworkError} onRetry={callbacks.onRetryHistory} />}
        {model.loadState === 'loading' && <div role="status" aria-label="Карточка загружается"><Skeleton height={120} /><Skeleton height={200} /></div>}
        {model.loadState === 'error' && <ErrorState message="Не удалось загрузить карточку" detail={model.error ?? 'Повторите попытку позже.'} onRetry={callbacks.onRetryHistory} />}
        {model.loadState === 'empty' && <EmptyState title="Данные задачи отсутствуют" description="Закройте карточку и обновите доску." />}
        {model.loadState === 'ready' && activeTab === 'overview' && overview}
        {model.loadState === 'ready' && activeTab === 'reworks' && reworks}
        {model.loadState === 'ready' && activeTab !== 'overview' && activeTab !== 'reworks' && (props.renderPanel?.(activeTab) ?? null)}
      </main>
    </div>
    {props.reworkOpen && <div className="new-task-rework" role="dialog" aria-modal="true" aria-label="Новый цикл доработки">
      <header><h3>{props.reworkDraft.editingId ? 'Правка доработки' : 'Новая доработка'}</h3><Button size="sm" variant="ghost" onClick={callbacks.onCancelRework}>Закрыть</Button></header>
      <div className="new-task-rework-body">
        {model.actions.hasActiveRun && <div className="new-task-warning" role="alert"><strong>Сейчас выполняется ран</strong><p>Черновик сохранится, но отправить его можно будет только после завершения рана.</p></div>}
        <label>Описание доработки<textarea value={props.reworkDraft.description} onChange={(e) => setDraft({ description: e.target.value })} aria-invalid={!props.reworkDraft.description.trim()} /></label>
        <label>Дополнительный критерий<div className="new-task-inline"><input value={criterion} onChange={(e) => setCriterion(e.target.value)} /><Button size="sm" onClick={() => { if (criterion.trim()) { setDraft({ criteria: [...props.reworkDraft.criteria, criterion.trim()] }); setCriterion('') } }}>Добавить</Button></div></label>
        <ul>{props.reworkDraft.criteria.map((item, index) => <li key={index}>{item}</li>)}</ul>
        <fieldset><legend>Make-источники</legend>
          {props.makeSourcesState?.state === 'loading' && <p role="status">Загружаем Make-проекты…</p>}
          {props.makeSourcesState?.state === 'error' && <div role="alert"><p>{props.makeSourcesState.error ?? 'Не удалось загрузить Make-проекты'}</p><Button size="sm" onClick={callbacks.onRetryMakeSources}>Повторить</Button></div>}
          {props.makeSourcesState?.state === 'empty' && <EmptyState title="Нет доступных Make-проектов" description="Цикл можно создать без Make-источника." />}
          {props.makeSourcesState?.items.map((source) => {
            const selectedSource = props.reworkDraft.makeSources?.find((item) => item.conversationId === source.conversationId)
            const update = (next?: { conversationId: string; mode: 'whole_project' | 'files'; paths: string[] }) => setDraft({ makeSources: next ? [...(props.reworkDraft.makeSources ?? []).filter((item) => item.conversationId !== source.conversationId), next] : (props.reworkDraft.makeSources ?? []).filter((item) => item.conversationId !== source.conversationId) })
            return <div key={source.conversationId}><label><input type="checkbox" checked={Boolean(selectedSource)} onChange={(e) => update(e.target.checked ? { conversationId: source.conversationId, mode: 'whole_project', paths: [] } : undefined)} />{source.title}</label>
              {selectedSource && <><label><input type="radio" name={'mode-' + source.conversationId} checked={selectedSource.mode === 'whole_project'} onChange={() => update({ ...selectedSource, mode: 'whole_project', paths: [] })} />Весь проект</label><label><input type="radio" name={'mode-' + source.conversationId} checked={selectedSource.mode === 'files'} onChange={() => { update({ ...selectedSource, mode: 'files', paths: [] }); setMakeFiles((all) => ({ ...all, [source.conversationId]: { state: 'loading', paths: [] } })); void callbacks.onLoadMakeFiles?.(source.conversationId).then((paths) => setMakeFiles((all) => ({ ...all, [source.conversationId]: { state: 'ready', paths } }))).catch(() => setMakeFiles((all) => ({ ...all, [source.conversationId]: { state: 'error', paths: [] } }))) }} />Отдельные файлы</label>
              {selectedSource.mode === 'files' && (makeFiles[source.conversationId]?.state === 'loading' ? <p role="status">Загружаем файлы…</p> : makeFiles[source.conversationId]?.state === 'error' ? <p role="alert">Не удалось загрузить файлы</p> : (makeFiles[source.conversationId]?.paths.length ? makeFiles[source.conversationId]!.paths.map((path) => <label key={path}><input type="checkbox" checked={selectedSource.paths.includes(path)} onChange={(e) => update({ ...selectedSource, paths: e.target.checked ? [...selectedSource.paths, path].sort() : selectedSource.paths.filter((item) => item !== path) })} />{path}</label>) : <p>В проекте нет файлов</p>))}</>}
            </div>
          })}
        </fieldset>
        <label>Вложения цикла<input aria-label="Добавить вложение цикла" type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void callbacks.onUploadAttachment?.('rework_draft', file) }} /></label>
        <FileRows files={props.reworkDraft.attachments} onDelete={(id) => void callbacks.onDeleteAttachment?.(id)} />
        <div className="new-task-note">«Сохранить» добавит требование в очередь без перемещения задачи. Отправить его на доработку можно из очереди — по одному или выбранным набором.</div>
        {props.reworkError && <p className="new-task-source-error" role="alert">{props.reworkError}</p>}
      </div>
      <footer>
        <Button onClick={callbacks.onCancelRework}>Отмена</Button>
        <Button variant="primary" loading={props.reworkPending} disabled={!props.reworkDraft.description.trim() || Boolean(props.reworkDraft.makeSources?.some((source) => source.mode === 'files' && !source.paths.length))} onClick={submit}>
          {props.reworkDraft.editingId ? 'Сохранить черновик' : 'Сохранить как черновик'}
        </Button>
      </footer>
    </div>}
  </Dialog>
}
