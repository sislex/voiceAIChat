// Чистая логика домена CI: бюджет уточняющих вопросов и полнота списков.
import { describe, it, expect } from 'vitest'
import {
  canStartCiRun,
  canTransitionTestGroup,
  blockedGroupsAfterFailure,
  mayMarkGroupNotApplicable,
  sameTestRunRevision,
  ciCardPulse,
  ciSummaryForTask,
  clarifyBudget,
  CI_CLARIFY_LEVELS,
  CI_CLARIFY_MAX_LIMIT,
  CI_RUN_MODES,
  CI_STATUSES,
  DEFAULT_CI_CLAUDE_MODEL,
  DEFAULT_CI_LLM_CONFIG,
  isActiveCiStatus,
  isTerminalCiStatus,
  isVerificationCommand,
  pickCiRunAgent,
  ciModelKnown,
  ciTaskTotals,
  ciUsageStages,
  ciUsageTotals,
  ciUsageInputTokens,
  normCiStageModels,
  resolveCiStageModel,
  resolveCiStageLlm,
  DEFAULT_CI_GLOBAL_SETTINGS,
  DEFAULT_CI_STAGE_MODELS,
  sumCiUsageTotals,
  classifyCiToolCall,
  countCiToolCalls,
  ciToolCallsTotal,
  ciToolCallsAny,
  isCiToolDenial,
  sumCiToolCalls,
  ciAvgContextPerRequest,
  ciToolCharsTotal,
  ciToolOutputLimits,
  isTrimmedToolOutput,
  sumCiToolChars,
  topCiToolResponses,
  trimmedToolOutputOriginalChars,
  trimToolOutput,
  DEFAULT_TOOL_OUTPUT_LIMITS,
  EMPTY_CI_TOOL_CALLS,
  EMPTY_CI_TOOL_CHARS,
  EMPTY_CI_USAGE_TOTALS,
  TOOL_OUTPUT_TRIM_MARK,
  type CiRunReport,
  type CiRunUsage,
  type CiUsageTotals
} from './ci'

describe('clarifyBudget', () => {
  it('фиксированные уровни дают 0/3/6', () => {
    expect(clarifyBudget({ clarifyLevel: 'none', clarifyMax: 30 })).toBe(0)
    expect(clarifyBudget({ clarifyLevel: 'few', clarifyMax: 30 })).toBe(3)
    expect(clarifyBudget({ clarifyLevel: 'medium', clarifyMax: 30 })).toBe(6)
  })

  it('детальное уточнение берёт clarifyMax и зажимается в 1..30', () => {
    expect(clarifyBudget({ clarifyLevel: 'detailed', clarifyMax: 12 })).toBe(12)
    expect(clarifyBudget({ clarifyLevel: 'detailed', clarifyMax: 0 })).toBe(1)
    expect(clarifyBudget({ clarifyLevel: 'detailed', clarifyMax: -5 })).toBe(1)
    expect(clarifyBudget({ clarifyLevel: 'detailed', clarifyMax: 999 })).toBe(CI_CLARIFY_MAX_LIMIT)
    expect(clarifyBudget({ clarifyLevel: 'detailed', clarifyMax: 2.6 })).toBe(3)
  })

  it('дефолт конфигурации — разработка с тремя вопросами', () => {
    expect(DEFAULT_CI_LLM_CONFIG.mode).toBe('development')
    expect(clarifyBudget(DEFAULT_CI_LLM_CONFIG)).toBe(3)
  })

  it('дефолтный движок CI — claude opus', () => {
    expect(DEFAULT_CI_LLM_CONFIG.provider).toBe('claude')
    expect(DEFAULT_CI_LLM_CONFIG.model).toBe('opus')
    expect(DEFAULT_CI_CLAUDE_MODEL).toBe('opus')
  })
})

describe('списки и статусы', () => {
  it('все уровни уточнения дают неотрицательный бюджет', () => {
    for (const clarifyLevel of CI_CLARIFY_LEVELS) {
      expect(clarifyBudget({ clarifyLevel, clarifyMax: 3 })).toBeGreaterThanOrEqual(0)
    }
  })

  it('режимов ровно два', () => {
    expect(CI_RUN_MODES).toEqual(['plan', 'development'])
  })

  it('ожидание ввода — не терминальный статус', () => {
    expect(CI_STATUSES).toContain('awaiting_input')
    expect(isTerminalCiStatus('awaiting_input')).toBe(false)
    expect(isTerminalCiStatus('success')).toBe(true)
  })
})

describe('isActiveCiStatus', () => {
  it('активны очередь, работа и ожидание ответа', () => {
    expect(isActiveCiStatus('queued')).toBe(true)
    expect(isActiveCiStatus('running')).toBe(true)
    expect(isActiveCiStatus('awaiting_input')).toBe(true)
  })

  it('терминальные статусы неактивны — запуск снова доступен', () => {
    for (const s of CI_STATUSES.filter(isTerminalCiStatus)) expect(isActiveCiStatus(s)).toBe(false)
    expect(isActiveCiStatus('skipped')).toBe(false)
  })
})

