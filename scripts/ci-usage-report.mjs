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
// Там, где на ходе известны И настоящая цена, И оценка, рядом печатается их
// расхождение («прайс +0.2% к факту»): это самопроверка таблицы цен. У codex
// настоящей цены нет ни на одном ходе, весь его расход — оценка, поэтому сдвиг
// цен claude ничем себя не выдаёт и молча ломает сравнение движков — так и
// прожили полтора месяца с прайсом, завышавшим opus втрое.
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

// Прайс — копия packages/shared/src/pricing.ts (USD за 1M токенов), включая то,
// какие строки сверены с фактической ценой CLI, а какие нет: подробности там.
const PRICES = [
  [/fable/i, { input: 10, output: 50, cacheRead: 1, cacheWrite: 20 }], // проверено
  [/opus/i, { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10 }], // проверено
  [/sonnet/i, { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }], // НЕ проверено
  [/haiku/i, { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }], // НЕ проверено
  [/gpt|codex|o[0-9]/i, { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 }] // НЕ проверено
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

// `denied` — не вид инструмента, а исход вызова (отказ): сам вызов уже посчитан
// своим видом, поэтому в «всего» он не входит и печатается отдельной припиской.
const EMPTY_TOOLS = { bash: 0, read: 0, grep: 0, edit: 0, kb: 0, other: 0, denied: 0 }
const toolsTotal = (t) => Object.entries(t).reduce((a, [kind, n]) => kind === 'denied' ? a : a + n, 0)
const toolsAny = (t) => toolsTotal(t) > 0 || t.denied > 0
/** Отказ, а не обычная ошибка команды (та же логика, что в shared/isCiToolDenial). */
const isDenial = (text) =>
  /requested permissions/i.test(text) || /haven'?t granted/i.test(text) ||
  /Отклонено:/.test(text) || /tool use was (?:denied|rejected)/i.test(text)

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
    // Отказ виден только в результате вызова: `[tool_result] ✗ ошибка: …`.
    if (line.startsWith('[tool_result]') && isDenial(line)) calls.denied++
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
    costUsd: null, costEstimated: false, costUnderstated: false, inputNormalized: false, modelActiveMs: 0,
    // Сверка прайса: суммы по ходам, где известны И настоящая цена от CLI, И
    // оценка. Смысл — чтобы следующий сдвиг цен нашёлся сам: у codex цены нет
    // вовсе, и весь его расход в отчёте — оценка, так что перекос в прайсе
    // claude молча делает сравнение движков бессмысленным.
    checkRequests: 0, checkActualUsd: 0, checkEstimateUsd: 0
  }
  // Разбивка по стадиям и моделям: после «модели по стадии» стадии рана считают
  // разные движки, и по одной сумме за ран уже не видно, кто сколько съел (та же
  // группировка, что у CiRunReport.stages).
  const stages = new Map()
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
    const estimate = price
      ? (input * price.input + u.output_tokens * price.output + u.cache_read_tokens * price.cacheRead +
         u.cache_creation_tokens * price.cacheWrite) / 1e6
      : null
    if (u.cost_usd != null && estimate != null) {
      totals.checkRequests++
      totals.checkActualUsd += u.cost_usd
      totals.checkEstimateUsd += estimate
    }
    const own = u.cost_usd ?? estimate
    if (own == null) { totals.costEstimated = true; totals.costUnderstated = true }
    else {
      totals.costUsd = (totals.costUsd ?? 0) + own
      if (u.cost_usd == null) totals.costEstimated = true
    }
    const key = `${u.kind} ${u.model || '(пусто)'}`
    const stage = stages.get(key) ?? { kind: u.kind, model: u.model || '(пусто)', requests: 0, ms: 0, costUsd: 0, estimated: false }
    stage.requests++
    stage.ms += u.duration_ms ?? 0
    if (own == null) stage.estimated = true
    else {
      stage.costUsd += own
      if (u.cost_usd == null) stage.estimated = true
    }
    stages.set(key, stage)
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
    runDurationMs: run.duration_ms, fixAttempts, totals, stages: [...stages.values()],
    toolCalls: calls, toolCallsSource: stored.length ? 'metric' : (toolsAny(fromLog.calls) ? 'log' : 'none'),
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
/**
 * Насколько оценка по прайсу разошлась с фактической ценой CLI — на ходах, где
 * известны обе. Это самопроверка таблицы цен: у codex настоящей цены нет ни на
 * одном ходе, весь его расход — оценка, поэтому перекос в прайсе claude ничем
 * себя не выдаёт и тихо ломает сравнение движков. Сверять не с чем — колонки нет.
 */
