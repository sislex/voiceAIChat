// Фикстуры CI-раннера: команды справочника, раны, шаги, лог, паузы, попытки
// авто-фикса, заключение и метрики. Плюс готовые сценарии ленты (`RunFeedCache`):
// очередь, выполняется, упал на шаге, успех, авто-фикс, ждёт ответа. Раньше,
// чтобы увидеть эти состояния, нужно было реально запустить агента на машине.

import type {
  CiCommand,
  CiFixAttempt,
  CiGlobalSettings,
  CiInteraction,
  CiLlmConfig,
  CiLogLine,
  CiCommandSuggestion,
  CiRun,
  CiRunConclusion,
  CiRunDetail,
  CiRunReport,
  CiRunReportStep,
  CiRunStep,
  CiTaskReport,
  CiUsageTotals,
  CiWorkspaceReportItem
} from '@shared/ci'
import { DEFAULT_CI_GLOBAL_SETTINGS, DEFAULT_CI_LLM_CONFIG, ciTaskTotals } from '@shared/ci'
import type { CiMetrics } from '../../remote/ciBridge'
import type { RunFeedCache } from '../../components/ci/RunFeed'

/** База времени ленты: `RunFeed` в сториз получает `now: () => NOW`. */
export const RUN_T0 = 1_000
export const NOW = 5_000

/** Ран (по умолчанию — выполняется, шаг «до модели» из трёх). */
export function makeRun(over: Partial<CiRun> = {}): CiRun {
  return {
    id: 'run-1',
    projectId: 'p1',
    taskId: 't1',
    agentId: null,
    status: 'running',
    workspaceId: null,
    triggeredBy: 'admin',
    prevColumnId: null,
    llmProvider: 'claude',
    llmModel: 'opus',
    mode: 'development',
    kbContextMode: 'auto',
    clarifyLevel: 'few',
    clarifyMax: 3,
    conversationId: null,
    slotProgress: { done: 1, total: 3, phase: 'до модели' },
    startedAt: RUN_T0,
    finishedAt: null,
    durationMs: null,
    createdAt: RUN_T0,
    ...over
  }
}

/** Шаг ленты (по умолчанию — выполняющаяся команда `npm ci`). */
export function makeStep(over: Partial<CiRunStep> = {}): CiRunStep {
  return {
    id: 's1',
    runId: 'run-1',
    slot: 'before_model',
    position: 1,
    kind: 'command',
    parentStepId: null,
    initiatedBy: 'system',
    commandId: 'cmd-1',
    commandSnapshot: 'npm ci',
    title: 'npm ci',
    workdir: null,
    status: 'running',
    exitCode: null,
    attempt: 1,
    fixedByModel: false,
    startedAt: RUN_T0,
    finishedAt: null,
    durationMs: null,
    ...over
  }
}

/** Успешно завершённый шаг — те же поля, но с кодом выхода и длительностью. */
export function makeDoneStep(over: Partial<CiRunStep> = {}): CiRunStep {
  return makeStep({ status: 'success', exitCode: 0, finishedAt: RUN_T0 + 3_000, durationMs: 3_000, ...over })
}

/** Строка потокового лога. */
export function makeLogLine(over: Partial<CiLogLine> = {}): CiLogLine {
  return { runId: 'run-1', stepId: 's1', seq: 1, stream: 'stdout', chunk: 'installing deps…', at: RUN_T0, ...over }
}

/** Простыня лога: N строк одного шага (проверка виртуального «хвоста» и скролла). */
export function makeLogSheet(count: number, stepId = 's1'): CiLogLine[] {
  return Array.from({ length: count }, (_, i) =>
    makeLogLine({
      stepId,
      seq: i + 1,
      at: RUN_T0 + i * 10,
      stream: i % 17 === 16 ? 'stderr' : 'stdout',
      chunk:
        i % 17 === 16
          ? `npm warn deprecated пакет-${i} больше не поддерживается`
          : `added ${i + 1}/2413 packages · node_modules/@voicechat/пакет-${i}`
    })
  )
}

