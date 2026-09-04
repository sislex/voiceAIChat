import { useState } from 'react'
import { Button, Dialog, EmptyState, ErrorState, Skeleton } from '@voicechat/ui-kit'
import type { TaskCardCallbacks, TaskCardTab, TaskCardVersion, TaskCardViewModel, TaskReworkDraft } from './TaskCardViewModel'

const TAB_LABELS: Record<TaskCardTab, string> = {
  overview: 'Обзор', workflow: 'Workflow', runs: 'Раны', files: 'Файлы и Make', history: 'История доработок'
}
const RUN_LABELS = {
  queued: 'В очереди', running: 'Выполняется', waiting_for_answer: 'Ждёт ответа',
  success: 'Успешно', failed: 'Ошибка', cancelled: 'Отменён'
} as const

export interface NewTaskCardViewProps {
  model: TaskCardViewModel
  activeTab: TaskCardTab
  version: TaskCardVersion
  reworkOpen: boolean
  reworkDraft: TaskReworkDraft
  reworkPending?: boolean
  reworkError?: string | null
  makeState?: import('./TaskCardViewModel').TaskCardLoadState
  availableMakeSources?: import('@shared/projects').ProjectDesignSource[]
  onRetryMake?(): void
  onVersionChange(version: TaskCardVersion): void
  callbacks: TaskCardCallbacks
}

function FileRows({ files, onDelete }: { files: TaskCardViewModel['source']['attachments']; onDelete?: (id: string) => void }): JSX.Element {
  if (!files.length) return <EmptyState title="Файлов пока нет" description="Добавленные материалы появятся здесь." />
  return <div className="new-task-files" role="list">{files.map((file) =>
    <div className={'new-task-file new-task-file--' + file.status} role="listitem" key={file.id}>
      <span>{file.name}</span><small>{file.error ?? file.mimeType ?? 'Файл'}</small>
      {onDelete && file.status !== 'uploading' && <Button size="sm" variant="ghost" onClick={() => onDelete(file.id)}>Удалить</Button>}
    </div>
  )}</div>
}

function AttachmentPicker({ label, onPick }: { label: string; onPick?: (file: File) => void }): JSX.Element | null {
  if (!onPick) return null
  return <label>{label}<input type="file" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onPick(file); event.currentTarget.value = '' }} /></label>
}

