// Структурированное ручное QA: общий контракт и чистые правила допуска к merge.
import type { LlmProvider } from './types'
export type QaCriterionTestType =
  | 'ui' | 'api' | 'integration' | 'negative' | 'regression' | 'manual'
  /** Legacy values remain readable for persisted criteria. */
  | 'automated' | 'mixed' | 'not_testable_in_app'
export const QA_CRITERION_TEST_TYPES: QaCriterionTestType[] = [
  'ui', 'api', 'integration', 'negative', 'regression', 'manual',
  'automated', 'mixed', 'not_testable_in_app'
]

export type UiImpact = 'none' | 'existing_components' | 'new_components' | 'multi_component_flow'
export interface StorybookCoverage {
  stories: boolean
  states: boolean
  fixtures: boolean
  playFunctions: boolean
  domTests: boolean
  accessibility: boolean
  visual: boolean
}
export interface AffectedUiComponent {
  id: string
  name: string
  storybookStoryId: string | null
  reusable: boolean
  coverage: StorybookCoverage | Record<string, unknown> | null
  exclusionReason: string
  alternativeVerification: string
}
export interface QaAutomationLink {
  testId: string
  path: string
  updatedAt: number
  commitSha: string
}
export interface TestCaseDefinition {
  /** Stable across edits; versions are stored separately. */
  id: string
  title: string
  description: string
  preconditions: string
  testData: string
  steps: string
  expectedResult: string
  required: boolean
  testType: QaCriterionTestType
  automatable: boolean
  automationLinks: QaAutomationLink[]
  notAutomatedReason: string
  alternativeManualVerification: string
  comments: string
}
export interface ReadinessAcceptanceCriterion {
  id: string
  title: string
  precondition: string
  action: string
  observableResult: string
}
export interface ReadinessSource {
  id: string
  kind: 'knowledge' | 'hierarchy' | 'related_tasks' | 'code' | 'tests' | 'storybook'
  status: 'available' | 'absent' | 'unavailable'
  summary: string
  refs: string[]
  critical: boolean
}
export interface ReadinessQuestion {
  questionId: string
  text: string
  material: boolean
  answer: string | null
}
export interface ReadinessAssumption { id: string; text: string; rationale: string; material: boolean }
export interface ReadinessDecision { id: string; text: string; rationale: string; questionId?: string }
export interface DevelopmentReadiness {
  /** Version 2 is the immutable, confirmed Development Brief contract. */
  schemaVersion?: 2
  goal?: string
  scope?: string[]
  outOfScope?: string[]
  functionalRequirements: string
  businessRules?: string[]
  errorsAndEdgeCases?: string[]
  uiImpact: UiImpact | null
  uiStates?: string[]
  affectedComponents: AffectedUiComponent[]
  contractChanges?: string[]
  dataChanges?: string[]
  acceptanceCriteria: string
  acceptanceCriteriaItems?: ReadinessAcceptanceCriterion[]
  testCases: TestCaseDefinition[]
  constraints?: string[]
  contradictions?: string[]
  openQuestions?: ReadinessQuestion[]
  decisions?: ReadinessDecision[]
  assumptions?: ReadinessAssumption[]
  sources?: ReadinessSource[]
  gateResults?: PreparationGateResult[]
  confirmation?: { confirmed: boolean; confirmedAt: number; confirmedBy: string; attemptId: string }
  acceptanceCriteriaConflict: boolean
}
export interface ReadinessCheck { allowed: boolean; reasons: string[] }

