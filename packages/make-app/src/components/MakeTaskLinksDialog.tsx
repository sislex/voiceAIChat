// Диалог «Задачи проекта» в панели Make — обратная сторона секции «Дизайн» в
// карточке: какие карточки ссылаются на этот Make-проект и как связать открытую
// страницу с задачей, не уходя из дизайна.
//
// Панель не знает ни проекта, ни прав: сервер сам ограничивает список проектом,
// к которому привязан Make-чат, и отвечает 404, если доступа нет.

import { useCallback, useEffect, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { MakeLinkableTask, MakeTaskLink } from '@shared/projects'
import { Button, Dialog, EmptyState, IconButton, useToast } from '@voicechat/ui-kit'

interface Props {
  conversationId: string
  /** Открытый файл — предзаполненная страница связи; пусто — проект целиком. */
  currentPath: string
  api: Pick<RendererApi, 'make:taskLinks' | 'make:linkTask' | 'make:linkableTasks'>
  /** Переход на доску к связанной карточке. */
  onOpenTask?: (projectId: string, taskId: string) => void
  onClose: () => void
}

export function MakeTaskLinksDialog({ conversationId, currentPath, api, onOpenTask, onClose }: Props): JSX.Element {
  const toast = useToast()
  const [links, setLinks] = useState<MakeTaskLink[]>([])
  const [tasks, setTasks] = useState<MakeLinkableTask[]>([])
  const [taskId, setTaskId] = useState('')
  const [path, setPath] = useState(currentPath)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([api['make:taskLinks']({ conversationId }), api['make:linkableTasks']({ conversationId })])
      .then(([nextLinks, nextTasks]) => {
        if (!alive) return
        setLinks(nextLinks)
        setTasks(nextTasks)
        setTaskId((current) => current || nextTasks[0]?.taskId || '')
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
    return () => { alive = false }
  }, [api, conversationId, toast])

  const link = useCallback(async (): Promise<void> => {
    if (!taskId) return
    setBusy(true)
    try {
      await api['make:linkTask']({ conversationId, taskId, path })
      setLinks(await api['make:taskLinks']({ conversationId }))
      toast.success('Дизайн связан с задачей')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [api, conversationId, path, taskId, toast])

  return (
    <Dialog className="make-dialog" padded title="Задачи проекта" ariaLabel="Задачи проекта" size="md" onClose={onClose} testId="make-task-links">
      {links.length === 0
        ? <EmptyState compact icon="🗂" title="Связей пока нет" description="Свяжите открытую страницу с карточкой — она появится в разделе «Дизайн» задачи." testId="make-task-links-empty" />
        : <ul className="make-task-links-list">
            {links.map((item) => (
              <li key={item.id}>
                <span className="make-task-links__key">{item.taskKey}</span>
                <span className="make-task-links__title">{item.taskTitle}</span>
                <span className="make-task-links__path">{item.path || 'проект целиком'}</span>
                {onOpenTask && <IconButton size="sm" title="Открыть карточку" aria-label={`Открыть карточку ${item.taskKey}`} onClick={() => onOpenTask(item.projectId, item.taskId)}>↗</IconButton>}
              </li>
            ))}
          </ul>}

      {tasks.length === 0
        ? <p className="fsub">Make-проект не привязан к проекту или в нём ещё нет карточек: привязка задаётся в настройках этого чата.</p>
        : <div className="make-task-links-form">
            <label><span className="fsub">Задача</span>
              <select aria-label="Задача проекта" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                {tasks.map((task) => <option key={task.taskId} value={task.taskId}>{task.taskKey} · {task.title}</option>)}
              </select>
            </label>
            <label><span className="fsub">Страница</span>
              <input className="tin" aria-label="Страница дизайна" value={path} placeholder="index.html" onChange={(e) => setPath(e.target.value)} />
            </label>
            <Button size="sm" variant="primary" disabled={busy || !taskId} loading={busy} onClick={() => void link()}>Связать с задачей</Button>
          </div>}
    </Dialog>
  )
}