export function NewTaskCardView(props: NewTaskCardViewProps): JSX.Element {
  const { model, activeTab, callbacks } = props
  const [criterion, setCriterion] = useState('')
  const draftSources = props.reworkDraft.makeSources ?? []
  const setDraft = (patch: Partial<TaskReworkDraft>): void => callbacks.onChangeReworkDraft({ ...props.reworkDraft, ...patch })
  const submit = (): void => {
    if (!props.reworkDraft.description.trim() || model.actions.hasActiveRun) return
    void callbacks.onSubmitRework(props.reworkDraft, 'rework-' + model.taskId + '-' + Date.now())
  }
  const versionSwitch = <div className="task-version-switch" role="group" aria-label="Версия карточки">
    <Button size="sm" variant={props.version === 'new' ? 'primary' : 'ghost'} aria-pressed={props.version === 'new'} onClick={() => props.onVersionChange('new')}>Новая</Button>
    <Button size="sm" variant={props.version === 'legacy' ? 'primary' : 'ghost'} aria-pressed={props.version === 'legacy'} onClick={() => props.onVersionChange('legacy')}>Старая</Button>
  </div>

  return <Dialog
    title={<span><small className="new-task-key">{model.taskKey} · {model.projectName}</small>{model.title}</span>}
    ariaLabel={'Задача ' + model.taskKey}
    size="full"
    onClose={callbacks.onClose}
    closeOnOverlay={false}
    actions={versionSwitch}
    className="new-task-dialog"
  >
    <div className="new-task-card">
      <header className="new-task-summary">
        <span className={'new-task-stage new-task-stage--' + (model.stage.fallback ? 'fallback' : model.stage.semanticType)}>{model.stage.label}</span>
        <span>{model.priority}</span><span>{model.assignee ?? 'Не назначена'}</span>
        {model.actions.canRework && <Button size="sm" variant="primary" onClick={callbacks.onStartRework}>На доработку</Button>}
      </header>
      <nav className="new-task-tabs" aria-label="Разделы карточки" role="tablist">
        {(Object.keys(TAB_LABELS) as TaskCardTab[]).map((tab) =>
          <Button key={tab} size="sm" variant="ghost" role="tab" aria-selected={tab === activeTab} onClick={() => callbacks.onChangeTab(tab)}>{TAB_LABELS[tab]}</Button>
        )}
      </nav>
      <main className="new-task-body">
        {model.loadState === 'loading' && <div role="status" aria-label="Карточка загружается"><Skeleton height={120} /><Skeleton height={200} /></div>}
        {model.loadState === 'error' && <ErrorState message="Не удалось загрузить карточку" detail={model.error ?? 'Повторите попытку позже.'} />}
        {model.loadState === 'empty' && <EmptyState title="Данные задачи отсутствуют" description="Закройте карточку и обновите доску." />}
        {model.loadState === 'ready' && activeTab === 'overview' && <div className="new-task-grid">
          <div className="new-task-column">
            <section className="new-task-section"><h3>Исходная постановка</h3><p>{model.source.description || 'Описание не заполнено'}</p><h4>Критерии приёмки</h4><p>{model.source.acceptanceCriteria || 'Критерии не заполнены'}</p><FileRows files={model.source.attachments} /></section>
            <section className="new-task-section"><h3>Текущая постановка</h3><p>{model.description || 'Описание не заполнено'}</p><p>{model.acceptanceCriteria}</p></section>
          </div>
          <aside className="new-task-column">
            <section className="new-task-section"><h3>Workflow</h3>{model.workflow.map((step) => <div className={'new-task-workflow-step new-task-workflow-step--' + step.state} key={step.id}><i aria-hidden="true" />{step.label}</div>)}</section>
            <section className="new-task-section"><h3>Последний ран</h3>{model.runs[0] ? <button className="new-task-run-link" onClick={() => callbacks.onOpenRun(model.runs[0]!.id)}>{model.runs[0].title} · {RUN_LABELS[model.runs[0].status]}</button> : <p>Ранов пока нет</p>}</section>
          </aside>
        </div>}
        {model.loadState === 'ready' && activeTab === 'workflow' && <section className="new-task-section">{model.workflow.map((step) => <div className={'new-task-workflow-step new-task-workflow-step--' + step.state} key={step.id}><i aria-hidden="true" /><strong>{step.label}</strong></div>)}</section>}
        {model.loadState === 'ready' && activeTab === 'runs' && <section className="new-task-section"><h3>Раны</h3>{model.runs.length ? model.runs.map((run) => <button className="new-task-run-link" key={run.id} onClick={() => callbacks.onOpenRun(run.id)}><strong>{run.title}</strong><span className={'new-task-run-status new-task-run-status--' + run.status}>{RUN_LABELS[run.status]}</span></button>) : <EmptyState title="Ранов пока нет" description="История появится после запуска этапа." />}</section>}
        {model.loadState === 'ready' && activeTab === 'files' && <div className="new-task-grid"><section className="new-task-section"><h3>Вложения исходной задачи</h3><AttachmentPicker label="Загрузить вложение" onPick={(file) => void callbacks.onUploadAttachment?.(file, 'task')} /><FileRows files={model.source.attachments} onDelete={(id) => void callbacks.onDeleteAttachment?.(id, 'task')} /></section><section className="new-task-section"><h3>Make-связи</h3>{model.makeSources.length ? model.makeSources.map((source) => <article key={source.id}><Button size="sm" variant="ghost" onClick={() => callbacks.onOpenMake(source.conversationId)}>{source.title}</Button><small>{source.mode === 'whole_project' ? 'Проект целиком' : source.paths.map((path) => path.path).join(', ')}</small>{source.paths.filter((path) => !path.available).map((path) => <p className="new-task-source-error" key={path.path}>{path.path}: {path.error ?? 'Файл недоступен'}</p>)}</article>) : <EmptyState title="Make не связан" description="Связь можно добавить в старой карточке." />}</section></div>}
        {model.loadState === 'ready' && activeTab === 'history' && <section className="new-task-section"><h3>История доработок</h3>{model.cycles.length ? model.cycles.map((cycle) => <article className="new-task-cycle" key={cycle.id}><strong>Цикл {cycle.sequence}</strong><p>{cycle.description}</p>{cycle.criteria.length > 0 && <><h4>Критерии</h4><ul>{cycle.criteria.map((item) => <li key={item}>{item}</li>)}</ul></>}{cycle.makeSources.length > 0 && <><h4>Make-снимок</h4>{cycle.makeSources.map((source) => <div key={source.conversationId}><strong>{source.title}</strong><small>{source.mode === 'whole_project' ? 'Проект целиком' : source.paths.map((path) => path.path).join(', ')}</small>{source.paths.filter((path) => !path.available).map((path) => <p className="new-task-source-error" key={path.path}>{path.path}: {path.error ?? 'Файл недоступен'}</p>)}</div>)}</>}{cycle.attachments.length > 0 && <><h4>Вложения</h4><FileRows files={cycle.attachments} /></>}<small>{new Date(cycle.createdAt).toLocaleString('ru-RU')} · {cycle.createdBy}</small></article>) : <EmptyState title="Доработок пока не было" description="После успешной разработки здесь сохраняются неизменяемые циклы." />}</section>}
      </main>
    </div>
    {props.reworkOpen && <div className="new-task-rework" role="dialog" aria-modal="true" aria-label="Новый цикл доработки">
      <header><h3>На доработку</h3><Button size="sm" variant="ghost" onClick={callbacks.onCancelRework}>Закрыть</Button></header>
      <div className="new-task-rework-body">
        {model.actions.hasActiveRun && <div className="new-task-warning" role="alert"><strong>Сейчас выполняется ран</strong><p>{model.actions.reworkBlockedReason ?? 'Создание цикла заблокировано: текущий ран не будет отменён или заменён.'}</p><p>Безопасно: оставить ран выполняться или открыть его.</p></div>}
        <label>Описание доработки<textarea value={props.reworkDraft.description} onChange={(e) => setDraft({ description: e.target.value })} aria-invalid={!props.reworkDraft.description.trim()} /></label>
        <label>Дополнительный критерий<div className="new-task-inline"><input value={criterion} onChange={(e) => setCriterion(e.target.value)} /><Button size="sm" onClick={() => { if (criterion.trim()) { setDraft({ criteria: [...props.reworkDraft.criteria, criterion.trim()] }); setCriterion('') } }}>Добавить</Button></div></label>
        <ul>{props.reworkDraft.criteria.map((item, index) => <li key={index}>{item}</li>)}</ul>
        <fieldset><legend>Make-источники</legend>
          {props.makeState === 'loading' && <div role="status"><Skeleton height={56} /></div>}
          {props.makeState === 'error' && <div role="alert"><ErrorState message="Не удалось загрузить Make-проекты" /><Button size="sm" onClick={props.onRetryMake}>Повторить</Button></div>}
          {props.makeState === 'empty' && <EmptyState title="Нет доступных Make-проектов" description="Цикл можно создать без Make-источника." />}
          {props.makeState === 'ready' && props.availableMakeSources?.map((source) => {
            const selected = draftSources.find((item) => item.conversationId === source.conversationId)
            const update = (patch: Partial<NonNullable<typeof selected>>): void => {
              if (!selected) return
              setDraft({ makeSources: draftSources.map((item) => item.conversationId === source.conversationId ? { ...item, ...patch } : item) })
            }
            const toggle = (): void => {
              if (selected) setDraft({ makeSources: draftSources.filter((item) => item.conversationId !== source.conversationId) })
              else setDraft({ makeSources: [...draftSources, { conversationId: source.conversationId, title: source.title, mode: 'whole_project', paths: [] }] })
            }
            const loadFiles = (): void => {
              update({ mode: 'files', paths: [], filesState: 'loading' })
              void window.api['projects:designSourceFiles']({ projectId: model.projectId ?? model.taskId, conversationId: source.conversationId })
                .then((files) => update({ files: files.map((file) => file.path), filesState: files.length ? 'ready' : 'empty' }))
                .catch((cause) => update({ filesState: 'error', error: cause instanceof Error ? cause.message : 'Не удалось загрузить файлы.' }))
            }
            return <div key={source.conversationId} className="new-task-make-choice">
              <label><input type="checkbox" checked={Boolean(selected)} onChange={toggle} /> {source.title}</label>
              {selected && <div><label><input type="radio" checked={selected.mode === 'whole_project'} onChange={() => update({ mode: 'whole_project', paths: [] })} /> Весь проект</label>
                <label><input type="radio" checked={selected.mode === 'files'} onChange={loadFiles} /> Отдельные файлы</label>
                {selected.filesState === 'loading' && <span role="status">Загрузка файлов…</span>}
                {selected.filesState === 'empty' && <small>В проекте нет файлов</small>}
                {selected.filesState === 'error' && <Button size="sm" onClick={loadFiles}>Повторить загрузку файлов</Button>}
                {selected.files?.map((path) => <label key={path}><input type="checkbox" checked={selected.paths.includes(path)} onChange={() => update({ paths: selected.paths.includes(path) ? selected.paths.filter((item) => item !== path) : [...selected.paths, path].sort() })} /> {path}</label>)}
              </div>}
            </div>
          })}
        </fieldset>
        <AttachmentPicker label="Загрузить вложение цикла" onPick={(file) => void callbacks.onUploadAttachment?.(file, 'rework')} />
        <FileRows files={props.reworkDraft.attachments} onDelete={(id) => void callbacks.onDeleteAttachment?.(id, 'rework')} />
        {props.reworkError && <p className="new-task-source-error" role="alert">{props.reworkError}</p>}
      </div>
      <footer><Button onClick={callbacks.onCancelRework}>Отмена</Button><Button variant="primary" loading={props.reworkPending} disabled={!props.reworkDraft.description.trim() || model.actions.hasActiveRun} onClick={submit}>Создать цикл</Button></footer>
    </div>}
  </Dialog>
}
