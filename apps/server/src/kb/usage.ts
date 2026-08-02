// Трекер обращений к базе знаний: одна точка, через которую и авто-инъекция
// контекста (turns.ts), и MCP-инструменты модели (kbMcp.ts) пишут телеметрию и
// рассылают живые кадры `kb.usage`.
//
// Два инварианта, которые здесь важнее удобства API:
//
// 1. НИ ОДИН метод не выбрасывает. База знаний не имеет права ронять ход модели,
//    а метрика — тем более. Любая ошибка (сломанная БД, закрытое соединение,
//    упавший слушатель) съедается на месте.
// 2. `pending` в БД не пишется. Строка появляется один раз, уже терминальной —
//    поэтому нет UPDATE-мусора и не остаётся висящих pending, если процесс упал
//    посреди обращения. «Запрашивает…» живёт только в WS-кадре, у которого тот
//    же id, что у будущей строки: клиент делает upsert по `query.id`.

import { estimateKbTokens, type KbUsageQuery, type KbUsageSectionRef, type KbUsageSource, type ServerMessage } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'

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

/** Одно открытое обращение. Терминальный метод вызывается ровно один раз. */
export interface KbUsageHandle {
  /** id обращения: он же в кадре `pending` и в строке БД. */
  readonly id: string
  complete(args: KbUsageCompleteArgs): void
  /** Разделов нет или уверенность низкая — обращение было, текста не было. */
  empty(reason: 'no-match' | 'low-confidence'): void
  fail(message: string): void
}

export interface KbUsageTracker {
  begin(ctx: KbUsageContext, query: string): KbUsageHandle
  /** Итоги хода (id сообщения, размер промпта, вход) — во все его обращения. */
  attachTurn(args: { turnId: string; messageId?: string | null; promptChars?: number | null; turnInputTokens?: number | null }): void
  subscribe(listener: (m: ServerMessage, ownerUserId: string) => void): () => void
}

export interface KbUsageTrackerDeps {
  db: VoiceChatDb
  now?: () => number
  newId?: () => string
}

/** Обращение без чата: методы есть, следов не оставляет (см. KbUsageContext). */
const NOOP_HANDLE: KbUsageHandle = {
  id: '',
  complete() {},
  empty() {},
  fail() {}
}

/** Причина пустого обращения человеческим текстом (её видно в ленте панели). */
const EMPTY_REASON: Record<'no-match' | 'low-confidence', string> = {
  'no-match': 'в базе знаний ничего не нашлось',
  'low-confidence': 'совпадения слабые — контекст не добавлен'
}

