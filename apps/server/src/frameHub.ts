// Процесс-глобальная шина кадров ядра для WS-сессий: журнал команд машины, тревоги watchdog,
// снимки браузерной проверки. Раньше эти кадры шли через `CiRunManager.publish`, то есть ядро
// пользовалось лентой канбана как общей трубой; с выделением канбана в сервис у ядра своя шина,
// а лента ранов приходит портом `KanbanService.runs` (docs/plans/kanban-service.md, круг 2).
import type { ServerMessage } from '@voicechat/shared'

export type FrameListener = (m: ServerMessage, ownerUserId: string) => void

export class UserFrameHub {
  private readonly listeners = new Set<FrameListener>()

  publish(message: ServerMessage, ownerUserId: string): void {
    for (const listener of this.listeners) listener(message, ownerUserId)
  }

  subscribe(listener: FrameListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
