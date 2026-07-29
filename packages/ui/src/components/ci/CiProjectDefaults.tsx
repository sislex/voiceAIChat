// Дефолтные команды слотов на уровне проекта (наследуются задачами).
import { useEffect, useState, type JSX } from 'react'
import type { CiCommand } from '@shared/ci'
import { CiSlotEditor } from './CiSlotEditor'

export function CiProjectDefaults(props: { projectId: string; editable: boolean }): JSX.Element {
  const [commands, setCommands] = useState<CiCommand[]>([])
  const [before, setBefore] = useState<string[]>([])
  const [after, setAfter] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    const bridge = window.ci
    if (!bridge) return
    void bridge.listCommands(props.projectId).then(setCommands)
    void bridge.getProjectCi(props.projectId).then((c) => { setBefore(c.beforeModel); setAfter(c.afterModel) })
  }, [props.projectId])

  const save = (): void => {
    void window.ci?.putProjectCi(props.projectId, { beforeModel: before, afterModel: after }).then(() => setDirty(false))
  }
  return (
    <div className="ci-defaults">
      <CiSlotEditor label="До работы модели (по умолчанию)" commands={commands} value={before} disabled={!props.editable} onChange={(v) => { setBefore(v); setDirty(true) }} />
      <CiSlotEditor label="После работы модели (по умолчанию)" commands={commands} value={after} disabled={!props.editable} onChange={(v) => { setAfter(v); setDirty(true) }} />
      {props.editable && dirty && <button type="button" className="btn-primary" onClick={save}>Сохранить команды проекта</button>}
    </div>
  )
}
