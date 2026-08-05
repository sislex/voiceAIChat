import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AgentInfo } from '@shared/agentProtocol'
import type { RendererPtyBridge } from '@shared/ipc'
import { ToolFrame } from './ToolFrame'
import { MachineUtilityHeader } from './MachineUtilityHeader'
import { EmptyState } from './ui/EmptyState'
import type { SwitchUtility, UtilityVariant } from './machine'

export interface MachineTerminalProps {
  agents: AgentInfo[]
  initialAgentId?: string | null
  /** Начальный рабочий каталог PTY. */
  initialCwd?: string
  /** Мост живого PTY (web). */
  pty: RendererPtyBridge
  variant?: UtilityVariant
  onClose?: () => void
  /** Переключиться на проводник этой машины в её cwd (шапка утилиты). */
  onSwitchUtility?: SwitchUtility
  /** Ссылка в раздел «Машины» из шапки утилиты. */
  onOpenMachines?: () => void
}

function newPtyId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  return g.crypto?.randomUUID ? g.crypto.randomUUID() : `pty-${Date.now()}-${performance.now()}`
}

/** Один живой xterm-сеанс на выбранную машину (перемонтируется по key=agentId). */
function TerminalView({ agentId, cwd, pty }: { agentId: string; cwd?: string; pty: RendererPtyBridge }): JSX.Element {
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
    pty.start({ agentId, ptyId, cols: term.cols, rows: term.rows, ...(cwd ? { cwd } : {}) })
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
  }, [agentId, cwd, pty])

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
  initialCwd,
  pty,
  variant = 'modal',
  onClose,
  onSwitchUtility,
  onOpenMachines
}: MachineTerminalProps): JSX.Element {
  const [agentId, setAgentId] = useState<string | null>(
    initialAgentId ?? agents.find((a) => a.online)?.id ?? agents[0]?.id ?? null
  )
  const selectedAgent = agents.find((agent) => agent.id === agentId)
  const agentOnline = selectedAgent?.online ?? false

  return (
    <ToolFrame
      title="Терминал машины"
      variant={variant}
      onClose={onClose}
      testId={variant === 'modal' ? 'terminal-overlay' : 'terminal-embed'}
    >
      <MachineUtilityHeader
        agents={agents}
        agentId={agentId}
        onAgentChange={setAgentId}
        kind="console"
        dir={initialCwd}
        onSwitch={onSwitchUtility && agentId ? (next) => onSwitchUtility(next, agentId, initialCwd) : undefined}
        onOpenMachines={onOpenMachines}
      />
      {agentId && !agentOnline ? (
        <EmptyState
          icon="⏳"
          title={'Машина «' + (selectedAgent?.name ?? agentId) + '» переподключается'}
          description="Терминал станет доступен после восстановления соединения. Попробуйте снова через несколько секунд."
        />
      ) : agentId ? (
        <TerminalView key={`${agentId}:${initialCwd ?? ''}`} agentId={agentId} cwd={initialCwd} pty={pty} />
      ) : (
        <EmptyState
          icon="💻"
          title="Нет машин — добавьте первую"
          description="Машина подключается в настройках: там выдаётся команда установки агента."
        />
      )}
    </ToolFrame>
  )
}
