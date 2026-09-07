// Зеркало онлайн-машин в процессе канбана. Кластер читает статус, имя, платформу, политику и
// телеметрию машины синхронно (21 вызов `isOnline` в горячих путях автопилота и подготовки), поэтому
// по сети их не спрашиваем: ядро присылает снимок после каждого изменения реестра, здесь он просто
// заменяет предыдущий. Пропущенный пуш догоняет следующий — состояние всегда полное, не дельта.
import type { AgentPolicy, AgentTelemetry } from '@voicechat/shared'
import type { MachineSnapshot } from '../internal.js'

export class MachinesMirror {
  private machines = new Map<string, MachineSnapshot>()
  /** Когда пришёл последний снимок; null — ядро ещё ничего не прислало (все машины считаются offline). */
  updatedAt: number | null = null

  apply(list: MachineSnapshot[], now: number = Date.now()): void {
    this.machines = new Map(list.map((m) => [m.id, m]))
    this.updatedAt = now
  }

  isOnline(agentId: string): boolean { return this.machines.has(agentId) }
  nameOf(agentId: string): string | undefined { return this.machines.get(agentId)?.name }
  platformOf(agentId: string): string | undefined { return this.machines.get(agentId)?.platform }
  policyOf(agentId: string): AgentPolicy | undefined { return this.machines.get(agentId)?.policy }
  telemetryOf(agentId: string): AgentTelemetry | undefined { return this.machines.get(agentId)?.telemetry }
  size(): number { return this.machines.size }
}