describe('canStartCiRun', () => {
  it('без рана запуск доступен', () => {
    expect(canStartCiRun(null)).toBe(true)
    expect(canStartCiRun(undefined)).toBe(true)
  })

  it('завершённый ран запуску не мешает — «Выполнить» стартует новый', () => {
    for (const s of ['success', 'failed', 'cancelled', 'timeout', 'skipped'] as const) {
      expect(canStartCiRun({ status: s })).toBe(true)
    }
  })

  it('пока ран активен, запуск закрыт', () => {
    for (const s of ['queued', 'running', 'awaiting_input'] as const) {
      expect(canStartCiRun({ status: s })).toBe(false)
    }
  })

  it('покрыты все статусы: запуск закрыт ровно на активных', () => {
    for (const s of CI_STATUSES) expect(canStartCiRun({ status: s })).toBe(!isActiveCiStatus(s))
  })
})

describe('ciSummaryForTask', () => {
  it('закрытая вручную задача не наследует старую ошибку рана', () => {
    const failed = { status: 'failed' as const }
    const timedOut = { status: 'timeout' as const }
    expect(ciSummaryForTask(failed, true)).toBeNull()
    expect(ciSummaryForTask(timedOut, true)).toBeNull()
    expect(ciSummaryForTask(failed, false)).toBe(failed)
  })

  it('не скрывает активный или успешный ран даже в done', () => {
    const running = { status: 'running' as const }
    const success = { status: 'success' as const }
    expect(ciSummaryForTask(running, true)).toBe(running)
    expect(ciSummaryForTask(success, true)).toBe(success)
  })
})

describe('ciCardPulse', () => {
  const sp = (fixing?: boolean): { done: number; total: number; phase: string; fixing?: boolean } =>
    ({ done: 1, total: 4, phase: 'ф', fixing })

  it('без рана подсветки нет', () => {
    expect(ciCardPulse(null)).toBeNull()
    expect(ciCardPulse(undefined)).toBeNull()
  })

  it('ран идёт — голубое «дыхание», а с флагом fixing — красное мигание', () => {
    expect(ciCardPulse({ status: 'running', slotProgress: sp() })).toBe('running')
    expect(ciCardPulse({ status: 'queued', slotProgress: sp() })).toBe('running')
    expect(ciCardPulse({ status: 'running', slotProgress: sp(true) })).toBe('fixing')
  })

  it('ожидание ответа, падение и успех дают свои состояния', () => {
    expect(ciCardPulse({ status: 'awaiting_input', slotProgress: sp() })).toBe('awaiting')
    expect(ciCardPulse({ status: 'failed', slotProgress: sp() })).toBe('failed')
    expect(ciCardPulse({ status: 'timeout', slotProgress: sp() })).toBe('failed')
    expect(ciCardPulse({ status: 'success', slotProgress: sp() })).toBe('done')
  })

  it('ожидание ответа важнее флага fixing', () => {
    expect(ciCardPulse({ status: 'awaiting_input', slotProgress: sp(true) })).toBe('awaiting')
  })

  it('отменённый и пропущенный ран карточку не подсвечивают', () => {
    expect(ciCardPulse({ status: 'cancelled', slotProgress: sp() })).toBeNull()
    expect(ciCardPulse({ status: 'skipped', slotProgress: sp() })).toBeNull()
  })
})

describe('pickCiRunAgent', () => {
  it('свободная машина по умолчанию выбирается первой', () => {
    expect(pickCiRunAgent(['a', 'b'], 'b', {})).toBe('b')
    expect(pickCiRunAgent(['a', 'b'], 'b', { a: 3 })).toBe('b')
  })

  it('занятая машина по умолчанию уступает машине без активных ранов', () => {
    expect(pickCiRunAgent(['a', 'b', 'c'], 'a', { a: 1 })).toBe('b')
    expect(pickCiRunAgent(['a', 'b', 'c'], 'a', { a: 1, b: 2 })).toBe('c')
  })

  it('свободных нет — берётся минимально загруженная', () => {
    expect(pickCiRunAgent(['a', 'b', 'c'], 'a', { a: 3, b: 1, c: 2 })).toBe('b')
  })

  it('при равной загрузке предпочитает машину по умолчанию, иначе порядок списка', () => {
    expect(pickCiRunAgent(['a', 'b', 'c'], 'c', { a: 1, b: 1, c: 1 })).toBe('c')
    expect(pickCiRunAgent(['a', 'b'], null, { a: 2, b: 2 })).toBe('a')
  })

  it('машина по умолчанию вне списка машин проекта не выбирается', () => {
    expect(pickCiRunAgent(['a', 'b'], 'x', {})).toBe('a')
  })

  it('пустой список машин — некуда запускать', () => {
    expect(pickCiRunAgent([], 'a', {})).toBeNull()
  })
})

