#!/usr/bin/env node
// Замер расхода CI-ранов: таблица «во что обошёлся ран» по данным БД, из которой
// делаются выводы вида «стало дешевле/дороже». Не сервис, а инструмент замера —
// поэтому отдельный скрипт, а не ручка API: его гоняют по прод-БД руками.
//
//   node scripts/ci-usage-report.mjs [--db путь] [--since 2026-08-02] [--task ЧАСТЬ]
//                                    [--run ЧАСТЬ] [--json]
//
// Стоимость: настоящая от CLI, иначе оценка по прайсу — «≈»; когда прайса нет
// вовсе (модель `unknown`), к оценке добавляется «занижено». Вход приводится к
// «без кэша»: старые строки codex несут его вместе с кэшем (input_semantics
// пустой), новые уже приведены.
//
// Вызовы инструментов берутся из ci_run_tool_calls, а у ранов до этой метрики
// восстанавливаются из ленты (`[tool_use] имя: …`) — тогда в колонке стоит «~».
// Правда только в коде: семантика повторяет packages/shared/src/ci.ts
// (classifyCiToolCall, ciUsageTotals) и packages/shared/src/pricing.ts.

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const args = process.argv.slice(2)
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const DB_PATH = opt('db', '/data/voicechat.db')
const SINCE = opt('since') ? Date.parse(opt('since')) : null
const TASK = opt('task')
const RUN = opt('run')
const AS_JSON = args.includes('--json')