/**
 * Лог с ANSI-раскраской, как его печатают npm/vitest. Экранированные
 * последовательности мы НЕ разбираем: и `CiConsole`, и лента шага показывают их
 * как есть — сториз это честно демонстрирует (и служит заявкой на доработку).
 */
export function makeAnsiLog(stepId = 's-test'): CiLogLine[] {
  const E = '\u001b'
  return [
    `${E}[1m${E}[32m✓${E}[0m src/components/ChatColumn.dom.test.tsx (24 tests) 812ms`,
    `${E}[1m${E}[32m✓${E}[0m src/components/ci/RunFeed.dom.test.tsx (11 tests) 340ms`,
    `${E}[31m✗${E}[0m src/components/VoiceBar.dom.test.tsx > микрофон недоступен`,
    `  ${E}[31mAssertionError${E}[0m: expected null not to be null`,
    `${E}[33mTest Files${E}[0m  1 failed | 60 passed (61)`
  ].map((chunk, i) => makeLogLine({ stepId, seq: i + 1, at: RUN_T0 + i * 100, stream: i === 2 || i === 3 ? 'stderr' : 'stdout', chunk }))
}

/** Пауза рана: уточняющие вопросы модели (по умолчанию — ждёт ответа). */
export function makeInteraction(over: Partial<CiInteraction> = {}): CiInteraction {
  return {
    id: 'it-1',
    runId: 'run-1',
    stepId: 'model-1',
    seq: 1,
    kind: 'clarify',
    questions: [{ q: 'Какую БД взять?', options: ['SQLite', 'Postgres'] }],
    planText: null,
    answerText: null,
    decision: null,
    status: 'pending',
    conversationId: 'c1',
    messageId: 'm1',
    createdAt: RUN_T0,
    answeredAt: null,
    answeredBy: null,
    ...over
  }
}

/** Пауза-гейт плана: текст плана и решение «одобрить / на доработку». */
export function makePlanGate(over: Partial<CiInteraction> = {}): CiInteraction {
  return makeInteraction({
    id: 'it-plan',
    kind: 'plan_approval',
    questions: [],
    planText: [
      '1. Собрать общие фикстуры в `src/test/fixtures/`.',
      '2. Написать сториз чата и CI-панели поверх них.',
      '3. Добавить play-функции на ключевые состояния.',
      '4. Включить build-storybook в сборку.'
    ].join('\n'),
    ...over
  })
}

/** Одна итерация авто-фикса упавшего шага. */
export function makeFixAttempt(over: Partial<CiFixAttempt> = {}): CiFixAttempt {
  return {
    id: 'fix-1',
    runStepId: 's-test',
    attemptNo: 1,
    diagnosis: 'Кэш npm повреждён: шаг падает с кодом 254.',
    action: 'npm cache clean --force и повторный npm ci',
    result: 'fixed',
    diff: null,
    durationMs: 47_000,
    tokensUsed: 18_400,
    createdAt: RUN_T0 + 20_000,
    ...over
  }
}

/** Заключение модели при исходе «нужен человек». */
export function makeConclusion(over: Partial<CiRunConclusion> = {}): CiRunConclusion {
  return { failureClass: 'no_access', summary: 'Нужен доступ к приватному npm-реестру', ...over }
}

/** Команда справочника. */
export function makeCommand(over: Partial<CiCommand> = {}): CiCommand {
  return {
    id: 'cmd-1',
    scope: 'global',
    projectId: null,
    name: 'install',
    script: 'npm ci',
    description: 'Установка зависимостей строго по package-lock.json',
    workdir: '',
    timeoutSec: null,
    env: {},
    allowFailure: false,
    isCleanup: false,
    availableToModel: false,
    isTest: false,
    version: 1,
    createdBy: 'admin',
    createdAt: RUN_T0,
    updatedAt: RUN_T0,
    deletedAt: null,
    ...over
  }
}

