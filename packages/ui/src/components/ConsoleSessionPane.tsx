import { useMemo, useState } from 'react'
import type { AgentInfo } from '@shared/agentProtocol'
import type { RendererPtyBridge } from '@shared/ipc'
import { consolePtyId } from '@shared/types'
import { EmptyState } from '@voicechat/ui-kit'
import { TerminalView } from './MachineTerminal'

// Правая панель инструмента «Консоль с ассистентом»: живой PTY-терминал разговора.
// ptyId детерминирован (`console:<conversationId>`), поэтому и терминал пользователя,
// и MCP-инструменты ассистента (`mcp__console__*`) адресуют одну и ту же сессию —
// пользователь и модель работают в общем терминале.
//
// В отличие от MachineTerminal здесь нет вкладок: одна беседа = одна консоль.
// Хост-машину выбирает шапка; смена машины перезапускает сессию на новой машине.

export interface ConsoleSessionPaneProps {
  conversationId: string
  agents: AgentInfo[]
  pty?: RendererPtyBridge
  /** Машина по умолчанию (execTarget разговора либо персональная default). */
  initialAgentId?: string | null
  projectId?: string
}

export function ConsoleSessionPane({ conversationId, agents, pty, initialAgentId, projectId }: ConsoleSessionPaneProps): JSX.Element {
  const online = useMemo(() => agents.filter((a) => a.online), [agents])
  const preferred = initialAgentId && online.some((a) => a.id === initialAgentId) ? initialAgentId : online[0]?.id ?? null
  const [agentId, setAgentId] = useState<string | null>(preferred)
  const effectiveAgentId = agentId && online.some((a) => a.id === agentId) ? agentId : preferred
  const ptyId = consolePtyId(conversationId)

  const header = (
    <div className="console-pane-header">
      <strong>Консоль</strong>
      <label className="console-pane-machine">
        <span className="vc-sr-only">Машина консоли</span>
        <select
          aria-label="Машина консоли"
          value={effectiveAgentId ?? ''}
          onChange={(event) => {
            const next = event.target.value || null
            if (pty && effectiveAgentId) pty.kill({ ptyId })
            setAgentId(next)
          }}
        >
          {online.length === 0 && <option value="" disabled>Нет машин в сети</option>}
          {online.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
    </div>
  )

  if (!pty) {
    return (
      <section className="console-browser-pane" aria-label="Консоль">
        {header}
        <EmptyState title="Терминал недоступен" description="PTY-мост не подключён (desktop-режим)." />
      </section>
    )
  }
  if (!effectiveAgentId) {
    return (
      <section className="console-browser-pane" aria-label="Консоль">
        {header}
        <EmptyState title="Нет доступной машины" description="Подключите машину-агент в сети, чтобы открыть консоль." />
      </section>
    )
  }

  return (
    <section className="console-browser-pane" aria-label="Консоль">
      {header}
      <div className="console-browser-viewport">
        {/* key по машине: смена машины перезапускает сессию на новой. */}
        <TerminalView
          key={effectiveAgentId}
          agentId={effectiveAgentId}
          ptyId={ptyId}
          pty={pty}
          {...(projectId ? { projectId } : {})}
        />
      </div>
    </section>
  )
}