/** Pure quality gate used before entering Ready for Development. */
export function canConfirmDevelopmentReadiness(input: DevelopmentReadiness): ReadinessCheck {
  const reasons: string[] = []
  if (!input.functionalRequirements.trim()) reasons.push('missing_functional_requirements')
  if (!input.acceptanceCriteria.trim()) reasons.push('missing_acceptance_criteria')
  if (!input.testCases.some((testCase) => testCase.required)) reasons.push('missing_required_test_cases')
  for (const testCase of input.testCases) {
    if (!testCase.required) continue
    if (!testCase.id.trim()) reasons.push('missing_stable_id')
    if (!testCase.title.trim()) reasons.push(`missing_title:${testCase.id}`)
    if (input.schemaVersion === 2 && !testCase.description.trim()) reasons.push(`missing_description:${testCase.id}`)
    if (!testCase.preconditions.trim()) reasons.push(`missing_preconditions:${testCase.id}`)
    if (input.schemaVersion === 2 && !testCase.testData.trim()) reasons.push(`missing_test_data:${testCase.id}`)
    if (!testCase.steps.trim()) reasons.push(`missing_steps:${testCase.id}`)
    if (!testCase.expectedResult.trim()) reasons.push(`missing_expected_result:${testCase.id}`)
    if (input.schemaVersion === 2 && !testCase.automatable && (!testCase.notAutomatedReason.trim() || !testCase.alternativeManualVerification.trim())) reasons.push(`missing_manual_justification:${testCase.id}`)
  }
  if (!input.uiImpact) reasons.push('missing_ui_impact')
  if (input.uiImpact && input.uiImpact !== 'none') {
    if (input.affectedComponents.length === 0) reasons.push('missing_affected_components')
    for (const component of input.affectedComponents) {
      if (!component.storybookStoryId && (!component.exclusionReason.trim() || !component.alternativeVerification.trim() || !component.coverage || Object.keys(component.coverage).length === 0)) reasons.push(`missing_storybook_coverage:${component.id}`)
      if (component.reusable && input.uiImpact === 'new_components' && !component.storybookStoryId && !component.exclusionReason.trim()) reasons.push(`new_reusable_component_without_story:${component.id}`)
    }
  }
  if (input.acceptanceCriteriaConflict) reasons.push('acceptance_criteria_conflict')
  if (input.schemaVersion === 2) {
    if (!input.goal?.trim()) reasons.push('missing_goal')
    if (!input.scope?.length) reasons.push('missing_scope')
    if (!input.outOfScope?.length) reasons.push('missing_out_of_scope')
    if (!input.acceptanceCriteriaItems?.length) reasons.push('missing_verifiable_acceptance_criteria')
    for (const criterion of input.acceptanceCriteriaItems ?? []) {
      if (!criterion.id.trim() || !criterion.precondition.trim() || !criterion.action.trim() || !criterion.observableResult.trim()) reasons.push(`unverifiable_acceptance_criterion:${criterion.id || 'unknown'}`)
    }
    for (const question of input.openQuestions ?? []) if (question.material && !question.answer?.trim()) reasons.push(`open_material_question:${question.questionId}`)
    if ((input.contradictions ?? []).some((item) => item.trim())) reasons.push('unresolved_material_contradiction')
    for (const assumption of input.assumptions ?? []) if (assumption.material || !assumption.rationale.trim()) reasons.push(`invalid_assumption:${assumption.id}`)
    if (!(input.sources ?? []).length) reasons.push('missing_researched_sources')
    if (!(input.sources ?? []).some((source) => source.kind === 'knowledge' && source.status === 'available')) reasons.push('missing_knowledge_source')
    if (!(input.sources ?? []).some((source) => source.kind === 'code' && source.status === 'available')) reasons.push('missing_code_source')
    for (const source of input.sources ?? []) if (source.critical && source.status !== 'available') reasons.push(`critical_source_unavailable:${source.id}`)
  }
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)] }
}

export function developmentReadinessGateResults(input: DevelopmentReadiness): PreparationGateResult[] {
  const reasons = canConfirmDevelopmentReadiness(input).reasons
  const checks: Array<[string, (reason: string) => boolean]> = [
    ['structure_complete', (r) => r.startsWith('missing_')],
    ['material_questions_closed', (r) => r.startsWith('open_material_question:')],
    ['contradictions_resolved', (r) => r === 'acceptance_criteria_conflict' || r === 'unresolved_material_contradiction'],
    ['acceptance_criteria_verifiable', (r) => r.startsWith('unverifiable_acceptance_criterion:')],
    ['required_test_cases_complete', (r) => /^(missing_(stable_id|title|description|preconditions|test_data|steps|expected_result|required_test_cases)|missing_manual_justification)/.test(r)],
    ['ui_impact_sufficient', (r) => r.includes('storybook') || r.includes('affected_components') || r.includes('ui_impact') || r.includes('reusable_component')],
    ['assumptions_allowed', (r) => r.startsWith('invalid_assumption:')],
    ['sensitive_data_redacted', () => false]
  ]
  return checks.map(([code, matches]) => {
    const refs = reasons.filter(matches)
    return { code, status: refs.length ? 'fail' : 'pass', explanation: refs.length ? refs.join(', ') : 'Проверка пройдена', refs }
  })
}

