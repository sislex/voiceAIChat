import { useState, type ReactNode } from 'react'
import { Button, Dialog, EmptyState, ErrorState, Skeleton } from '@voicechat/ui-kit'
import { formatDateTime } from '../../lib/dateFormat'
import { fmtDuration } from '../ci/ciFormat'
import { CRITERION_STATE_LABEL, diffCriteria } from './criteriaDiff'
import type { TaskCardCallbacks, TaskCardTab, TaskCardVersion, TaskCardViewModel, TaskReworkCycleViewModel, TaskReworkDraft, TaskReworkSourcesState } from './TaskCardViewModel'

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
  onVersionChange(version: TaskCardVersion): void
  callbacks: TaskCardCallbacks
  /**
   * Содержимое вкладок, которые новая карточка не рисует сама: подготовка,
   * настройки, ход выполнения, QA, merge и лента рана. Панели те же, что в
   * старой карточке, — дублировать их логику в новой оболочке незачем.
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

function MakeSourceCard({ source, onOpen, onUnlink, onReplace, choices }: {
  source: TaskCardViewModel['makeSources'][number]
  onOpen(): void
  onUnlink?(): void
  /** Замена макета: связь переезжает на другой Make-проект того же проекта. */
  onReplace?(conversationId: string): void
  choices?: TaskReworkSourcesState
}): JSX.Element {
  const [replacing, setReplacing] = useState(false)
  const broken = source.paths.filter((path) => !path.available)
  return <article className="new-task-make" key={source.id}>
    <header>
      <div><small>Дизайн Make</small><h4>{source.title}</h4></div>
      <span className={'new-task-make-status new-task-make-status--' + (broken.length ? 'broken' : 'ok')}>{broken.length ? 'Файлы недоступны' : 'Доступен'}</span>
    </header>
    <dl className="new-task-make-facts">
      <div><dt>Режим</dt><dd>{source.mode === 'whole_project' ? 'Проект целиком' : `${source.paths.length} файла`}</dd></div>
      <div><dt>Обновлён</dt><dd>{source.updatedAt ? formatDateTime(source.updatedAt) : '—'}</dd></div>
      <div><dt>Доступ AI</dt><dd>Только чтение</dd></div>
    </dl>
    {source.mode === 'files' && <div className="new-task-make-files" role="list">{source.paths.map((path) =>
      <div className="new-task-make-file" role="listitem" key={path.path}>
        <span>{path.path}</span>
        <small className={path.available ? '' : 'new-task-source-error'}>{path.available ? 'Доступен' : path.error ?? 'Недоступен'}</small>
      </div>
    )}</div>}
    <footer>
      <Button size="sm" variant="secondary" onClick={onOpen}>Открыть превью</Button>
      {onReplace && !replacing && <Button size="sm" variant="secondary" onClick={() => setReplacing(true)}>Заменить</Button>}
      {onReplace && replacing && <label className="new-task-make-replace">Новый макет
        <select
          aria-label="Новый макет"
          defaultValue=""
          onChange={(event) => { if (event.target.value) { onReplace(event.target.value); setReplacing(false) } }}
        >
          <option value="" disabled>Выберите проект</option>
          {(choices?.items ?? []).filter((item) => item.conversationId !== source.conversationId).map((item) =>
            <option key={item.conversationId} value={item.conversationId}>{item.title}</option>
          )}
        </select>
      </label>}
      {onUnlink && <Button size="sm" variant="danger" onClick={onUnlink}>Удалить связь</Button>}
    </footer>
  </article>
}

