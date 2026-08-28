// Бейдж здоровья машины хода в шапке чата: точка состояния + имя, тултип с телеметрией.
// Предупреждения (offline/устарел/мало места) — отдельной полосой над строкой ввода (MachineHealthWarnings).
import type { AgentInfo } from '@shared/agentProtocol'
import { machineHealth } from '@shared/machineHealth'
import { AGENT_VERSION } from '@shared/version'

export function MachineHealthBadge({ agent, onClick }: { agent: AgentInfo | undefined; onClick?: () => void }): JSX.Element {
  const health = machineHealth(agent, AGENT_VERSION)
  const title = [agent ? `${agent.name}: ${health.label}` : 'Машина не найдена', ...health.details, ...health.warnings].join('\n')
  return (
    <button
      type="button"
      className={`mtitle-machine mhealth mhealth--${health.level}`}
      data-testid="head-machine"
      title={title}
      aria-label={`Машина хода: ${agent?.name ?? 'не найдена'} — ${health.label}`}
      onClick={onClick}
      disabled={!onClick}
    >
      <span className="mhealth-dot" aria-hidden />
      {agent?.name ?? 'не найдена'}
    </button>
  )
}

export function MachineHealthWarnings({ agent }: { agent: AgentInfo | undefined }): JSX.Element | null {
  const health = machineHealth(agent, AGENT_VERSION)
  if (health.warnings.length === 0) return null
  // role=status — на обёртке: <ul> с ролью статуса теряет семантику списка (axe: listitem).
  return (
    <div className="mhealth-warnings" role="status" data-testid="machine-health-warnings">
      <ul>{health.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>
    </div>
  )
}
