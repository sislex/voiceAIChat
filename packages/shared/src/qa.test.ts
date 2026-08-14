import { describe, expect, it } from 'vitest'
import { canCompleteAutomation, canCompleteQa, canConfirmDevelopmentReadiness, qaProgress, validateQaResult, type DevelopmentReadiness, type QaSession, type TestCaseDefinition } from './qa'

function session(statuses: Array<'not_tested' | 'in_progress' | 'passed' | 'failed' | 'blocked' | 'not_applicable' | 'stale'>): QaSession {
  return {
    id: 's1', taskId: 't1', projectId: 'p1', branch: 'feature', commitSha: 'abc',
    testRunId: 'tr1', previewId: 'pr1', previewSha: 'abc', appUrl: null,
    storybookUrl: null, testDataScenario: '', status: 'active', testerId: 'qa',
    initiatedBy: 'qa', startedAt: 1, finishedAt: null, staleReason: null, summary: '',
    criteriaSnapshot: statuses.map((_, i) => ({ criterionId: `c${i}`, version: 1, required: true })),
    results: statuses.map((status, i) => ({
      id: `r${i}`, sessionId: 's1', criterionId: `c${i}`, criterionVersion: 1,
      status, draft: false, testerId: 'qa', assigneeId: null, startedAt: 1, finishedAt: 2,
      branch: 'feature', commitSha: 'abc', previewId: 'pr1', previewSha: 'abc',
      appUrl: null, storybookUrl: null, testDataScenario: '', executedSteps: 'steps',
      expectedResult: 'expected', actualResult: 'actual', comment: '', environment: '',
      blockerReason: status === 'blocked' ? 'offline' : '', blockerType: status === 'blocked' ? 'environment' : null,
      blockerOwner: status === 'blocked' ? 'ops' : null,
      notApplicableReason: status === 'not_applicable' ? 'not in this environment' : '',
      revision: 1, attachments: [], issue: null, updatedAt: 2
    }))
  }
}
const testCase = (patch: Partial<TestCaseDefinition> = {}): TestCaseDefinition => ({
  id: 'TC-1', title: 'Scenario', description: 'Goal', preconditions: 'Signed in',
  testData: 'Fixture A', steps: 'Open page', expectedResult: 'Page is visible',
  required: true, testType: 'ui', automatable: true, automationLinks: [],
  notAutomatedReason: '', alternativeManualVerification: '', comments: '', ...patch
})

describe('development readiness gate', () => {
  const ready = (): DevelopmentReadiness => ({
    functionalRequirements: 'Requirement', acceptanceCriteria: 'Criterion',
    testCases: [testCase()], uiImpact: 'none', affectedComponents: [],
    acceptanceCriteriaConflict: false
  })
  it('rejects incomplete required cases and undefined UI impact', () => {
    const input = ready()
    input.testCases[0].expectedResult = ''
    input.uiImpact = null
    expect(canConfirmDevelopmentReadiness(input).reasons).toEqual([
      'missing_expected_result:TC-1', 'missing_ui_impact'
    ])
  })
  it('requires Storybook coverage or an explicit alternative for UI work', () => {
    const input = ready()
    input.uiImpact = 'new_components'
    input.affectedComponents = [{
      id: 'button', name: 'Button', storybookStoryId: null, reusable: true,
      coverage: null, exclusionReason: '', alternativeVerification: ''
    }]
    expect(canConfirmDevelopmentReadiness(input).allowed).toBe(false)
  })
  it('requires a current-SHA Playwright link or a documented manual alternative', () => {
    expect(canCompleteAutomation([testCase()], 'sha-1').reasons).toEqual(['missing_automation:TC-1'])
    expect(canCompleteAutomation([testCase({
      automatable: false, notAutomatedReason: 'Hardware only',
      alternativeManualVerification: 'Verify on device'
    })], 'sha-1').allowed).toBe(true)
  })
})

describe('manual QA gate', () => {
  it.each([
    [['passed'], true],
    [['not_applicable'], false],
    [['passed', 'not_applicable'], false],
    [['not_tested'], false],
    [['in_progress'], false],
    [['failed'], false],
    [['blocked'], false],
    [['stale'], false]
  ] as const)('%j -> %s', (statuses, allowed) => {
    expect(canCompleteQa(session([...statuses])).allowed).toBe(allowed)
  })
  it('rejects stale SHA and preview', () => {
    const value = session(['passed'])
    value.results[0].commitSha = 'old'
    expect(canCompleteQa(value).reasons).toContain('stale_result:c0')
    value.results[0].commitSha = 'abc'
    value.previewSha = 'old'
    expect(canCompleteQa(value).reasons).toContain('preview_sha_mismatch')
  })
  it('counts every server status', () => {
    expect(qaProgress(session(['passed', 'failed', 'blocked', 'not_tested', 'in_progress', 'not_applicable', 'stale']))).toEqual({
      total: 7, passed: 1, failed: 1, blocked: 1, notTested: 1, inProgress: 1, notApplicable: 1, stale: 1
    })
  })
  it('requires structured failure, blocker and N/A fields', () => {
    const blank = { actualResult: '', executedSteps: '', expectedResult: '', comment: '', blockerReason: '', blockerType: null, blockerOwner: null, notApplicableReason: '' }
    expect(validateQaResult('failed', blank)).toEqual(['comment'])
    expect(validateQaResult('blocked', blank)).toEqual(['blockerReason', 'blockerType', 'blockerOwner'])
    expect(validateQaResult('not_applicable', blank)).toEqual([])
  })
})
