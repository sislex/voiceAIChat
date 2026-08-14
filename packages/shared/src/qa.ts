// Структурированное ручное QA: общий контракт и чистые правила допуска к merge.
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
  coverage: StorybookCoverage | null
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
export interface DevelopmentReadiness {
  functionalRequirements: string
  acceptanceCriteria: string
  testCases: TestCaseDefinition[]
  uiImpact: UiImpact | null
  affectedComponents: AffectedUiComponent[]
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
    if (!testCase.preconditions.trim()) reasons.push(`missing_preconditions:${testCase.id}`)
    if (!testCase.steps.trim()) reasons.push(`missing_steps:${testCase.id}`)
    if (!testCase.expectedResult.trim()) reasons.push(`missing_expected_result:${testCase.id}`)
  }
  if (!input.uiImpact) reasons.push('missing_ui_impact')
  if (input.uiImpact && input.uiImpact !== 'none') {
    if (input.affectedComponents.length === 0) reasons.push('missing_affected_components')
    for (const component of input.affectedComponents) {
      if (!component.storybookStoryId && (!component.exclusionReason.trim() || !component.alternativeVerification.trim())) {
        reasons.push(`missing_storybook_coverage:${component.id}`)
      }
      if (component.reusable && input.uiImpact === 'new_components' && !component.storybookStoryId && !component.exclusionReason.trim()) {
        reasons.push(`new_reusable_component_without_story:${component.id}`)
      }
    }
  }
  if (input.acceptanceCriteriaConflict) reasons.push('acceptance_criteria_conflict')
  return { allowed: reasons.length === 0, reasons }
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
    if (!fields.blockerReason.trim()) missing.push('blockerReason')
    if (!fields.blockerType) missing.push('blockerType')
    if (!fields.blockerOwner?.trim()) missing.push('blockerOwner')
  }
  return missing
}