const hasDrift = (t) => t.checkRequests > 0 && t.checkActualUsd > 0
const driftPct = (t) => {
  const pct = (t.checkEstimateUsd / t.checkActualUsd - 1) * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}
const drift = (t) => hasDrift(t) ? `  прайс ${driftPct(t)} к факту (по ${t.checkRequests})` : ''
const mins = (ms) => ms == null ? '—' : `${Math.round(ms / 60000)}м`
/** Подписи стадий — копия CI_USAGE_KIND_LABELS из packages/shared/src/ci.ts. */
const STAGE_LABELS = {
  model_work: 'работа модели', summary: 'резюме', fix: 'правки после падения', kb_update: 'актуализация базы знаний'
}
const k = (n) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

console.log(`БД: ${DB_PATH}; ранов: ${report.length}\n`)
for (const r of report) {
  const c = r.toolCalls
  const mark = r.toolCallsSource === 'log' ? '~' : r.toolCallsSource === 'none' ? '' : ''
  console.log(
    `${r.at.slice(0, 16)}  ${r.runId.slice(0, 8)}  ${r.provider}/${r.model}  ${r.status}  ${JSON.stringify(r.title.slice(0, 40))}\n` +
    `   ${money(r.totals)}${drift(r.totals)}  запросов ${r.totals.requests}  вход ${k(r.totals.inputTokens)}  выход ${k(r.totals.outputTokens)}  ` +
    `кэш ${k(r.totals.cacheReadTokens)}/${k(r.totals.cacheCreationTokens)}${r.totals.inputNormalized ? ' (вход приведён)' : ''}\n` +
    `   ран ${mins(r.runDurationMs)}  модель ${mins(r.totals.modelActiveMs || null)}  fix-loop ${r.fixAttempts}  ` +
    `инструменты ${r.toolCallsSource === 'none' ? '—' : `${mark}${toolsTotal(c)}`}` +
    `${r.toolCallsSource === 'none' ? '' : ` (bash ${c.bash} · read ${c.read} · grep ${c.grep} · edit ${c.edit} · БЗ ${c.kb})`}` +
    `${c.denied ? `  отказов ${c.denied}` : ''}\n` +
    // Стадии — ради них и затевалась модель по стадии: видно, чем каждая
    // посчитана и во что обошлась. Доля от рана считается от известной суммы.
    `${r.stages.map((s) => `   · ${STAGE_LABELS[s.kind] ?? s.kind} на ${s.model}: ` +
      `${s.estimated ? '≈' : ''}${s.costUsd.toFixed(2)}` +
      `${r.totals.costUsd ? ` (${Math.round((s.costUsd / r.totals.costUsd) * 100)}%)` : ''}` +
      `  запросов ${s.requests}  модель ${mins(s.ms || null)}`).join('\n')}${r.stages.length ? '\n' : ''}` +
    `   в bash: чтений файлов ${r.bashFileReads}, правок heredoc ${r.bashHeredocEdits}  ` +
    `БЗ: обращений ${r.kbQueries}, символов ${r.kbChars} (инъекцией ${r.kbInjectedChars})` +
    `${r.kbSectionsDelivered != null ? `, разделов ${r.kbSectionsDelivered} (попало ${r.kbSectionsHit})` : ''}`
  )
}

const byProvider = new Map()
for (const r of report) {
  const acc = byProvider.get(r.provider) ?? { runs: 0, cost: 0, costKnown: 0, requests: 0, input: 0, output: 0, cacheRead: 0, model: 0, run: 0, tools: { ...EMPTY_TOOLS }, bashReads: 0, checkRequests: 0, checkActualUsd: 0, checkEstimateUsd: 0 }
  acc.runs++
  acc.checkRequests += r.totals.checkRequests
  acc.checkActualUsd += r.totals.checkActualUsd
  acc.checkEstimateUsd += r.totals.checkEstimateUsd
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
    `отказов ${a.tools.denied}, чтений файлов через bash ${a.bashReads}`
  )
  // Сверка прайса по движку: пока строка держится около нуля, оценке (а значит и
  // сравнению движков) можно верить; уехала — таблица цен устарела.
  if (hasDrift(a)) {
    console.log(
      `    сверка прайса: оценка ${a.checkEstimateUsd.toFixed(2)} против факта ` +
      `${a.checkActualUsd.toFixed(2)} USD (${driftPct(a)}, по ${a.checkRequests} ходам)`
    )
  } else {
    console.log('    сверка прайса: не с чем — настоящей цены от CLI ни на одном ходе нет')
  }
}
db.close()