describe('isVerificationCommand', () => {
  it('узнаёт гейт по тексту команды, даже если флаг не проставлен', () => {
    expect(isVerificationCommand({ name: 'Запустить тестирование (npm test)', script: 'npm test' })).toBe(true)
    expect(isVerificationCommand({ name: 'Гейт', script: 'npm run -w @voicechat/server typecheck && npm run -w @voicechat/server test' })).toBe(true)
    expect(isVerificationCommand({ name: 'UI', script: 'npx vitest run' })).toBe(true)
    expect(isVerificationCommand({ name: 'Линт', script: 'npm run lint' })).toBe(true)
    expect(isVerificationCommand({ name: 'Гейт', script: 'npm run affected-check' })).toBe(true)
  })

  it('флаг справочника перевешивает текст', () => {
    expect(isVerificationCommand({ isTest: true, name: 'Проверка', script: './check.sh' })).toBe(true)
  })

  it('установка зависимостей и сборка гейтом не считаются — они модели нужны', () => {
    expect(isVerificationCommand({ name: 'Установить зависимости (npm ci)', script: 'npm ci' })).toBe(false)
    expect(isVerificationCommand({ name: 'Сборка', script: 'npm run build' })).toBe(false)
    expect(isVerificationCommand({ name: 'Клонировать репозиторий', script: 'git clone --branch "$BASE_BRANCH" "$GIT_URL"' })).toBe(false)
    expect(isVerificationCommand({ name: 'Обновить прод-контейнер', script: 'docker compose up --build -d' })).toBe(false)
  })
})

