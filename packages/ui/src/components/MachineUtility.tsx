import type { AgentInfo } from '@shared/agentProtocol'
import type { ToolSpec } from '@shared/tools'
import type { RendererPtyBridge } from '@shared/ipc'
import { EmptyState } from '@voicechat/ui-kit'
import { FileExplorer } from './FileExplorer'
import { MachineConsole } from './MachineConsole'
import { MachineTerminal } from './MachineTerminal'
import type { ConsoleHistoryStore, MachineOps, SwitchUtility, UtilityVariant } from './machine'
import { GitTargetPane } from './git/GitTargetPane'

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

/** Рендерит нужную утилиту (консоль/проводник/панель кода) по ToolSpec. */
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
  if (tool.kind === 'git') {
    // Панель кода живёт рядом с двумя другими утилитами: человек попадает в неё из
    // проводника и терминала по той же папке. Цель (проект + чат/задача) кладёт
    // приложение — из блока модели она не читается.
    return tool.gitTarget
      ? (
        <GitTargetPane
          projectId={tool.gitTarget.projectId}
          {...(tool.gitTarget.taskId ? { taskId: tool.gitTarget.taskId } : {})}
          {...(tool.gitTarget.conversationId ? { conversationId: tool.gitTarget.conversationId } : {})}
          api={window.api}
        />
      )
      : (
        <EmptyState
          icon="🌿"
          title="Не выбрана рабочая копия"
          description="Панель кода открывается для задачи или разговора: откройте её из карточки задачи, из раздела «Код» проекта или из чата, привязанного к проекту."
        />
      )
  }
  if (tool.kind === 'console') {
    // Настоящий терминал (xterm+PTY), если доступен мост; иначе — однострочная консоль.
    if (pty) {
      return (
        <MachineTerminal
          agents={agents}
          initialAgentId={tool.agentId ?? null}
          initialCwd={tool.path}
          initialCommand={tool.command}
          projectId={tool.projectId}
          gitAvailable={Boolean(tool.gitTarget)}
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
        initialCommand={tool.command}
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
      gitAvailable={Boolean(tool.gitTarget)}
      onSwitchUtility={onSwitchUtility}
      onOpenMachines={onOpenMachines}
      variant={variant}
      onClose={onClose}
    />
  )
}
