// Замер поиска на базе в 100k сообщений. В общий гейт не входит (генерация базы
// и переиндексация занимают минуту): запуск вручную —
//   VC_SEARCH_BENCH=1 npx vitest run apps/server/src/db/search.perf.test.ts
//
// Данные близки к живой переписке: словарь на 2000 слов с распределением
// Ципфа, 20–80 слов в сообщении, 200 бесед, часть — у другого пользователя.
// Это важно для честности замера: если каждое слово встречается в 70%
// сообщений, bm25 обязан оценить 70k строк, и никакой индекс не спасёт
// (измерено: ~2.8 мкс на совпадение, то есть ~200 мс на 70k).

import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VoiceChatDb } from './database.js'

const ENABLED = !!process.env.VC_SEARCH_BENCH
/** Бюджет типичного запроса. */
const BUDGET_MS = 150
const MESSAGES = 100_000
const CONVERSATIONS = 200
const VOCABULARY = 2000

/** Слова, которые будем искать: середина частотного списка — как живые термины. */
const QUERY_WORDS = ['миграция', 'канбан', 'схема', 'очередь', 'релиз', 'ревью']

/** Детерминированный ГПСЧ (mulberry32): замер не зависит от удачного сида. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe.runIf(ENABLED)('searchMessages — 100k сообщений', () => {
  it(`типичный запрос укладывается в ${BUDGET_MS} мс`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-fts-bench-'))
    try {
      const file = join(dir, 'db.sqlite')
      const db = new VoiceChatDb(file)
      db.identity.createUser('alice', '', 'developer')
      db.identity.createUser('bob', '', 'developer')
      const convIds = Array.from({ length: CONVERSATIONS }, (_, i) =>
        // Каждая десятая беседа — чужая: фильтр по владельцу работает на реальных данных.
        db.chat.createConversation(i % 10 === 0 ? 'bob' : 'alice', `Беседа ${i}`).id
      )

      // Словарь: часть слов — искомые термины, остальные — шум. Частота слова
      // падает с его номером (Ципф), поэтому термины из середины списка
      // встречаются в единицах процентов сообщений.
      const vocabulary = Array.from({ length: VOCABULARY }, (_, i) => `слово${i}`)
      QUERY_WORDS.forEach((w, i) => (vocabulary[60 + i * 90] = w))
      const rand = rng(7)
      const zipf = (): number => Math.min(VOCABULARY - 1, Math.floor(Math.exp(rand() * Math.log(VOCABULARY))))
      const containing = new Map(QUERY_WORDS.map((w) => [w, 0]))

      // Сообщения вставляем одной транзакцией на прямом соединении: 100k вызовов
      // addMessage — это 100k транзакций и полторы минуты, а нам нужен объём.
      const raw = new Database(file)
      const insert = raw.prepare(
        `INSERT INTO messages (id, conversation_id, role, text, time, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      const seedStart = Date.now()
      raw.transaction(() => {
        for (let i = 0; i < MESSAGES; i++) {
          const words: string[] = []
          const len = 20 + Math.floor(rand() * 60)
          for (let j = 0; j < len; j++) words.push(vocabulary[zipf()])
          const text = words.join(' ')
          for (const w of QUERY_WORDS) if (text.includes(w)) containing.set(w, (containing.get(w) ?? 0) + 1)
          insert.run(`m${i}`, convIds[i % CONVERSATIONS], i % 2 ? 'ai' : 'u1', text, '12:00', 1_700_000_000_000 + i)
        }
      })()
      const seedMs = Date.now() - seedStart

      // Полная переиндексация порциями — тот же путь, что и миграция боевой базы.
      raw.prepare(`UPDATE fts_state SET last_rowid = 0, max_rowid = 0, done = 0 WHERE name = 'messages'`).run()
      raw.close()
      const indexStart = Date.now()
      db.chat.ensureMessagesIndexed()
      const indexMs = Date.now() - indexStart

      // Прогрев: первый запрос платит за чтение страниц индекса с диска.
      db.chat.searchMessages('alice', { q: 'миграция ' })

      const queries = ['миграция ', 'канбан схема ', 'очередь релиз ревью ', 'мигра', 'схема ']
      const timings = queries.map((q) => {
        const started = performance.now()
        const res = db.chat.searchMessages('alice', { q })
        const ms = Math.round((performance.now() - started) * 10) / 10
        expect(res.hits.length).toBeGreaterThan(0)
        return { q, ms, hits: res.hits.length }
      })

      // Замер печатается в консоль — его переносят в описание PR.
      const log = (line: string): void => console.log(`[bench] ${line}`)
      log(`сообщений: ${MESSAGES}, бесед: ${CONVERSATIONS} (каждая 10-я — чужая)`)
      log(`генерация: ${seedMs} мс, полная переиндексация порциями: ${indexMs} мс`)
      log(`частота искомых слов: ${[...containing].map(([w, n]) => `${w} — ${n}`).join(', ')}`)
      for (const t of timings) log(`«${t.q}» → ${t.hits} результатов за ${t.ms} мс`)

      const worst = Math.max(...timings.map((t) => t.ms))
      log(`худший запрос: ${worst} мс (бюджет ${BUDGET_MS} мс)`)
      expect(worst).toBeLessThan(BUDGET_MS)
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 600_000)
})
