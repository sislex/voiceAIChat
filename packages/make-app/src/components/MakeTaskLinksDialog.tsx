import { Dialog, useToast } from '../i18n/ui'
import { mt, useMakeLocale } from '../i18n'
// Make's project-task dialog is the reverse of a task card's Design section: list cards referencing
// this Make project and link the open page without leaving the design. The server resolves the
// project from the Make conversation, restricts the list, and returns 404 without access; the panel
// does not determine permissions.

import { useCallback, useEffect, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { MakeLinkableTask, MakeTaskLink } from '@shared/projects'
import { Button, EmptyState, IconButton } from '@voicechat/ui-kit'

interface Props {
  conversationId: string
  /** Open file used to prefill the linked page; empty means the entire project. */
  currentPath: string
  api: Pick<RendererApi, 'make:taskLinks' | 'make:linkTask' | 'make:linkableTasks'>
  /** Navigate to the linked task card on the board. */
  onOpenTask?: (projectId: string, taskId: string) => void
  onClose: () => void
}

export function MakeTaskLinksDialog({ conversationId, currentPath, api, onOpenTask, onClose }: Props): JSX.Element {
  useMakeLocale()
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
      toast.success(mt("designLinkedToTask"))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [api, conversationId, path, taskId, toast])

  return (
    <Dialog className="make-dialog" padded title={mt("projectTasks_121d1a")} ariaLabel={mt("projectTasks_121d1a")} size="md" onClose={onClose} testId="make-task-links">
      {links.length === 0
        ? <EmptyState compact icon="🗂" title={mt("noLinksYet")} description={mt("linkTheOpenPageToATaskToShow")} testId="make-task-links-empty" />
        : <ul className="make-task-links-list">
            {links.map((item) => (
              <li key={item.id}>
                <span className="make-task-links__key">{item.taskKey}</span>
                <span className="make-task-links__title">{item.taskTitle}</span>
                <span className="make-task-links__path">{item.path || mt("entireProject")}</span>
                {onOpenTask && <IconButton size="sm" title={mt("openTask")} aria-label={mt("openTaskValue", { p0: item.taskKey })} onClick={() => onOpenTask(item.projectId, item.taskId)}>↗</IconButton>}
              </li>
            ))}
          </ul>}

      {tasks.length === 0
        ? <p className="fsub">{mt("thisMakeProjectIsNotLinkedToAProject")}</p>
        : <div className="make-task-links-form">
            <label><span className="fsub">{mt("task")}</span>
              <select aria-label={mt("projectTask")} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                {tasks.map((task) => <option key={task.taskId} value={task.taskId}>{task.taskKey} · {task.title}</option>)}
              </select>
            </label>
            <label><span className="fsub">{mt("page")}</span>
              <input className="tin" aria-label={mt("designPage")} value={path} placeholder="index.html" onChange={(e) => setPath(e.target.value)} />
            </label>
            <Button size="sm" variant="primary" disabled={busy || !taskId} loading={busy} onClick={() => void link()}>{mt("linkToTask")}</Button>
          </div>}
    </Dialog>
  )
}