// Агрегаторы расхода модели: числа отчёта по рану и по задаче считаются здесь,
// а сервер и UI только показывают их. Поэтому тесты — на числах, без моков.
describe('ciUsageTotals', () => {
  const row = (over: Partial<CiRunUsage> = {}): CiRunUsage => ({
    id: 'u1', runId: 'r1', stepId: 's1', kind: 'model_work', provider: 'claude', model: 'sonnet',
    inputTokens: 100, outputTokens: 200, cacheReadTokens: 300, cacheCreationTokens: 400,
    inputSemantics: 'no_cache', costUsd: null, durationMs: 1000, numTurns: 1, at: 1, ...over
  })

  it('пустой список — нули и отсутствующая стоимость', () => {
    expect(ciUsageTotals([])).toEqual(EMPTY_CI_USAGE_TOTALS)
  })

  it('складывает токены, запросы и время работы модели', () => {
    const t = ciUsageTotals([row(), row({ id: 'u2', durationMs: 500, costUsd: 0.5 })])
    expect(t.requests).toBe(2)
    expect(t.inputTokens).toBe(200)
    expect(t.outputTokens).toBe(400)
    expect(t.cacheReadTokens).toBe(600)
    expect(t.cacheCreationTokens).toBe(800)
    expect(t.tokens).toBe(2000)
    expect(t.modelActiveMs).toBe(1500)
  })

  it('стоимость от CLI берётся как есть — итог точный', () => {
    const t = ciUsageTotals([row({ costUsd: 0.25 }), row({ id: 'u2', costUsd: 0.75 })])
    expect(t.costUsd).toBeCloseTo(1, 10)
    expect(t.costEstimated).toBe(false)
  })

  it('без стоимости от CLI считает оценку по прайсу и помечает итог', () => {
    const t = ciUsageTotals([row({ model: 'sonnet' })])
    // sonnet: 100·3 + 200·15 + 300·0.3 + 400·3.75 за 1M токенов.
    expect(t.costUsd).toBeCloseTo((100 * 3 + 200 * 15 + 300 * 0.3 + 400 * 3.75) / 1e6, 12)
    expect(t.costEstimated).toBe(true)
  })

  it('неизвестная модель: слагаемого нет, но итог помечен приблизительным', () => {
    const t = ciUsageTotals([row({ model: 'своя-модель' }), row({ id: 'u2', costUsd: 2 })])
    expect(t.costUsd).toBe(2)
    expect(t.costEstimated).toBe(true)
  })

  it('нет ни одной посчитанной стоимости — null, а не ноль', () => {
    expect(ciUsageTotals([row({ model: '' })]).costUsd).toBeNull()
  })

  it('ход без длительности не ломает время работы модели', () => {
    expect(ciUsageTotals([row({ durationMs: null })]).modelActiveMs).toBe(0)
  })

  it('модель unknown: слагаемого нет, итог помечен заниженным', () => {
    const t = ciUsageTotals([row({ model: 'unknown' }), row({ id: 'u2', costUsd: 3 })])
    expect(t.costUsd).toBe(3)
    expect(t.costEstimated).toBe(true)
    expect(t.costUnderstated).toBe(true)
  })

  it('точная стоимость от CLI не считается заниженной', () => {
    const t = ciUsageTotals([row({ costUsd: 1 })])
    expect(t.costEstimated).toBe(false)
    expect(t.costUnderstated).toBe(false)
  })

  // Историческая строка codex: вход в БД лежит ВМЕСТЕ с прочитанным кэшем.
  // Переписывать её нельзя, поэтому семантики сводятся на чтении.
  it('старая строка codex приводится к «входу без кэша» и помечает итог', () => {
    const legacy = row({ provider: 'codex', model: 'gpt-5.4', inputSemantics: 'with_cache', inputTokens: 1000, cacheReadTokens: 800 })
    expect(ciUsageInputTokens(legacy)).toBe(200)
    const t = ciUsageTotals([legacy])
    expect(t.inputTokens).toBe(200)
    expect(t.cacheReadTokens).toBe(800)
    expect(t.inputNormalized).toBe(true)
    // Оценка идёт по приведённому входу: 200 по цене входа, а не 1000.
    expect(t.costUsd).toBeCloseTo((200 * 1.25 + 200 * 10 + 800 * 0.125 + 400 * 1.25) / 1e6, 12)
  })

  it('вход меньше кэша (иная арифметика CLI) зажимается в ноль, а не уходит в минус', () => {
    expect(ciUsageInputTokens(row({ inputSemantics: 'with_cache', inputTokens: 100, cacheReadTokens: 900 }))).toBe(0)
  })

  it('приведённые строки не пересчитываются повторно', () => {
    const t = ciUsageTotals([row({ provider: 'codex', model: 'gpt-5.4', inputTokens: 1000, cacheReadTokens: 800 })])
    expect(t.inputTokens).toBe(1000)
    expect(t.inputNormalized).toBe(false)
  })

  // Второй множитель цены хода: контекст на ОДИН запрос к API. Ходов CLI мало
  // (единицы), запросов — сотни: каждый вызов инструмента идёт новым запросом со
  // всем накопленным контекстом, и по сумме токенов это не видно.
  it('считает запросы к API и контекст на запрос — средний и самый тяжёлый', () => {
    const light = row({ numTurns: 10, inputTokens: 0, outputTokens: 500, cacheReadTokens: 100_000, cacheCreationTokens: 0 })
    const heavy = row({ id: 'u2', numTurns: 5, inputTokens: 0, outputTokens: 500, cacheReadTokens: 400_000, cacheCreationTokens: 0 })
    const t = ciUsageTotals([light, heavy])
    expect(t.requests).toBe(2) // ходов CLI — два
    expect(t.apiRequests).toBe(15) // а запросов к API — пятнадцать
    expect(ciAvgContextPerRequest(t)).toBe(Math.round(500_000 / 15))
    // Максимум — самый дорогой ход, а не сумма: 400k на 5 запросов.
    expect(t.maxContextPerRequest).toBe(80_000)
  })

  it('запись кэша входит в контекст запроса, выход — нет', () => {
    const t = ciUsageTotals([row({ numTurns: 2, inputTokens: 1000, outputTokens: 1_000_000, cacheReadTokens: 2000, cacheCreationTokens: 1000 })])
    expect(ciAvgContextPerRequest(t)).toBe(2000)
  })

  it('без num_turns контекст на запрос — null, а не ноль', () => {
    const t = ciUsageTotals([row({ numTurns: null })])
    expect(t.apiRequests).toBe(0)
    expect(ciAvgContextPerRequest(t)).toBeNull()
    expect(t.maxContextPerRequest).toBe(0)
  })

  it('итог по ранам складывает запросы, а максимум оставляет максимумом', () => {
    const a = ciUsageTotals([row({ numTurns: 4, cacheReadTokens: 40_000, inputTokens: 0, cacheCreationTokens: 0 })])
    const b = ciUsageTotals([row({ id: 'u2', numTurns: 2, cacheReadTokens: 60_000, inputTokens: 0, cacheCreationTokens: 0 })])
    const sum = sumCiUsageTotals([a, b])
    expect(sum.apiRequests).toBe(6)
    expect(sum.maxContextPerRequest).toBe(30_000)
    expect(ciAvgContextPerRequest(sum)).toBe(Math.round(100_000 / 6))
  })
})