/** Справочник на все виды команд: глобальная, проектная, cleanup, доступная модели. */
export function makeCommands(): CiCommand[] {
  return [
    makeCommand(),
    makeCommand({ id: 'cmd-2', name: 'typecheck', script: 'npm run typecheck', description: 'tsc по всем воркспейсам' }),
    makeCommand({
      id: 'cmd-3',
      name: 'test',
      script: 'npm test',
      description: 'vitest run во всех пакетах',
      timeoutSec: 900,
      availableToModel: true,
      isTest: true
    }),
    makeCommand({
      id: 'cmd-4',
      scope: 'project',
      projectId: 'p1',
      name: 'storybook',
      script: 'npm run -w @voicechat/ui build-storybook',
      description: 'Смоук-сборка витрины: ловит сломанную сториз',
      env: { CI: '1' }
    }),
    makeCommand({
      id: 'cmd-5',
      name: 'release-workspace',
      script: 'rm -rf "$VC_WORKDIR"',
      description: 'Освобождает рабочую копию репозитория',
      isCleanup: true,
      createdBy: 'bob'
    })
  ]
}

/** Предложение модели поправить команду. */
export function makeSuggestion(over: Partial<CiCommandSuggestion> = {}): CiCommandSuggestion {
  return {
    id: 'sug-1',
    commandId: 'cmd-1',
    runStepId: 's1',
    reason: 'Шаг трижды падал с кодом 254: общий кэш npm ломается при параллельных ранах.',
    proposedScript: 'npm cache clean --force\nnpm ci',
    status: 'new',
    occurrences: 3,
    createdAt: RUN_T0,
    resolvedBy: null,
    resolvedAt: null,
    ...over
  }
}

/** Занятая раном рабочая копия репозитория. */
export function makeWorkspace(over: Partial<CiWorkspaceReportItem> = {}): CiWorkspaceReportItem {
  return {
    id: 'ws-1',
    projectId: 'p1',
    taskId: 't1',
    agentId: 'm1',
    path: '/root/VoiceAIChatRepos/chatai/24',
    state: 'active',
    sizeBytes: 812 * 1024 * 1024,
    createdAt: RUN_T0,
    releasedByStepId: null,
    taskTitle: 'Storybook: покрыть сториз виджеты чата и CI-панели',
    orphaned: false,
    ...over
  }
}

export function makeGlobalSettings(over: Partial<CiGlobalSettings> = {}): CiGlobalSettings {
  return { ...DEFAULT_CI_GLOBAL_SETTINGS, ...over }
}

export function makeLlmConfig(over: Partial<CiLlmConfig> = {}): CiLlmConfig {
  return { ...DEFAULT_CI_LLM_CONFIG, ...over }
}

/** Медианы по командам — лента показывает «типично» и долю текущего шага. */
export function makeMetrics(): CiMetrics {
  return {
    commands: [
      { projectId: 'p1', commandId: 'cmd-1', medianMs: 42_000, avgMs: 45_000, p90Ms: 61_000, samples: 18, successRate: 0.94 },
      { projectId: 'p1', commandId: 'cmd-2', medianMs: 18_000, avgMs: 19_000, p90Ms: 24_000, samples: 18, successRate: 1 },
      { projectId: 'p1', commandId: 'cmd-3', medianMs: 190_000, avgMs: 210_000, p90Ms: 260_000, samples: 16, successRate: 0.75 }
    ],
    modelWork: { projectId: 'p1', avgMs: 640_000, samples: 12 }
  }
}

export function makeRunDetail(
  run: CiRun,
  steps: CiRunStep[],
  extra: { fixAttempts?: CiFixAttempt[]; interactions?: CiInteraction[] } = {}
): CiRunDetail {
  return { run, steps, fixAttempts: extra.fixAttempts ?? [], interactions: extra.interactions ?? [] }
}

// --- Готовые сценарии ленты рана ------------------------------------------