/** Одна доработка: черновик с действиями или отправленный неизменяемый цикл. */
function ReworkRow({ cycle, callbacks }: { cycle: TaskReworkCycleViewModel; callbacks: TaskCardCallbacks }): JSX.Element {
  const draft = cycle.status === 'draft'
  // Заголовок строки — первая строка описания, остальное уходит в тело: иначе
  // однострочная доработка показывалась бы дважды подряд.
  const [title, ...rest] = cycle.description.split('\n')
  return <article className={'new-task-rework-row new-task-rework-row--' + cycle.status} role="listitem">
    <header>
      <span className="new-task-rework-num">№ {cycle.sequence}</span>
      <strong>{title || 'Без описания'}</strong>
      <span className={'new-task-rework-badge new-task-rework-badge--' + (draft ? 'draft' : cycle.merged ? 'merged' : 'sent')}>
        {draft ? 'Черновик' : cycle.merged ? 'Вмержено в main' : 'Отправлена'}
      </span>
      <small>{formatDateTime(cycle.createdAt)}</small>
    </header>
    {rest.join('\n').trim() && <p>{rest.join('\n')}</p>}
    <small className="new-task-rework-counts">
      {cycle.criteria.length} критерия · {cycle.makeSources.reduce((sum, source) => sum + source.paths.length, 0)} Make-файла · {cycle.attachments.length} вложение
    </small>
    {draft && <footer className="new-task-rework-actions">
      <Button size="sm" variant="primary" onClick={() => void callbacks.onSubmitDraft?.(cycle.id)}>Отправить на доработку</Button>
      <Button size="sm" variant="secondary" onClick={() => callbacks.onEditDraft?.(cycle.id)}>Изменить</Button>
      <Button size="sm" variant="danger" onClick={() => void callbacks.onDeleteDraft?.(cycle.id)}>Удалить</Button>
    </footer>}
  </article>
}

