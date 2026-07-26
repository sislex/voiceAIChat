import type { AgentInfo } from '@shared/agentProtocol'
import type { ToolSpec } from '@shared/tools'
import type { RendererPtyBridge } from '@shared/ipc'
import { FileExplorer } from './FileExplorer'
import { MachineConsole } from './MachineConsole'
import { MachineTerminal } from './MachineTerminal'
import type { MachineOps, UtilityVariant } from './machine'

export interface MachineUtilityProps {
  tool: ToolSpec
  agents: AgentInfo[]
  ops: MachineOps
  variant?: UtilityVariant
  onClose?: () => void
  /** Мост живого PTY-терминала. По умолчанию — window.pty (web); отсутствует → однострочная консоль. */
  pty?: RendererPtyBridge
  /** Переключить popup проводника на терминал в указанной папке. */
  onOpenTerminal?: (agentId: string, cwd: string) => void
}

/** Рендерит нужную утилиту (консоль/проводник) по ToolSpec. */
export function MachineUtility({
  tool,
  agents,
  ops,
  variant = 'modal',
  onClose,
  onOpenTerminal,
  pty = typeof window !== 'undefined' ? window.pty : undefined
}: MachineUtilityProps): JSX.Element {
  if (tool.kind === 'console') {
    // Настоящий терминал (xterm+PTY), если доступен мост; иначе — однострочная консоль.
    if (pty) {
      return (
        <MachineTerminal
          agents={agents}
          initialAgentId={tool.agentId ?? null}
          initialCwd={tool.path}
          pty={pty}
          variant={variant}
          onClose={onClose}
        />
      )
    }
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
      initialFilePath={tool.path}
      ops={ops}
      onOpenTerminal={onOpenTerminal}
      variant={variant}
      onClose={onClose}
    />
  )
}