/** Gate for leaving integration-test creation. */
export function canCompleteAutomation(testCases: readonly TestCaseDefinition[], commitSha: string): ReadinessCheck {
  const reasons: string[] = []
  for (const testCase of testCases) {
    if (!testCase.required) continue
    const currentLinks = testCase.automationLinks.filter((link) => link.commitSha === commitSha && link.path.trim())
    if (testCase.automatable && currentLinks.length === 0) reasons.push(`missing_automation:${testCase.id}`)
    if (!testCase.automatable && (!testCase.notAutomatedReason.trim() || !testCase.alternativeManualVerification.trim())) {
      reasons.push(`missing_manual_alternative:${testCase.id}`)
    }
  }
  return { allowed: reasons.length === 0, reasons }
}
export const QA_RUN_STAGES = ['component_qa', 'integration_tests', 'automated_qa'] as const
export type QaRunStage = typeof QA_RUN_STAGES[number]
export type QaStageRunKind = 'componentQaRun' | 'integrationTestsRun' | 'automatedQaRun'
export type QaStageRunStatus = 'queued' | 'running' | 'awaiting_input' | 'success' | 'gate_failed' | 'failed' | 'cancelled' | 'interrupted'
export interface QaStageProgress { current: number; total: number; label: string }
export interface QaStageLogEntry { seq: number; at: number; stream: 'out' | 'err' | 'system'; text: string }
export interface QaStageRun {
  id: string
  projectId: string
  taskId: string
  kind: QaStageRunKind
  stage: QaRunStage
  status: QaStageRunStatus
  attempt: number
  triggeredBy: string
  branch: string
  commitSha: string
  llmEngineId: string | null
  llmProvider: LlmProvider
  llmModel: string
  currentStep: string
  progress: QaStageProgress
  log: QaStageLogEntry[]
  result: Record<string, unknown> | null
  gateReasons: string[]
  error: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  canCancel: boolean
  canRetry: boolean
}
export interface ComponentQaStageRun extends QaStageRun { kind: 'componentQaRun'; stage: 'component_qa' }
export interface IntegrationTestsRun extends QaStageRun { kind: 'integrationTestsRun'; stage: 'integration_tests' }
export interface AutomatedQaRun extends QaStageRun { kind: 'automatedQaRun'; stage: 'automated_qa' }
export type AnyQaStageRun = ComponentQaStageRun | IntegrationTestsRun | AutomatedQaRun
export const QA_RUN_KIND: Record<QaRunStage, QaStageRunKind> = {
  component_qa: 'componentQaRun',
  integration_tests: 'integrationTestsRun',
  automated_qa: 'automatedQaRun'
}
export function isActiveQaStageRun(status: QaStageRunStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'awaiting_input'
}
export type ComponentQaRunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'blocked' | 'cancelled' | 'stale' | 'skipped'
export type ComponentQaFailureClassification = 'implementation_defect' | 'infrastructure'
export type ComponentQaScenarioStatus = 'pending' | 'passed' | 'failed' | 'blocked' | 'not_applicable'
export interface ComponentQaScenarioSnapshot {
  testCase: TestCaseDefinition
  version: number
  semanticHash: string
  status: ComponentQaScenarioStatus
  actualResult: string
  diagnostic: string
}
export interface ComponentQaCommandResult {
  commandId: string
  name: string
  command: string
  exitCode: number | null
  durationMs: number
  status: 'pending' | 'running' | 'passed' | 'failed' | 'blocked' | 'cancelled'
  stdout: string
  stderr: string
  diagnostic: string
  artifacts: ComponentQaArtifact[]
}
export interface ComponentQaArtifact {
  id: string
  kind: 'report' | 'screenshot' | 'visual_diff' | 'storybook' | 'log'
  name: string
  url: string
  path: string
}
export interface ComponentQaRun {
  id: string
  projectId: string
  taskId: string
  developmentRunId: string
  linkedFixRunId: string | null
  branch: string
  commitSha: string
  attempt: number
  status: ComponentQaRunStatus
  uiImpact: UiImpact
  readinessRunId: string
  readinessVersion: string
  scenarios: ComponentQaScenarioSnapshot[]
  components: AffectedUiComponent[]
  commands: ComponentQaCommandResult[]
  artifacts: ComponentQaArtifact[]
  failureClassification: ComponentQaFailureClassification | null
  blockerReasons: string[]
  summary: string
  log: string
  storybookUrl: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  staleReason: string | null
  canCancel: boolean
  canRetry: boolean
}
export interface ComponentQaTaskState {
  activeRun: ComponentQaRun | null
  latestRun: ComponentQaRun | null
  runs: ComponentQaRun[]
  launchReasons: string[]
  canStart: boolean
  canComplete: boolean
  gateReasons: string[]
}
export interface ComponentQaGateInput {
  run: ComponentQaRun
  currentCommitSha: string
  currentReadinessVersion: string
  acceptanceCriteriaConflict: boolean
}
export function componentQaSemanticVersion(readiness: Pick<DevelopmentReadiness, 'testCases' | 'affectedComponents' | 'uiImpact' | 'acceptanceCriteriaConflict'>): string {
  const stable = JSON.stringify({
    uiImpact: readiness.uiImpact,
    conflict: readiness.acceptanceCriteriaConflict,
    tests: readiness.testCases.map((item) => ({
      id: item.id, title: item.title, description: item.description, preconditions: item.preconditions,
      testData: item.testData, steps: item.steps, expectedResult: item.expectedResult,
      required: item.required, testType: item.testType, automatable: item.automatable,
      notAutomatedReason: item.notAutomatedReason, alternativeManualVerification: item.alternativeManualVerification
    })),
    components: readiness.affectedComponents.map((item) => ({
      id: item.id, name: item.name, storybookStoryId: item.storybookStoryId, reusable: item.reusable,
      coverage: item.coverage, exclusionReason: item.exclusionReason, alternativeVerification: item.alternativeVerification
    }))
  })
  let hash = 2166136261
  for (let index = 0; index < stable.length; index++) {
    hash ^= stable.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
export function componentQaLaunchReasons(readiness: DevelopmentReadiness): string[] {
  if (readiness.uiImpact === 'none') return []
  const reasons: string[] = []
  if (!readiness.uiImpact) reasons.push('missing_ui_impact')
  if (!readiness.affectedComponents.length) reasons.push('missing_affected_components')
  const componentCases = readiness.testCases.filter((item) => item.testType === 'ui' || item.testType === 'automated' || item.testType === 'mixed')
  if (!componentCases.some((item) => item.required)) reasons.push('missing_required_component_scenarios')
  for (const component of readiness.affectedComponents) {
    if (!component.storybookStoryId) {
      if (!component.exclusionReason.trim()) reasons.push(`missing_exclusion_reason:${component.id}`)
      if (!component.alternativeVerification.trim()) reasons.push(`missing_alternative_verification:${component.id}`)
      if (!component.coverage || Object.keys(component.coverage).length === 0) reasons.push(`missing_storybook_coverage:${component.id}`)
      continue
    }
    if (!component.coverage) { reasons.push(`missing_storybook_coverage:${component.id}`); continue }
    const missing = Object.entries(component.coverage).filter(([, covered]) => !covered).map(([name]) => name)
    for (const name of missing) reasons.push(`missing_storybook_${name}:${component.id}`)
  }
  if (readiness.acceptanceCriteriaConflict) reasons.push('acceptance_criteria_conflict')
  return reasons
}
export function canCompleteComponentQa(input: ComponentQaGateInput): ReadinessCheck {
  const reasons: string[] = []
  const { run } = input
  if (run.status !== 'passed' && run.status !== 'skipped') reasons.push(`run_${run.status}`)
  if (run.staleReason || run.status === 'stale') reasons.push('run_stale')
  if (run.commitSha !== input.currentCommitSha) reasons.push('commit_sha_mismatch')
  if (run.readinessVersion !== input.currentReadinessVersion) reasons.push('scenario_version_mismatch')
  if (input.acceptanceCriteriaConflict) reasons.push('acceptance_criteria_conflict')
  if (run.uiImpact === 'none') {
    if (run.status !== 'skipped') reasons.push('ui_none_not_skipped')
    return { allowed: reasons.length === 0, reasons }
  }
  for (const scenario of run.scenarios) {
    if (scenario.testCase.required && scenario.status !== 'passed') reasons.push(`${scenario.status}:${scenario.testCase.id}`)
  }
  for (const component of run.components) {
    if (!component.storybookStoryId) {
      if (!component.exclusionReason.trim() || !component.alternativeVerification.trim() || !component.coverage || Object.keys(component.coverage).length === 0) reasons.push(`component_unverified:${component.id}`)
    } else if (!component.coverage || Object.values(component.coverage).some((covered) => !covered)) {
      reasons.push(`storybook_incomplete:${component.id}`)
    }
  }
  for (const command of run.commands) if (command.status !== 'passed' || command.exitCode !== 0) reasons.push(`command_failed:${command.commandId}`)
  if (run.blockerReasons.length) reasons.push('has_blockers')
  return { allowed: reasons.length === 0, reasons }
}

export type IntegrationTestRunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'blocked' | 'cancelled' | 'stale' | 'skipped'
export type IntegrationTestFailureClassification = 'implementation_defect' | 'infrastructure'
export interface IntegrationTestCommandResult {
  commandId: string
  name: string
  command: string
  exitCode: number | null
  durationMs: number
  status: 'pending' | 'running' | 'passed' | 'failed' | 'blocked' | 'cancelled'
  diagnostic: string
  stdout: string
  stderr: string
}
export interface IntegrationTestRun {
  id: string; projectId: string; taskId: string; developmentRunId: string
  linkedFixRunId: string | null; branch: string; commitSha: string; attempt: number
  status: IntegrationTestRunStatus; readinessRunId: string; snapshotVersion: string
  testCases: TestCaseDefinition[]; automationLinks: QaAutomationLink[]
  commands: IntegrationTestCommandResult[]; log: string
  failureClassification: IntegrationTestFailureClassification | null
  failureReason: string | null; blockerReasons: string[]; summary: string
  createdAt: number; startedAt: number | null; finishedAt: number | null
  staleReason: 'sha_changed' | 'snapshot_changed' | null
  canCancel: boolean; canRetry: boolean
}
export interface IntegrationTestTaskState {
  activeRun: IntegrationTestRun | null; latestRun: IntegrationTestRun | null
  runs: IntegrationTestRun[]; testCases: TestCaseDefinition[]
  launchReasons: string[]; canStart: boolean; canComplete: boolean; gateReasons: string[]
}
export function integrationTestSemanticVersion(testCases: readonly TestCaseDefinition[]): string {
  const stable = JSON.stringify(testCases.filter((item) => item.automatable).map((item) => ({
    id:item.id,title:item.title,description:item.description,preconditions:item.preconditions,
    testData:item.testData,steps:item.steps,expectedResult:item.expectedResult,required:item.required,
    testType:item.testType,automatable:item.automatable
  })))
  let hash = 2166136261
  for (let index=0; index<stable.length; index++) { hash ^= stable.charCodeAt(index); hash = Math.imul(hash,16777619) }
  return (hash>>>0).toString(16).padStart(8,'0')
}
export function integrationTestGate(run: IntegrationTestRun, currentSha: string, currentCases: readonly TestCaseDefinition[]): ReadinessCheck {
  const reasons:string[]=[]
  if (run.status!=='passed'&&run.status!=='skipped') reasons.push(`run_${run.status}`)
  if (run.status==='stale'||run.staleReason) reasons.push('run_stale')
  if (run.commitSha!==currentSha) reasons.push('commit_sha_mismatch')
  if (run.snapshotVersion!==integrationTestSemanticVersion(currentCases)) reasons.push('snapshot_version_mismatch')
  for (const command of run.commands) if (command.status!=='passed'||command.exitCode!==0) reasons.push(`command_failed:${command.commandId}`)
  if (run.blockerReasons.length) reasons.push('has_blockers')
  reasons.push(...canCompleteAutomation(currentCases,currentSha).reasons)
  return {allowed:reasons.length===0,reasons:[...new Set(reasons)]}
}
export function validateIntegrationTestDiff(paths: readonly string[], patterns: readonly RegExp[] = [
  /(^|\/)(__tests__|tests?|test|integration)(\/|$)/i,
  /\.(test|spec)\.[cm]?[jt]sx?$/i
]): string[] {
  return paths.filter((path)=>!patterns.some((pattern)=>pattern.test(path)))
}

export type QaResultStatus = 'not_tested' | 'in_progress' | 'passed' | 'failed' | 'blocked' | 'not_applicable' | 'stale'
export const QA_RESULT_STATUSES: QaResultStatus[] = ['not_tested', 'in_progress', 'passed', 'failed', 'blocked', 'not_applicable', 'stale']
export type QaSessionStatus = 'active' | 'passed' | 'failed' | 'blocked' | 'stale'
export type QaIssueClassification = 'implementation_defect' | 'requirement_change' | 'environment_problem' | 'test_data_problem' | 'needs_decision'
export type QaSeverity = 'blocker' | 'critical' | 'major' | 'minor' | 'cosmetic'
export type QaFrequency = 'always' | 'often' | 'sometimes' | 'once' | 'unknown'
export type QaBlockerType = 'environment' | 'test_data' | 'access' | 'dependency' | 'decision' | 'other'

export interface AcceptanceCriterionSnapshot {
  title: string; description: string; preconditions: string; steps: string
  testData: string; expectedResult: string; required: boolean; testType: QaCriterionTestType
}
export interface AcceptanceCriterion extends AcceptanceCriterionSnapshot {
  id: string; taskId: string; order: number; currentVersion: number; active: boolean
  author: string; createdAt: number; updatedAt: number
}
export interface AcceptanceCriterionVersion extends AcceptanceCriterionSnapshot {
  criterionId: string; version: number; author: string; reason: string
  createdAt: number; supersededBy: number | null
}
export interface QaAttachment {
  id: string; resultId: string; uploadId: string; name: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; size: number
  width: number | null; height: number | null; caption: string
  author: string; createdAt: number; commitSha: string
}
export interface QaIssue {
  id: string; resultId: string; classification: QaIssueClassification
  severity: QaSeverity; frequency: QaFrequency; reproduction: string
  proposedRoute: 'development' | 'ready' | 'decision_required' | 'manual_qa'
  requirementProposal: string; resolution: string; linkedFixRunId: string | null; createdAt: number
}
export interface QaCriterionResult {
  id: string; sessionId: string; criterionId: string; criterionVersion: number
  status: QaResultStatus; draft: boolean; testerId: string | null; assigneeId: string | null
  startedAt: number | null; finishedAt: number | null; branch: string; commitSha: string
  previewId: string | null; previewSha: string | null; appUrl: string | null; storybookUrl: string | null
  testDataScenario: string; executedSteps: string; expectedResult: string; actualResult: string
  comment: string; environment: string; blockerReason: string; blockerType: QaBlockerType | null
  blockerOwner: string | null; notApplicableReason: string; revision: number
  attachments: QaAttachment[]; issue: QaIssue | null; updatedAt: number
}
export interface QaSession {
  id: string; taskId: string; projectId: string; branch: string; commitSha: string
  testRunId: string; previewId: string | null; previewSha: string | null
  appUrl: string | null; storybookUrl: string | null; testDataScenario: string
  criteriaSnapshot: Array<{ criterionId: string; version: number; required: boolean }>
  status: QaSessionStatus; testerId: string | null; initiatedBy: string
  startedAt: number; finishedAt: number | null; staleReason: string | null; summary: string
  additionalIssues?: string; linkedFixRunId?: string | null; results: QaCriterionResult[]
}
/** Пред-разработческая подготовка задачи — отдельна от подготовки ручного QA. */
export const TASK_PREPARATION_STATUSES = ['queued', 'running', 'waiting_for_answer', 'validating', 'completed', 'failed', 'cancelled', 'blocked', 'success'] as const
export type TaskPreparationStatus = typeof TASK_PREPARATION_STATUSES[number]
export const TASK_PREPARATION_PHASES = ['initialization', 'knowledge_research', 'hierarchy_research', 'related_tasks_research', 'code_research', 'tests_research', 'storybook_research', 'clarification', 'brief_generation', 'readiness_validation', 'persistence', 'completed'] as const
export type TaskPreparationPhase = typeof TASK_PREPARATION_PHASES[number]
export interface PreparationGateResult { code: string; status: 'pass' | 'fail'; explanation: string; refs: string[] }
export interface PreparationEvent {
  eventId: string; attemptId: string; sequence: number; timestamp: number
  type: string; phase: TaskPreparationPhase; text: string; data?: Record<string, unknown>
  stepId?: string | null
  stream?: 'stdout' | 'stderr' | 'system'
}
export type TaskPreparationStepStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'
export interface TaskPreparationStep {
  id: string
  name: string
  ordinal: number
  status: TaskPreparationStepStatus
  startedAt: number | null
  finishedAt: number | null
  durationMs: number | null
  error: string | null
  log: PreparationEvent[]
}
export interface PreparationQuestion {
  questionId: string; attemptId: string; text: string; material: boolean
  status: 'open' | 'answered'; answer: string | null; askedAt: number
  answeredAt: number | null; answeredBy: string | null
}
export interface PreparationAnswerResult { accepted: boolean; alreadyAnswered: boolean; question: PreparationQuestion }
/** Явное серверное состояние вопроса подготовки, требующего участия пользователя. */
export interface PreparationClarificationNotification {
  questionId: string
  attemptId: string
  projectId: string
  projectName: string
  taskId: string
  taskTitle: string
  text: string
  askedAt: number
  dismissedAt: number | null
}
export interface TaskPreparationLlmSelection {
  machineId?: string
  llmEngineId?: string | null
  provider: 'claude' | 'codex'
  model: string
}
export interface TaskPreparationRun {
  id: string
  attemptId?: string
  projectId: string
  taskId: string
  taskKey?: string
  status: TaskPreparationStatus
  phase?: TaskPreparationPhase
  attempt: number
  attemptNumber?: number
  maxAttempts: number
  machineId?: string | null
  machineName?: string | null
  llmEngineId?: string | null
  provider?: 'claude' | 'codex'
  model?: string
  profileId?: string
  log: string
  events?: PreparationEvent[]
  steps?: TaskPreparationStep[]
  questions?: PreparationQuestion[]
  error: string | null
  readiness: DevelopmentReadiness | null
  gateReasons: string[]
  gateResults?: PreparationGateResult[]
  createdAt: number
  startedAt?: number | null
  finishedAt: number | null
  durationMs?: number
  canRetry: boolean
  canCancel: boolean
  canAnswer?: boolean
}
const PREPARATION_SECRET_PATTERNS: RegExp[] = [
  /\b(?:authorization|proxy-authorization)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi,
  /\b(?:api[_-]?key|token|secret|password|passwd|cookie|set-cookie)\s*[:=]\s*[^\s,;]+/gi,
  /-----BEGIN [^-]*(?:PRIVATE KEY|OPENSSH KEY)-----[\s\S]*?-----END [^-]*(?:PRIVATE KEY|OPENSSH KEY)-----/gi,
  /\b(?:sk|ghp|github_pat|xox[baprs])-[-A-Za-z0-9_]{12,}\b/g
]
export function redactPreparationText(value: unknown): string {
  let text = typeof value === 'string' ? value : String(value ?? '')
  for (const pattern of PREPARATION_SECRET_PATTERNS) text = text.replace(pattern, '[REDACTED]')
  return text
}
export function safePreparationKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'TASK'
}
export function preparationExportFilename(taskKey: string, attemptNumber: number, timestamp: number, ext: 'json' | 'md' | 'txt'): string {
  return `${safePreparationKey(taskKey)}-preparation-attempt-${Math.max(1, Math.trunc(attemptNumber))}-${new Date(timestamp).toISOString().slice(0, 10)}.${ext}`
}

export type QaPreparationStatus = 'running' | 'success' | 'failed'
export interface QaPreparationAttempt {
  attempt: number; rawResponse: string; error: string | null; status: 'success' | 'failed'
}
export interface QaPreparationRun {
  id: string; taskId: string; branch: string; commitSha: string; status: QaPreparationStatus
  attempt: number; maxAttempts: number; error: string | null; attempts: QaPreparationAttempt[]
  createdAt: number; finishedAt: number | null; canRetry: boolean; log?: string
}
export interface QaTaskState {
  criteria: AcceptanceCriterion[]; versions: AcceptanceCriterionVersion[]
  sessions: QaSession[]; activeSession: QaSession | null; preparation?: QaPreparationRun | null; canEdit?: boolean
}
export interface QaProgress {
  total: number; passed: number; failed: number; blocked: number; notTested: number
  inProgress: number; notApplicable: number; stale: number
}
export function qaProgress(session: QaSession): QaProgress {
  const p: QaProgress = { total: session.results.length, passed: 0, failed: 0, blocked: 0, notTested: 0, inProgress: 0, notApplicable: 0, stale: 0 }
  for (const result of session.results) {
    if (result.status === 'passed') p.passed++
    else if (result.status === 'failed') p.failed++
    else if (result.status === 'blocked') p.blocked++
    else if (result.status === 'not_tested') p.notTested++
    else if (result.status === 'in_progress') p.inProgress++
    else if (result.status === 'not_applicable') p.notApplicable++
    else p.stale++
  }
  return p
}
export interface QaCompletionCheck { allowed: boolean; reasons: string[] }
export function canCompleteQa(session: QaSession): QaCompletionCheck {
  const reasons: string[] = []
  if (session.status !== 'active') reasons.push('session_not_active')
  if (session.staleReason) reasons.push('session_stale')
  if (session.previewId && session.previewSha !== session.commitSha) reasons.push('preview_sha_mismatch')
  const byCriterion = new Map(session.results.map((r) => [`${r.criterionId}:${r.criterionVersion}`, r]))
  for (const item of session.criteriaSnapshot) {
    if (!item.required) continue
    const result = byCriterion.get(`${item.criterionId}:${item.version}`)
    if (!result) { reasons.push(`missing:${item.criterionId}`); continue }
    if (result.commitSha !== session.commitSha || result.previewSha !== session.previewSha) reasons.push(`stale_result:${item.criterionId}`)
    else if (result.status !== 'passed') reasons.push(`${result.status}:${item.criterionId}`)
  }
  for (const item of session.criteriaSnapshot) {
    if (item.required) continue
    const result = byCriterion.get(`${item.criterionId}:${item.version}`)
    if (!result || !['passed', 'not_applicable'].includes(result.status)) reasons.push(`${result?.status ?? 'missing'}:${item.criterionId}`)
  }
  if (session.results.some((result) => result.status === 'failed')) reasons.push('has_failed_tests')
  if (session.additionalIssues?.trim()) reasons.push('has_additional_issues')
  return { allowed: reasons.length === 0, reasons }
}
export type QaRequiredFields = Pick<QaCriterionResult, 'actualResult' | 'executedSteps' | 'expectedResult' | 'comment' | 'blockerReason' | 'blockerType' | 'blockerOwner' | 'notApplicableReason'>
export function validateQaResult(status: QaResultStatus, fields: QaRequiredFields): string[] {
  const missing: string[] = []
  if (status === 'failed') {
    if (!fields.comment.trim()) missing.push('comment')
  }
  if (status === 'blocked') {
    if (!fields.comment.trim()) missing.push('comment')
    if (!fields.blockerReason.trim()) missing.push('blockerReason')
    if (!fields.blockerType) missing.push('blockerType')
    if (!fields.blockerOwner?.trim()) missing.push('blockerOwner')
  }
  return missing
}