// Сжатие ответов инструментов: главный множитель цены хода — размер контекста, а
// он набирается ответами, которые перечитываются на каждом следующем запросе.
describe('trimToolOutput', () => {
  const text = (n: number, ch = 'a'): string => Array.from({ length: n }, () => `${ch}`).join('')

  it('короткий вывод не трогает и обрезанным не помечает', () => {
    const r = trimToolOutput('ровно то, что нужно', 1000)
    expect(r.truncated).toBe(false)
    expect(r.text).toBe('ровно то, что нужно')
    expect(r.originalChars).toBe('ровно то, что нужно'.length)
    expect(isTrimmedToolOutput(r.text)).toBe(false)
  })

  it('длинный вывод режет середину: хвост важнее головы', () => {
    const out = `ШАПКА\n${text(4000, 'x')}\nПРИЧИНА ПАДЕНИЯ`
    const r = trimToolOutput(out, 1000, 'сузь вывод')
    expect(r.truncated).toBe(true)
    expect(r.text.startsWith('ШАПКА')).toBe(true)
    // Хвост на месте — по нему fix-loop и понимает, из-за чего упали тесты.
    expect(r.text.endsWith('ПРИЧИНА ПАДЕНИЯ')).toBe(true)
    expect(r.text).not.toContain(text(2000, 'x'))
    // Метка явная, с числами и подсказкой, чем дочитать.
    expect(isTrimmedToolOutput(r.text)).toBe(true)
    expect(r.text).toContain('Данные неполные; сузь вывод')
    expect(trimmedToolOutputOriginalChars(r.text)).toBe(out.length)
    // Под хвост уходит больше, чем под голову (доля 25/75).
    const head = r.text.slice(0, r.text.indexOf(TOOL_OUTPUT_TRIM_MARK))
    const tail = r.text.slice(r.text.lastIndexOf('⟧') + 1)
    expect(tail.length).toBeGreaterThan(head.length)
  })

  it('не падает ни на пустом выводе, ни на крошечном лимите, ни на выводе без переводов строк', () => {
    expect(trimToolOutput('', 1).truncated).toBe(false)
    const r = trimToolOutput(text(5000, 'z'), 1)
    expect(r.truncated).toBe(true)
    expect(r.text.length).toBeLessThan(1000)
    expect(trimmedToolOutputOriginalChars(r.text)).toBe(5000)
  })
})

describe('ciToolOutputLimits', () => {
  it('без настроек — дефолты, а настройки применяются как есть', () => {
    expect(ciToolOutputLimits()).toEqual({ bashChars: 8_000, readChars: 24_000, readLines: 600, grepMatches: 100, grepChars: 8_000 })
    expect(ciToolOutputLimits({ bashOutputLimitChars: 5000 }).bashChars).toBe(5000)
  })

  it('мусор в настройке не роняет ход: ноль, минус и NaN дают дефолт', () => {
    const limits = ciToolOutputLimits({
      bashOutputLimitChars: 0, readOutputLimitChars: -5, readWindowMaxLines: Number.NaN, grepMatchLimit: undefined
    })
    expect(limits.bashChars).toBe(8_000)
    expect(limits.readChars).toBe(24_000)
    expect(limits.readLines).toBe(600)
    expect(limits.grepMatches).toBe(100)
  })

  it('слишком мелкие и слишком крупные значения зажимаются в границы', () => {
    // Ниже минимума модель не увидит ни причины падения, ни контекста.
    expect(ciToolOutputLimits({ bashOutputLimitChars: 10 }).bashChars).toBe(1000)
    expect(ciToolOutputLimits({ readWindowMaxLines: 1 }).readLines).toBe(40)
    expect(ciToolOutputLimits({ grepMatchLimit: 1 }).grepMatches).toBe(5)
    expect(ciToolOutputLimits({ bashOutputLimitChars: 9_000_000 }).bashChars).toBe(400_000)
  })

  it('дефолты настроек CI и дефолты моста — одно и то же', () => {
    expect(ciToolOutputLimits(DEFAULT_CI_GLOBAL_SETTINGS)).toEqual(DEFAULT_TOOL_OUTPUT_LIMITS)
  })
})

// Объём ответов и тяжёлые ответы: число вызовов о цене не говорит, платится за
// символы, которые перечитываются на каждом следующем запросе хода.
describe('объём ответов инструментов', () => {
  it('всего символов — по видам инструментов, отказы отдельно', () => {
    const chars = { ...EMPTY_CI_TOOL_CHARS, bash: 100_000, read: 20_000, denied: 500 }
    expect(ciToolCharsTotal(chars)).toBe(120_000)
  })

  it('складывает раны, а ран без метрики оставляет null', () => {
    expect(sumCiToolChars([null, null])).toBeNull()
    const sum = sumCiToolChars([{ ...EMPTY_CI_TOOL_CHARS, bash: 10 }, null, { ...EMPTY_CI_TOOL_CHARS, bash: 5, read: 1 }])
    expect(sum).toMatchObject({ bash: 15, read: 1 })
  })

  it('топ ответов — от тяжёлого к лёгкому, при равенстве раньше пришедший', () => {
    const mk = (chars: number, at: number) => ({ tool: 'mcp__remote__bash', kind: 'bash' as const, label: `#${at}`, chars, originalChars: null, stepId: null, at })
    const top = topCiToolResponses([mk(10, 3), mk(300, 1), mk(300, 2), mk(50, 4)], 3)
    expect(top.map((r) => r.label)).toEqual(['#1', '#2', '#4'])
  })
})

