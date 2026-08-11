import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AgentInfo } from '@shared/agentProtocol'
import type { RendererPtyBridge } from '@shared/ipc'
import { ToolFrame } from './ToolFrame'
import { MachineUtilityHeader } from './MachineUtilityHeader'
import { EmptyState } from './ui/EmptyState'
import type { PtySessionStore, PtySessionTab, SwitchUtility, UtilityVariant } from './machine'
import { ptySessionStore } from '../store/ptySessions'

export interface MachineTerminalProps {
  agents: AgentInfo[]
  initialAgentId?: string | null
  /** Начальный рабочий каталог PTY. */
  initialCwd?: string
  /** Явный проектный контекст для делегированной машины. */
  projectId?: string
  /** Мост живого PTY (web). */
  pty: RendererPtyBridge
  variant?: UtilityVariant
  onClose?: () => void
  /** Переключиться на проводник этой машины в её cwd (шапка утилиты). */
  onSwitchUtility?: SwitchUtility
  /** Ссылка в раздел «Машины» из шапки утилиты. */
  onOpenMachines?: () => void
  /** Стор открытых сеансов (вкладок). По умолчанию — общий стор приложения. */
  sessions?: PtySessionStore
}

/** Подпись вкладки: машина, номер сеанса (если их несколько) и каталог. */
function tabLabel(tab: PtySessionTab, tabs: PtySessionTab[], agents: AgentInfo[]): string {
  const name = agents.find((a) => a.id === tab.agentId)?.name ?? tab.agentId
  const sameMachine = tabs.filter((t) => t.agentId === tab.agentId)
  const num = sameMachine.length > 1 ? ` #${sameMachine.indexOf(tab) + 1}` : ''
  const dir = tab.cwd ? ` · ${tab.cwd.replace(/\/+$/, '').split('/').pop() || '/'}` : ''
  return `${name}${num}${dir}`
}

/** Представление одного присоединённого PTY-сеанса. */
function TerminalView({ agentId, cwd, projectId, pty, ptyId }: { agentId: string; cwd?: string; projectId?: string; pty: RendererPtyBridge; ptyId: string }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'live' | 'exited' | 'error'>('live')
  const [statusMsg, setStatusMsg] = useState('')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
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
    const attach = (): void => pty.start({ agentId, ptyId, cols: term.cols, rows: term.rows, ...(cwd ? { cwd } : {}), ...(projectId ? { projectId } : {}) })
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
    const offConnected = pty.onConnected(attach)
    attach()
    term.focus()
    return () => {
      ro.disconnect()
      onData.dispose()
      offOut()
      offExit()
      offErr()
      offConnected()
      // PTY остаётся на сервере: при новом монтировании attach() вернёт его с буфером.
      term.dispose()
    }
  }, [agentId, cwd, projectId, pty, ptyId])

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
  projectId,
  pty,
  variant = 'modal',
  onClose,
  onSwitchUtility,
  onOpenMachines,
  sessions = ptySessionStore
}: MachineTerminalProps): JSX.Element {
  const { tabs, activeId } = useSyncExternalStore(sessions.subscribe, sessions.snapshot, sessions.snapshot)
  // Машина, которую просили открыть: её вкладка либо находится, либо заводится.
  const wantedAgentId = initialAgentId ?? agents.find((a) => a.online)?.id ?? agents[0]?.id ?? null
  useEffect(() => {
    if (wantedAgentId) sessions.open(wantedAgentId, initialCwd)
  }, [sessions, wantedAgentId, initialCwd])

  const active = tabs.find((t) => t.ptyId === activeId) ?? null
  const agentId = active?.agentId ?? null
  // Все вкладки закрыли — селектор и «Новый сеанс» продолжают показывать машину.
  const headerAgentId = agentId ?? wantedAgentId
  const selectedAgent = agents.find((agent) => agent.id === agentId)
  const agentOnline = selectedAgent?.online ?? false
  // Закрытие вкладки — единственное место, где PTY убивают: размонтирование
  // xterm (закрыли утилиту, переключили вкладку) сеанс не трогает.
  const closeTab = (ptyId: string): void => {
    pty.kill({ ptyId })
    sessions.close(ptyId)
  }

  return (
    <ToolFrame
      title="Терминал машины"
      variant={variant}
      onClose={onClose}
      testId={variant === 'modal' ? 'terminal-overlay' : 'terminal-embed'}
    >
      <MachineUtilityHeader
        agents={agents}
        agentId={headerAgentId}
        onAgentChange={(next) => sessions.open(next)}
        kind="console"
        dir={active?.cwd ?? initialCwd}
        onSwitch={onSwitchUtility && agentId ? (next) => onSwitchUtility(next, agentId, active?.cwd ?? initialCwd) : undefined}
        onOpenMachines={onOpenMachines}
      />
      {tabs.length > 0 && (
        <div className="term-tabs" role="group" aria-label="Сеансы терминала">
          {tabs.map((tab) => {
            const label = tabLabel(tab, tabs, agents)
            return (
              <span
                key={tab.ptyId}
                className={tab.ptyId === activeId ? 'term-tab term-tab--active' : 'term-tab'}
              >
                <button
                  type="button"
                  aria-pressed={tab.ptyId === activeId}
                  className="term-tab__name"
                  onClick={() => sessions.activate(tab.ptyId)}
                >
                  {label}
                </button>
                <button
                  type="button"
                  className="term-tab__close"
                  aria-label={`Закрыть сеанс: ${label}`}
                  title="Закрыть вкладку — сеанс на машине будет завершён"
                  onClick={() => closeTab(tab.ptyId)}
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      )}
      {headerAgentId && (
        <div className="term-actions">
          <button type="button" onClick={() => sessions.create(headerAgentId, initialCwd)}>
            Новый сеанс
          </button>
          {active && (
            <button type="button" onClick={() => closeTab(active.ptyId)}>
              Завершить сеанс
            </button>
          )}
        </div>
      )}
      {agentId && !agentOnline ? (
        <EmptyState
          icon="⏳"
          title={'Машина «' + (selectedAgent?.name ?? agentId) + '» переподключается'}
          description="Терминал станет доступен после восстановления соединения. Попробуйте снова через несколько секунд."
        />
      ) : active && agentId ? (
        <TerminalView
          key={active.ptyId}
          agentId={agentId}
          {...(active.cwd ? { cwd: active.cwd } : {})}
          {...(projectId ? { projectId } : {})}
          pty={pty}
          ptyId={active.ptyId}
        />
      ) : agents.length > 0 ? (
        <EmptyState
          icon="💻"
          title="Нет открытых сеансов"
          description="Нажмите «Новый сеанс», чтобы открыть shell на выбранной машине."
        />
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