/** Ран только что поставлен в очередь: шагов ещё нет. */
export function queuedRunCache(): RunFeedCache {
  return {
    detail: makeRunDetail(makeRun({ status: 'queued', slotProgress: { done: 0, total: 3, phase: 'в очереди' }, startedAt: null }), []),
    log: [],
    conclusion: null
  }
}

/** Выполняется: первый шаг успешен, второй идёт с логом, третий ждёт очереди. */
export function runningRunCache(): RunFeedCache {
  return {
    detail: makeRunDetail(makeRun(), [
      makeDoneStep(),
      makeStep({ id: 's2', position: 2, commandId: 'cmd-2', title: 'npm run typecheck' }),
      makeStep({
        id: 's3',
        position: 3,
        commandId: 'cmd-3',
        title: 'npm test',
        status: 'queued',
        startedAt: null
      })
    ]),
    log: [
      makeLogLine({ chunk: 'added 2413 packages in 42s\n' }),
      makeLogLine({ stepId: 's2', seq: 2, chunk: 'tsc --noEmit -p tsconfig.json\n' })
    ],
    conclusion: null
  }
}

/**
 * Упал на шаге: `npm test` вернул код 1, работа модели тоже свалилась — под ней
 * появляется выбор движка и «Повторить работу модели», финальные команды не шли.
 */
export function failedRunCache(): RunFeedCache {
  return {
    detail: makeRunDetail(
      makeRun({ status: 'failed', slotProgress: { done: 2, total: 5, phase: 'работа модели' }, finishedAt: RUN_T0 + 300_000, durationMs: 300_000 }),
      [
        makeDoneStep(),
        makeDoneStep({ id: 's2', position: 2, commandId: 'cmd-2', title: 'npm run typecheck' }),
        makeStep({
          id: 's-test',
          position: 3,
          commandId: 'cmd-3',
          title: 'npm test',
          status: 'failed',
          exitCode: 1,
          finishedAt: RUN_T0 + 192_000,
          durationMs: 192_000
        }),
        makeStep({
          id: 'model-1',
          position: 4,
          slot: null,
          kind: 'model_work',
          commandId: null,
          commandSnapshot: null,
          title: 'Работа модели',
          status: 'failed',
          exitCode: null,
          finishedAt: RUN_T0 + 300_000,
          durationMs: 108_000
        })
      ]
    ),
    log: makeAnsiLog('s-test'),
    conclusion: makeConclusion({ failureClass: 'script_error', summary: 'Тест ленты чата ждал старую фикстуру — нужно решение человека' })
  }
}

/** Успешный ран: все шаги зелёные, вложенный вызов команды моделью, итог модели. */
export function successRunCache(): RunFeedCache {
  return {
    detail: makeRunDetail(
      makeRun({
        status: 'success',
        slotProgress: { done: 5, total: 5, phase: 'готово' },
        finishedAt: RUN_T0 + 720_000,
        durationMs: 720_000
      }),
      [
        makeDoneStep(),
        makeDoneStep({ id: 's2', position: 2, commandId: 'cmd-2', title: 'npm run typecheck' }),
        makeDoneStep({
          id: 'model-1',
          position: 3,
          slot: null,
          kind: 'model_work',
          commandId: null,
          commandSnapshot: null,
          title: 'Работа модели',
          durationMs: 640_000,
          finishedAt: RUN_T0 + 660_000
        }),
        makeDoneStep({
          id: 'model-cmd-1',
          position: 4,
          slot: null,
          kind: 'model_command',
          parentStepId: 'model-1',
          initiatedBy: 'model',
          commandId: 'cmd-3',
          commandSnapshot: 'npm test',
          title: 'модель: npm test',
          durationMs: 190_000
        }),
        makeDoneStep({
          id: 's-sum',
          position: 5,
          slot: 'after_model',
          kind: 'model_summary',
          commandId: null,
          commandSnapshot: null,
          title: 'Итог модели',
          durationMs: 1_200
        })
      ]
    ),
    log: [makeLogLine({ stepId: 'model-cmd-1', chunk: 'Test Files  61 passed (61)\n' })],
    conclusion: null
  }
}

