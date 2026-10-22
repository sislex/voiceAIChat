import type { KbUsageSectionRef, KbUsageSource, ServerMessage } from '@voicechat/shared'
/** Чей это ход: владелец, чат, снимок проекта и id хода (для attachTurn). */
export interface KbUsageContext {
  userId: string
  /**
   * Чат, к которому привязано обращение. `null` бывает только у CI-рана без
   * связанного чата: база знаний работает, а телеметрия молча пропускается —
   * писать её некуда (строка ссылается на conversations), и ронять ран из-за
   * этого нельзя.
   */
  conversationId: string | null
  projectId?: string | null
  turnId?: string | null
  /** Ход внутри CI-рана: ран и шаг его ленты (привязка отчётов по ране/задаче). */
  ciRunId?: string | null
  ciStepId?: string | null
  source: KbUsageSource
}

/** Раздел, отданный модели: `chars` — точная длина его текста в ответе. */
export interface KbUsageSectionInput {
  documentId: string
  title?: string
  heading?: string
  anchor?: string
  sourcePath?: string
  relatedFiles?: string[]
  chars: number
  score?: number | null
  matchTypes?: KbUsageSectionRef['matchTypes']
  freshness?: KbUsageSectionRef['freshness']
}

export interface KbUsageCompleteArgs {
  sections?: KbUsageSectionInput[]
  /** Точная длина текста, реально пришедшего модели. */
  deliveredChars: number
  injected?: boolean
  bundleTokens?: number | null
  confidence?: 'high' | 'medium' | 'low' | null
}

/**
 * Почему обращение осталось без текста. Причина пишется всегда: «пусто» без
 * причины неотличимо от поломки, и по такой строке нельзя понять, чинить поиск
 * или порог уверенности.
 */
export type KbEmptyReason = 'no-match' | 'low-confidence' | 'budget'

/** Одно открытое обращение. Терминальный метод вызывается ровно один раз. */
export interface KbUsageHandle {
  /** id обращения: он же в кадре `pending` и в строке БД. */
  readonly id: string
  complete(args: KbUsageCompleteArgs): void
  /**
   * Текста не было. `confidence` — уверенность бандла, который до промпта не
   * доехал: у пустой строки она такой же факт, как у доставленной.
   */
  empty(reason: KbEmptyReason, confidence?: 'high' | 'medium' | 'low' | null): void
  fail(message: string): void
}

export interface KbUsageTracker {
  begin(ctx: KbUsageContext, query: string): Promise<KbUsageHandle>
  /** Итоги хода (id сообщения, размер промпта, вход) — во все его обращения. */
  attachTurn(args: { turnId: string; messageId?: string | null; promptChars?: number | null; turnInputTokens?: number | null }): Promise<void>
  subscribe(listener: (m: ServerMessage, ownerUserId: string) => void): () => void
}

