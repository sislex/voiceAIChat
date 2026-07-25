import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AgentInfo } from '@shared/agentProtocol'
import type { RendererPtyBridge } from '@shared/ipc'
import type { UtilityVariant } from './machine'

export interface MachineTerminalProps {
  agents: AgentInfo[]
  initialAgentId?: string | null
  /** Мост живого PTY (web). */
  pty: RendererPtyBridge
  variant?: UtilityVariant
  onClose?: () => void
}

function newPtyId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  return g.crypto?.randomUUID ? g.crypto.randomUUID() : `pty-${Date.now()}-${performance.now()}`
}

/** Один живой xterm-сеанс на выбранную машину (перемонтируется по key=agentId). */
function TerminalView({ agentId, pty }: { agentId: string; pty: RendererPtyBridge }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'live' | 'exited' | 'error'>('live')
  const [statusMsg, setStatusMsg] = useState('')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const ptyId = newPtyId()
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      scrollback: 5000,
      allowProposedApi: true,
      theme: { background: '#0b0e14', foreground: '#d7dce5' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    const doFit = (): void => {
      try {
        fit.fit()
      } catch {
        /* контейнер ещё без размера */
      }
    }
    doFit()
    pty.start({ agentId, ptyId, cols: term.cols, rows: term.rows })
    const onData = term.onData((data) => pty.input({ ptyId, data }))
    const offOut = pty.onOutput((m) => {
      if (m.ptyId === ptyId) term.write(m.data)
    })
    const offExit = pty.onExit((m) => {
      if (m.ptyId !== ptyId) return
      setStatus('exited')
      setStatusMsg(`Сеанс завершён${m.exitCode != null ? ` (код ${m.exitCode})` : ''}`)
    })
    const offErr = pty.onError((m) => {
      if (m.ptyId !== ptyId) return
      setStatus('error')
      setStatusMsg(m.message)
    })
    const ro = new ResizeObserver(() => {
      doFit()
      pty.resize({ ptyId, cols: term.cols, rows: term.rows })
    })
    ro.observe(host)
    term.focus()
    return () => {
      ro.disconnect()
      onData.dispose()
      offOut()
      offExit()
      offErr()
      pty.kill({ ptyId })
      term.dispose()
    }
  }, [agentId, pty])

  return (
    <div className="term-wrap">
      <div ref={hostRef} className="term-host" data-testid="terminal-host" />
      {status !== 'live' && (
        <p className={status === 'error' ? 'term-status term-status--err' : 'term-status'}>{statusMsg}</p>
      )}
    </div>
  )
}

/** Настоящий терминал по машине (xterm + PTY). Реальный shell на машине агента. */
export function MachineTerminal({
  agents,
  initialAgentId,
  pty,
  variant = 'modal',
  onClose
}: MachineTerminalProps): JSX.Element {
  const [agentId, setAgentId] = useState<string | null>(
    initialAgentId ?? agents.find((a) => a.online)?.id ?? agents[0]?.id ?? null
  )
  const [fullscreen, setFullscreen] = useState(false)

  const header = (
    <div className="mdhead">
      <h2 className="mdh">Терминал машины</h2>
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
        {agents.length === 0 && (
          <span className="fspath">Нет машин. Добавьте машину в настройках.</span>
        )}
      </div>
      {agentId ? (
        <TerminalView key={agentId} agentId={agentId} pty={pty} />
      ) : (
        <p className="cc-empty">Нет доступной машины.</p>
      )}
    </>
  )

  if (variant === 'modal') {
    return (
      <div className="ovl" onClick={onClose} data-testid="terminal-overlay">
        <div className="ccobs" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Терминал машины">
          {header}
          {body}
        </div>
      </div>
    )
  }
  return (
    <div className={fullscreen ? 'util-embed util-embed--fs' : 'util-embed'} data-testid="terminal-embed">
      {header}
      {body}
    </div>
  )
}
