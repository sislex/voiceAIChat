import { useState } from 'react'
import { Button, Dialog, EmptyState, ErrorState, Skeleton } from '@voicechat/ui-kit'
import type { TaskCardCallbacks, TaskCardTab, TaskCardVersion, TaskCardViewModel, TaskReworkDraft, TaskReworkSourcesState } from './TaskCardViewModel'

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
  makeSourcesState?: TaskReworkSourcesState
  onVersionChange(version: TaskCardVersion): void
  callbacks: TaskCardCallbacks
}

function FileRows({ files, onDelete }: { files: TaskCardViewModel['source']['attachments']; onDelete?: (id: string) => void }): JSX.Element {
  if (!files.length) return <EmptyState title="Файлов пока нет" description="Добавленные материалы появятся здесь." />
  return <div className="new-task-files" role="list">{files.map((file) =>
    <div className={'new-task-file new-task-file--' + file.status} role="listitem" key={file.id}>
      <span>{file.name}</span><small>{file.error ?? file.mimeType ?? 'Файл'}</small>{onDelete && file.status !== 'uploading' && <Button size="sm" variant="ghost" onClick={() => onDelete(file.id)}>Удалить</Button>}
    </div>
  )}</div>
}

export function NewTaskCardView(props: NewTaskCardViewProps): JSX.Element {
  const { model, activeTab, callbacks } = props
  const [criterion, setCriterion] = useState('')
  const [makeFiles, setMakeFiles] = useState<Record<string, { state: 'loading' | 'ready' | 'error'; paths: string[] }>>({})
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
            <section className="new-task-section"><h3>Исходная постановка</h3><p>{model.source.description || 'Описание не заполнено'}</p><h4>Критерии приёмки</h4><p>{model.source.acceptanceCriteria || 'Критерии не заполнены'}</p><input aria-label="Добавить вложение исходной задачи" type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void callbacks.onUploadAttachment?.('source', file) }} /><FileRows files={model.source.attachments} onDelete={(id) => void callbacks.onDeleteAttachment?.(id)} /></section>
            <section className="new-task-section"><h3>Текущая постановка</h3><p>{model.description || 'Описание не заполнено'}</p><p>{model.acceptanceCriteria}</p></section>
          </div>
          <aside className="new-task-column">
            <section className="new-task-section"><h3>Workflow</h3>{model.workflow.map((step) => <div className={'new-task-workflow-step new-task-workflow-step--' + step.state} key={step.id}><i aria-hidden="true" />{step.label}</div>)}</section>
            <section className="new-task-section"><h3>Последний ран</h3>{model.runs[0] ? <button className="new-task-run-link" onClick={() => callbacks.onOpenRun(model.runs[0]!.id)}>{model.runs[0].title} · {RUN_LABELS[model.runs[0].status]}</button> : <p>Ранов пока нет</p>}</section>
          </aside>
        </div>}
        {model.loadState === 'ready' && activeTab === 'workflow' && <section className="new-task-section">{model.workflow.map((step) => <div className={'new-task-workflow-step new-task-workflow-step--' + step.state} key={step.id}><i aria-hidden="true" /><strong>{step.label}</strong></div>)}</section>}
        {model.loadState === 'ready' && activeTab === 'runs' && <section className="new-task-section"><h3>Раны</h3>{model.runs.length ? model.runs.map((run) => <button className="new-task-run-link" key={run.id} onClick={() => callbacks.onOpenRun(run.id)}><strong>{run.title}</strong><span className={'new-task-run-status new-task-run-status--' + run.status}>{RUN_LABELS[run.status]}</span></button>) : <EmptyState title="Ранов пока нет" description="История появится после запуска этапа." />}</section>}
        {model.loadState === 'ready' && activeTab === 'files' && <div className="new-task-grid"><section className="new-task-section"><h3>Вложения исходной задачи</h3><FileRows files={model.source.attachments} /></section><section className="new-task-section"><h3>Make-связи</h3>{model.makeSources.length ? model.makeSources.map((source) => <article key={source.id}><Button size="sm" variant="ghost" onClick={() => callbacks.onOpenMake(source.conversationId)}>{source.title}</Button><small>{source.mode === 'whole_project' ? 'Проект целиком' : source.paths.map((path) => path.path).join(', ')}</small>{source.paths.filter((path) => !path.available).map((path) => <p className="new-task-source-error" key={path.path}>{path.path}: {path.error ?? 'Файл недоступен'}</p>)}</article>) : <EmptyState title="Make не связан" description="Связь можно добавить в старой карточке." />}</section></div>}
        {model.loadState === 'ready' && activeTab === 'history' && <section className="new-task-section"><h3>История доработок</h3>{model.cycles.length ? model.cycles.map((cycle) => <article className="new-task-cycle" key={cycle.id}><strong>Цикл {cycle.sequence}</strong><p>{cycle.description}</p>{cycle.criteria.length > 0 && <ul>{cycle.criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul>}{cycle.makeSources.map((source) => <p key={source.id}>Make: {source.title} — {source.mode === 'whole_project' ? 'проект целиком' : source.paths.map((item) => item.path).join(', ')}</p>)}<FileRows files={cycle.attachments} /><small>{new Date(cycle.createdAt).toLocaleString('ru-RU')} · {cycle.createdBy}</small></article>) : <EmptyState title="Доработок пока не было" description="После успешной разработки здесь сохраняются неизменяемые циклы." />}</section>}
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
      <footer><Button onClick={callbacks.onCancelRework}>Отмена</Button><Button variant="primary" loading={props.reworkPending} disabled={!props.reworkDraft.description.trim() || model.actions.hasActiveRun || Boolean(props.reworkDraft.makeSources?.some((source) => source.mode === 'files' && !source.paths.length))} onClick={submit}>Создать цикл</Button></footer>
    </div>}
  </Dialog>
}
