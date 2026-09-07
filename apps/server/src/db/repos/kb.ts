// Домен «kb»: таблицы kb_documents, kb_usage_queries, kb_usage_sections, kb_usage_views.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import { estimateKbTokens, type KbDocumentKind, type KbScope, type KbFreshness, type KbMatchType, type KbProjectUsageReport, type KbUsageQuery, type KbUsageReport, type KbUsageSectionAggregate, type KbUsageSectionRef, type KbUsageSource, type KbUsageStatus, type KbRunUsageReport, type KbTaskUsageReport, type KbUsageTotals } from '@voicechat/shared'
import { BaseRepo } from './base.js'
import { parseStringArray } from './support.js'

// ============== Использование базы знаний: строки БД и мапперы =======
/**
 * Отчёты БД без флагов конфигурации: доступность индекса и включённость
 * mcp__kb__* знает не БД, а роут (config + kb.status()) — он их и дописывает.
 */
export type KbChatUsage = Omit<KbUsageReport, 'toolEnabled' | 'available'>

/** То же для проектного агрегата. */
export type KbProjectUsage = Omit<KbProjectUsageReport, 'toolEnabled' | 'available'>

interface KbUsageQueryRow {
  id: string; seq: number; user_id: string; conversation_id: string; project_id: string | null
  turn_id: string | null; message_id: string | null; ci_run_id: string | null; ci_step_id: string | null
  source: string; status: string; query: string
  confidence: string | null; injected: number; sections_count: number; chars: number; est_tokens: number
  bundle_tokens: number | null; prompt_chars: number | null; turn_input_tokens: number | null
  duration_ms: number | null; error: string | null; created_at: number
}

interface KbUsageSectionRow {
  id: string; query_id: string; document_id: string; title: string; heading: string; anchor: string
  source_path: string; related_files: string; chars: number; est_tokens: number; score: number | null; match_types: string
  freshness: string; position: number
}

interface KbSectionAggRow {
  document_id: string; anchor: string; title: string; heading: string; source_path: string; freshness: string
  times: number; auto_times: number; chars: number; est_tokens: number; last_at: number; conversations?: number
}

const KB_SOURCES: KbUsageSource[] = ['auto', 'tool_search', 'tool_document', 'tool_topics']

function kbSource(value: string): KbUsageSource {
  return KB_SOURCES.includes(value as KbUsageSource) ? (value as KbUsageSource) : 'auto'
}

function kbStatus(value: string): KbUsageStatus {
  return value === 'empty' || value === 'error' ? value : 'delivered'
}

function kbFreshness(value: string): KbFreshness {
  return value === 'current' || value === 'stale' ? value : 'unknown'
}

function kbMatchTypes(json: string): KbMatchType[] {
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is KbMatchType => typeof item === 'string') : []
  } catch {
    return [] // битый JSON — обращение важнее его подписи
  }
}

function mapKbUsageSection(r: KbUsageSectionRow): KbUsageSectionRef {
  return {
    documentId: r.document_id, title: r.title, heading: r.heading, anchor: r.anchor, sourcePath: r.source_path, relatedFiles: parseStringArray(r.related_files),
    chars: r.chars, estimatedTokens: r.est_tokens, score: r.score, matchTypes: kbMatchTypes(r.match_types),
    freshness: kbFreshness(r.freshness)
  }
}

function mapKbUsageQuery(r: KbUsageQueryRow, sections: KbUsageSectionRef[]): KbUsageQuery {
  return {
    id: r.id, seq: r.seq, conversationId: r.conversation_id, projectId: r.project_id, turnId: r.turn_id,
    messageId: r.message_id, ciRunId: r.ci_run_id, ciStepId: r.ci_step_id,
    source: kbSource(r.source), status: kbStatus(r.status), query: r.query,
    confidence: r.confidence === 'high' || r.confidence === 'medium' || r.confidence === 'low' ? r.confidence : null,
    injected: r.injected === 1, sectionsCount: r.sections_count, chars: r.chars, estimatedTokens: r.est_tokens,
    bundleTokens: r.bundle_tokens, promptChars: r.prompt_chars, turnInputTokens: r.turn_input_tokens,
    durationMs: r.duration_ms, error: r.error, createdAt: r.created_at, sections
  }
}

