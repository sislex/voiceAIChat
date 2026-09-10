import { registerApplicationReleaseRoutes } from '../routes/applicationReleases.js'
import { ApplicationReleaseManager, createApplicationReleaseRuntime } from '../releases/applicationReleaseManager.js'
// Сборка канбан-кластера: хуки модели, подготовка задач, менеджер ранов CI, QA-стадии, релизы,
// мерж-раны, автопилот, запуск ранов из MCP и оркестрация планов. Раньше всё это лежало прямо в
// `buildServer` (~1 000 строк) и замыкалось на его локальные переменные; теперь зависимости от ядра
// перечислены явно в `KanbanDeps` — это первый шаг к отдельному сервису канбана
// (docs/plans/kanban-service.md). Код внутри перенесён как есть.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { type FastifyInstance } from 'fastify'
import { taskReworkContext } from '@voicechat/shared'
import { isModelAllowedForUser, isProviderAllowed, canConfirmDevelopmentReadiness, developmentReadinessGateResults, preparationExportFilename, redactPreparationText, type DevelopmentReadiness, type LlmProvider } from '@voicechat/shared'
import type { ServerConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { registerProjectRoutes } from '../routes/projects.js'
import { registerProjectTypeRoutes } from '../routes/projectTypes.js'
import { registerInvitationRoutes } from '../routes/invitations.js'
import { registerQaRoutes } from '../routes/qa.js'
import { registerCiRoutes } from '../routes/ci.js'
import { registerFeaturePreviewRoutes } from '../routes/featurePreview.js'
import { registerReleaseRoutes } from '../routes/releases.js'
import { knowledgeBaseTimeoutMs, ReleaseManager, releaseKnowledgeBaseCommand } from '../releases/releaseManager.js'
import { releaseCiTarget, releaseProductionTarget } from '../releases/targets.js'
import { ManagedEnvironmentResolver } from '../releases/managedEnvironmentResolver.js'
import { FeaturePreviewManager } from '../preview/manager.js'
import { createCiRunManager, type CiRunManager } from '../ci/runManager.js'
import { createAutomatedQaRunner, createComponentQaRunner } from '../ci/componentQa.js'
import { automatedQaRemarks } from '@voicechat/shared'
import { isDirtyWorkspaceFailure, retryAllowedNow, shouldResumeAfterInfraFailure } from '../ci/autopilotResume.js'
import { createIntegrationTestRunner } from '../ci/integrationTests.js'
import { createAutomatedQaCheck } from '../ci/automatedQaCheck.js'
import { MergeRunManager } from '../merge/runManager.js'
import { createCiModelHooks } from '../ci/modelHooks.js'
import type { CommandExecutor, CiKbUpdateHook } from '../ci/types.js'
import { BoardHub, NotificationHub } from '../projects/boardHub.js'
import { uid } from '../users/auth.js'
import { type Mailer } from '../users/mailer.js'
import { preparationDesignNote } from '../ci/preparationNotes.js'
import { registerKanbanMcp, type KanbanRunLaunchers } from '../mcp/kanbanMcp.js'
import { registerCiCommandsMcp } from '../ci/ciCommandsMcp.js'
import { AgentCommandExecutor } from '../ci/executor.js'
import type { KanbanCore } from './core.js'
import type { KanbanService } from './service.js'
import { createOrchestrationManager } from '../orchestration/runManager.js'
import type { MakeService } from '@voicechat/make-contracts'
import { RemoteLlmClient } from '../llm/remoteClient.js'
import type { LlmClient } from '../claude/types.js'
import { type KbUsageTracker } from '../kb/usage.js'
import { kbToolBroker } from '../kb/kbMcp.js'
import { createPreviewTurnTokens } from '@voicechat/web-reader-contracts'
import { type BrowserRunnerClient } from '../browser/runnerClient.js'
import { taskPreparationModel, taskPreparationFailure, parseQaPreparationResponse } from './preparation.js'

/** Бюджет разовой проверки набора: человек ждёт ответ, а не уходит пить чай. */
const CHECK_BUDGET_MS = 90_000
/** Как часто автопроход сам осматривает проекты (приход машины в онлайн board-события не даёт). */
const AUTOPILOT_SWEEP_MS = 60_000
/** Сколько раз автопроход возобновляет один ран после сбоя машины. */
const AUTOPILOT_INFRA_RESUMES = 3

export type { EnsureProjectMainCurrent } from './core.js'
import { createAutomatedQaScenarioRunner } from '../ci/automatedQaScenario.js'

export type AutomatedQaScenarioRunner = ReturnType<typeof createAutomatedQaScenarioRunner>

/**
 * Всё, что канбан берёт у ядра. Состояние процесса ядра — портом `core` (`KanbanCore`); остальное —
 * клиенты и настройки, которые отдельный процесс канбана поднимет сам из своего env. Список не должен
 * расти незаметно: снимок ключей — в `boundary.test.ts`.
 */
export interface KanbanDeps {
  app: FastifyInstance
  db: VoiceChatDb
  config: ServerConfig
  core: KanbanCore
  claude: LlmClient
  codex: LlmClient
  kbUsage: KbUsageTracker
  make: { service: MakeService }
  /** Секрет MCP-эндпоинтов кластера (`/mcp/kanban`, `/mcp/ci-commands`). */
  mcpSecret: string
  /** Тестовый исполнитель команд вместо потокового exec машины. */
  ciExecutor?: CommandExecutor
  browserRunner: BrowserRunnerClient | undefined
  mailer: Mailer
  automatedQaScenarioRunner: AutomatedQaScenarioRunner | undefined
  automatedQaScreenshotDir: string
  remoteBashMcpBaseUrl: string
  kbMcpBaseUrl: string
  previewMcpBaseUrl: string
  ciCommandsMcpBaseUrl: string
  ciKbUpdate: CiKbUpdateHook | undefined
}

export type KanbanModule = Awaited<ReturnType<typeof createKanbanModuleImpl>>

export async function createKanbanModule(deps: KanbanDeps): Promise<KanbanModule> {
  return await createKanbanModuleImpl(deps)
}

async function createKanbanModuleImpl(deps: KanbanDeps) {
  const { app, db, config, core, claude, codex, kbUsage, make, browserRunner, mailer, mcpSecret, automatedQaScenarioRunner, automatedQaScreenshotDir, remoteBashMcpBaseUrl, kbMcpBaseUrl, previewMcpBaseUrl, ciCommandsMcpBaseUrl, ciKbUpdate } = deps
  const { machines, kb, uploads, widgets, ensureProjectMainCurrent } = core
  // Хабы доски и уведомлений принадлежат кластеру: ядро и соседи узнают о событиях через `KanbanService`.
  const boardHub = new BoardHub()
  const notificationHub = new NotificationHub()
  const ciExecutor = deps.ciExecutor ?? new AgentCommandExecutor(machines)
  const preparationRunUpdated = (userId: string, projectId: string, taskId: string, runId: string, boardChanged = true): void => {
    preparationDeltaThrottle.delete(runId) // переход рана — сбрасываем окно троттла дельт, чтобы событие ушло сразу
    boardHub.emitPreparationRun({ userId, projectId, taskId, runId })
    if (boardChanged) boardHub.emit(projectId)
  }
  // Дельты стрим-лога сыплются часто; WS-уведомление о ране коалесим до ~1/с на ран
  // (сам лог пишется в БД на каждый чанк, клиент догрузит текущее состояние рана).
  const preparationDeltaThrottle = new Map<string, number>()
  const PREPARATION_DELTA_WINDOW_MS = 1000
  const preparationRunDelta = (userId: string, projectId: string, taskId: string, runId: string): void => {
    const now = Date.now()
    const last = preparationDeltaThrottle.get(runId) ?? 0
    if (now - last < PREPARATION_DELTA_WINDOW_MS) return
    preparationDeltaThrottle.set(runId, now)
    boardHub.emitPreparationRun({ userId, projectId, taskId, runId }) // дельты карточку не меняют — board не трогаем
  }
  const ciModelHooks = createCiModelHooks({
    db,
    claude: await claude,
    codex: await codex,
    engineClient: (engine) => new RemoteLlmClient({ kind: engine.kind, baseUrl: engine.baseUrl, ...(engine.token ? { token: engine.token } : {}) }),
    mcpBaseUrl: remoteBashMcpBaseUrl,
    ciMcpBaseUrl: ciCommandsMcpBaseUrl,
    agentNameOf: (agentId) => machines.nameOf(agentId),
    // Шагу «Актуализировать базу знаний» нужен диф рабочей копии: его собирает
    // сервер тем же исполнителем, что и команды слотов.
    executor: ciExecutor,
    // База знаний в ходах рана: авто-контекст по теме задачи и mcp__kb__*.
    // Режим берётся из настройки проекта и фиксируется в ране.
    kb,
    kbUsage,
    kbToolEnabled: config.kbToolEnabled,
    kbTool: kbToolBroker,
    kbMcpBaseUrl,
    // Браузерная проверка результата: инструменты появляются у хода только при
    // выбранном режиме проверки задачи (см. `withBrowserTools`). Токен подписан
    // секретом MCP — его проверит эндпоинт превью в любом процессе.
    previewMcpBaseUrl,
    previewTurns: createPreviewTurnTokens(mcpSecret),
    make: make.service
  })
  // Вопросы модели дублируются в связанный чат задачи обычными сообщениями:
  // UI разбирает блок ```questions тем же парсером, что и вопросы в чате.
  const ciChatTime = (): string => {
    const d = new Date()
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const launchQaPreparation = async (args: { userId: string; projectId: string; taskId: string; branch: string; commitSha: string; runId?: string }, retry = false): Promise<boolean> => {
    const { userId, projectId, taskId, branch, commitSha } = args
    const preparation = await db.qa.startQaPreparationRun(projectId, taskId, branch, commitSha, retry)
    if (!preparation) return false
    const task = await db.tasks.getCiTask(userId, projectId, taskId)
    const existing = (await db.qa.getQaTaskState(userId, projectId, taskId))?.criteria.filter((criterion) => criterion.active) ?? []
    const development = args.runId ? await db.ci.getCiRun(userId, args.runId) : null
    const basePrompt = `Ты формируешь финальные структурированные сценарии ручного QA. Не запускай агентов или инструменты, не делегируй работу, не переходи в режим ожидания и не описывай свои действия. Ответь за один ход ТОЛЬКО JSON-массивом без Markdown и пояснений. Каждый объект обязан содержать строковые поля title, description, preconditions, steps, testData, expectedResult, boolean required и testType: manual|mixed|not_testable_in_app. title, steps и expectedResult должны быть непустыми.\n\nЗадача: ${task?.title ?? ''}\nОписание: ${task?.description ?? ''}\nAcceptance criteria: ${task?.acceptanceCriteria ?? ''}\nFeature branch: ${branch}\nCommit SHA: ${commitSha}\nАвтотесты: ${(development?.steps ?? []).map((step) => `${step.title}: ${step.status}`).join('; ')}\nУже активные сценарии (не дублировать): ${existing.map((criterion) => criterion.title).join('; ')}`
    const sendAttempt = async (attempt: number, correction?: string): Promise<void> => {
      const prompt = correction ? `${basePrompt}\n\nПредыдущий ответ отклонён: ${correction}. Исправь ошибку и верни только валидный JSON-массив установленной схемы.` : basePrompt
      await claude.send({ userId, prompt, sessionId: null, model: 'sonnet', executionDisabled: true }, {
        onDelta: async (chunk) => await db.qa.appendQaPreparationLog(preparation.id, chunk),
        onSession: async () => {},
        onDone: async (text) => {
          try {
            const scenarios = parseQaPreparationResponse(text)
            await db.qa.recordQaPreparationAttempt(preparation.id, attempt, text, null)
            const existingTitles = new Set(existing.map((criterion) => criterion.title.trim().toLocaleLowerCase()))
            for (const scenario of scenarios) {
              if (existingTitles.has(scenario.title.toLocaleLowerCase())) continue
              await db.qa.createAcceptanceCriterion(userId, projectId, taskId, scenario)
              existingTitles.add(scenario.title.toLocaleLowerCase())
            }
            await db.qa.completeQaPreparation(userId, projectId, taskId)
            const qaState = await db.qa.getQaTaskState(userId, projectId, taskId)
            if (!qaState?.activeSession) await db.qa.startQaSession(userId, { projectId, taskId, branch, commitSha, testRunId: args.runId ?? preparation.id }, true)
            await db.qa.finishQaPreparationRun(preparation.id, 'success')
            boardHub.emit(projectId)
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause)
            await db.qa.recordQaPreparationAttempt(preparation.id, attempt, text, message)
            if (attempt < 2) await sendAttempt(attempt + 1, message)
            else { await db.qa.finishQaPreparationRun(preparation.id, 'failed', message); boardHub.emit(projectId) }
          }
        },
        onError: async (message) => {
          await db.qa.recordQaPreparationAttempt(preparation.id, attempt, '', message)
          if (attempt < 2) await sendAttempt(attempt + 1, message)
          else { await db.qa.finishQaPreparationRun(preparation.id, 'failed', message); boardHub.emit(projectId) }
        }
      })
    }
    await sendAttempt(1)
    boardHub.emit(projectId)
    return true
  }

  const parseTaskPreparation = (text: string): DevelopmentReadiness => {
    const raw = text.trim()
    if (!raw.startsWith('{') || !raw.endsWith('}')) throw new Error('Модель должна вернуть ровно один JSON-объект без окружающего текста')
    const value = JSON.parse(raw) as unknown
    const issues: string[] = []
    const record = (input: unknown): Record<string, unknown> | null =>
      input !== null && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null
    const requireString = (input: Record<string, unknown>, key: string, path = key): void => {
      if (typeof input[key] !== 'string') issues.push(`${path} должен быть строкой`)
    }
    const requireBoolean = (input: Record<string, unknown>, key: string, path = key): void => {
      if (typeof input[key] !== 'boolean') issues.push(`${path} должен быть boolean`)
    }
    const requireArray = (input: Record<string, unknown>, key: string, path = key): unknown[] => {
      if (!Array.isArray(input[key])) {
        issues.push(`${path} должен быть массивом`)
        return []
      }
      return input[key]
    }
    const root = record(value)
    if (!root) throw new Error('Модель вернула неполную структуру готовности: корень должен быть JSON-объектом')
    // Совместимость ограничена однозначными представлениями: смысл и фактическая
    // доступность источника никогда не выводятся и не подменяются.
    const normalizeBoolean = (input: Record<string, unknown>, key: string): void => {
      if (input[key] === 'true') input[key] = true
      if (input[key] === 'false') input[key] = false
    }
    if (root.schemaVersion === '2') root.schemaVersion = 2
    normalizeBoolean(root, 'acceptanceCriteriaConflict')
    if (root.schemaVersion !== 2) issues.push('schemaVersion должен быть равен 2')
    requireString(root, 'functionalRequirements')
    requireString(root, 'acceptanceCriteria')
    requireBoolean(root, 'acceptanceCriteriaConflict')
    const uiImpact = root.uiImpact
    if (typeof uiImpact !== 'string' || !['none', 'existing_components', 'new_components', 'multi_component_flow'].includes(uiImpact)) {
      issues.push('uiImpact должен быть строкой none|existing_components|new_components|multi_component_flow')
    }
    const testCases = requireArray(root, 'testCases')
    const affectedComponents = requireArray(root, 'affectedComponents')
    for (const [index, item] of testCases.entries()) {
      const testCase = record(item)
      const path = `testCases[${index}]`
      if (!testCase) { issues.push(`${path} должен быть объектом`); continue }
      for (const key of ['id', 'title', 'description', 'preconditions', 'testData', 'steps', 'expectedResult', 'testType', 'notAutomatedReason', 'alternativeManualVerification', 'comments']) {
        requireString(testCase, key, `${path}.${key}`)
      }
      normalizeBoolean(testCase, 'required')
      normalizeBoolean(testCase, 'automatable')
      requireBoolean(testCase, 'required', `${path}.required`)
      requireBoolean(testCase, 'automatable', `${path}.automatable`)
      for (const [linkIndex, link] of requireArray(testCase, 'automationLinks', `${path}.automationLinks`).entries()) {
        if (typeof link !== 'string') issues.push(`${path}.automationLinks[${linkIndex}] должен быть строкой`)
      }
    }
    for (const [index, item] of affectedComponents.entries()) {
      const component = record(item)
      const path = `affectedComponents[${index}]`
      if (!component) { issues.push(`${path} должен быть объектом`); continue }
      // Однозначный список проверок сохраняем без потерь в каноническом объекте.
      if (Array.isArray(component.coverage) && component.coverage.length > 0 && component.coverage.every((entry) => typeof entry === 'string' && entry.trim())) {
        component.coverage = { required: [...component.coverage] }
      }
      for (const key of ['id', 'name', 'exclusionReason', 'alternativeVerification']) requireString(component, key, `${path}.${key}`)
      requireBoolean(component, 'reusable', `${path}.reusable`)
      if (component.storybookStoryId !== null && typeof component.storybookStoryId !== 'string') issues.push(`${path}.storybookStoryId должен быть строкой или null`)
      if (component.coverage !== null && !record(component.coverage)) issues.push(`${path}.coverage должен быть объектом или null`)
    }
    if (root.schemaVersion === 2) {
      requireString(root, 'goal')
      for (const key of ['scope', 'outOfScope', 'businessRules', 'errorsAndEdgeCases', 'uiStates', 'contractChanges', 'dataChanges', 'constraints', 'contradictions']) {
        const items = requireArray(root, key)
        root[key] = items.map((item) => {
          const objectItem = record(item)
          return objectItem && typeof objectItem.text === 'string' && objectItem.text.trim() ? objectItem.text : item
        })
        for (const [index, item] of (root[key] as unknown[]).entries()) {
          if (typeof item !== 'string' || !item.trim()) issues.push(`${key}[${index}] должен быть непустой строкой`)
        }
      }
      for (const key of ['acceptanceCriteriaItems', 'openQuestions', 'decisions', 'assumptions', 'sources']) requireArray(root, key)
      for (const [index, item] of (Array.isArray(root.acceptanceCriteriaItems) ? root.acceptanceCriteriaItems : []).entries()) {
        const criterion = record(item)
        const path = `acceptanceCriteriaItems[${index}]`
        if (!criterion) { issues.push(`${path} должен быть объектом`); continue }
        for (const key of ['id', 'title', 'precondition', 'action', 'observableResult']) requireString(criterion, key, `${path}.${key}`)
      }
      for (const [index, item] of (Array.isArray(root.openQuestions) ? root.openQuestions : []).entries()) {
        const question = record(item)
        const path = `openQuestions[${index}]`
        if (!question) { issues.push(`${path} должен быть объектом`); continue }
        requireString(question, 'questionId', `${path}.questionId`)
        requireString(question, 'text', `${path}.text`)
        requireBoolean(question, 'material', `${path}.material`)
        if (question.answer !== null && typeof question.answer !== 'string') issues.push(`${path}.answer должен быть строкой или null`)
      }
      for (const [index, item] of (Array.isArray(root.decisions) ? root.decisions : []).entries()) {
        const decision = record(item)
        const path = `decisions[${index}]`
        if (!decision) { issues.push(`${path} должен быть объектом`); continue }
        requireString(decision, 'id', `${path}.id`)
        requireString(decision, 'text', `${path}.text`)
        requireString(decision, 'rationale', `${path}.rationale`)
        if (decision.questionId !== undefined && typeof decision.questionId !== 'string') issues.push(`${path}.questionId должен быть строкой`)
      }
      for (const [index, item] of (Array.isArray(root.assumptions) ? root.assumptions : []).entries()) {
        const assumption = record(item)
        const path = `assumptions[${index}]`
        if (!assumption) { issues.push(`${path} должен быть объектом`); continue }
        requireString(assumption, 'id', `${path}.id`)
        requireString(assumption, 'text', `${path}.text`)
        requireString(assumption, 'rationale', `${path}.rationale`)
        requireBoolean(assumption, 'material', `${path}.material`)
      }
      for (const [index, item] of (Array.isArray(root.sources) ? root.sources : []).entries()) {
        const source = record(item)
        const path = `sources[${index}]`
        if (!source) { issues.push(`${path} должен быть объектом`); continue }
        const kindAliases: Record<string, string> = { knowledge_base: 'knowledge', 'knowledge-base': 'knowledge', 'knowledge-base-gap': 'knowledge', 'code-search': 'code' }
        if (typeof source.kind === 'string' && kindAliases[source.kind]) source.kind = kindAliases[source.kind]
        if (typeof source.refs === 'string') source.refs = [source.refs]
        normalizeBoolean(source, 'critical')
        if (typeof source.status === 'string') {
          const canonicalStatus = source.status.trim().toLowerCase()
          if (['available', 'absent', 'unavailable'].includes(canonicalStatus)) source.status = canonicalStatus
        }
        for (const key of ['id', 'kind', 'status', 'summary']) requireString(source, key, `${path}.${key}`)
        if (typeof source.kind === 'string' && !['knowledge', 'hierarchy', 'related_tasks', 'code', 'tests', 'storybook'].includes(source.kind)) issues.push(`${path}.kind имеет недопустимое значение: ${String(source.kind)}`)
        if (typeof source.status === 'string' && !['available', 'absent', 'unavailable'].includes(source.status)) issues.push(`${path}.status имеет недопустимое значение`)
        for (const [refIndex, ref] of requireArray(source, 'refs', `${path}.refs`).entries()) if (typeof ref !== 'string') issues.push(`${path}.refs[${refIndex}] должен быть строкой`)
        requireBoolean(source, 'critical', `${path}.critical`)
      }
    }
    if (issues.length) throw new Error(`Модель вернула неполную структуру готовности: ${issues.slice(0, 12).join('; ')}`)
    return root as unknown as DevelopmentReadiness
  }
  const taskPreparationHandles = new Map<string, { cancel(): void }>()
  // CLI-дети подготовки не должны переживать app.close(): cancel() ставит
  // finished и глушит поздние onDone/onError, которые иначе читают закрытую БД.
  app.addHook('onClose', async () => {
    for (const handle of taskPreparationHandles.values()) handle.cancel()
    taskPreparationHandles.clear()
  })
  const launchTaskPreparation = async (userId: string, projectId: string, taskId: string, selection?: import('@voicechat/shared').TaskPreparationLlmSelection): Promise<import('@voicechat/shared').TaskPreparationRun> => {
    let run = await db.tasks.activeTaskPreparationRun(userId, projectId, taskId)
    if (!run) {
      const project = await db.projects.getProject(userId, projectId)
      if (!project) throw new Error('Проект недоступен')
      const projectLlm = await db.ci.getCiLlmConfig('project', projectId) ?? await db.ci.ciLlmDefaultsForUser(userId)
      const explicitSelection = Boolean(selection?.machineId)
      const provider = explicitSelection ? selection!.provider : projectLlm.provider
      const model = taskPreparationModel(provider, explicitSelection ? selection!.model : projectLlm.model)
      const llmEngineId = explicitSelection ? selection!.llmEngineId ?? null : projectLlm.llmEngineId ?? null
      const access = await db.identity.getUserLlmAccess(userId)
      if (!isProviderAllowed(access, provider)) throw new Error(explicitSelection ? 'model_unavailable: выбранный провайдер недоступен' : `Проектный движок ${provider === 'codex' ? 'Codex' : 'Claude'} недоступен пользователю`)
      if (!isModelAllowedForUser(access, provider, model)) throw new Error(explicitSelection ? 'model_unavailable: выбранная модель недоступна' : `Проектная модель ${provider}:${model} недоступна пользователю`)
      const usable = await db.machines.listUsableAgents(userId, projectId)
      const machineId = selection?.machineId ?? await db.machines.getUserProjectDefaultMachine(userId, projectId) ?? project.defaultAgentId ?? project.machines.find((candidate) => candidate.canUse !== false && candidate.path.trim())?.agentId ?? ''
      const agent = usable.find((candidate) => candidate.id === machineId)
      const configured = project.machines.find((candidate) => candidate.agentId === machineId && candidate.canUse !== false && candidate.path.trim())
      if (explicitSelection && (!agent || !configured)) throw new Error('unknown_machine: выбранная машина недоступна проекту')
      if (explicitSelection && !machines.isOnline(machineId)) throw new Error('machine_offline: выбранная машина offline')
      run = await db.tasks.startTaskPreparationRun(userId, projectId, taskId, {
        machineId: configured?.agentId ?? null,
        machineName: configured?.name ?? agent?.name ?? null,
        llmEngineId,
        provider,
        model
      })
    }
    if (run.status === 'waiting_for_answer' || taskPreparationHandles.has(run.id)) return run
    if (run.status !== 'running' && run.status !== 'queued') return run
    if (run.status === 'running' && run.log) return run
    const task = await db.tasks.getCiTask(userId, projectId, taskId)
    const preparationMakeSources = task ? make.service.taskSources({ designs: task.designs ?? [], userId, projectId, taskId }) : []
    // Любое продолжение использует снимок попытки, а не текущие настройки проекта.
    const provider: LlmProvider = run.provider ?? 'claude'
    const model = taskPreparationModel(provider, run.model ?? '')
    const llmEngineId = run.llmEngineId ?? null
    const client = await (provider === 'codex' ? codex : claude)
    const project = await db.projects.getProject(userId, projectId)
    const configuredMachines = (project?.machines ?? []).filter((machine) => machine.canUse !== false && machine.path.trim())
    const selectedMachine = configuredMachines.find((machine) => machine.agentId === run.machineId) ?? null
    const projectMachines = await db.machines.listProjectMachines(projectId)
    const kbToken = randomUUID()
    const kbEnabled = config.kbToolEnabled
    if (kbEnabled) {
      kbToolBroker.register(kbToken, {
        userId,
        conversationId: null,
        projectId,
        turnId: run.id,
        coreReadOnly: true,
        runtimeContext: {
          projectName: project?.name,
          projectGitUrl: project?.gitUrl ?? null,
          llm: { provider, model, engineId: llmEngineId, source: 'project' }
        }
      })
    }
    let toolsClosed = false
    const closePreparationTools = (): void => {
      if (toolsClosed) return
      toolsClosed = true
      if (kbEnabled) kbToolBroker.unregister(kbToken)
    }
    const remote = selectedMachine ? {
      remote: {
        mcpUrl: `${remoteBashMcpBaseUrl}&agent=${encodeURIComponent(selectedMachine.agentId)}&cwd=${encodeURIComponent(selectedMachine.path)}&project=${encodeURIComponent(projectId)}`,
        agentName: selectedMachine.name ?? selectedMachine.agentId,
        projectMachines: projectMachines.filter((machine) => machine.agentId !== selectedMachine.agentId).map((machine) => machine.name)
      }
    } : { executionDisabled: true as const }
    const kbFields = kbEnabled
      ? { kbMcpUrl: `${kbMcpBaseUrl}&turn=${encodeURIComponent(kbToken)}`, kbMode: 'manual' as const }
      : {}
    const machineDiagnostic = selectedMachine
      ? `Машина проекта: «${selectedMachine.name ?? selectedMachine.agentId}»; рабочая директория: ${selectedMachine.path}; статус: ${machines.isOnline(selectedMachine.agentId) ? 'online' : 'offline (инструменты вернут точную диагностику недоступности)'}.`
      : 'Критичный источник недоступен: в конфигурации проекта нет доступной машины с рабочей директорией.'
    // Чем шла подготовка — первой строкой ленты: без этого причину падения CLI
    // приходится искать в коде подготовки.
    await db.tasks.setTaskPreparationExecution(run.id, { llmEngineId, provider, model })
    await db.tasks.appendTaskPreparationLog(run.id, `[система] Движок: ${provider === 'codex' ? 'Codex' : 'Claude'}, модель: ${model}, CLI-профиль: ${userId}\n[система] ${machineDiagnostic}\n`)
    const answeredContext = (run.questions ?? []).filter((question) => question.answer).map((question) => `Вопрос ${question.questionId}: ${question.text}\\nОтвет: ${question.answer}`).join('\\n')
    const researchDirective = `Начни с базы знаний проекта, затем сверяй её с кодом; инструменты подготовки работают только на чтение.

Перед формированием DevelopmentReadiness обязательно выполни контролируемое исследование:
1. Сначала найди тему через mcp__kb__search и прочитай подходящий существующий раздел через mcp__kb__document.
2. Затем через read-only remote-инструменты найди релевантные файлы внутри настроенной рабочей директории проекта и прочитай фактические API-контракты, общие типы, клиентские компоненты и тесты. Код — источник истины при расхождении с БЗ.
3. Не вызывай edit, deploy, package managers, сборки, тесты и любые команды, меняющие файлы, процессы, данные или окружение. Разрешены read/grep/machines и bash только для ls/find/git status/log/diff.
4. Бюджет исследования: не более 12 вызовов инструментов суммарно, не более 8 файлов, не более 24 000 символов полезных выдержек; один вызов — не дольше 120 секунд. Исследуй только рабочую директорию проекта и docs/kb.
5. В sources перечисли только фактически прочитанные источники, с точным refs и фактическим status available|absent|unavailable. Никогда не меняй absent/unavailable на available. critical=true ставь только если без источника нельзя определить требования самого brief; источник, нужный лишь для последующей визуальной реализации или приёмки, сохраняй unavailable и помечай critical=false, явно оставляя его проверку в scope/testCases. Конкретную причину недоступности запиши в summary. Подтверждённое расхождение БЗ и кода запиши как закрытое решение в decisions (contradictions оставь только для неразрешённых противоречий) и опирайся на код.
6. Не спрашивай доступ к машине или репозиторию: они определены конфигурацией ниже. Вопрос допустим только после исследования, если критичный источник реально недоступен, требования существенно противоречат друг другу либо нужно продуктовое решение.
7. Если БЗ неполна, не изменяй её сейчас: зафиксируй подтверждённый пробел в финальном блоке kb-gaps для последующего безопасного этапа актуализации.

${machineDiagnostic}
${preparationDesignNote(task?.designs ?? [], preparationMakeSources)}
${task ? taskReworkContext(task, await db.tasks.taskReworkCycles(userId, projectId, taskId) ?? [], await db.tasks.taskAttachments(userId, projectId, taskId, 'source') ?? []) : ''}`
    const basePrompt = `${researchDirective}

Подготовь подтверждаемый Development Brief в режиме только чтения. Не меняй код и данные. Ответ должен содержать ровно один JSON-объект: первый непробельный символ «{», последний — «}»; Markdown-ограда, вводный, заключительный и любой служебный текст запрещены. Если есть существенный вопрос, ответ на который меняет продукт, публичный контракт, данные, безопасность, обязательный scope или проверяемость, верни ТОЛЬКО JSON {"question":"текст","material":true}; не принимай такое решение самостоятельно. Иначе верни ТОЛЬКО JSON DevelopmentReadiness schemaVersion=2 со всеми полями: goal, scope, outOfScope, functionalRequirements, businessRules, errorsAndEdgeCases, uiImpact, uiStates, affectedComponents, contractChanges, dataChanges, acceptanceCriteria, acceptanceCriteriaItems (id,title,precondition,action,observableResult), testCases, constraints, contradictions, openQuestions, decisions, assumptions, sources, acceptanceCriteriaConflict. Типы обязательны: functionalRequirements и acceptanceCriteria — строки; uiImpact — строка none|existing_components|new_components|multi_component_flow; acceptanceCriteriaConflict — boolean; scope/outOfScope и остальные списки — массивы. Каждый testCase — объект со строками id, title, description, preconditions, testData, steps, expectedResult, testType, notAutomatedReason, alternativeManualVerification, comments, boolean required, automatable и массивом automationLinks. testType принимает только ui|api|integration|negative|regression|manual. Если uiImpact не равен none, среди testCases обязателен хотя бы один с required=true и testType=ui — по нему запускается этап Component QA, и без него задача встанет после разработки. Каждый affectedComponent — объект со строками id, name, exclusionReason, alternativeVerification, boolean reusable, storybookStoryId string|null и coverage object|null. acceptanceCriteriaItems содержат строковые id,title,precondition,action,observableResult. Строковые списки scope, outOfScope, businessRules, errorsAndEdgeCases, uiStates, contractChanges, dataChanges, constraints и contradictions содержат только непустые строки. Объектные списки: openQuestions — объекты questionId,text,material,answer; decisions — объекты id,text,rationale,questionId; assumptions — объекты id,text,rationale,material; sources — объекты id,kind,status,summary,refs,critical. В sources kind допускает только knowledge|hierarchy|related_tasks|code|tests|storybook, а refs всегда является массивом строк string[]. Не заменяй строки массивами или объектами. Для каждого affectedComponent укажи непустой coverage object. Если Storybook неприменим или отсутствует, storybookStoryId должен быть null, а exclusionReason и alternativeVerification — непустыми и конкретными; coverage перечисляет существующие и обязательные альтернативные проверки. Существенные открытые вопросы и противоречия запрещены. Задача: ${task?.title ?? ''}\\nОписание: ${task?.description ?? ''}\\nКритерии: ${task?.acceptanceCriteria ?? ''}\\n${answeredContext}`
const ordinaryResponses: string[] = []
    const terminalValidationFailure = async (message: string, text: string, recoveryDetail?: string): Promise<void> => {
      const terminalMessage = recoveryDetail ? `Recovery Development Brief завершился ошибкой: ${recoveryDetail}; исходная диагностика: ${message}` : message
      const readiness = (() => { try { return parseTaskPreparation(text) } catch { return null } })()
      const results = readiness ? developmentReadinessGateResults(readiness) : []
      await db.tasks.blockTaskPreparationRun(run.id, terminalMessage, results.flatMap((item) => item.status === 'fail' ? item.refs : []), results)
      closePreparationTools()
      preparationRunUpdated(userId, projectId, taskId, run.id)
    }
    const sendRecovery = async (reason: string): Promise<void> => {
      const sourceName = `${provider}:${model}`
      const recoveryName = sourceName
      await db.tasks.transitionTaskPreparationRun(run.id, 'running', 'brief_generation', 'Аварийное восстановление Development Brief')
      preparationRunUpdated(userId, projectId, taskId, run.id)
      await db.tasks.appendTaskPreparationEvent(run.id, 'recovery_started', 'brief_generation', `Recovery через зафиксированную проектную пару ${recoveryName}: ${reason}`, { sourceProvider: provider, sourceModel: model, recoveryProvider: provider, recoveryModel: model, reason })
      await db.tasks.appendTaskPreparationLog(run.id, `[система] Recovery через зафиксированную проектную пару: ${recoveryName}; причина: ${reason}\\n`)
      const recoveryPrompt = `Исправь ТОЛЬКО структуру уже подготовленного Development Brief без повторного исследования и без изменения смысла требований. Верни ровно один JSON-объект schemaVersion=2: первый непробельный символ «{», последний — «}»; Markdown-ограда и любой текст вне объекта запрещены.\\n
Диагностика валидатора (точные пути/гейты): ${reason}\\n
Исходный ответ: ${ordinaryResponses[0] ?? ''}\\n
Повторный ответ: ${ordinaryResponses[1] ?? ''}\\n
Строгий контракт DevelopmentReadiness:
schemaVersion: 2; goal, functionalRequirements, acceptanceCriteria — string; scope, outOfScope, businessRules, errorsAndEdgeCases, uiStates, contractChanges, dataChanges, constraints, contradictions — string[]; uiImpact — none|existing_components|new_components|multi_component_flow; acceptanceCriteriaConflict — boolean.
acceptanceCriteriaItems: {id,title,precondition,action,observableResult:string}[].
testCases: {id,title,description,preconditions,testData,steps,expectedResult,testType,notAutomatedReason,alternativeManualVerification,comments:string,required:boolean,automatable:boolean,automationLinks:array}[]. testType — ui|api|integration|negative|regression|manual; при uiImpact≠none обязателен хотя бы один testCase с required=true и testType=ui.
affectedComponents: {id,name,exclusionReason,alternativeVerification:string,reusable:boolean,storybookStoryId:string|null,coverage:object}[]. Для каждого компонента coverage непустой; при storybookStoryId=null обязательны непустые exclusionReason и alternativeVerification.
openQuestions: {questionId:string,text:string,material:boolean,answer:string|null}[]; decisions: {id,text,rationale:string,questionId?:string}[]; assumptions: {id,text,rationale:string,material:boolean}[].
sources: {id:string,kind:knowledge|hierarchy|related_tasks|code|tests|storybook,status:available|absent|unavailable,summary:string,refs:string[],critical:boolean}[].
Сохрани исходные требования. Если диагностика выявляет дефект подготовки, добавь в scope, acceptanceCriteria/acceptanceCriteriaItems и testCases отдельные проверяемые работы: усиление prompt/schema, безопасная нормализация однозначных совместимых значений, регрессионные тесты и актуализация существующего раздела БЗ. Не добавляй новые исследования и не выдумывай источники.`
      const handle = await client.send({ userId, prompt: recoveryPrompt, sessionId: null, model, executionDisabled: true, makeSources: preparationMakeSources }, {
        onDelta: async () => {},
        onSession: async () => {},
        onDone: async (text) => {
          taskPreparationHandles.delete(run.id)
          if ((await db.tasks.getTaskPreparationRun(userId, run.id))?.status !== 'running') return
          try {
            await db.tasks.transitionTaskPreparationRun(run.id, 'validating', 'readiness_validation', 'Проверка восстановленного Development Brief')
            preparationRunUpdated(userId, projectId, taskId, run.id)
            const readiness = parseTaskPreparation(text)
            const gate = canConfirmDevelopmentReadiness(readiness)
            if (!gate.allowed) throw new Error(`Гейт готовности не пройден: ${gate.reasons.join(', ')}`)
            await db.tasks.appendTaskPreparationEvent(run.id, 'recovery_completed', 'readiness_validation', `Recovery ${recoveryName} успешно прошёл runtime-валидацию и readiness-гейт`, { sourceProvider: provider, sourceModel: model, recoveryProvider: provider, recoveryModel: model, result: 'success' })
            await db.tasks.completeTaskPreparationRun(userId, run.id, readiness)
            closePreparationTools()
            preparationRunUpdated(userId, projectId, taskId, run.id)
          } catch (error) {
            const recoveryError = redactPreparationText(error instanceof Error ? error.message : String(error))
            await db.tasks.appendTaskPreparationEvent(run.id, 'recovery_failed', 'readiness_validation', `Recovery ${recoveryName} отклонён: ${recoveryError}`, { sourceProvider: provider, sourceModel: model, recoveryProvider: provider, recoveryModel: model, result: 'failed', error: recoveryError })
            await terminalValidationFailure(reason, text, recoveryError)
          }
        },
        onError: async (message) => {
          taskPreparationHandles.delete(run.id)
          if ((await db.tasks.getTaskPreparationRun(userId, run.id))?.status !== 'running') return
          const recoveryError = taskPreparationFailure(provider, userId, message)
          await db.tasks.appendTaskPreparationEvent(run.id, 'recovery_failed', 'brief_generation', `Recovery ${recoveryName} не выполнен: ${recoveryError}`, { result: 'failed', error: recoveryError })
          await terminalValidationFailure(reason, ordinaryResponses[1] ?? '', recoveryError)
        }
      })
      if (handle) taskPreparationHandles.set(run.id, { cancel: () => { closePreparationTools(); handle.cancel() } })
    }
    const sendAttempt = async (attempt: number, correction?: string): Promise<void> => {
      const prompt = correction ? `${basePrompt}\\nПредыдущий ответ отклонён: ${correction}. Верни исправленный единственный JSON-объект без любого текста вне JSON.` : basePrompt
      const handle = await client.send({ userId, prompt, sessionId: null, model, permissionMode: 'default', readOnlyRemote: true, makeSources: preparationMakeSources, ...remote, ...kbFields }, {
        onDelta: async (chunk) => { await db.tasks.appendTaskPreparationLog(run.id, chunk); preparationRunDelta(userId, projectId, taskId, run.id) },
        onSession: async () => {},
        onDone: async (text) => {
          taskPreparationHandles.delete(run.id)
          if ((await db.tasks.getTaskPreparationRun(userId, run.id))?.status !== 'running') return
          ordinaryResponses[attempt - 1] = text
          try {
            const questionRaw = text.trim()
            if (!questionRaw.startsWith('{') || !questionRaw.endsWith('}')) throw new Error('Ожидался чистый JSON-объект')
            const candidate = JSON.parse(questionRaw) as { question?: unknown; material?: unknown }
            if (typeof candidate.question === 'string' && candidate.question.trim()) {
              const question = await db.tasks.createTaskPreparationQuestion(run.id, candidate.question, candidate.material !== false)
              if (!question) throw new Error('Не удалось сохранить уточняющий вопрос')
              closePreparationTools()
              preparationRunUpdated(userId, projectId, taskId, run.id)
              return
            }
          } catch {
            // Обычный readiness JSON разбирается и диагностируется ниже.
          }
          try {
            await db.tasks.transitionTaskPreparationRun(run.id, 'validating', 'readiness_validation', 'Проверка Development Brief')
            preparationRunUpdated(userId, projectId, taskId, run.id)
            const readiness = parseTaskPreparation(text)
            const gate = canConfirmDevelopmentReadiness(readiness)
            if (!gate.allowed) throw new Error(`Гейт готовности не пройден: ${gate.reasons.join(', ')}`)
            await db.tasks.completeTaskPreparationRun(userId, run.id, readiness)
            closePreparationTools()
            preparationRunUpdated(userId, projectId, taskId, run.id)
          } catch (error) {
            const message = redactPreparationText(error instanceof Error ? error.message : String(error))
            if (attempt < 2) {
              await db.tasks.transitionTaskPreparationRun(run.id, 'running', 'brief_generation', 'Исправление Development Brief после проверки')
              preparationRunUpdated(userId, projectId, taskId, run.id)
              await sendAttempt(attempt + 1, message)
            } else if (message.includes('.kind имеет недопустимое значение')) {
              await terminalValidationFailure(message, text)
            } else {
              await sendRecovery(message)
            }
          }
        },
        onError: async (message) => {
          taskPreparationHandles.delete(run.id)
          if ((await db.tasks.getTaskPreparationRun(userId, run.id))?.status !== 'running') return
          if (attempt < 2) await sendAttempt(attempt + 1, message)
          else { await db.tasks.failTaskPreparationRun(run.id, taskPreparationFailure(provider, userId, message)); closePreparationTools(); preparationRunUpdated(userId, projectId, taskId, run.id) }
        }
      })
      if (handle) taskPreparationHandles.set(run.id, { cancel: () => { closePreparationTools(); handle.cancel() } })
    }
    // Подготовка обязана исследовать тот же SHA, который сейчас опубликован в
    // origin. Fetch выполняется сервером до LLM: read-only модель не может забыть
    // его вызвать или молча продолжить на устаревшей копии.
    void (async () => {
      if (project?.gitUrl) {
        if (!selectedMachine) throw new Error('Для Git-проекта не настроена доступная машина с рабочей директорией')
        if (!machines.isOnline(selectedMachine.agentId)) throw new Error(`Машина «${selectedMachine.name ?? selectedMachine.agentId}» offline`)
        const snapshot = await ensureProjectMainCurrent({
          userId, projectId, conversationId: null, agentId: selectedMachine.agentId,
          path: selectedMachine.path, branch: project.ciBaseBranch || 'main', gitUrl: project.gitUrl
        })
        await db.tasks.appendTaskPreparationLog(run.id, `[система] Актуальная базовая ветка: ${project.ciBaseBranch || 'main'} @ ${snapshot.baseSha}; совпадение с origin подтверждено.\n`)
        // Автолечение копии видно в логе подготовки: иначе спрятанный stash
        // остаётся невидимым и человек не знает, где искать свои правки.
        if (snapshot.autoHealed) await db.tasks.appendTaskPreparationLog(run.id, `[система] Общая копия проекта приведена в порядок автоматически: ${snapshot.autoHealed}.\n`)
      }
      await sendAttempt(1)
    })().catch(async (error) => {
      const message = `Не удалось синхронизировать проект с origin: ${error instanceof Error ? error.message : String(error)}`
      await db.tasks.failTaskPreparationRun(run.id, message)
      closePreparationTools()
      preparationRunUpdated(userId, projectId, taskId, run.id)
    })
    preparationRunUpdated(userId, projectId, taskId, run.id)
    return run
  }

  app.get('/api/task-preparation/notifications', async (req) =>
    await db.tasks.listTaskPreparationNotifications(uid(req))
  )
  app.post<{ Params: { questionId: string } }>('/api/task-preparation/notifications/:questionId/dismiss', async (req, reply) => {
    const current = (await db.tasks.listTaskPreparationNotifications(uid(req))).find((item) => item.questionId === req.params.questionId)
    const dismissed = await db.tasks.dismissTaskPreparationNotification(uid(req), req.params.questionId)
    if (!dismissed) return reply.code(404).send({ error: 'not found' })
    if (current) notificationHub.emit(current.projectId, uid(req))
    return { dismissed: true }
  })

  app.post<{ Params: { id: string; taskId: string }; Body: Partial<import('@voicechat/shared').TaskPreparationLlmSelection> }>('/api/projects/:id/tasks/:taskId/preparation/run', async (req, reply) => {
    const selection = req.body?.provider && typeof req.body.model === 'string' ? { llmEngineId: req.body.llmEngineId ?? null, provider: req.body.provider, model: req.body.model } : undefined
    try { return await launchTaskPreparation(uid(req), req.params.id, req.params.taskId, selection) }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }) }
  })
  app.get<{ Params: { id: string; taskId: string } }>('/api/projects/:id/tasks/:taskId/preparation/runs', async (req) =>
    await db.tasks.listTaskPreparationRuns(uid(req), req.params.id, req.params.taskId)
  )
  app.get<{ Params: { runId: string } }>('/api/task-preparation/runs/:runId', async (req, reply) =>
    await db.tasks.getTaskPreparationRun(uid(req), req.params.runId) ?? reply.code(404).send({ error: 'not found' })
  )
  app.post<{ Params: { questionId: string }; Body: { answer?: string } }>('/api/task-preparation/questions/:questionId/answer', async (req, reply) => {
    try {
      const result = await db.tasks.answerTaskPreparationQuestion(uid(req), req.params.questionId, req.body?.answer ?? '')
      if (!result) return reply.code(404).send({ error: 'not found' })
      if (result.accepted) {
        const run = await db.tasks.getTaskPreparationRun(uid(req), result.question.attemptId)
        if (run) await launchTaskPreparation(uid(req), run.projectId, run.taskId)
      }
      return result
    } catch (error) {
      return reply.code(400).send({ error: redactPreparationText(error instanceof Error ? error.message : String(error)) })
    }
  })
  app.get<{ Params: { runId: string; format: 'json' | 'md' | 'txt' } }>('/api/task-preparation/runs/:runId/export/:format', async (req, reply) => {
    const run = await db.tasks.getTaskPreparationRun(uid(req), req.params.runId)
    if (!run) return reply.code(404).send({ error: 'not found' })
    const format = req.params.format
    if (format !== 'json' && format !== 'md' && format !== 'txt') return reply.code(400).send({ error: 'unsupported format' })
    const filename = preparationExportFilename(run.taskKey ?? run.taskId, run.attemptNumber ?? run.attempt, run.createdAt, format)
    reply.header('content-disposition', `attachment; filename="${filename}"`)
    if (format === 'json') {
      reply.type('application/json; charset=utf-8')
      return {
        schemaVersion: 1, taskId: run.taskId, taskKey: run.taskKey, attemptId: run.attemptId,
        attemptNumber: run.attemptNumber, llmEngineId: run.llmEngineId, provider: run.provider, model: run.model, profileId: run.profileId, status: run.status,
        phase: run.phase, createdAt: run.createdAt, startedAt: run.startedAt, finishedAt: run.finishedAt,
        durationMs: run.durationMs, events: run.events, questions: run.questions, readiness: run.readiness,
        gateResults: run.gateResults, gateReasons: run.gateReasons, error: run.error
      }
    }
    const lines = [
      `# Подготовка ${run.taskKey}: попытка ${run.attemptNumber}`, '',
      `- Attempt ID: ${run.attemptId}`, `- Статус: ${run.status}`, `- Фаза: ${run.phase}`,
      `- LLM: ${run.provider ?? 'claude'} · ${run.model || 'не указана'}`, `- Исполнитель: ${run.llmEngineId ?? 'по умолчанию'}`, `- Profile ID: ${run.profileId}`, `- Длительность: ${run.durationMs} мс`, '',
      '## Хронология', '', ...(run.events ?? []).map((event) => `${event.sequence}. [${new Date(event.timestamp).toISOString()}] ${event.type}: ${event.text}`), '',
      '## Вопросы и ответы', '', ...(run.questions ?? []).map((question) => `- ${question.text} — ${question.answer ?? 'без ответа'}`), '',
      '## Readiness-гейты', '', ...(run.gateResults ?? []).map((gate) => `- ${gate.code}: ${gate.status} — ${gate.explanation}`), '',
      '## Development Brief', '', run.readiness ? `\`\`\`json\\n${JSON.stringify(run.readiness, null, 2)}\\n\`\`\`` : 'Итоговый brief отсутствует.'
    ]
    reply.type('text/markdown; charset=utf-8')
    return redactPreparationText(lines.join('\\n'))
  })
  app.delete<{ Params: { runId: string } }>('/api/task-preparation/runs/:runId', async (req, reply) => {
    const run = await db.tasks.cancelTaskPreparationRun(uid(req), req.params.runId)
    if (!run) return reply.code(404).send({ error: 'not found' })
    try { taskPreparationHandles.get(run.id)?.cancel() } finally { taskPreparationHandles.delete(run.id) }
    preparationRunUpdated(uid(req), run.projectId, run.taskId, run.id)
    return run
  })
  app.post<{ Params: { runId: string }; Body: Partial<import('@voicechat/shared').TaskPreparationLlmSelection> }>('/api/task-preparation/runs/:runId/retry', async (req, reply) => {
    const previous = await db.tasks.getTaskPreparationRun(uid(req), req.params.runId)
    if (!previous) return reply.code(404).send({ error: 'not found' })
    if (!previous.canRetry) return reply.code(409).send({ error: 'Эту попытку нельзя повторить' })
    const selection = req.body?.provider && typeof req.body.model === 'string' ? { llmEngineId: req.body.llmEngineId ?? null, provider: req.body.provider, model: req.body.model } : undefined
    try { return await launchTaskPreparation(uid(req), previous.projectId, previous.taskId, selection) }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }) }
  })

  let autoPilotTick: (projectId: string) => void = () => {}
  // Координатор автопрохода будится подпиской на сам хаб, а не обёрткой над ним:
  // раньше тик планировал только `emitBoard`, а завершение preparation-, CI-,
  // QA- и merge-ранов зовёт `boardHub.emit` напрямую — автопроход не узнавал,
  // что этап закончился, и стоял до следующего действия человека.
  boardHub.onChange((projectId) => autoPilotTick(projectId))
  const emitBoard = (projectId: string): void => boardHub.emit(projectId)
  const ciRunManager: CiRunManager = createCiRunManager({
    db,
    executor: ciExecutor,
    boardChanged: emitBoard,
    improvementsChanged: (projectId) => boardHub.emitImprovements(projectId),
    // Боевой исполнитель не ждёт reconnect агента; тестовый executor сам задаёт
    // доступность и не зависит от реестра WebSocket.
    isAgentOnline: deps.ciExecutor ? undefined : (agentId) => machines.isOnline(agentId),
    postToChat: async ({ userId, conversationId, text, runId, interactionId }) => {
      try {
        return (await db.chat.addMessage(userId, conversationId, 'ai', text, ciChatTime(), undefined, { ciInteraction: { runId, interactionId } })).id
      } catch {
        return null
      }
    },
    postAnswerToChat: async ({ userId, conversationId, text }) => {
      try {
        await db.chat.addMessage(userId, conversationId, 'u1', text, ciChatTime())
      } catch {
        /* чат мог быть удалён — не роняем ответ на вопрос */
      }
    },
    // Сессия браузерной проверки задачи гасится best-effort: не смогли — ран
    // продолжится в прежней странице, а это заметно модели, но не смертельно.
    resetBrowserCheck: ({ taskId }) => {
      void browserRunner?.stop(`task-${taskId}`).catch(() => undefined)
    },
    // Резюме законченного рана — обычное AI-сообщение чата; метка `ciRunSummary`
    // связывает его с раном и отличает от ответа хода модели.
    postSummaryToChat: async ({ userId, conversationId, text, runId }) => {
      try {
        return await db.chat.addMessage(userId, conversationId, 'ai', text, ciChatTime(), undefined, { ciRunSummary: { runId } })
      } catch {
        return null // чат удалён — резюме от этого не падает
      }
    },
    modelWork: ciModelHooks.modelWork,
    modelSummary: ciModelHooks.modelSummary,
    attemptFix: ciModelHooks.attemptFix,
    kbUpdate: ciKbUpdate ?? ciModelHooks.kbUpdate,
    qaPreparation: (args) => { void launchQaPreparation(args) }
  })
  registerCiRoutes(app, db, ciRunManager, machines, (projectId) => boardHub.emit(projectId), (userId, projectId, taskId) => launchTaskPreparation(userId, projectId, taskId), (projectId) => boardHub.emitImprovements(projectId))


  const featurePreviews = new FeaturePreviewManager({
    db,
    executor: ciExecutor,
    storePath: join(config.dataDir, 'feature-previews.json'),
    isOnline: (agentId) => machines.isOnline(agentId),
    platformOf: (agentId) => machines.platformOf(agentId),
    allowedDirsOf: (agentId) => machines.policyOf(agentId)?.allowedDirs ?? [],
    fsRead: (agentId, path) => machines.fsRead(agentId, path),
    fsWrite: (agentId, path, dataBase64) => machines.fsWrite(agentId, path, dataBase64),
    fsMkdir: (agentId, path) => machines.fsMkdir(agentId, path),
    fsRename: (agentId, from, to) => machines.fsRename(agentId, from, to),
    fsDelete: (agentId, path) => machines.fsDelete(agentId, path),
    closeTunnelsForAgent: (agentId) => machines.closeTunnelsForTarget(agentId)
  })
  registerFeaturePreviewRoutes(app, featurePreviews, db, machines)
  void featurePreviews.reconcile()
  const releaseManager = new ReleaseManager(db, {
    exec: async (target, command, timeoutMs, onChunk) => {
      let output = ''
      const result = await machines.execStream(target.agentId, command, timeoutMs, (chunk) => {
        output += chunk
        onChunk?.(chunk)
      })
      return { ...result, output }
    },
    isOnline: (agentId) => machines.isOnline(agentId),
    prepareKnowledgeBase: async (releaseBranch, target) => {
      // Лимит берётся из настроек шага, а не из константы: жёсткие 120 с убивали
      // шаг с объявленным лимитом 10 минут ровно на 121-й секунде, и в логе
      // оставался обрыв на середине push — искать причину было не по чему.
      const limitMs = knowledgeBaseTimeoutMs(target)
      const result = await machines.exec(target.agentId, releaseKnowledgeBaseCommand(target, releaseBranch), limitMs)
      if (result.timedOut) throw new Error(`Release-preflight базы знаний не уложился в ${Math.round(limitMs / 1000)} с`)
      if (result.exitCode !== 0) throw new Error(result.output || 'Release-preflight базы знаний завершился с ошибкой')
    }
  })
  const managedEnvironments = new ManagedEnvironmentResolver(db, releaseManager, (agentId) => machines.policyOf(agentId)?.allowedDirs ?? [])
  await releaseManager.reconcile(async (release) => {
    const project = await db.projects.getProject(release.triggeredBy, release.projectId)
    const agentId = project?.productionAgentId
    const linked = agentId ? project?.machines.some(machine => machine.agentId === agentId) : false
    if (!project || !agentId || !linked || !project.productionDeployCommand || !project.productionHealthCheckCommand || !project.gitUrl) return null
    // requireOnline:false — target resolvable даже если companion-агент прод-машины
    // ещё не переподключился после рестарта; monitorHealth сам дождётся онлайна и
    // корректной версии в пределах health-check бюджета, а не падает мгновенно.
    if(project.productionEnvironmentMode==='managed'){try{return (await managedEnvironments.resolve(release.triggeredBy,release.projectId,'production',{requireOnline:false})).target}catch{return null}}
    if(!project.productionCheckoutPath)return null
    return { projectId: release.projectId, agentId, path: project.productionCheckoutPath, prepareCheckout: false, gitUrl: project.gitUrl, baseBranch: project.ciBaseBranch || 'main', testCommand: project.testCommand?.trim() || 'npm run gate:all', deployCommand: project.productionDeployCommand, healthCheckCommand: project.productionHealthCheckCommand, expectedRepository: project.gitUrl, mode:'legacy' }
  })
  registerReleaseRoutes(app, db, releaseManager, managedEnvironments, machines)
  const applicationReleases = new ApplicationReleaseManager(db, createApplicationReleaseRuntime({
    exec: async (target, command, timeoutMs, onChunk) => {
      let output = ''
      const result = await machines.execStream(target.agentId, command, timeoutMs, chunk => { output += chunk; onChunk?.(chunk) })
      return { ...result, output }
    }
  }))
  registerApplicationReleaseRoutes(app, db, applicationReleases, releaseManager, managedEnvironments)

  const mergeRunManager = new MergeRunManager({ db, executor: ciExecutor, conflictFix: ciModelHooks.conflictFixForMerge, testFix: ciModelHooks.testFixForMerge, kbUpdate: ciModelHooks.kbUpdateForMerge, isOnline: (id) => machines.isOnline(id), platformOf: (id) => machines.platformOf(id), policyOf: (id) => machines.policyOf(id), fsRead: (id, path) => machines.fsRead(id, path), fsWrite: (id, path, data) => machines.fsWrite(id, path, data), fsDelete: (id, path) => machines.fsDelete(id, path), broadcast: (message, userId) => ciRunManager.publish(message, userId), boardChanged: (id) => boardHub.emit(id), repositoriesChanged: (projectId, taskId) => boardHub.emitTaskRepositories({ projectId, taskId }) })
  registerProjectTypeRoutes(app, db)
  registerInvitationRoutes(app, db, { mailer, publicUrl: config.publicUrl, membershipChanged: (projectId, userId) => notificationHub.emit(projectId, userId, 'membership') })
  registerProjectRoutes(app, db, boardHub, { kb, toolEnabled: config.kbToolEnabled }, ciRunManager, machines, mergeRunManager, (userId, projectId, taskId, selection) => launchTaskPreparation(userId, projectId, taskId, selection), (projectId, affectedUserId) => notificationHub.emit(projectId, affectedUserId, 'membership'), emitBoard,
    // Разовый прогон набора: тот же исполнитель, что у этапа, но без рана и
    // воркспейса — человек проверяет сценарий сразу после записи.
    automatedQaScenarioRunner
      ? createAutomatedQaCheck({
          scenariosOf: async (userId, projectId) => (await db.projects.getProject(userId, projectId))?.automatedQaScenarios ?? [],
          runner: automatedQaScenarioRunner,
          budgetMs: CHECK_BUDGET_MS
        })
      : undefined,
    { cancel: async (owner, planId) => await orchestrationManager.cancel(owner, planId) },
    make.service,
    uploads)
  await mergeRunManager.reconcile()
  const onAutoPilotFailure = async (runId: string, userId: string, stage: string, reason: string, options?: { classification?: 'implementation_defect' | 'infrastructure' | null; remarks?: string }): Promise<void> => {
    const run = stage === 'component_qa' ? await db.ci.getComponentQaRun(userId, runId) : stage === 'integration_tests' ? await db.ci.getIntegrationTestRun(userId, runId) : await db.qa.getQaStageRun(userId, runId)
    if (!run) return
    // Инфраструктурный сбой (недоступный воркспейс, таймаут, отключившийся
    // исполнитель) — не дефект разработчика: возвращать задачу и жечь цикл
    // автопрохода за чужой сбой нельзя, поэтому автопроход просто встаёт.
    if (options?.classification === 'infrastructure') {
      await db.qa.recordAutoPilotEvent(run.projectId, run.taskId, 'autopilot.stopped', { stage, runId, reason, blockedBy: 'infrastructure' })
      emitBoard(run.projectId)
      return
    }
    const handled = await db.tasks.handleAutoPilotFailure(userId, run.projectId, run.taskId, stage, runId, reason, options?.remarks ?? '')
    if (handled && !handled.decisionRequired) await ciRunManager.start(userId, run.projectId, run.taskId, { mode: 'development' })
    emitBoard(run.projectId)
  }
  const componentQaRunner=createComponentQaRunner({db,executor:ciExecutor,boardChanged:emitBoard,qaStageChanged:(projectId,taskId)=>boardHub.emitQaStage({projectId,taskId,stage:'component_qa'}),completed:async (runId,userId,passed,reason,classification)=>{
    const run=await db.ci.getComponentQaRun(userId,runId);if(!run)return
    if(passed){try{await db.tasks.completeComponentQaRun(userId,run.projectId,run.taskId,runId);emitBoard(run.projectId)}catch(error){await onAutoPilotFailure(runId,userId,'component_qa',error instanceof Error?error.message:String(error))}}
    else await onAutoPilotFailure(runId,userId,'component_qa',reason,{classification:classification??null})
  }})
  const integrationTestRunner=createIntegrationTestRunner({db,executor:ciExecutor,boardChanged:emitBoard,qaStageChanged:(projectId,taskId)=>boardHub.emitQaStage({projectId,taskId,stage:'integration_tests'}),completed:async (runId,userId,passed,reason,classification)=>{
    const run=await db.ci.getIntegrationTestRun(userId,runId);if(!run)return
    if(passed){try{await db.ci.completeIntegrationTestRun(userId,run.projectId,run.taskId,runId);emitBoard(run.projectId)}catch(error){await onAutoPilotFailure(runId,userId,'integration_tests',error instanceof Error?error.message:String(error))}}
    else await onAutoPilotFailure(runId,userId,'integration_tests',reason,{classification:classification??null})
  }})
  const automatedQaRunner=createAutomatedQaRunner({db,executor:ciExecutor,scenarioRunner:automatedQaScenarioRunner,boardChanged:emitBoard,qaStageChanged:(projectId,taskId)=>boardHub.emitQaStage({projectId,taskId,stage:'automated_qa'}),completed:async (runId,userId,passed,reason,verdict)=>{
    if(passed)return
    await onAutoPilotFailure(runId,userId,'automated_qa',reason,{classification:verdict?.classification??null,remarks:verdict?automatedQaRemarks(verdict):''})
  }})
  /**
   * Начало конвейера у автопрохода: карточка в TODO или в подготовке сама уходит
   * в работу. Раньше координатор начинался с `component_qa`, а старт подготовки и
   * переход ready → development жили только в drag&drop-роуте доски, поэтому
   * автопроход стоял до тех пор, пока человек не перетащит карточку руками.
   *
   * Ран подготовки уже идемпотентен (`launchTaskPreparation` переиспользует
   * активный), поэтому повторные тики безопасны. Ожидание ответа на вопрос модели
   * (`waiting_for_answer`) — осознанная остановка: там нужен человек, и
   * перезапускать попытку нельзя. Упавшие попытки повторяются в пределах
   * `autoPilotFixLimit` — инфраструктурный сбой (таймаут синхронизации с origin,
   * отвалившаяся машина) не должен требовать ручного «Повторить», но и крутить
   * бесконечный цикл на сломанном окружении координатор не имеет права.
   */
  const autoPilotPreparation = async (userId: string, projectId: string, task: import('@voicechat/shared').Task): Promise<void> => {
    if (await db.tasks.activeTaskPreparationRun(userId, projectId, task.id)) return
    const runs = await db.tasks.listTaskPreparationRuns(userId, projectId, task.id)
    if (runs.some((run) => run.status === 'success' || run.status === 'completed')) return
    const limit = (await db.projects.getProject(userId, projectId))?.autoPilotFixLimit ?? 3
    const failed = runs.filter((run) => run.status === 'failed' || run.status === 'blocked').length
    if (failed >= limit) {
      await db.qa.recordAutoPilotEvent(projectId, task.id, 'autopilot.stopped', { stage: 'preparation', reason: 'Подготовка не прошла после автоматических повторов', attempts: failed, limit })
      // Из TODO пути в decision_required нет (карту переходов автопроход не
      // обходит): там карточка просто остаётся ждать человека с записью в аудите.
      try { await db.tasks.transitionAutoPilotTask(projectId, task.id, 'decision_required', 'autopilot.preparation_limit_exhausted') }
      catch { /* переход недоступен из текущей колонки */ }
      emitBoard(projectId)
      return
    }
    try { await launchTaskPreparation(userId, projectId, task.id) }
    catch (error) {
      // Причина запуска (нет машины, недоступная модель) не лечится повтором в том
      // же тике: событие остаётся в аудите, а следующий board event попробует снова.
      await db.qa.recordAutoPilotEvent(projectId, task.id, 'autopilot.stopped', { stage: 'preparation', reason: error instanceof Error ? error.message : String(error), attempts: failed, limit })
    }
  }
  /**
   * Сбой машины посреди рана (ноутбук ушёл в сон, обрыв Wi-Fi) валит текущий шаг,
   * но работа модели остаётся в рабочей копии. Новый ран заставил бы модель
   * делать её заново — десятки минут в мусор, — поэтому автопроход возобновляет
   * тот же ран с упавшего шага. Повторов конечное число: сломанное окружение не
   * должно крутить ран по кругу.
   */
  const autoPilotResumeAfterInfraFailure = async (userId: string, projectId: string, task: import('@voicechat/shared').Task): Promise<boolean> => {
    const last = await db.ci.latestCiRunSummary(task.id)
    if (!last) return false
    const allowed = shouldResumeAfterInfraFailure({
      status: last.status,
      infraErrors: await db.ci.countCiEvents(last.id, 'run.infra_error'),
      resumes: await db.ci.countCiEvents(last.id, 'run.autopilot_infra_resume'),
      limit: AUTOPILOT_INFRA_RESUMES
    })
    if (!allowed) return false
    const resumed = await ciRunManager.retryFromFailed(userId, last.id)
    if ('error' in resumed) return false
    await db.ci.addCiEvent({ projectId, runId: last.id, type: 'run.autopilot_infra_resume', actorType: 'system', payload: { taskId: task.id, status: last.status } })
    emitBoard(projectId)
    return true
  }
  /**
   * Карточка в development с упавшим раном и без активного — тупик: fix-loop уже
   * отработал внутри рана, а следующий ран без человека не появлялся. Сначала
   * пробуем продолжить брошенный ран, иначе ставим новый — но только пока подряд
   * упавших ранов меньше лимита доработок: бесконечно долбиться в сломанную
   * задачу автопроход не должен, для этого есть `decision_required`.
   */
  const autoPilotDevelopmentStuck = async (userId: string, projectId: string, task: import('@voicechat/shared').Task): Promise<void> => {
    if (await autoPilotResumeAfterInfraFailure(userId, projectId, task)) return
    const last = await db.ci.latestCiRunSummary(task.id)
    if (!last || (last.status !== 'failed' && last.status !== 'timeout')) return
    // Незакоммиченная работа модели в копии задачи: перезапуск падает мгновенно и
    // только жжёт попытки, а сброс копии уничтожил бы саму работу.
    if (isDirtyWorkspaceFailure(last.error)) {
      await db.qa.recordAutoPilotEvent(projectId, task.id, 'autopilot.stopped', { stage: 'development', reason: 'Рабочая копия задачи содержит несохранённые изменения', runId: last.id })
      return
    }
    if (!retryAllowedNow({ finishedAt: await db.ci.lastCiRunFinishedAt(task.id), now: Date.now() })) return
    const limit = (await db.projects.getProject(userId, projectId))?.autoPilotFixLimit ?? 3
    const failures = await db.ci.countTrailingFailedCiRuns(task.id)
    if (failures >= limit) {
      await db.qa.recordAutoPilotEvent(projectId, task.id, 'autopilot.stopped', { stage: 'development', reason: 'Подряд упавшие development-раны', failures, limit })
      try { await db.tasks.transitionAutoPilotTask(projectId, task.id, 'decision_required', 'autopilot.development_limit_exhausted') }
      catch { /* переход недоступен из текущей колонки */ }
      emitBoard(projectId)
      return
    }
    const started = await ciRunManager.start(userId, projectId, task.id, { mode: 'development' })
    if ('error' in started) {
      await db.qa.recordAutoPilotEvent(projectId, task.id, 'autopilot.stopped', { stage: 'development', reason: started.error, failures, limit })
      return
    }
    await db.qa.recordAutoPilotEvent(projectId, task.id, 'autopilot.development_retry', { runId: started.run.id, failures, limit })
    emitBoard(projectId)
  }
  /** Готовая к разработке карточка сама встаёт в очередь development-рана. */
  const autoPilotDevelopment = async (userId: string, projectId: string, task: import('@voicechat/shared').Task): Promise<void> => {
    if (await autoPilotResumeAfterInfraFailure(userId, projectId, task)) return
    const result = await ciRunManager.startForDevelopmentTransition(userId, projectId, task.id, true)
    if ('error' in result) {
      await db.qa.recordAutoPilotEvent(projectId, task.id, 'autopilot.stopped', { stage: 'ready', reason: result.error })
      return
    }
    if (!result.existing) emitBoard(projectId)
  }
  /**
   * Этап не запускается на спящей машине. Раньше упавший по «Машина отключилась
   * во время выполнения команды» этап сразу перезапускался следующим board-событием
   * и падал снова — так задача жгла круги доработки за чужой сбой. Пока online-машины
   * у проекта нет, автопроход просто ждёт: фоновый тик вернётся к нему сам.
   */
  const projectHasOnlineMachine = async (userId: string, projectId: string): Promise<boolean> =>
    (await db.machines.listUsableAgents(userId, projectId)).some((agent) => machines.isOnline(agent.id))
  /**
   * Merge — такой же этап конвейера, как QA: карточка в нём с упавшим раном
   * никем не подхватывалась, а «Машина отключилась во время выполнения команды»
   * оставляла её стоять навсегда (прод, CHAT-412). Запуск идемпотентен
   * (`startMergeRun` возвращает активный ран), поэтому повторные тики безопасны;
   * предохранитель — число подряд упавших ранов и пауза между попытками.
   */
  const autoPilotMerge = async (userId: string, projectId: string, task: import('@voicechat/shared').Task): Promise<void> => {
    const limit = (await db.projects.getProject(userId, projectId))?.autoPilotFixLimit ?? 3
    const failures = await db.ci.countTrailingFailedMergeRuns(task.id)
    if (failures >= limit) {
      await db.qa.recordAutoPilotEvent(projectId, task.id, 'autopilot.stopped', { stage: 'merge', reason: 'Подряд упавшие merge-раны', failures, limit })
      try { await db.tasks.transitionAutoPilotTask(projectId, task.id, 'decision_required', 'autopilot.merge_limit_exhausted') }
      catch { /* переход недоступен из текущей колонки */ }
      emitBoard(projectId)
      return
    }
    if (failures > 0 && !retryAllowedNow({ finishedAt: await db.ci.lastMergeRunFinishedAt(task.id), now: Date.now() })) return
    try {
      const run = await db.ci.startMergeRun(userId, projectId, task.id)
      mergeRunManager.start(run)
    } catch (error) {
      await db.qa.recordAutoPilotEvent(projectId, task.id, 'autopilot.stopped', { stage: 'merge', reason: error instanceof Error ? error.message : String(error), failures, limit })
    }
  }
  const ticking = new Set<string>()
  /** Доска изменилась, пока шёл тик: пробуждение нельзя терять, иначе конвейер встаёт. */
  const pendingTicks = new Set<string>()
  autoPilotTick = (projectId) => {
    if (ticking.has(projectId)) { pendingTicks.add(projectId); return }
    ticking.add(projectId)
    queueMicrotask(async () => {
      try {
        for (const item of await db.tasks.autoPilotSnapshot(projectId)) {
          const { task, stage, userId } = item
          // Машина нужна не всем стадиям: пропуск ручного QA — чистая работа с
          // доской, а подготовка требует копию проекта только у Git-проекта.
          const needsMachine = stage === 'manual_qa'
            ? false
            : stage === 'backlog' || stage === 'preparation'
              ? Boolean((await db.projects.getProject(userId, projectId))?.gitUrl)
              : true
          if (needsMachine && !await projectHasOnlineMachine(userId, projectId)) continue
          if (stage === 'backlog' || stage === 'preparation') await autoPilotPreparation(userId, projectId, task)
          else if (stage === 'ready') await autoPilotDevelopment(userId, projectId, task)
          else if (stage === 'development') await autoPilotDevelopmentStuck(userId, projectId, task)
          else if (stage === 'component_qa') { const run=await db.ci.startComponentQaRun(userId,projectId,task.id); if(run.status==='queued')await componentQaRunner.launch(run.id,userId) }
          else if (stage === 'integration_tests') { const run=await db.ci.startIntegrationTestRun(userId,projectId,task.id); if(run.status==='queued')integrationTestRunner.launch(run.id,userId) }
          else if (stage === 'automated_qa') { const run=await db.qa.startQaStageRun(userId,projectId,task.id,'automated_qa'); if(run.status==='queued'||run.status==='running')await automatedQaRunner.launch(run.id,userId) }
          else if (stage === 'manual_qa' && !item.requiresManualQa) await db.tasks.transitionAutoPilotTask(projectId,task.id,'awaiting_merge','autopilot.skip_manual_qa')
          else if (stage === 'awaiting_merge' || stage === 'merge') await autoPilotMerge(userId, projectId, task)
        }
      } catch (error) { app.log.warn({ projectId, error }, 'autopilot tick failed') }
      finally {
        ticking.delete(projectId)
        if (pendingTicks.delete(projectId)) autoPilotTick(projectId)
      }
    })
  }
  // Board-события покрывают всё, что случилось в самом приложении, но не приход
  // машины в онлайн: этап, брошенный уснувшим ноутбуком, ждал бы человека. Раз в
  // минуту координатор сам проходит проекты с автопроходом — тик идемпотентен,
  // и на живом конвейере этот проход ничего не делает.
  const autoPilotTimer = setInterval(async () => {
    try { for (const projectId of await db.tasks.autoPilotProjectIds()) autoPilotTick(projectId) }
    catch (error) { app.log.warn({ error }, 'autopilot sweep failed') }
  }, AUTOPILOT_SWEEP_MS)
  autoPilotTimer.unref?.()
  app.addHook('onClose', async () => clearInterval(autoPilotTimer))
  registerQaRoutes(app, db, uploads, ciRunManager, (args) => launchQaPreparation(args, true),(runId,userId)=>componentQaRunner.launch(runId,userId),(runId)=>componentQaRunner.cancel(runId),(runId,userId)=>integrationTestRunner.launch(runId,userId),(runId)=>integrationTestRunner.cancel(runId),(runId,userId)=>automatedQaRunner.launch(runId,userId),(runId)=>automatedQaRunner.cancel(runId),(id)=>boardHub.emit(id),automatedQaScreenshotDir,(projectId,taskId,stage)=>boardHub.emitQaStage({projectId,taskId,stage}))

  // Запуск работ ассистентом и оркестратором идёт теми же путями, что кнопки в
  // UI: очередь, изоляция директорий и проверки готовности живут в менеджерах.
  const kanbanRunLaunchers: KanbanRunLaunchers = {
    startCi: (userId, projectId, taskId, options) =>
      ciRunManager.start(userId, projectId, taskId, {
        launch: options.launch,
        ...(options.agentId ? { agentId: options.agentId } : {}),
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.model ? { model: options.model } : {})
      }),
    cancelCi: (userId, runId) => ciRunManager.cancel(userId, runId),
    previewOperate: (userId, projectId, taskId, operation, options) =>
      featurePreviews.operate(userId, projectId, taskId, operation, options),
    startPreparation: (userId, projectId, taskId) => launchTaskPreparation(userId, projectId, taskId),
    createReleaseBranch: async (userId, projectId, branch, baseBranch) => {
      const target = await releaseCiTarget(db, releaseManager, userId, projectId)
      return releaseManager.createBranch(userId, target, branch, baseBranch ?? target.baseBranch)
    },
    deployRelease: async (userId, projectId, branch) => {
      const production = await releaseProductionTarget(db, managedEnvironments, userId, projectId)
      if (!production) throw new Error('Production-машина, checkout, deploy-команда или health-check не настроены')
      if (production.mode === 'managed') {
        const check = await managedEnvironments.preflight(userId, projectId, 'production')
        if (!check.ok) throw new Error('Managed production не готов к выкладке')
      }
      return releaseManager.start(userId, await releaseCiTarget(db, releaseManager, userId, projectId), production, branch)
    },
    startMerge: async (userId, projectId, taskId, agentId) => {
      // Та же проверка готовности, что и у кнопки «Влить» в карточке.
      const workspace = await db.ci.findLatestPushedCiWorkspace(projectId, taskId)
      const targetAgentId = agentId ?? workspace?.agentId
      if (targetAgentId) {
        const readiness = await mergeRunManager.checkReadiness(userId, projectId, taskId, targetAgentId)
        if (!readiness.ready) throw new Error(readiness.message)
      }
      const run = await db.ci.startMergeRun(userId, projectId, taskId, agentId)
      mergeRunManager.start(run)
      boardHub.emit(projectId)
      return run
    },
    startQa: async (userId, projectId, taskId, stage) => {
      if (stage === 'component_qa') {
        const run = await db.ci.startComponentQaRun(userId, projectId, taskId)
        if (run.status === 'queued') await componentQaRunner.launch(run.id, userId)
        boardHub.emit(projectId)
        return run
      }
      if (stage === 'integration_tests') {
        const run = await db.ci.startIntegrationTestRun(userId, projectId, taskId)
        if (run.status === 'queued') integrationTestRunner.launch(run.id, userId)
        boardHub.emit(projectId)
        return run
      }
      const run = await db.qa.startQaStageRun(userId, projectId, taskId, 'automated_qa')
      if (run.status === 'queued' || run.status === 'running') await automatedQaRunner.launch(run.id, userId)
      boardHub.emit(projectId)
      return run
    }
  }

  // Планы канбан-ассистента: тот же приём, что у CI-ранов — незавершённые
  // подхватываются после рестарта, потому что ожидание merge длиннее процесса.
  const orchestrationManager = createOrchestrationManager({
    db,
    runs: async () => kanbanRunLaunchers,
    boardChanged: (projectId) => boardHub.emit(projectId),
    publish: (plan) => ciRunManager.publish({ t: 'assistant.orchestration', plan }, plan.owner),
    // Итог плана попадает в тот же чат ассистента обычным сообщением: панель
    // прогресса показывает только идущие планы, а результат нужен и потом.
    // Кадра «в разговоре появилось сообщение» в протоколе нет, и заводить его
    // ради одного отчёта незачем: панель ассистента перечитывает ленту сама,
    // когда план приходит в терминальном статусе кадром assistant.orchestration.
    report: async (plan, text) => {
      if (!plan.conversationId) return
      await db.chat.addMessage(plan.owner, plan.conversationId, 'ai', text, new Date().toTimeString().slice(0, 5))
    }
  })
  await orchestrationManager.restore()
  // Планы двигаются по событиям, а не по таймеру: доска меняется после каждого
  // шага CI, merge и QA, и этого достаточно, чтобы продолжить следующий шаг.
  boardHub.onChange(() => orchestrationManager.notify())
  app.addHook('onClose', async () => orchestrationManager.dispose())

  // Восстанавливаем process-local очередь. Уже начатые раны закрываются как
  // interrupted, а не начавшиеся снова занимают очередь нового менеджера.
  const ciReconciliation = await ciRunManager.reconcile()
  if (ciReconciliation.queued.length) app.log.info({ runs: ciReconciliation.queued.map((r) => r.id) }, 'ci: незапущенные раны возвращены в очередь')
  if (ciReconciliation.interrupted.length) app.log.warn({ runs: ciReconciliation.interrupted.map((r) => r.id) }, 'ci: начатые раны прерваны рестартом сервера')
  const interruptedPreparation = await db.tasks.failInterruptedTaskPreparationRuns()
  if (interruptedPreparation.length) app.log.warn({ runs: interruptedPreparation }, 'task preparation: прерванные раны закрыты как failed')
  const interruptedQa = await db.qa.failInterruptedQaPreparationRuns()
  if (interruptedQa.length) app.log.warn({ runs: interruptedQa }, 'qa preparation: прерванные раны закрыты как failed')
  const interruptedQaStages = await db.qa.failInterruptedQaStageRuns()
  if (interruptedQaStages.length) app.log.warn({ runs: interruptedQaStages }, 'qa stages: прерванные раны закрыты как interrupted')
  for (const run of await db.qa.recoverableAutomatedQaRuns()) await automatedQaRunner.launch(run.id, run.userId)
  // Разовая фоновая чистка прогресс-событий релизов (до исправления их писали на каждый чанк лога): пачками и
  // после старта, чтобы многогигабайтная таблица на проде не задерживала подъём сервера и не держала базу.
  const pruneTimer = setTimeout(() => {
    void db.releases.pruneProgressEvents().then((removed) => { if (removed) app.log.info({ removed }, 'releases: удалены прогресс-события step.running') })
      .catch((error) => app.log.warn({ err: error }, 'releases: чистка прогресс-событий не удалась'))
  }, 15_000)
  pruneTimer.unref?.()
  app.addHook('onClose', async () => clearTimeout(pruneTimer))
  const interruptedComponentQa=await db.ci.failInterruptedComponentQaRuns()
  if (interruptedComponentQa.length) app.log.warn({runs:interruptedComponentQa},'component QA: прерванные раны закрыты как blocked infrastructure')
  const interruptedIntegrationTests=await db.ci.failInterruptedIntegrationTestRuns()
  if(interruptedIntegrationTests.length)app.log.warn({runs:interruptedIntegrationTests},'integration tests: прерванные раны закрыты как blocked infrastructure')
  // MCP канбана (mcp__kanban__*) и CI-команд слушают процесс кластера: в режиме отдельного сервиса
  // ядро переправит эти пути сюда, как пути Make. Снимок «что открыто» у виджета — состояние ядра,
  // приходит портом `core.widgets`.
  registerCiCommandsMcp(app, mcpSecret)
  registerKanbanMcp(app, {
    db,
    agents: machines,
    contexts: widgets.contexts,
    ui: widgets.ui,
    boardChanged: (projectId) => boardHub.emit(projectId),
    orchestration: () => orchestrationManager,
    runs: async () => kanbanRunLaunchers
  }, mcpSecret)
  // Что ядро берёт у кластера — только ленты событий; менеджеры наружу не выходят.
  const service: KanbanService = {
    runs: ciRunManager,
    board: {
      changed: (projectId) => boardHub.emit(projectId),
      subscribe: (cb) => boardHub.onChange(cb),
      subscribePreparationRuns: (cb) => boardHub.onPreparationRunChange(cb),
      subscribeTaskRepositories: (cb) => boardHub.onTaskRepositoriesChange(cb),
      subscribeQaStages: (cb) => boardHub.onQaStageChange(cb),
      subscribeImprovements: (cb) => boardHub.onImprovementsChange(cb)
    },
    notifications: { subscribe: (cb) => notificationHub.onChange(cb) },
    previews: { list: async () => featurePreviews.list() }
  }

  return { service, ciModelHooks, ciRunManager, orchestrationManager, releaseManager, managedEnvironments, mergeRunManager, featurePreviews, automatedQaRunner, launchTaskPreparation, launchQaPreparation, runLaunchers: kanbanRunLaunchers }
}
