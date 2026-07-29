// CI-настройки задачи в карточке: два упорядоченных мультиселекта (до/после)
// с наследованием дефолтов проекта и пометкой «унаследовано/переопределено».
import { useEffect, useState, type JSX } from 'react'
import type { CiCommand, CiSlotConfig } from '@shared/ci'
import { CiSlotEditor } from './CiSlotEditor'

export interface CiTaskSettingsProps {
  projectId: string
  taskId: string
}

export function CiTaskSettings(props: CiTaskSettingsProps): JSX.Element {
  const [commands, setCommands] = useState<CiCommand[]>([])
  const [before, setBefore] = useState<string[]>([])
  const [after, setAfter] = useState<string[]>([])
  const [overridden, setOverridden] = useState(false)
  const [saved, setSaved] = useState(true)

  useEffect(() => {
    const bridge = window.ci
    if (!bridge) return
    void bridge.listCommands(props.projectId).then(setCommands)
    void bridge.getTaskCi(props.projectId, props.taskId).then((r) => {
      setBefore(r.config.beforeModel)
      setAfter(r.config.afterModel)
      setOverridden(r.overridden)
    })
  }, [props.projectId, props.taskId])

  const isCleanup = (id: string): boolean => commands.find((c) => c.id === id)?.isCleanup ?? false
  // Валидация: cleanup в «после» без создателя директории в «до» — предупреждение.
  const cleanupWarn = after.some(isCleanup) && before.length === 0

  const save = (): void => {
    const cfg: CiSlotConfig = { beforeModel: before, afterModel: after }
    void window.ci?.putTaskCi(props.projectId, props.taskId, cfg).then(() => { setSaved(true); setOverridden(true) })
  }
  const mark = (): void => setSaved(false)

  return (
    <section className="ci-task">
      <div className="ci-task-head">
        <span className="ci-task-title">Команды воркфлоу</span>
        <span className={`lozenge ${overridden ? 'lozenge-progress' : 'lozenge-neutral'}`}>{overridden ? 'переопределено' : 'унаследовано'}</span>
      </div>
      <CiSlotEditor label="До работы модели" commands={commands} value={before} onChange={(v) => { setBefore(v); mark() }} />
      <CiSlotEditor label="После работы модели" commands={commands} value={after} onChange={(v) => { setAfter(v); mark() }} />
      {cleanupWarn && <div className="ci-warn">В слоте «после» есть cleanup-команда, но в «до» нет команды, создающей рабочую директорию.</div>}
      {!saved && <button type="button" className="btn-primary ci-task-save" onClick={save}>Сохранить команды</button>}
    </section>
  )
}
