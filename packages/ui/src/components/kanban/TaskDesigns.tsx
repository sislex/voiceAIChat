// Секция «Дизайн» карточки: связи задачи с макетами, собранными в Make.
//
// Дизайн живёт в Make-проекте, привязанном к тому же проекту, что и задача, —
// поэтому выбор источника ограничен списком `projects:designSources`, а не всеми
// чатами пользователя: связать можно только то, что откроется у всей команды.
// Связь адресует живой проект, а не снимок: макет правится дальше, и карточка
// должна показывать текущее состояние экрана.

import { useCallback, useEffect, useState } from 'react'
import { makeDesignPreviewUrl } from '@shared/protocol'
import type { ProjectDesignSource, TaskDesignLink } from '@shared/projects'
import { Button, EmptyState, IconButton } from '@voicechat/ui-kit'
import { TrashIcon } from '../icons'

export interface TaskDesignsProps {
  projectId: string
  taskId: string
  /** Переход в режим Make (кнопка «Открыть в Make»); без него остаётся только превью. */
  onOpenMake?: (conversationId: string) => void
}

/** Открыть в новой вкладке умеет только то, что превью отдаёт как страницу. */
function previewable(path: string): boolean {
  return path === '' || /\.html$/i.test(path)
}

export function TaskDesigns(props: TaskDesignsProps): JSX.Element {
  const { projectId, taskId } = props
  const [links, setLinks] = useState<TaskDesignLink[]>([])
  const [sources, setSources] = useState<ProjectDesignSource[]>([])
  const [adding, setAdding] = useState(false)
  const [conversationId, setConversationId] = useState('')
  const [mode, setMode] = useState<'whole_project' | 'files'>('whole_project')
  const [paths, setPaths] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [pages, setPages] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    // Моста может не быть вовсе (старый desktop-хост, тесты соседних экранов):
    // секция тогда просто пустая — карточка из-за дизайна падать не должна.
    void window.api?.['tasks:designs']?.({ projectId, taskId })?.then(
      (next) => { if (alive) setLinks(next) },
      () => { /* связи — не главное в карточке: молча оставляем список пустым */ }
    )
    return () => { alive = false }
  }, [projectId, taskId])

  // Источники и файлы грузим только когда форма открыта: карточка не должна
  // тянуть состояние Make-проектов ради секции, в которую не заглянули.
  useEffect(() => {
    if (!adding) return
    let alive = true
    void window.api?.['projects:designSources']?.({ id: projectId })?.then(
      (next) => {
        if (!alive) return
        setSources(next)
        setConversationId((current) => current || next[0]?.conversationId || '')
      },
      (err: unknown) => { if (alive) setError(err instanceof Error ? err.message : String(err)) }
    )
    return () => { alive = false }
  }, [adding, projectId])

  useEffect(() => {
    if (!adding || !conversationId) return
    let alive = true
    setPages([])
    void window.api?.['make:state']?.({ conversationId })?.then(
      (state) => { if (alive) setPages(state.files.map((file) => file.path).sort((a, b) => a.localeCompare(b))) },
      () => { /* без списка файлов остаётся связь с проектом целиком */ }
    )
    return () => { alive = false }
  }, [adding, conversationId])

  const link = useCallback(async () => {
    if (!conversationId) return
    setBusy(true)
    setError(null)
    try {
      setLinks(await window.api['tasks:linkDesign']({ projectId, taskId, conversationId, mode, paths: mode === 'files' ? paths : [], label }))
      setAdding(false)
      setEditingId(null)
      setMode('whole_project')
      setPaths([])
      setLabel('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [conversationId, label, mode, paths, projectId, taskId])

  const unlink = useCallback(async (linkId: string) => {
    setLinks(await window.api['tasks:unlinkDesign']({ projectId, taskId, linkId }))
  }, [projectId, taskId])

  return (
    <section className="task-designs" aria-label="Дизайн">
      <div className="jmodal-desc-head">
        <h3 className="jmodal-h">Дизайн</h3>
        {!adding && <Button size="sm" variant="secondary" onClick={() => { setAdding(true); setError(null) }}>Связать дизайн</Button>}
      </div>

      {links.length === 0 && !adding && (
        <EmptyState compact icon="✦" title="Дизайна пока нет" description="Свяжите карточку с экраном из Make-проекта, привязанного к этому проекту." testId="task-designs-empty" />
      )}

      {links.length > 0 && <ul className="task-designs-list">
        {links.map((item) => (
          <li key={item.id} className="task-design">
            <span className="task-design__name">{item.label || item.conversationTitle}</span>
            <span className="task-design__path">{item.mode === 'whole_project' ? 'проект целиком' : item.paths.join(', ')}</span>
            {item.fileStatuses?.filter((status) => !status.available).map((status) => <span key={status.path} className="task-designs-error">{status.error}</span>)}
            <Button size="sm" variant="ghost" onClick={() => { setAdding(true); setEditingId(item.id); setConversationId(item.conversationId); setMode(item.mode); setPaths(item.paths); setLabel(item.label); setError(null) }}>Изменить</Button>
            {props.onOpenMake && <Button size="sm" variant="ghost" onClick={() => props.onOpenMake?.(item.conversationId)}>Открыть в Make</Button>}
            {item.mode === 'whole_project' && previewable('') && <a className="task-design__preview" href={makeDesignPreviewUrl(item.conversationId, '')} target="_blank" rel="noreferrer">Превью</a>}
            <IconButton size="sm" title="Убрать дизайн" aria-label={`Убрать дизайн ${item.label || item.conversationTitle}`} onClick={() => void unlink(item.id)}><TrashIcon /></IconButton>
          </li>
        ))}
      </ul>}

      {adding && <div className="task-designs-form">
        <label>
          <span className="fsub">Make-проект</span>
          <select aria-label="Make-проект" disabled={Boolean(editingId)} value={conversationId} onChange={(e) => { setConversationId(e.target.value); setPaths([]) }}>
            {sources.length === 0 && <option value="">Нет привязанных Make-проектов</option>}
            {sources.map((source) => (
              <option key={source.conversationId} value={source.conversationId}>
                {source.title}{source.own ? '' : ` · ${source.owner ?? 'другой участник'}`}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="fsub">Объём дизайна</legend>
          <label><input type="radio" name="design-mode" checked={mode === 'whole_project'} onChange={() => { setMode('whole_project'); setPaths([]) }} /> Весь проект</label>
          <label><input type="radio" name="design-mode" checked={mode === 'files'} onChange={() => setMode('files')} /> Выбранные файлы</label>
        </fieldset>
        {mode === 'files' && <fieldset className="task-designs-tree">
          <legend className="fsub">Файлы Make-проекта</legend>
          {pages.map((page) => <label key={page} style={{ paddingLeft: `${Math.max(0, page.split('/').length - 1) * 12}px` }}>
            <input type="checkbox" aria-label={page} checked={paths.includes(page)} onChange={(event) => setPaths((current) => event.target.checked ? [...new Set([...current, page])].sort((a, b) => a.localeCompare(b)) : current.filter((item) => item !== page))} /> {page}
          </label>)}
          {pages.length === 0 && <p className="convsettings-muted">В проекте нет файлов.</p>}
        </fieldset>}
        <label>
          <span className="fsub">Подпись</span>
          <input className="tin" aria-label="Подпись дизайна" value={label} placeholder="Экран оплаты" onChange={(e) => setLabel(e.target.value)} />
        </label>
        <div className="task-designs-actions">
          <Button size="sm" disabled={busy || !conversationId || (mode === 'files' && paths.length === 0)} onClick={() => void link()}>{editingId ? 'Сохранить' : 'Связать'}</Button>
          <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setEditingId(null); setError(null) }}>Отмена</Button>
        </div>
        {sources.length === 0 && <p className="convsettings-muted">Привяжите Make-проект к этому проекту в настройках его чата — тогда он появится в списке.</p>}
      </div>}

      {error && <p className="task-designs-error" role="alert">{error}</p>}
    </section>
  )
}
