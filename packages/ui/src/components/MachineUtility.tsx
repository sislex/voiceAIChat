import type { AgentInfo } from '@shared/agentProtocol'
import type { ToolSpec } from '@shared/tools'
import type { RendererPtyBridge } from '@shared/ipc'
import { FileExplorer } from './FileExplorer'
import { MachineConsole } from './MachineConsole'
import { MachineTerminal } from './MachineTerminal'
import type { ConsoleHistoryStore, MachineOps, SwitchUtility, UtilityVariant } from './machine'

export interface MachineUtilityProps {
  tool: ToolSpec
  agents: AgentInfo[]
  ops: MachineOps
  /** Память команд консоли по машине (стор): переживает закрытие утилиты. */
  consoleHistory?: ConsoleHistoryStore
  variant?: UtilityVariant
  onClose?: () => void
  /** Мост живого PTY-терминала. По умолчанию — window.pty (web); отсутствует → однострочная консоль. */
  pty?: RendererPtyBridge
  /**
   * Переключить утилиту на другую (кнопки «Консоль/Терминал ↔ Проводник» в общей
   * шапке), сохранив машину и папку. Нет — переключателя в шапке нет.
   */
  onSwitchUtility?: SwitchUtility
  /** Открыть раздел «Машины» — ссылка в шапке утилиты. */
  onOpenMachines?: () => void
}

/** Рендерит нужную утилиту (консоль/проводник) по ToolSpec. */
export function MachineUtility({
  tool,
  agents,
  ops,
  consoleHistory,
  variant = 'modal',
  onClose,
  onSwitchUtility,
  onOpenMachines,
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
          onSwitchUtility={onSwitchUtility}
          onOpenMachines={onOpenMachines}
        />
      )
    }
    return (
      <MachineConsole
        agents={agents}
        initialAgentId={tool.agentId ?? null}
        exec={ops.exec}
        {...(consoleHistory ? { historyStore: consoleHistory } : {})}
        initialCwd={tool.path}
        variant={variant}
        onClose={onClose}
        onSwitchUtility={onSwitchUtility}
        onOpenMachines={onOpenMachines}
      />
    )
  }
  return (
    <FileExplorer
      agents={agents}
      initialAgentId={tool.agentId ?? null}
      initialFilePath={tool.dir ? undefined : tool.path}
      initialDir={tool.dir ? tool.path : undefined}
      ops={ops}
      // Переключатель шапки обещает то, что откроется на самом деле: без моста PTY
      // консоль однострочная, и называть её «Терминалом» было бы неправдой.
      consoleLabel={pty ? 'Терминал' : 'Консоль'}
      onSwitchUtility={onSwitchUtility}
      onOpenMachines={onOpenMachines}
      variant={variant}
      onClose={onClose}
    />
  )
}
