import { useState, type FormEvent } from 'react'
import type { AgentExecResult, AgentInfo } from '@shared/agentProtocol'
import type { UtilityVariant } from './machine'
import { IconButton } from './ui/IconButton'
import { ToolFrame } from './ToolFrame'
import { RefreshIndicator } from './ui/Skeleton'
import { EmptyState } from './ui/EmptyState'
import { ErrorState } from './ui/ErrorState'

export interface MachineConsoleProps {
  agents: AgentInfo[]
  initialAgentId?: string | null
  /** Выполнить команду на машине. */
  exec: (agentId: string, command: string) => Promise<AgentExecResult>
  variant?: UtilityVariant
  onClose?: () => void
}

interface HistoryItem {
  command: string
  output: string
  exitCode: number | null
  error?: string
}

/** Самодостаточная консоль по машине: ввод команды → вывод (по политике машины). */
export function MachineConsole({
  agents,
  initialAgentId,
  exec,
  variant = 'modal',
  onClose
}: MachineConsoleProps): JSX.Element {
  const [agentId, setAgentId] = useState<string | null>(
    initialAgentId ?? agents.find((a) => a.online)?.id ?? agents[0]?.id ?? null
  )
  const [cmd, setCmd] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [running, setRunning] = useState(false)
  const selectedAgent = agents.find((agent) => agent.id === agentId)
  const agentOnline = selectedAgent?.online ?? false

  /** Выполнить команду и дописать результат в историю (та же дорога у «Повторить»). */
  const runCommand = async (command: string): Promise<void> => {
    if (!command || !agentId || !agentOnline || running) return
    setRunning(true)
    try {
      const res = await exec(agentId, command)
      setHistory((h) => [
        ...h,
        { command, output: res.output, exitCode: res.exitCode }
      ])
    } catch (err) {
      setHistory((h) => [
        ...h,
        { command, output: '', exitCode: null, error: err instanceof Error ? err.message : String(err) }
      ])
    } finally {
      setRunning(false)
    }
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const command = cmd.trim()
    if (!command || !agentId || running) return
    setCmd('')
    await runCommand(command)
  }

  return (
    <ToolFrame
      title="Консоль машины"
      variant={variant}
      onClose={onClose}
      testId={variant === 'modal' ? 'console-overlay' : 'console-embed'}
    >
      <div className="fsbar">
        {agents.length > 1 && (
          <select
            className="sel"
            aria-label="Машина"
            value={agentId ?? ''}
            onChange={(e) => setAgentId(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.online}>
                💻 {a.name}
                {a.online ? '' : ' (офлайн)'}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="consout" data-testid="console-output">
        {agents.length === 0 && (
          <EmptyState
            icon="💻"
            title="Нет машин — добавьте первую"
            description="Машина подключается в настройках: там выдаётся команда установки агента."
          />
        )}
        {agentId && !agentOnline && (
          <EmptyState
            icon="⏳"
            title={'Машина «' + (selectedAgent?.name ?? agentId) + '» переподключается'}
            description="Консоль станет доступна после восстановления соединения. Попробуйте снова через несколько секунд."
          />
        )}
        {agentOnline && history.length === 0 && !running && (
          <EmptyState
            icon="▶"
            title="Команд ещё не было"
            description="Наберите команду в поле ниже — вывод и код возврата появятся здесь."
          />
        )}
        {history.map((h, i) => (
          <div className="conshist" key={i}>
            <p className="conscmd">$ {h.command}</p>
            {h.output && <pre className="conspre">{h.output}</pre>}
            {h.error && (
              <ErrorState
                compact
                className="conserr"
                message="Команда не выполнилась"
                detail={h.error}
                onRetry={() => void runCommand(h.command)}
              />
            )}
            {!h.error && h.exitCode !== 0 && h.exitCode !== null && (
              <p className="conserr">exit {h.exitCode}</p>
            )}
          </div>
        ))}
        {running && (
          <p className="consrun">
            <RefreshIndicator label="Выполняю…" />
          </p>
        )}
      </div>

      <form className="consbar" onSubmit={submit}>
        <span className="consprompt">$</span>
        <input
          className="consinput"
          aria-label="Команда"
          placeholder="команда…"
          value={cmd}
          disabled={!agentOnline || running}
          onChange={(e) => setCmd(e.target.value)}
        />
        <IconButton
          size="sm"
          type="submit"
          title="Выполнить команду"
          aria-label="Выполнить команду"
          loading={running}
          disabled={!agentOnline || !cmd.trim()}
        >
          ▶
        </IconButton>
      </form>
    </ToolFrame>
  )
}