/**
 * Ран с попыткой авто-фикса: шаг упал, модель разобралась и довела его до успеха —
 * в ленте у шага остаётся лозенг «исправлено моделью» и вторая попытка.
 */
export function autoFixRunCache(): RunFeedCache {
  return {
    detail: makeRunDetail(
      makeRun({ slotProgress: { done: 1, total: 5, phase: 'исправление шага', fixing: true } }),
      [
        makeDoneStep({ id: 's-fix', title: 'npm ci', status: 'success', attempt: 2, fixedByModel: true, durationMs: 51_000 }),
        makeStep({ id: 's2', position: 2, commandId: 'cmd-2', title: 'npm run typecheck' })
      ],
      {
        fixAttempts: [
          makeFixAttempt({ runStepId: 's-fix', result: 'retrying', diagnosis: 'npm ci упал с кодом 254' }),
          makeFixAttempt({ id: 'fix-2', runStepId: 's-fix', attemptNo: 2 })
        ]
      }
    ),
    log: [
      makeLogLine({ stepId: 's-fix', chunk: 'npm error code EINTEGRITY\n', stream: 'stderr' }),
      makeLogLine({ stepId: 's-fix', seq: 2, chunk: 'npm cache clean --force\n', stream: 'system' }),
      makeLogLine({ stepId: 's-fix', seq: 3, chunk: 'added 2413 packages in 51s\n' })
    ],
    conclusion: null
  }
}

/** Ран стоит и ждёт человека: уточняющий вопрос модели внутри «Работы модели». */
export function awaitingInputRunCache(): RunFeedCache {
  return {
    detail: makeRunDetail(
      makeRun({ status: 'awaiting_input', slotProgress: { done: 2, total: 5, phase: 'ждёт ответа' } }),
      [
        makeDoneStep(),
        makeStep({
          id: 'model-1',
          position: 2,
          slot: null,
          kind: 'model_work',
          commandId: null,
          commandSnapshot: null,
          title: 'Работа модели'
        })
      ],
      { interactions: [makeInteraction()] }
    ),
    log: [],
    conclusion: null
  }
}

/** Ран в режиме плана: гейт «План готов — нужно решение». */
export function planGateRunCache(): RunFeedCache {
  return {
    detail: makeRunDetail(
      makeRun({ status: 'awaiting_input', mode: 'plan', slotProgress: { done: 2, total: 4, phase: 'план готов' } }),
      [
        makeDoneStep(),
        makeStep({
          id: 'model-1',
          position: 2,
          slot: null,
          kind: 'model_work',
          commandId: null,
          commandSnapshot: null,
          title: 'Работа модели'
        })
      ],
      { interactions: [makePlanGate()] }
    ),
    log: [],
    conclusion: null
  }
}

// --- Отчёт по расходу модели ---------------------------------------------

/** Итоги расхода: по умолчанию — точная стоимость от CLI. */
export function makeUsageTotals(over: Partial<CiUsageTotals> = {}): CiUsageTotals {
  return {
    requests: 4,
    inputTokens: 12_000,
    outputTokens: 3400,
    cacheReadTokens: 180_000,
    cacheCreationTokens: 24_000,
    tokens: 219_400,
    costUsd: 1.84,
    costEstimated: false,
    costUnderstated: false,
    inputNormalized: false,
    modelActiveMs: 640_000,
    // Запросов к API за ходами в разы больше, чем самих ходов: каждый вызов
    // инструмента — новый запрос со всем накопленным контекстом.
    apiRequests: 24,
    maxContextPerRequest: 12_000,
    ...over
  }
}

/** Шаг отчёта: та же строка, что в ленте, плюс расход ходов модели. */
export function makeReportStep(over: Partial<CiRunReportStep> = {}): CiRunReportStep {
  return {
    id: 's1',
    parentStepId: null,
    title: 'npm ci',
    slot: 'before_model',
    kind: 'command',
    initiatedBy: 'system',
    status: 'success',
    attempt: 1,
    fixedByModel: false,
    exitCode: 0,
    durationMs: 42_000,
    usage: null,
    ...over
  }
}

