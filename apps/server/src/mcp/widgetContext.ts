// Снимок экрана канбан-ассистента на время хода. MCP-сервер stateless и не
// видит браузер, поэтому «что сейчас открыто» ему передаёт ход: turns.ts кладёт
// сюда `assistantContext` перед запуском модели, инструменты читают его по
// conversationId. Живой снимок (после навигации самого ассистента) приносит
// UI-мост, он же перезаписывает запись.

import type { WidgetAssistantContext, WidgetSurfaceSnapshot } from '@voicechat/shared'

export interface WidgetContextEntry {
  turnId: string
  context: WidgetAssistantContext
  at: number
}

/** Не больше одной записи на разговор: ход всегда один. */
export class WidgetContextStore {
  private readonly entries = new Map<string, WidgetContextEntry>()

  remember(conversationId: string, turnId: string, context: WidgetAssistantContext): void {
    this.entries.set(conversationId, { turnId, context, at: Date.now() })
    // Кап на случай долгоживущего процесса с сотнями проектов: снимок нужен
    // только текущему ходу, старые записи держать незачем.
    if (this.entries.size > 500) {
      const oldest = [...this.entries.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest) this.entries.delete(oldest[0])
    }
  }

  get(conversationId: string): WidgetContextEntry | null {
    return this.entries.get(conversationId) ?? null
  }

  surface(conversationId: string): WidgetSurfaceSnapshot | null {
    return this.entries.get(conversationId)?.context.surface ?? null
  }

  /** Живой снимок от UI-моста заменяет снимок хода: адрес после навигации новее. */
  updateSurface(conversationId: string, surface: WidgetSurfaceSnapshot): void {
    const entry = this.entries.get(conversationId)
    if (!entry) return
    this.entries.set(conversationId, { ...entry, context: { ...entry.context, surface }, at: Date.now() })
  }

  forget(conversationId: string): void {
    this.entries.delete(conversationId)
  }
}
