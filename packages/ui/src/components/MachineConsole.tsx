import { useState, type FormEvent, type MouseEvent } from 'react'
import type { AgentExecResult, AgentInfo } from '@shared/agentProtocol'
import type { UtilityVariant } from './machine'

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
  const [fullscreen, setFullscreen] = useState(false)
  const stop = (e: MouseEvent): void => e.stopPropagation()

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const command = cmd.trim()
    if (!command || !agentId || running) return
    setCmd('')
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

  const body = (
    <>
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
        {agents.length === 0 && <span className="fspath">Нет машин. Добавьте машину в настройках.</span>}
      </div>

      <div className="consout" data-testid="console-output">
        {history.map((h, i) => (
          <div className="conshist" key={i}>
            <p className="conscmd">$ {h.command}</p>
            {h.output && <pre className="conspre">{h.output}</pre>}
            {h.error && <p className="conserr">{h.error}</p>}
            {!h.error && h.exitCode !== 0 && h.exitCode !== null && (
              <p className="conserr">exit {h.exitCode}</p>
            )}
          </div>
        ))}
        {running && <p className="cc-empty">Выполняю…</p>}
      </div>

      <form className="consbar" onSubmit={submit}>
        <span className="consprompt">$</span>
        <input
          className="consinput"
          aria-label="Команда"
          placeholder="команда…"
          value={cmd}
          disabled={!agentId || running}
          onChange={(e) => setCmd(e.target.value)}
        />
        <button className="fsbtn" type="submit" disabled={!agentId || running || !cmd.trim()}>
          ▶
        </button>
      </form>
    </>
  )

  const header = (
    <div className="mdhead">
      <h2 className="mdh">Консоль машины</h2>
      <span className="util-head-btns">
        {variant === 'embedded' && (
          <button className="xbtn" title="На весь экран" onClick={() => setFullscreen((v) => !v)}>
            {fullscreen ? '🗕' : '⛶'}
          </button>
        )}
        {onClose && (
          <button className="xbtn" aria-label="Закрыть" onClick={onClose}>
            ✕
          </button>
        )}
      </span>
    </div>
  )

  if (variant === 'modal') {
    return (
      <div className="ovl" onClick={onClose} data-testid="console-overlay">
        <div className="ccobs" onClick={stop} role="dialog" aria-label="Консоль машины">
          {header}
          {body}
        </div>
      </div>
    )
  }
  return (
    <div className={fullscreen ? 'util-embed util-embed--fs' : 'util-embed'} data-testid="console-embed">
      {header}
      {body}
    </div>
  )
}
