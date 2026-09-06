// Watchdog агентов (machines-roadmap п.1): машина, у которой был агент, пропала из сети дольше порога —
// владелец получает событие `machine.status` (тост) и запись в machine_events; когда агент вернулся —
// второе событие «вернулась после N мин». Автоперезапуск самого агента делают launchd/systemd
// (`unixInstall.ts`: KeepAlive/Restart=always) — сервер лишь замечает, что перезапуск не помог.
import type { MachineStatusEvent, ServerMessage } from '@voicechat/shared'

export interface WatchdogDeps {
  db: {
    machines: {
      listAllAgents(): Array<{ id: string; name: string; lastSeen: number | null; userId: string | null }>
      logMachineEvent(e: { machineId: string; userId: string; state: 'offline' | 'online'; at: number; offlineForMs: number }): void
    }
  }
  registry: {
    isOnline(id: string): boolean
    onChange(cb: () => void): () => void
  }
  /** Доставить событие владельцу (WS через ciRunManager.publish). */
  publish: (message: ServerMessage, userId: string) => void
  /** Порог тревоги, мс (config.agentOfflineAlertMs). */
  thresholdMs: number
  now?: () => number
}

export interface AgentWatchdog {
  /** Один проход: кого объявить пропавшим. Вызывается таймером и тестами. */
  tick(): MachineStatusEvent[]
  /** Машины, по которым тревога уже поднята и ещё не снята. */
  alerted(): string[]
  stop(): void
}

export function createAgentWatchdog(deps: WatchdogDeps): AgentWatchdog {
  const now = deps.now ?? (() => Date.now())
  // machineId → момент, с которого машина считается пропавшей (lastSeen на момент тревоги).
  const alertedSince = new Map<string, number>()

  const tick = (): MachineStatusEvent[] => {
    const events: MachineStatusEvent[] = []
    const at = now()
    for (const agent of deps.db.machines.listAllAgents()) {
      // Машина, у которой агента никогда не было, не «пропала» — её ещё не подключали.
      if (!agent.userId || agent.lastSeen === null) continue
      if (deps.registry.isOnline(agent.id) || alertedSince.has(agent.id)) continue
      const offlineForMs = at - agent.lastSeen
      if (offlineForMs < deps.thresholdMs) continue
      alertedSince.set(agent.id, agent.lastSeen)
      const event: MachineStatusEvent = { machineId: agent.id, machineName: agent.name, state: 'offline', at, offlineForMs }
      deps.db.machines.logMachineEvent({ machineId: agent.id, userId: agent.userId, state: 'offline', at, offlineForMs })
      deps.publish({ t: 'machine.status', event }, agent.userId)
      events.push(event)
    }
    return events
  }

  // Возврат в сеть снимает тревогу — событие «вернулась» тем же владельцам.
  const offChange = deps.registry.onChange(() => {
    if (alertedSince.size === 0) return
    const at = now()
    for (const agent of deps.db.machines.listAllAgents()) {
      const since = alertedSince.get(agent.id)
      if (since === undefined || !deps.registry.isOnline(agent.id) || !agent.userId) continue
      alertedSince.delete(agent.id)
      const event: MachineStatusEvent = { machineId: agent.id, machineName: agent.name, state: 'online', at, offlineForMs: at - since }
      deps.db.machines.logMachineEvent({ machineId: agent.id, userId: agent.userId, state: 'online', at, offlineForMs: at - since })
      deps.publish({ t: 'machine.status', event }, agent.userId)
    }
  })

  return { tick, alerted: () => [...alertedSince.keys()], stop: () => { offChange() } }
}