// Прайс — копия packages/shared/src/pricing.ts (USD за 1M токенов).
const PRICES = [
  [/opus/i, { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
  [/sonnet/i, { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  [/haiku/i, { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
  [/gpt|codex|o[0-9]/i, { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 }]
]
const priceOf = (model) => {
  if (!model || model === 'unknown') return null
  const row = PRICES.find(([re]) => re.test(model))
  return row ? row[1] : null
}

/** Вид инструмента по имени от CLI — копия classifyCiToolCall. */
function classify(name) {
  const raw = (name ?? '').trim()
  if (!raw) return 'other'
  const parts = raw.match(/^mcp__(.+?)__(.+)$/) ?? raw.match(/^([^:\s]+):(.+)$/)
  const server = (parts ? parts[1] : '').toLowerCase()
  const tool = (parts ? parts[2] : raw).toLowerCase()
  if (server === 'kb') return 'kb'
  if (tool === 'bash' || tool === 'shell') return 'bash'
  if (tool === 'read' || tool === 'grep') return tool
  if (tool === 'edit' || tool === 'write' || tool === 'multiedit') return 'edit'
  return 'other'
}

const EMPTY_TOOLS = { bash: 0, read: 0, grep: 0, edit: 0, kb: 0, other: 0 }
const toolsTotal = (t) => Object.values(t).reduce((a, b) => a + b, 0)

/**
 * Восстановление вызовов из ленты рана — для ранов, сделанных до метрики. Заодно
 * считает, сколько раз файл читали командой внутри bash (`cat`/`sed`/`head`/
 * `tail`) и сколько правок шло heredoc'ом или python-скриптом: именно эту долю
 * должен был убить CHAT-54.
 */
function toolsFromLog(text) {
  const calls = { ...EMPTY_TOOLS }
  let bashFileReads = 0, bashHeredocEdits = 0
  for (const line of text.split('\n')) {
    // Лента пишет `[tool_use] <краткое имя>: <ввод>`, где имя бывает с сервером
    // (`remote:bash`, `kb:document`), без него (`Read`) или запуском команды
    // codex (`$ npm test`) — иначе `remote:bash` читалось бы как сервер `remote`.
    const m = line.match(/^\[tool_use\]\s+(?:(\$)|([A-Za-z_][\w:.-]*)\s*:)\s*(.*)$/)
    if (!m) continue
    const kind = m[1] ? 'bash' : classify(m[2])
    calls[kind]++
    if (kind !== 'bash') continue
    for (const command of (m[3] ?? '').split(/&&|\|\||;/)) {
      if (/(^|\s|\/)(cat|sed|head|tail)\s/.test(command)) bashFileReads++
      if (/<<\s*['"]?(EOF|PY|SCRIPT)|python3?\s+-\s*<</.test(command)) bashHeredocEdits++
    }
  }
  return { calls, bashFileReads, bashHeredocEdits }
}

const db = new Database(DB_PATH, { readonly: true })
const all = (sql, ...p) => db.prepare(sql).all(...p)

const where = ['1 = 1']
const params = []
if (SINCE != null) { where.push('r.created_at >= ?'); params.push(SINCE) }
if (TASK) { where.push('t.title LIKE ?'); params.push(`%${TASK}%`) }
if (RUN) { where.push('r.id LIKE ?'); params.push(`${RUN}%`) }

const runs = all(
  `SELECT r.id, r.llm_provider AS provider, r.llm_model AS model, r.status, r.mode, r.created_at,
          r.duration_ms, t.title
     FROM ci_runs r LEFT JOIN tasks t ON t.id = r.task_id
    WHERE ${where.join(' AND ')} ORDER BY r.created_at`,
  ...params
)

const hasToolTable = all(`SELECT name FROM sqlite_master WHERE type='table' AND name='ci_run_tool_calls'`).length > 0

const report = runs.map((run) => {
  const usage = all(`SELECT * FROM ci_run_usage WHERE run_id = ? ORDER BY at`, run.id)
  const totals = {
    requests: usage.length, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
    costUsd: null, costEstimated: false, costUnderstated: false, inputNormalized: false, modelActiveMs: 0
  }
  for (const u of usage) {
    // Семантика входа: явная колонка, иначе старая строка (у codex — с кэшем).
    const withCache = u.input_semantics
      ? u.input_semantics === 'with_cache'
      : u.provider === 'codex'
    const input = withCache ? Math.max(0, u.input_tokens - u.cache_read_tokens) : u.input_tokens
    if (input !== u.input_tokens) totals.inputNormalized = true
    totals.inputTokens += input
    totals.outputTokens += u.output_tokens
    totals.cacheReadTokens += u.cache_read_tokens
    totals.cacheCreationTokens += u.cache_creation_tokens
    totals.modelActiveMs += u.duration_ms ?? 0
    const price = priceOf(u.model)
    const own = u.cost_usd ?? (price
      ? (input * price.input + u.output_tokens * price.output + u.cache_read_tokens * price.cacheRead +
         u.cache_creation_tokens * price.cacheWrite) / 1e6
      : null)
    if (own == null) { totals.costEstimated = true; totals.costUnderstated = true }
    else {
      totals.costUsd = (totals.costUsd ?? 0) + own
      if (u.cost_usd == null) totals.costEstimated = true
    }
  }

  const stored = hasToolTable
    ? all(`SELECT tool, calls FROM ci_run_tool_calls WHERE run_id = ?`, run.id)
    : []
  const logText = all(`SELECT chunk FROM ci_run_logs WHERE run_id = ? ORDER BY seq`, run.id).map((r) => r.chunk).join('')
  const fromLog = toolsFromLog(logText)
  const calls = stored.length ? { ...EMPTY_TOOLS } : fromLog.calls
  for (const row of stored) if (row.tool in calls) calls[row.tool] += row.calls

  const fixAttempts = all(
    `SELECT COUNT(*) AS n FROM ci_fix_attempts f JOIN ci_run_steps s ON s.id = f.run_step_id WHERE s.run_id = ?`,
    run.id
  )[0].n
  const kb = all(`SELECT sections_delivered, sections_hit FROM ci_run_kb_metrics WHERE run_id = ?`, run.id)[0] ?? null
  const kbChars = all(
    `SELECT COALESCE(SUM(chars), 0) AS chars, COUNT(*) AS queries,
            COALESCE(SUM(CASE WHEN injected = 1 THEN chars ELSE 0 END), 0) AS injectedChars
       FROM kb_usage_queries WHERE ci_run_id = ?`, run.id
  )[0]

  return {
    runId: run.id, at: new Date(run.created_at).toISOString(), provider: run.provider,
    model: run.model || '(пусто)', status: run.status, title: run.title ?? '',
    runDurationMs: run.duration_ms, fixAttempts, totals,
    toolCalls: calls, toolCallsSource: stored.length ? 'metric' : (toolsTotal(fromLog.calls) ? 'log' : 'none'),
    bashFileReads: fromLog.bashFileReads, bashHeredocEdits: fromLog.bashHeredocEdits,
    kbSectionsDelivered: kb?.sections_delivered ?? null, kbSectionsHit: kb?.sections_hit ?? null,
    kbQueries: kbChars.queries, kbChars: kbChars.chars, kbInjectedChars: kbChars.injectedChars
  }
})

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

const money = (t) => t.costUsd == null
  ? '—'
  : `${t.costEstimated ? '≈' : ''}$${t.costUsd.toFixed(2)}${t.costUnderstated ? ' (занижено)' : ''}`
const mins = (ms) => ms == null ? '—' : `${Math.round(ms / 60000)}м`
const k = (n) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

console.log(`БД: ${DB_PATH}; ранов: ${report.length}\n`)
for (const r of report) {
  const c = r.toolCalls
  const mark = r.toolCallsSource === 'log' ? '~' : r.toolCallsSource === 'none' ? '' : ''
  console.log(
    `${r.at.slice(0, 16)}  ${r.runId.slice(0, 8)}  ${r.provider}/${r.model}  ${r.status}  ${JSON.stringify(r.title.slice(0, 40))}\n` +
    `   ${money(r.totals)}  запросов ${r.totals.requests}  вход ${k(r.totals.inputTokens)}  выход ${k(r.totals.outputTokens)}  ` +
    `кэш ${k(r.totals.cacheReadTokens)}/${k(r.totals.cacheCreationTokens)}${r.totals.inputNormalized ? ' (вход приведён)' : ''}\n` +
    `   ран ${mins(r.runDurationMs)}  модель ${mins(r.totals.modelActiveMs || null)}  fix-loop ${r.fixAttempts}  ` +
    `инструменты ${r.toolCallsSource === 'none' ? '—' : `${mark}${toolsTotal(c)}`}` +
    `${r.toolCallsSource === 'none' ? '' : ` (bash ${c.bash} · read ${c.read} · grep ${c.grep} · edit ${c.edit} · БЗ ${c.kb})`}\n` +
    `   в bash: чтений файлов ${r.bashFileReads}, правок heredoc ${r.bashHeredocEdits}  ` +
    `БЗ: обращений ${r.kbQueries}, символов ${r.kbChars} (инъекцией ${r.kbInjectedChars})` +
    `${r.kbSectionsDelivered != null ? `, разделов ${r.kbSectionsDelivered} (попало ${r.kbSectionsHit})` : ''}`
  )
}

const byProvider = new Map()
for (const r of report) {
  const acc = byProvider.get(r.provider) ?? { runs: 0, cost: 0, costKnown: 0, requests: 0, input: 0, output: 0, cacheRead: 0, model: 0, run: 0, tools: { ...EMPTY_TOOLS }, bashReads: 0 }
  acc.runs++
  acc.requests += r.totals.requests
  acc.input += r.totals.inputTokens
  acc.output += r.totals.outputTokens
  acc.cacheRead += r.totals.cacheReadTokens
  acc.model += r.totals.modelActiveMs
  acc.run += r.runDurationMs ?? 0
  acc.bashReads += r.bashFileReads
  for (const kind of Object.keys(EMPTY_TOOLS)) acc.tools[kind] += r.toolCalls[kind]
  if (r.totals.costUsd != null) { acc.cost += r.totals.costUsd; acc.costKnown++ }
  byProvider.set(r.provider, acc)
}
console.log('\nИтог по движкам (стоимость — по ранам, где её вообще есть из чего посчитать):')
for (const [provider, a] of byProvider) {
  console.log(
    `  ${provider}: ранов ${a.runs}, $${a.cost.toFixed(2)} (по ${a.costKnown}), ` +
    `$/ран ${a.costKnown ? (a.cost / a.costKnown).toFixed(2) : '—'}, запросов ${a.requests}, ` +
    `вход ${k(a.input)}, выход ${k(a.output)}, кэш ${k(a.cacheRead)}, ` +
    `ран ${mins(a.run / a.runs)} в среднем, модель ${mins(a.model / a.runs)}, ` +
    `инструменты bash ${a.tools.bash}/read ${a.tools.read}/grep ${a.tools.grep}/edit ${a.tools.edit}/БЗ ${a.tools.kb}, ` +
    `чтений файлов через bash ${a.bashReads}`
  )
}
db.close()