function mapKbSectionAggregate(r: KbSectionAggRow): KbUsageSectionAggregate {
  return {
    documentId: r.document_id, title: r.title, heading: r.heading, anchor: r.anchor, sourcePath: r.source_path,
    freshness: kbFreshness(r.freshness), times: r.times, autoTimes: r.auto_times, chars: r.chars,
    estimatedTokens: r.est_tokens, lastAt: r.last_at,
    ...(r.conversations === undefined ? {} : { conversations: r.conversations })
  }
}

// ============== Статьи базы знаний: строка БД и маппер =======
interface KbDocumentRow {
  id: string; scope: string; owner_id: string | null; project_id: string | null; title: string; kind: string
  tags: string; areas: string; body: string; checked_on: string | null; created_by: string
  created_at: number; updated_at: number
}

/** Статья БЗ из БД (файловые темы приходят из docs/kb и сюда не попадают). */
export interface KbStoredDocument {
  id: string
  scope: KbScope
  ownerId: string | null
  projectId: string | null
  title: string
  kind: KbDocumentKind
  tags: string[]
  areas: string[]
  body: string
  checkedOn: string | null
  createdBy: string
  createdAt: number
  updatedAt: number
}

function mapKbDocument(r: KbDocumentRow): KbStoredDocument {
  return {
    id: r.id,
    scope: r.scope === 'usage' || r.scope === 'project' ? r.scope : 'user',
    ownerId: r.owner_id,
    projectId: r.project_id,
    title: r.title,
    kind: (r.kind || 'subsystem') as KbDocumentKind,
    tags: parseStringArray(r.tags),
    areas: parseStringArray(r.areas),
    body: r.body,
    checkedOn: r.checked_on,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}
export class KbRepo extends BaseRepo {
  /**
   * Вопросы рана, на которые база знаний не ответила вовсе (`empty`/`error`) —
   * объективная половина пробелов: она есть даже тогда, когда модель забыла
   * назвать пробел блоком `kb-gaps`. Один вопрос — одна строка (модель повторяет
   * запросы), а вопрос, который позже ВСЁ ЖЕ был отвечен тем же текстом, из
   * списка выпадает: там пробела нет, была неудачная попытка.
   */
  kbUsageRunGaps(runId: string, limit = 12): Array<{ query: string; reason: string }> {
    return (this.db
      .prepare(
        `SELECT q.query AS query, MAX(COALESCE(q.error, '')) AS reason, MIN(q.created_at) AS at
           FROM kb_usage_queries q
          WHERE q.ci_run_id = ? AND q.status IN ('empty', 'error')
            AND NOT EXISTS (SELECT 1 FROM kb_usage_queries d
                             WHERE d.ci_run_id = q.ci_run_id AND d.query = q.query AND d.status = 'delivered')
          GROUP BY q.query
          ORDER BY at ASC
          LIMIT ?`
      )
      .all(runId, Math.max(1, Math.min(limit, 50))) as Array<{ query: string; reason: string; at: number }>)
      .map((row) => ({ query: row.query, reason: row.reason || 'база знаний не ответила' }))
  }

  //
  // Пишем только то, что видела модель: авто-инъекцию контекста перед ходом и
  // вызовы mcp__kb__*. Статус `pending` в БД не хранится — он живёт лишь в
  // WS-кадре, а строка появляется один раз, уже терминальной (нет UPDATE-мусора
  // и висящих pending после падения процесса).

  /** Записать состоявшееся обращение. `seq` монотонен внутри разговора. */
  addKbUsage(args: {
    /** Заранее сгенерированный id: тот же, что ушёл в кадр `pending`. */
    id?: string
    userId: string
    conversationId: string
    /** Снимок проекта на момент обращения (чат может сменить проект позже). */
    projectId?: string | null
    turnId?: string | null
    messageId?: string | null
    /** Ран и шаг CI-раннера, если обращение случилось в ходе рана. */
    ciRunId?: string | null
    ciStepId?: string | null
    source: KbUsageSource
    status?: Exclude<KbUsageStatus, 'pending'>
    query: string
    confidence?: 'high' | 'medium' | 'low' | null
    injected?: boolean
    /** Точная длина текста, пришедшего модели. */
    chars: number
    bundleTokens?: number | null
    promptChars?: number | null
    turnInputTokens?: number | null
    durationMs?: number | null
    error?: string | null
    sections?: Array<{
      documentId: string
      title?: string
      heading?: string
      anchor?: string
      sourcePath?: string
      relatedFiles?: string[]
      chars: number
      score?: number | null
      matchTypes?: KbMatchType[]
      freshness?: KbFreshness
    }>
  }): KbUsageQuery {
    const id = args.id ?? this.newId()
    const createdAt = this.now()
    const status = args.status ?? 'delivered'
    const estTokens = estimateKbTokens(args.chars)
    const sections: KbUsageSectionRef[] = (args.sections ?? []).map((item) => ({
      documentId: item.documentId,
      title: item.title ?? '',
      heading: item.heading ?? '',
      anchor: item.anchor ?? '',
      sourcePath: item.sourcePath ?? '',
      relatedFiles: item.relatedFiles ?? [],
      chars: item.chars,
      estimatedTokens: estimateKbTokens(item.chars),
      score: item.score ?? null,
      matchTypes: item.matchTypes ?? [],
      freshness: item.freshness ?? 'unknown'
    }))
    const insertQuery = this.db.prepare(
      `INSERT INTO kb_usage_queries (id, seq, user_id, conversation_id, project_id, turn_id, message_id, ci_run_id,
         ci_step_id, source, status, query, confidence, injected, sections_count, chars, est_tokens, bundle_tokens,
         prompt_chars, turn_input_tokens, duration_ms, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertSection = this.db.prepare(
      `INSERT INTO kb_usage_sections (id, query_id, document_id, title, heading, anchor, source_path, related_files, chars, est_tokens,
         score, match_types, freshness, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    // Одна транзакция: MAX(seq)+1 считается внутри неё, иначе параллельные
    // обращения одного разговора получили бы один и тот же курсор.
    let seq = 0
    this.db.transaction(() => {
      const row = this.db
        .prepare(`SELECT COALESCE(MAX(seq), 0) AS m FROM kb_usage_queries WHERE conversation_id = ?`)
        .get(args.conversationId) as { m: number }
      seq = row.m + 1
      insertQuery.run(
        id, seq, args.userId, args.conversationId, args.projectId ?? null, args.turnId ?? null, args.messageId ?? null,
        args.ciRunId ?? null, args.ciStepId ?? null,
        args.source, status, args.query, args.confidence ?? null, args.injected ? 1 : 0, sections.length, args.chars,
        estTokens, args.bundleTokens ?? null, args.promptChars ?? null, args.turnInputTokens ?? null,
        args.durationMs ?? null, args.error ?? null, createdAt
      )
      sections.forEach((section, position) => {
        insertSection.run(
          this.newId(), id, section.documentId, section.title, section.heading, section.anchor, section.sourcePath, JSON.stringify(section.relatedFiles),
          section.chars, section.estimatedTokens, section.score, JSON.stringify(section.matchTypes), section.freshness,
          position
        )
      })
    })()
    return {
      id,
      seq,
      conversationId: args.conversationId,
      projectId: args.projectId ?? null,
      turnId: args.turnId ?? null,
      messageId: args.messageId ?? null,
      ciRunId: args.ciRunId ?? null,
      ciStepId: args.ciStepId ?? null,
      source: args.source,
      status,
      query: args.query,
      confidence: args.confidence ?? null,
      injected: Boolean(args.injected),
      sectionsCount: sections.length,
      chars: args.chars,
      estimatedTokens: estTokens,
      bundleTokens: args.bundleTokens ?? null,
      promptChars: args.promptChars ?? null,
      turnInputTokens: args.turnInputTokens ?? null,
      durationMs: args.durationMs ?? null,
      error: args.error ?? null,
      createdAt,
      sections
    }
  }

  /**
   * Дописать в обращения хода итоги самого хода: id сохранённого сообщения,
   * размер промпта и суммарный вход. Известны они только после `claude.done`,
   * а обращения записаны раньше — поэтому отдельный шаг, а не поле в addKbUsage.
   */
  attachKbUsageTurn(args: { turnId: string; messageId?: string | null; promptChars?: number | null; turnInputTokens?: number | null }): number {
    const set: string[] = []
    const vals: unknown[] = []
    if (args.messageId !== undefined) { set.push('message_id = ?'); vals.push(args.messageId) }
    if (args.promptChars !== undefined) { set.push('prompt_chars = ?'); vals.push(args.promptChars) }
    if (args.turnInputTokens !== undefined) { set.push('turn_input_tokens = ?'); vals.push(args.turnInputTokens) }
    if (!set.length) return 0
    const info = this.db.prepare(`UPDATE kb_usage_queries SET ${set.join(', ')} WHERE turn_id = ?`).run(...vals, args.turnId)
    return info.changes
  }

  /**
   * Последний курсор обращений разговора. Нужен трекеру: кадр `pending` строки в
   * БД не имеет, а клиент отбрасывает кадры с seq ≤ lastSeq.
   */
  kbUsageLastSeq(conversationId: string): number {
    return (this.db
      .prepare(`SELECT COALESCE(MAX(seq), 0) AS m FROM kb_usage_queries WHERE conversation_id = ?`)
      .get(conversationId) as { m: number }).m
  }

  /**
   * Продвинуть границу просмотра только вперёд. Проверка владельца выполняется до
   * upsert, поэтому строку другого пользователя нельзя ни читать, ни менять.
   */
  markKbUsageViewed(userId: string, conversationId: string, lastSeq: number): { lastSeq: number; unreadCount: number } | null {
    if (!this.repos.chat.getConversation(userId, conversationId)) return null
    const boundary = Math.max(0, Math.min(Math.trunc(lastSeq), this.kbUsageLastSeq(conversationId)))
    this.db.prepare(
      `INSERT INTO kb_usage_views (user_id, conversation_id, last_seq, viewed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, conversation_id) DO UPDATE SET
         last_seq = MAX(kb_usage_views.last_seq, excluded.last_seq),
         viewed_at = CASE WHEN excluded.last_seq > kb_usage_views.last_seq THEN excluded.viewed_at ELSE kb_usage_views.viewed_at END`
    ).run(userId, conversationId, boundary, this.now())
    return { lastSeq: this.kbUsageViewedSeq(userId, conversationId), unreadCount: this.kbUsageUnreadCount(userId, conversationId) }
  }

  private kbUsageViewedSeq(userId: string, conversationId: string): number {
    const row = this.db.prepare(`SELECT last_seq FROM kb_usage_views WHERE user_id = ? AND conversation_id = ?`)
      .get(userId, conversationId) as { last_seq: number } | undefined
    return row?.last_seq ?? 0
  }

  private kbUsageUnreadCount(userId: string, conversationId: string): number {
    return (this.db.prepare(
      `SELECT COUNT(*) AS n FROM kb_usage_queries
       WHERE conversation_id = ? AND seq > ?`
    ).get(conversationId, this.kbUsageViewedSeq(userId, conversationId)) as { n: number }).n
  }

  /** Отчёт по чату: свой чат (изоляция по владельцу) — иначе null → 404 у роута. */
  kbUsageReport(userId: string, conversationId: string, limit = 40): KbChatUsage | null {
    const conv = this.repos.chat.getConversation(userId, conversationId)
    if (!conv) return null
    const totals = this.kbUsageTotals('q.conversation_id = ?', [conversationId])
    const sections = this.kbUsageSections('q.conversation_id = ?', [conversationId])
    const recent = this.kbUsageQueries('q.conversation_id = ?', [conversationId], limit)
    return {
      conversationId,
      projectId: conv.projectId ?? null,
      kbContextMode: conv.kbContextMode ?? 'auto',
      lastSeq: this.kbUsageLastSeq(conversationId),
      unreadCount: this.kbUsageUnreadCount(userId, conversationId),
      totals,
      sections,
      recent
    }
  }

  /** Агрегат по всем чатам проекта: только участнику проекта — иначе null. */
  kbUsageProjectReport(userId: string, projectId: string, limit = 40): KbProjectUsage | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    const totals = this.kbUsageTotals('q.project_id = ?', [projectId])
    const sections = this.kbUsageSections('q.project_id = ?', [projectId], { withConversations: true })
    const conversations = (this.db
      .prepare(
        `SELECT q.conversation_id, COALESCE(c.title, '') AS title, COUNT(*) AS queries, SUM(q.chars) AS chars,
                SUM(q.est_tokens) AS est_tokens, MAX(q.created_at) AS last_at
           FROM kb_usage_queries q LEFT JOIN conversations c ON c.id = q.conversation_id
          WHERE q.project_id = ?
          GROUP BY q.conversation_id
          ORDER BY last_at DESC`
      )
      .all(projectId) as Array<{ conversation_id: string; title: string; queries: number; chars: number; est_tokens: number; last_at: number }>)
      .map((r) => ({ conversationId: r.conversation_id, title: r.title, queries: r.queries, chars: r.chars, estimatedTokens: r.est_tokens, lastAt: r.last_at }))
    return { projectId, totals, sections, recent: this.kbUsageQueries('q.project_id = ?', [projectId], limit), conversations }
  }

  /**
   * Обращения к БЗ внутри одного CI-рана. Гейт — членство в проекте рана (как у
   * ленты), поэтому чужой пользователь получает null → 404 у роута.
   */
  kbUsageRunReport(userId: string, runId: string, limit = 40): KbRunUsageReport | null {
    const run = this.repos.ci.getCiRunRaw(runId)
    if (!run || !this.repos.projects.isProjectMember(userId, run.projectId)) return null
    return {
      runId,
      projectId: run.projectId,
      taskId: run.taskId,
      kbContextMode: run.kbContextMode,
      conversationId: run.conversationId,
      totals: this.kbUsageTotals('q.ci_run_id = ?', [runId]),
      sections: this.kbUsageSections('q.ci_run_id = ?', [runId]),
      recent: this.kbUsageQueries('q.ci_run_id = ?', [runId], limit)
    }
  }

  /**
   * Агрегат по ВСЕМ ранам задачи (блок в модалке задачи). Срез задаётся
   * подзапросом по `ci_runs`, а не сохранённым task_id в самой телеметрии:
   * привязка «обращение → ран» одна, и дублировать её нечем.
   */
  kbUsageTaskReport(userId: string, projectId: string, taskId: string, limit = 40): KbTaskUsageReport | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    if (!this.db.prepare(`SELECT 1 FROM tasks WHERE id = ? AND project_id = ?`).get(taskId, projectId)) return null
    const where = 'q.ci_run_id IN (SELECT id FROM ci_runs WHERE task_id = ? AND project_id = ?)'
    const params = [taskId, projectId]
    const runs = (this.db
      .prepare(`SELECT COUNT(DISTINCT q.ci_run_id) AS n FROM kb_usage_queries q WHERE ${where}`)
      .get(...params) as { n: number }).n
    return {
      projectId,
      taskId,
      runs,
      totals: this.kbUsageTotals(where, params),
      sections: this.kbUsageSections(where, params),
      recent: this.kbUsageQueries(where, params, limit)
    }
  }

  /**
   * Итоги по обращениям — ОТДЕЛЬНЫМ запросом, без JOIN с разделами: иначе суммы
   * размножились бы по числу разделов каждого обращения.
   */
  private kbUsageTotals(where: string, params: unknown[]): KbUsageTotals {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS queries,
                SUM(CASE WHEN q.status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
                SUM(CASE WHEN q.status = 'empty' THEN 1 ELSE 0 END) AS empty,
                SUM(CASE WHEN q.status = 'error' THEN 1 ELSE 0 END) AS errors,
                SUM(CASE WHEN q.source <> 'auto' THEN 1 ELSE 0 END) AS tool_queries,
                SUM(q.sections_count) AS sections, SUM(q.chars) AS chars, SUM(q.est_tokens) AS est_tokens,
                MAX(q.created_at) AS last_at
           FROM kb_usage_queries q WHERE ${where}`
      )
      .get(...params) as {
        queries: number; delivered: number | null; empty: number | null; errors: number | null
        tool_queries: number | null; sections: number | null; chars: number | null; est_tokens: number | null
        last_at: number | null
      }
    const documents = (this.db
      .prepare(
        `SELECT COUNT(DISTINCT s.document_id) AS n FROM kb_usage_sections s
           JOIN kb_usage_queries q ON q.id = s.query_id WHERE ${where}`
      )
      .get(...params) as { n: number }).n
    // Промпт одного хода общий для всех его обращений — берём его по одному разу
    // на turn_id, иначе доля «сколько из промпта от БЗ» была бы заниженной.
    const promptChars = (this.db
      .prepare(
        `SELECT COALESCE(SUM(prompt_chars), 0) AS n FROM (
           SELECT COALESCE(q.turn_id, q.id) AS turn, MAX(q.prompt_chars) AS prompt_chars
             FROM kb_usage_queries q WHERE ${where} AND q.prompt_chars IS NOT NULL GROUP BY turn)`
      )
      .get(...params) as { n: number }).n
    return {
      queries: row.queries,
      delivered: row.delivered ?? 0,
      empty: row.empty ?? 0,
      errors: row.errors ?? 0,
      toolQueries: row.tool_queries ?? 0,
      sections: row.sections ?? 0,
      documents,
      chars: row.chars ?? 0,
      estimatedTokens: row.est_tokens ?? 0,
      promptChars,
      lastAt: row.last_at ?? null
    }
  }

  /**
   * Разделы в разрезе произвольного среза обращений (`where` — по алиасу `q`).
   * Один запрос на чат, проект, ран и задачу: иначе четыре копии одного GROUP BY
   * неизбежно разъедутся в мелочах вроде порядка сортировки.
   */
  private kbUsageSections(where: string, params: unknown[], opts: { withConversations?: boolean } = {}): KbUsageSectionAggregate[] {
    const conversations = opts.withConversations ? ', COUNT(DISTINCT q.conversation_id) AS conversations' : ''
    return (this.db
      .prepare(
        `SELECT s.document_id, s.anchor, MAX(s.title) AS title, MAX(s.heading) AS heading,
                MAX(s.source_path) AS source_path, MAX(s.freshness) AS freshness, COUNT(*) AS times,
                SUM(CASE WHEN q.source = 'auto' THEN 1 ELSE 0 END) AS auto_times, SUM(s.chars) AS chars,
                SUM(s.est_tokens) AS est_tokens, MAX(q.created_at) AS last_at${conversations}
           FROM kb_usage_sections s JOIN kb_usage_queries q ON q.id = s.query_id
          WHERE ${where}
          GROUP BY s.document_id, s.anchor
          ORDER BY times DESC, chars DESC`
      )
      .all(...params) as KbSectionAggRow[]).map(mapKbSectionAggregate)
  }

  /** Последние обращения (новые сверху) вместе с их разделами. */
  private kbUsageQueries(where: string, params: unknown[], limit: number): KbUsageQuery[] {
    const rows = this.db
      .prepare(`SELECT q.* FROM kb_usage_queries q WHERE ${where} ORDER BY q.created_at DESC, q.seq DESC LIMIT ?`)
      .all(...params, Math.max(1, Math.min(limit, 200))) as KbUsageQueryRow[]
    if (!rows.length) return []
    const placeholders = rows.map(() => '?').join(',')
    const sections = this.db
      .prepare(`SELECT * FROM kb_usage_sections WHERE query_id IN (${placeholders}) ORDER BY position ASC`)
      .all(...rows.map((r) => r.id)) as KbUsageSectionRow[]
    const byQuery = new Map<string, KbUsageSectionRef[]>()
    for (const item of sections) {
      const list = byQuery.get(item.query_id) ?? []
      list.push(mapKbUsageSection(item))
      byQuery.set(item.query_id, list)
    }
    return rows.map((row) => mapKbUsageQuery(row, byQuery.get(row.id) ?? []))
  }

  //
  // Раздел «Использование» лежит в файлах репозитория (docs/kb) и одинаков для
  // всех; здесь — то, что пишут пользователь и модель. Проверку доступа делает
  // слой БЗ (kb/access.ts): методы ниже принадлежностью только помечают строки,
  // фильтровать по ней обязан вызывающий.

  /** Статьи по фильтру принадлежности. Без фильтра — все (для сборки индекса). */
  kbDocuments(filter: { scope?: KbScope; projectId?: string | null; ownerId?: string | null } = {}): KbStoredDocument[] {
    const where: string[] = []
    const params: unknown[] = []
    if (filter.scope) {
      where.push('scope = ?')
      params.push(filter.scope)
    }
    if (filter.projectId !== undefined && filter.projectId !== null) {
      where.push('project_id = ?')
      params.push(filter.projectId)
    }
    if (filter.ownerId !== undefined && filter.ownerId !== null) {
      where.push('owner_id = ?')
      params.push(filter.ownerId)
    }
    const rows = this.db
      .prepare(`SELECT * FROM kb_documents${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC`)
      .all(...params) as KbDocumentRow[]
    return rows.map(mapKbDocument)
  }

  kbDocumentById(id: string): KbStoredDocument | null {
    const row = this.db.prepare(`SELECT * FROM kb_documents WHERE id = ?`).get(id) as KbDocumentRow | undefined
    return row ? mapKbDocument(row) : null
  }

  /**
   * Версия набора статей: количество + максимум updated_at. Индекс БЗ держится в
   * памяти и пересобирается только при смене версии — иначе каждый поиск платил
   * бы за перечитывание всех статей.
   */
  kbDocumentsVersion(): string {
    const row = this.db.prepare(`SELECT COUNT(*) AS n, IFNULL(MAX(updated_at), 0) AS ts FROM kb_documents`).get() as {
      n: number
      ts: number
    }
    return `${row.n}:${row.ts}`
  }

  /** Создать статью или переписать существующую (id задаёт вызывающий). */
  saveKbDocument(args: {
    id?: string | null
    scope: KbScope
    ownerId?: string | null
    projectId?: string | null
    title: string
    body: string
    kind?: KbDocumentKind
    tags?: string[]
    areas?: string[]
    checkedOn?: string | null
    createdBy?: string
  }): KbStoredDocument {
    const ts = this.now()
    const existing = args.id ? this.kbDocumentById(args.id) : null
    const id = existing?.id ?? args.id ?? this.newId()
    if (existing) {
      this.db
        .prepare(
          `UPDATE kb_documents SET title = ?, body = ?, kind = ?, tags = ?, areas = ?, checked_on = ?, updated_at = ? WHERE id = ?`
        )
        .run(
          args.title,
          args.body,
          args.kind ?? existing.kind,
          JSON.stringify(args.tags ?? existing.tags),
          JSON.stringify(args.areas ?? existing.areas),
          args.checkedOn ?? existing.checkedOn,
          ts,
          id
        )
    } else {
      this.db
        .prepare(
          `INSERT INTO kb_documents (id, scope, owner_id, project_id, title, kind, tags, areas, body, checked_on, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          args.scope,
          args.ownerId ?? null,
          args.projectId ?? null,
          args.title,
          args.kind ?? 'subsystem',
          JSON.stringify(args.tags ?? []),
          JSON.stringify(args.areas ?? []),
          args.body,
          args.checkedOn ?? null,
          args.createdBy ?? args.ownerId ?? '',
          ts,
          ts
        )
    }
    return this.kbDocumentById(id) as KbStoredDocument
  }

  deleteKbDocument(id: string): boolean {
    return this.db.prepare(`DELETE FROM kb_documents WHERE id = ?`).run(id).changes > 0
  }
}