export function createKbUsageTracker(deps: KbUsageTrackerDeps): KbUsageTracker {
  const listeners = new Set<(m: ServerMessage, ownerUserId: string) => void>()
  const now = deps.now ?? (() => Date.now())
  const newId = deps.newId ?? (() => `kbu-${Math.random().toString(36).slice(2, 10)}-${now()}`)
  // Курсоры pending-кадров: строки для них ещё нет, а клиент отбрасывает кадры с
  // seq ≤ lastSeq. Поэтому seq предсказывается (максимум из БД и уже выданного),
  // а окончательный ставит вставка строки; upsert по id сводит их вместе.
  const issued = new Map<string, number>()

  function emit(m: ServerMessage, ownerUserId: string): void {
    for (const listener of listeners) {
      try {
        listener(m, ownerUserId)
      } catch {
        // Сломанный слушатель (закрытый сокет) не должен ронять обращение к БЗ.
      }
    }
  }

  function nextSeq(conversationId: string): number {
    let stored = 0
    try {
      stored = deps.db.kbUsageLastSeq(conversationId)
    } catch {
      stored = 0
    }
    const seq = Math.max(stored, issued.get(conversationId) ?? 0) + 1
    issued.set(conversationId, seq)
    return seq
  }

  function begin(ctx: KbUsageContext, query: string): KbUsageHandle {
    // Ран без связанного чата: телеметрию писать некуда, но БЗ уже отработала.
    if (!ctx.conversationId) return NOOP_HANDLE
    const conversationId = ctx.conversationId
    const id = newId()
    const startedAt = now()
    let done = false
    const projectId = ctx.projectId ?? null

    const frame = (patch: Partial<KbUsageQuery>): void => {
      const draft: KbUsageQuery = {
        id,
        seq: 0,
        conversationId,
        projectId,
        turnId: ctx.turnId ?? null,
        messageId: null,
        ciRunId: ctx.ciRunId ?? null,
        ciStepId: ctx.ciStepId ?? null,
        source: ctx.source,
        status: 'pending',
        query,
        confidence: null,
        injected: false,
        sectionsCount: 0,
        chars: 0,
        estimatedTokens: 0,
        bundleTokens: null,
        promptChars: null,
        turnInputTokens: null,
        durationMs: null,
        error: null,
        createdAt: startedAt,
        sections: [],
        ...patch
      }
      emit({ t: 'kb.usage', conversationId, projectId, query: draft }, ctx.userId)
    }

    // Кадр «запрашивает…» уходит сразу: панель должна показать обращение до того,
    // как БЗ ответит (поиск с reranker — это секунды).
    try {
      frame({ seq: nextSeq(conversationId) })
    } catch {
      /* метрика не мешает ходу */
    }

    /** Записать строку и разослать терминальный кадр. Ошибки — только в лог кадра. */
    const finish = (args: {
      status: 'delivered' | 'empty' | 'error'
      chars: number
      sections?: KbUsageSectionInput[]
      injected?: boolean
      bundleTokens?: number | null
      confidence?: 'high' | 'medium' | 'low' | null
      error?: string | null
    }): void => {
      if (done) return
      done = true
      const durationMs = Math.max(0, now() - startedAt)
      try {
        const saved = deps.db.addKbUsage({
          id,
          userId: ctx.userId,
          conversationId,
          projectId,
          turnId: ctx.turnId ?? null,
          ciRunId: ctx.ciRunId ?? null,
          ciStepId: ctx.ciStepId ?? null,
          source: ctx.source,
          status: args.status,
          query,
          confidence: args.confidence ?? null,
          injected: Boolean(args.injected),
          chars: args.chars,
          bundleTokens: args.bundleTokens ?? null,
          durationMs,
          error: args.error ?? null,
          sections: args.sections ?? []
        })
        issued.set(conversationId, Math.max(issued.get(conversationId) ?? 0, saved.seq))
        emit({ t: 'kb.usage', conversationId, projectId, query: saved }, ctx.userId)
      } catch {
        // БД недоступна: обращение всё равно показываем в панели живым кадром —
        // иначе сбой записи метрик выглядел бы как «модель БЗ не спрашивала».
        try {
          frame({
            seq: Math.max(issued.get(conversationId) ?? 0, 1),
            status: args.status,
            chars: args.chars,
            estimatedTokens: estimateKbTokens(args.chars),
            sectionsCount: args.sections?.length ?? 0,
            injected: Boolean(args.injected),
            confidence: args.confidence ?? null,
            durationMs,
            error: args.error ?? null
          })
        } catch {
          /* совсем ничего не поделать */
        }
      }
    }

    return {
      id,
      complete(args) {
        finish({
          status: 'delivered',
          chars: Math.max(0, Math.round(args.deliveredChars)),
          sections: args.sections,
          injected: args.injected ?? true,
          bundleTokens: args.bundleTokens ?? null,
          confidence: args.confidence ?? null
        })
      },
      empty(reason) {
        finish({ status: 'empty', chars: 0, error: EMPTY_REASON[reason] })
      },
      fail(message) {
        finish({ status: 'error', chars: 0, error: message })
      }
    }
  }

  return {
    begin,
    attachTurn(args) {
      try {
        deps.db.attachKbUsageTurn(args)
      } catch {
        /* итоги хода — украшение метрики, а не сам ход */
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
