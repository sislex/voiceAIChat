// Типизированный мост window.kb: телеметрия использования базы знаний (REST) +
// живые кадры kb.usage (WS). Контракт домена — в @shared/kb, пути — в
// @shared/protocol. Ставится в remote/index.ts (web); в desktop отсутствует —
// панель тогда работает на фолбэке из истории сообщений (lib/kbUsage.ts).

import type { KbProjectUsageReport, KbUsageQuery, KbUsageReport } from '@shared/kb'

/** REST-часть моста (реализация — createKbUsageRest в httpApi.ts). */
export interface RendererKbRest {
  getConversationUsage(conversationId: string): Promise<KbUsageReport>
  getProjectUsage(projectId: string): Promise<KbProjectUsageReport>
}

export interface RendererKbBridge extends RendererKbRest {
  /**
   * Инкременты обращений. Подписки на чат нет: сервер рассылает кадры по userId
   * (как claude.usage), а лишние чаты отсекает стор по conversationId.
   */
  onUsage(cb: (m: { conversationId: string; projectId: string | null; query: KbUsageQuery }) => void): () => void
}
