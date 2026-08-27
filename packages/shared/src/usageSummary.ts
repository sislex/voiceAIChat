// Сводка расхода беседы (п.24 Make): сумма по ходам ассистента. Стоимость — реальная
// из meta.costUsd, иначе расчётная по тарифам (тогда сводка помечена как оценка).
import type { Message } from './types'
import { estimateCostUsd } from './pricing'

export interface ConversationUsage {
  /** Число ответов ассистента с метаданными расхода. */
  turns: number
  inputTokens: number
  outputTokens: number
  /** Сумма в USD; ходы без известной цены не учтены. */
  costUsd: number
  /** Хотя бы один ход посчитан по тарифам, а не по данным модели. */
  estimated: boolean
  /** Ходы, у которых цену узнать не удалось (нет ни costUsd, ни прайса модели). */
  unpriced: number
}

export function summarizeConversationUsage(messages: readonly Pick<Message, 'role' | 'meta'>[]): ConversationUsage | null {
  const out: ConversationUsage = { turns: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, estimated: false, unpriced: 0 }
  for (const m of messages) {
    if (m.role !== 'ai' || !m.meta) continue
    const meta = m.meta
    const hasUsage = typeof meta.inputTokens === 'number' || typeof meta.outputTokens === 'number' || typeof meta.costUsd === 'number'
    if (!hasUsage) continue
    out.turns += 1
    out.inputTokens += meta.inputTokens ?? 0
    out.outputTokens += meta.outputTokens ?? 0
    if (typeof meta.costUsd === 'number') { out.costUsd += meta.costUsd; continue }
    const est = estimateCostUsd(meta.model, meta)
    if (typeof est === 'number') { out.costUsd += est; out.estimated = true } else out.unpriced += 1
  }
  return out.turns > 0 ? out : null
}

/** «$0.0123» для мелких сумм, «$0.12» для крупных; «≈» — если хоть что-то расчётное. */
export function formatUsd(value: number, estimated = false): string {
  const text = `$${value.toFixed(value < 0.1 ? 4 : 2)}`
  return estimated ? `≈ ${text}` : text
}