// Модель по стадии рана: вспомогательные стадии не обязаны идти на модели
// разработки, но и уронить ран настройка не имеет права.
describe('resolveCiStageModel', () => {
  const run = { llmProvider: 'claude' as const, llmModel: 'opus' }

  it('дефолт: разработка и правки — на модели рана, база знаний и резюме — дешевле', () => {
    expect(DEFAULT_CI_STAGE_MODELS.model_work).toBe('')
    expect(DEFAULT_CI_STAGE_MODELS.fix).toBe('')
    expect(resolveCiStageModel('model_work', DEFAULT_CI_STAGE_MODELS, run)).toBe('opus')
    expect(resolveCiStageModel('fix', DEFAULT_CI_STAGE_MODELS, run)).toBe('opus')
    expect(resolveCiStageModel('kb_update', DEFAULT_CI_STAGE_MODELS, run)).toBe('sonnet')
    expect(resolveCiStageModel('summary', DEFAULT_CI_STAGE_MODELS, run)).toBe('haiku')
    expect(DEFAULT_CI_GLOBAL_SETTINGS.stageModels).toEqual(DEFAULT_CI_STAGE_MODELS)
  })

  it('без настройки стадии берётся модель рана, у claude пустая — дефолт CI', () => {
    expect(resolveCiStageModel('kb_update', null, run)).toBe('opus')
    expect(resolveCiStageModel('kb_update', {}, { llmProvider: 'claude', llmModel: '' })).toBe(DEFAULT_CI_CLAUDE_MODEL)
    // У codex пустая модель штатна: он берёт её из своего config.toml.
    expect(resolveCiStageModel('kb_update', {}, { llmProvider: 'codex', llmModel: '' })).toBe('')
  })

  it('модель, которой у движка рана нет, откатывается на модель рана', () => {
    // claude-алиас в codex-ране и наоборот: исполнитель такую модель не запустит.
    expect(resolveCiStageModel('kb_update', { kb_update: 'sonnet' }, { llmProvider: 'codex', llmModel: 'gpt-5.5' })).toBe('gpt-5.5')
    expect(resolveCiStageModel('kb_update', { kb_update: 'gpt-5.4' }, run)).toBe('opus')
    expect(resolveCiStageModel('summary', { summary: 'сонет' }, run)).toBe('opus')
  })

  it('алиасы claude узнаются с префиксом и суффиксом окна', () => {
    expect(ciModelKnown('claude', 'opus')).toBe(true)
    expect(ciModelKnown('claude', 'opus[1m]')).toBe(true)
    expect(ciModelKnown('claude', 'claude-haiku')).toBe(true)
    expect(ciModelKnown('claude', 'gpt-5.4')).toBe(false)
    expect(ciModelKnown('claude', '')).toBe(false)
    expect(ciModelKnown('codex', 'gpt-5.5')).toBe(true)
    expect(ciModelKnown('codex', 'gpt-5.4')).toBe(true)
    expect(ciModelKnown('codex', 'gpt-5.3-codex-spark')).toBe(true)
  })

  it('настройка чистится: чужие ключи прочь, не-строка — «модель рана»', () => {
    const norm = normCiStageModels({ kb_update: ' haiku ', summary: 7, чужое: 'x' })
    expect(norm).toEqual({ ...DEFAULT_CI_STAGE_MODELS, kb_update: 'haiku', summary: '' })
    expect(normCiStageModels(null)).toEqual(DEFAULT_CI_STAGE_MODELS)
    expect(normCiStageModels('строка')).toEqual(DEFAULT_CI_STAGE_MODELS)
  })
})

describe('ciUsageStages', () => {
  const row = (over: Partial<CiRunUsage> = {}): CiRunUsage => ({
    id: 'u1', runId: 'r1', stepId: 's1', kind: 'model_work', provider: 'claude', model: 'opus',
    inputTokens: 0, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0,
    inputSemantics: 'no_cache', costUsd: 1, durationMs: 1000, numTurns: 1, at: 1, ...over
  })

  it('разбивает расход по стадии и модели в порядке стадий', () => {
    const stages = ciUsageStages([
      row(),
      row({ id: 'u2', kind: 'kb_update', model: 'sonnet', costUsd: 0.1, durationMs: 500 }),
      row({ id: 'u3', costUsd: 2 }),
      row({ id: 'u4', kind: 'summary', model: 'haiku', costUsd: 0.01 })
    ])
    expect(stages.map((s) => [s.kind, s.model])).toEqual([
      ['model_work', 'opus'], ['kb_update', 'sonnet'], ['summary', 'haiku']
    ])
    expect(stages[0].totals.requests).toBe(2)
    expect(stages[0].totals.costUsd).toBe(3)
    expect(stages[1].totals.modelActiveMs).toBe(500)
  })

  it('одна стадия на двух моделях — две строки: цену от разных моделей не смешиваем', () => {
    const stages = ciUsageStages([row({ kind: 'kb_update', model: 'sonnet' }), row({ id: 'u2', kind: 'kb_update', model: 'opus' })])
    expect(stages).toHaveLength(2)
    expect(stages.map((s) => s.model)).toEqual(['sonnet', 'opus'])
  })

  it('расхода нет — стадий нет (ран до фичи)', () => {
    expect(ciUsageStages([])).toEqual([])
  })
})

