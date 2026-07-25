import type { AgentInfo } from '@shared/agentProtocol'
import type { ToolSpec } from '@shared/tools'
import { FileExplorer } from './FileExplorer'
import { MachineConsole } from './MachineConsole'
import type { MachineOps, UtilityVariant } from './machine'

export interface MachineUtilityProps {
  tool: ToolSpec
  agents: AgentInfo[]
  ops: MachineOps
  variant?: UtilityVariant
  onClose?: () => void
}

/** Рендерит нужную утилиту (консоль/проводник) по ToolSpec. */
export function MachineUtility({
  tool,
  agents,
  ops,
  variant = 'modal',
  onClose
}: MachineUtilityProps): JSX.Element {
  if (tool.kind === 'console') {
    return (
      <MachineConsole
        agents={agents}
        initialAgentId={tool.agentId ?? null}
        exec={ops.exec}
        variant={variant}
        onClose={onClose}
      />
    )
  }
  return (
    <FileExplorer
      agents={agents}
      initialAgentId={tool.agentId ?? null}
      ops={ops}
      variant={variant}
      onClose={onClose}
    />
  )
}
