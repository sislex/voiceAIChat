// "Настройки" of the new task card: the three blocks of the Make mock (machine,
// engine and model, commands) drawn as design sections around the shared
// `CiTaskSettings`, which owns loading and saving.
import type { UserLlmAccess } from '@shared/llmAccess'
import { CiTaskSettings } from '../ci/CiTaskSettings'

export interface NewTaskSettingsPanelProps {
  projectId: string
  taskId: string
  mergeMachineBound?: boolean
  llmAccess?: UserLlmAccess[]
}

export function NewTaskSettingsPanel(props: NewTaskSettingsPanelProps): JSX.Element {
  const shared = { projectId: props.projectId, taskId: props.taskId, ...(props.llmAccess ? { llmAccess: props.llmAccess } : {}) }
  return <div className="new-task-settings" data-testid="new-task-settings">
    <section className="new-task-section"><CiTaskSettings section="machine" {...shared} {...(props.mergeMachineBound !== undefined ? { mergeMachineBound: props.mergeMachineBound } : {})} /></section>
    <section className="new-task-section"><CiTaskSettings section="model" {...shared} /></section>
    <section className="new-task-section"><CiTaskSettings section="commands" {...shared} /></section>
  </div>
}