export function NewTaskCardView(props: NewTaskCardViewProps): JSX.Element {
  const { model, activeTab, callbacks } = props
  const [criterion, setCriterion] = useState('')
  const [sourceOpen, setSourceOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [makeFiles, setMakeFiles] = useState<Record<string, { state: 'loading' | 'ready' | 'error'; paths: string[] }>>({})
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
    {callbacks.onOpenChat && <Button size="sm" variant="secondary" onClick={callbacks.onOpenChat}>Открыть чат</Button>}
    {model.actions.canRework && <Button size="sm" variant="primary" onClick={callbacks.onStartRework}>↩ На доработку · цикл {model.nextCycleNumber}</Button>}
    {versionSwitch}
  </>

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
      {model.makeSources.length > 0
        ? model.makeSources.map((source) => <MakeSourceCard
          key={source.id} source={source}
          onOpen={() => callbacks.onOpenMake(source.conversationId)}
          {...(props.makeSourcesState ? { choices: props.makeSourcesState } : {})}
          {...(callbacks.onUnlinkMake ? { onUnlink: () => void callbacks.onUnlinkMake?.(source.id) } : {})}
          {...(callbacks.onReplaceMake ? { onReplace: (conversationId: string) => void callbacks.onReplaceMake?.(source.id, conversationId) } : {})}
        />)
        : <section className="new-task-section"><h3>Дизайн Make</h3><EmptyState title="Make не связан" description="Связь с макетом добавляется в старой карточке." /></section>}
    </div>
    <aside className="new-task-column new-task-side">
      <section className="new-task-section">
        <h3>Workflow</h3>
        <ol className="new-task-workflow" role="list">{model.workflow.map((step, index) =>
          <li className={'new-task-workflow-step new-task-workflow-step--' + step.state} key={step.id} role="listitem">
            <span className="new-task-workflow-num" aria-hidden="true">{index + 1}</span>
            <span className="new-task-workflow-body"><strong>{step.label}</strong><small>{WORKFLOW_STATE_LABEL[step.state]}</small></span>
            {step.durationMs != null && <small className="new-task-workflow-time">{fmtDuration(step.durationMs)}</small>}
          </li>
        )}</ol>
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
    </aside>
  </div>

  const reworks = <section className="new-task-section">
    <header className="new-task-section-head">
      <h3>Доработки</h3>
      {model.actions.canRework && <Button size="sm" variant="secondary" onClick={callbacks.onStartRework}>Добавить доработку</Button>}
    </header>
    {model.drafts.length + model.cycles.length === 0
      ? <EmptyState title="Доработок пока не было" description="Соберите набор изменений — он отправится отдельным циклом." />
      : <>
        {/* Два списка, а не один с заголовком внутри: у role="list" разрешены
            только listitem, и заголовок истории ломал бы дерево доступности. */}
        {model.drafts.length > 0 && <div className="new-task-rework-list" role="list">
          {model.drafts.map((cycle) => <ReworkRow key={cycle.id} cycle={cycle} callbacks={callbacks} />)}
        </div>}
        {model.cycles.length > 0 && <>
          <h4 className="new-task-rework-history">История запущенных циклов</h4>
          <div className="new-task-rework-list" role="list">
            {model.cycles.map((cycle) => <ReworkRow key={cycle.id} cycle={cycle} callbacks={callbacks} />)}
          </div>
        </>}
      </>}
  </section>

  return <Dialog
    title={<span>
      <small className="new-task-key">{model.taskKey} · {model.projectName}</small>
      {model.title}
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
  >
    <div className="new-task-card">
      {model.actions.hasActiveRun && <div className="new-task-banner" role="status">
        <strong>Активный ран блокирует возврат</strong>
        <span>{model.actions.reworkBlockedReason ?? 'Остановите его или дождитесь завершения.'}</span>
        {model.actions.canStopRun && callbacks.onStopRun && <Button size="sm" variant="danger" onClick={() => void callbacks.onStopRun?.()}>Остановить ран</Button>}
      </div>}
      <nav className="new-task-tabs" aria-label="Разделы карточки" role="tablist">
        {model.tabs.map((tab) =>
          <Button key={tab.id} size="sm" variant="ghost" role="tab" aria-selected={tab.id === activeTab} onClick={() => callbacks.onChangeTab(tab.id)}>
            {tab.label}
            {tab.count != null && tab.count > 0 && <span className="new-task-tab-count">{tab.count}</span>}
            {tab.live && <span className="new-task-tab-live" aria-label="идёт сейчас" />}
          </Button>
        )}
      </nav>
      <main className="new-task-body">
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
            const selected = props.reworkDraft.makeSources?.find((item) => item.conversationId === source.conversationId)
            const update = (next?: { conversationId: string; mode: 'whole_project' | 'files'; paths: string[] }) => setDraft({ makeSources: next ? [...(props.reworkDraft.makeSources ?? []).filter((item) => item.conversationId !== source.conversationId), next] : (props.reworkDraft.makeSources ?? []).filter((item) => item.conversationId !== source.conversationId) })
            return <div key={source.conversationId}><label><input type="checkbox" checked={Boolean(selected)} onChange={(e) => update(e.target.checked ? { conversationId: source.conversationId, mode: 'whole_project', paths: [] } : undefined)} />{source.title}</label>
              {selected && <><label><input type="radio" name={'mode-' + source.conversationId} checked={selected.mode === 'whole_project'} onChange={() => update({ ...selected, mode: 'whole_project', paths: [] })} />Весь проект</label><label><input type="radio" name={'mode-' + source.conversationId} checked={selected.mode === 'files'} onChange={() => { update({ ...selected, mode: 'files', paths: [] }); setMakeFiles((all) => ({ ...all, [source.conversationId]: { state: 'loading', paths: [] } })); void callbacks.onLoadMakeFiles?.(source.conversationId).then((paths) => setMakeFiles((all) => ({ ...all, [source.conversationId]: { state: 'ready', paths } }))).catch(() => setMakeFiles((all) => ({ ...all, [source.conversationId]: { state: 'error', paths: [] } }))) }} />Отдельные файлы</label>
              {selected.mode === 'files' && (makeFiles[source.conversationId]?.state === 'loading' ? <p role="status">Загружаем файлы…</p> : makeFiles[source.conversationId]?.state === 'error' ? <p role="alert">Не удалось загрузить файлы</p> : (makeFiles[source.conversationId]?.paths.length ? makeFiles[source.conversationId]!.paths.map((path) => <label key={path}><input type="checkbox" checked={selected.paths.includes(path)} onChange={(e) => update({ ...selected, paths: e.target.checked ? [...selected.paths, path].sort() : selected.paths.filter((item) => item !== path) })} />{path}</label>) : <p>В проекте нет файлов</p>))}</>}
            </div>
          })}
        </fieldset>
        <label>Вложения цикла<input aria-label="Добавить вложение цикла" type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void callbacks.onUploadAttachment?.('rework_draft', file) }} /></label>
        <FileRows files={props.reworkDraft.attachments} onDelete={(id) => void callbacks.onDeleteAttachment?.(id)} />
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