/** Отчёт по успешному рану: команды слотов, работа модели и резюме. */
export function makeRunReport(over: Partial<CiRunReport> = {}): CiRunReport {
  return {
    runId: 'run-1',
    projectId: 'p1',
    taskId: 't1',
    status: 'success',
    mode: 'development',
    provider: 'claude',
    model: 'opus',
    startedAt: RUN_T0,
    finishedAt: RUN_T0 + 720_000,
    durationMs: 720_000,
    createdAt: RUN_T0,
    fixAttempts: 1,
    kbHit: null,
    toolCalls: { bash: 12, read: 31, grep: 9, edit: 14, kb: 3, other: 1, denied: 2 },
    toolChars: { bash: 148_000, read: 96_000, grep: 12_400, edit: 1800, kb: 32_000, other: 0, denied: 0 },
    toolResponses: [
      { tool: 'mcp__remote__bash', kind: 'bash', label: 'remote:bash: npm ci', chars: 20_000, originalChars: 243_100, stepId: 'model-1', at: RUN_T0 + 120_000 },
      { tool: 'mcp__remote__read', kind: 'read', label: 'remote:read: apps/server/src/db/database.ts', chars: 18_400, originalChars: null, stepId: 'model-1', at: RUN_T0 + 200_000 },
      { tool: 'mcp__kb__document', kind: 'kb', label: 'kb:document: ci-runner', chars: 8000, originalChars: null, stepId: 'model-1', at: RUN_T0 + 60_000 }
    ],
    totals: makeUsageTotals(),
    // Разные модели по стадиям — ровно та картина, ради которой разбивка и есть:
    // разработка на модели рана, вспомогательные стадии дешевле.
    stages: [
      { kind: 'model_work', model: 'opus', totals: makeUsageTotals({ requests: 2, tokens: 160_000, costUsd: 1.4, modelActiveMs: 520_000 }) },
      { kind: 'summary', model: 'haiku', totals: makeUsageTotals({ requests: 1, tokens: 17_400, costUsd: 0.02, modelActiveMs: 19_000 }) },
      { kind: 'fix', model: 'opus', totals: makeUsageTotals({ requests: 1, tokens: 42_000, costUsd: 0.31, modelActiveMs: 61_000 }) },
      { kind: 'kb_update', model: 'sonnet', totals: makeUsageTotals({ requests: 1, tokens: 74_000, costUsd: 0.11, modelActiveMs: 40_000 }) }
    ],
    steps: [
      makeReportStep(),
      makeReportStep({ id: 's2', title: 'npm run typecheck', durationMs: 96_000, status: 'failed', exitCode: 1, attempt: 2, fixedByModel: true, usage: makeUsageTotals({ requests: 1, tokens: 42_000, costUsd: 0.31, modelActiveMs: 61_000 }) }),
      makeReportStep({
        id: 'model-1', title: 'Работа модели', slot: null, kind: 'model_work', durationMs: 540_000,
        usage: makeUsageTotals({ requests: 2, tokens: 160_000, costUsd: 1.4, modelActiveMs: 520_000 })
      }),
      makeReportStep({ id: 'model-cmd-1', parentStepId: 'model-1', title: 'Установить зависимости', kind: 'model_command', initiatedBy: 'model', durationMs: 18_000 }),
      makeReportStep({
        id: 'sum-1', title: 'Резюме модели', slot: null, kind: 'model_summary', durationMs: 24_000,
        usage: makeUsageTotals({ requests: 1, tokens: 17_400, costUsd: 0.13, modelActiveMs: 59_000 })
      })
    ],
    ...over
  }
}

/** Отчёт по задаче: один ран или несколько (повтор после падения). */
export function makeTaskReport(runs: CiRunReport[] = [makeRunReport()]): CiTaskReport {
  return { projectId: 'p1', taskId: 't1', runs, ...ciTaskTotals(runs) }
}