// Вызовы инструментов: имя приходит от CLI в трёх разных видах, а вид
// инструмента должен получаться один и тот же — иначе разбивка по движкам
// несравнима, а гипотезу «читаем read, а не cat в bash» не проверить.
describe('classifyCiToolCall', () => {
  it('сводит имена claude, codex и встроенных инструментов к одному виду', () => {
    expect(classifyCiToolCall('mcp__remote__read')).toBe('read')
    expect(classifyCiToolCall('remote:read')).toBe('read')
    expect(classifyCiToolCall('Read')).toBe('read')
    expect(classifyCiToolCall('mcp__remote__bash')).toBe('bash')
    expect(classifyCiToolCall('shell')).toBe('bash')
    expect(classifyCiToolCall('remote:grep')).toBe('grep')
    expect(classifyCiToolCall('mcp__remote__edit')).toBe('edit')
    expect(classifyCiToolCall('Write')).toBe('edit')
  })

  it('сервер БЗ важнее имени тула: поиск по базе — это обращение к базе', () => {
    expect(classifyCiToolCall('mcp__kb__search')).toBe('kb')
    expect(classifyCiToolCall('kb:document')).toBe('kb')
    expect(classifyCiToolCall('kb:topics')).toBe('kb')
  })

  it('незнакомое и пустое имя — прочее, а не выдуманный вид', () => {
    expect(classifyCiToolCall('mcp__ci__run_command')).toBe('other')
    expect(classifyCiToolCall('WebFetch')).toBe('other')
    expect(classifyCiToolCall('  ')).toBe('other')
  })
})

describe('счётчики вызовов инструментов', () => {
  it('считает по видам и даёт общий итог', () => {
    const calls = countCiToolCalls(['mcp__remote__read', 'remote:read', 'remote:bash', 'kb:search', 'ToolSearch'])
    expect(calls).toEqual({ ...EMPTY_CI_TOOL_CALLS, read: 2, bash: 1, kb: 1, other: 1 })
    expect(ciToolCallsTotal(calls)).toBe(5)
  })

  it('отказ не попадает в «всего»: сам вызов уже посчитан своим видом', () => {
    const calls = { ...EMPTY_CI_TOOL_CALLS, bash: 3, read: 2, denied: 2 }
    expect(ciToolCallsTotal(calls)).toBe(5)
    expect(ciToolCallsAny(calls)).toBe(true)
    // Ход из одних отказов записать надо — иначе их снова никто не увидит.
    expect(ciToolCallsAny({ ...EMPTY_CI_TOOL_CALLS, denied: 1 })).toBe(true)
    expect(ciToolCallsAny({ ...EMPTY_CI_TOOL_CALLS })).toBe(false)
  })

  it('отказ узнаётся по тексту результата, ошибка команды — нет', () => {
    expect(isCiToolDenial("Claude requested permissions to use mcp__remote__edit, but you haven't granted it yet.")).toBe(true)
    expect(isCiToolDenial('✗ ошибка: Отклонено: режим «План» — правки файлов запрещены')).toBe(true)
    expect(isCiToolDenial('Отклонено: это чтение файла, а его делает инструмент read.')).toBe(true)
    expect(isCiToolDenial('[exit code: 1]')).toBe(false)
    expect(isCiToolDenial('ENOENT: no such file or directory')).toBe(false)
    expect(isCiToolDenial('mkdir: Permission denied')).toBe(false)
    expect(isCiToolDenial('')).toBe(false)
  })

  it('сумма ранов без счётчика — null, а не нули: «нет метрики» ≠ «нет вызовов»', () => {
    expect(sumCiToolCalls([null, null])).toBeNull()
    expect(sumCiToolCalls([])).toBeNull()
    expect(sumCiToolCalls([null, { ...EMPTY_CI_TOOL_CALLS, read: 3 }])).toEqual({ ...EMPTY_CI_TOOL_CALLS, read: 3 })
  })
})

describe('sumCiUsageTotals и ciTaskTotals', () => {
  const totals = (over: Partial<CiUsageTotals> = {}): CiUsageTotals => ({
    ...EMPTY_CI_USAGE_TOTALS, requests: 1, inputTokens: 10, outputTokens: 20, tokens: 30,
    costUsd: 1, modelActiveMs: 100, ...over
  })

  it('складывает итоги и наследует пометку оценки', () => {
    const s = sumCiUsageTotals([totals(), totals({ costEstimated: true, costUsd: 0.5 })])
    expect(s.requests).toBe(2)
    expect(s.tokens).toBe(60)
    expect(s.costUsd).toBeCloseTo(1.5, 10)
    expect(s.costEstimated).toBe(true)
    expect(s.modelActiveMs).toBe(200)
  })

  it('сумма пустого списка — нули без стоимости', () => {
    expect(sumCiUsageTotals([])).toEqual(EMPTY_CI_USAGE_TOTALS)
  })

  it('итог по задаче складывает раны, включая ран без расхода', () => {
    const run = (over: Partial<CiRunReport> = {}): CiRunReport => ({
      runId: 'r1', projectId: 'p1', taskId: 't1', status: 'success', mode: 'development',
      provider: 'claude', model: 'opus', startedAt: 1, finishedAt: 2, durationMs: 5000, createdAt: 1,
      fixAttempts: 0, kbHit: null, toolCalls: null, toolChars: null, toolResponses: [],
      totals: totals(), stages: [], steps: [], ...over
    })
    const r = ciTaskTotals([run(), run({ runId: 'r2', durationMs: null, totals: { ...EMPTY_CI_USAGE_TOTALS } })])
    expect(r.durationMs).toBe(5000)
    expect(r.totals.requests).toBe(1)
    expect(r.totals.costUsd).toBe(1)
    // Счётчика вызовов нет ни у одного рана — в итоге тоже null.
    expect(r.toolCalls).toBeNull()
  })

  it('выбирает executor/provider/model этапа по независимой цепочке наследования', () => {
    expect(resolveCiStageLlm({
      taskStage: { model: 'gpt-5.4' },
      projectStage: { provider: 'codex' },
      projectModel: { llmEngineId: 'engine-project', provider: 'claude', model: 'opus' },
      systemFallback: { llmEngineId: null, provider: 'claude', model: 'sonnet' }
    })).toEqual({ llmEngineId: 'engine-project', provider: 'codex', model: 'gpt-5.4' })
  })

  it('итог по задаче складывает вызовы инструментов тех ранов, где счётчик есть', () => {
    const run = (over: Partial<CiRunReport> = {}): CiRunReport => ({
      runId: 'r1', projectId: 'p1', taskId: 't1', status: 'success', mode: 'development',
      provider: 'codex', model: 'gpt-5.4', startedAt: 1, finishedAt: 2, durationMs: 1000, createdAt: 1,
      fixAttempts: 0, kbHit: null, toolCalls: null, toolChars: null, toolResponses: [],
      totals: totals(), stages: [], steps: [], ...over
    })
    const r = ciTaskTotals([
      run({ toolCalls: { ...EMPTY_CI_TOOL_CALLS, read: 10, bash: 4 } }),
      run({ runId: 'r2' }),
      run({ runId: 'r3', toolCalls: { ...EMPTY_CI_TOOL_CALLS, read: 5, edit: 2 } })
    ])
    expect(r.toolCalls).toEqual({ ...EMPTY_CI_TOOL_CALLS, read: 15, bash: 4, edit: 2 })
  })
})

describe('test pipeline transitions', () => {
  const group = (id: string, position: number, status: import('./ci').TestGroupStatus = 'queued'): import('./ci').TestGroupRun => ({
    id, testRunId: 'run-1', configId: id, name: id, kind: 'custom', command: 'npm test',
    commandVersion: 1, position, required: true, status, commitSha: 'abc', startedAt: null,
    finishedAt: null, durationMs: null, exitCode: null, counters: { suites: null, tests: null, passed: 0, failed: 0, skipped: 0 },
    currentSuite: null, currentTest: null, progress: null, log: '', failures: [], artifacts: [],
    skipReason: null, notApplicable: null, browserProject: null, baseUrl: null, testData: null
  })

  it.each([
    ['queued', 'running', true],
    ['queued', 'not_applicable', true],
    ['running', 'passed', true],
    ['running', 'failed', true],
    ['passed', 'running', false],
    ['failed', 'running', false]
  ] as const)('%s → %s = %s', (from, to, allowed) => {
    expect(canTransitionTestGroup(from, to)).toBe(allowed)
  })

  it('fail-fast пропускает только не начатые последующие группы', () => {
    const result = blockedGroupsAfterFailure([
      group('done', 1, 'passed'), group('failed', 2, 'failed'), group('later', 3), group('na', 4, 'not_applicable')
    ], 'failed')
    expect(result.map((item) => [item.status, item.skipReason])).toEqual([
      ['passed', null], ['failed', null], ['skipped', 'blocked_by_failure'], ['not_applicable', null]
    ])
  })

  it('Playwright N/A разрешён только владельцу/тестировщику и с полным обоснованием', () => {
    const playwright = { kind: 'playwright_smoke', required: false } as const
    const decision = { reason: 'нет UI', alternativeVerification: 'contract test' }
    expect(mayMarkGroupNotApplicable(playwright, 'owner', decision)).toBe(true)
    expect(mayMarkGroupNotApplicable(playwright, 'tester', decision)).toBe(true)
    expect(mayMarkGroupNotApplicable(playwright, 'member', decision)).toBe(false)
    expect(mayMarkGroupNotApplicable(playwright, 'model', decision)).toBe(false)
    expect(mayMarkGroupNotApplicable(playwright, 'owner', { ...decision, reason: '' })).toBe(false)
    expect(mayMarkGroupNotApplicable({ kind: 'build', required: true }, 'owner', decision)).toBe(false)
  })

  it('результаты разных SHA нельзя объединить', () => {
    expect(sameTestRunRevision({ commitSha: 'abc' }, { commitSha: 'abc' })).toBe(true)
    expect(sameTestRunRevision({ commitSha: 'abc' }, { commitSha: 'def' })).toBe(false)
  })
})
