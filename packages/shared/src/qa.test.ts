import { describe, expect, it } from 'vitest'
import { canCompleteAutomation, canCompleteComponentQa, canCompleteQa, canConfirmDevelopmentReadiness, componentQaLaunchReasons, componentQaSemanticVersion, integrationTestGate, integrationTestSemanticVersion, qaProgress, validateIntegrationTestDiff, validateQaResult, type ComponentQaRun, type DevelopmentReadiness, type IntegrationTestRun, type QaSession, type TestCaseDefinition } from './qa'

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
  it('requires actually researched knowledge and code sources for schema v2', () => {
    const input: DevelopmentReadiness = {
      ...ready(),
      schemaVersion: 2,
      goal: 'Goal',
      scope: ['In scope'],
      outOfScope: ['Out of scope'],
      acceptanceCriteriaItems: [{ id: 'AC-1', title: 'Criterion', precondition: 'Given', action: 'When', observableResult: 'Then' }],
      sources: []
    }
    expect(canConfirmDevelopmentReadiness(input).reasons).toEqual(expect.arrayContaining([
      'missing_researched_sources', 'missing_knowledge_source', 'missing_code_source'
    ]))
    input.sources = [
      { id: 'kb', kind: 'knowledge' as const, status: 'available' as const, summary: 'Read', refs: ['task-preparation'], critical: true },
      { id: 'code', kind: 'code' as const, status: 'available' as const, summary: 'Read', refs: ['qa.ts'], critical: true }
    ]
    expect(canConfirmDevelopmentReadiness(input).allowed).toBe(true)
    input.sources[1] = { ...input.sources[1], status: 'absent', summary: 'Файл не найден' }
    expect(canConfirmDevelopmentReadiness(input).reasons).toEqual(expect.arrayContaining([
      'missing_code_source', 'critical_source_unavailable:code'
    ]))
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

describe('component QA gate', () => {
  const readiness = (): DevelopmentReadiness => ({
    functionalRequirements: 'UI', acceptanceCriteria: 'Works', testCases: [testCase()],
    uiImpact: 'existing_components', acceptanceCriteriaConflict: false,
    affectedComponents: [{ id: 'button', name: 'Button', storybookStoryId: 'ui-button--default', reusable: true,
      coverage: { stories:true, states:true, fixtures:true, playFunctions:true, domTests:true, accessibility:true, visual:true },
      exclusionReason:'', alternativeVerification:'' }]
  })
  const run = (value = readiness()): ComponentQaRun => ({
    id:'cq1',projectId:'p1',taskId:'t1',developmentRunId:'dev1',linkedFixRunId:null,branch:'feature',commitSha:'abc',
    attempt:1,status:'passed',uiImpact:value.uiImpact!,readinessRunId:'prep1',readinessVersion:componentQaSemanticVersion(value),
    scenarios:value.testCases.map((item)=>({testCase:item,version:1,semanticHash:'h',status:'passed',actualResult:'ok',diagnostic:''})),
    components:value.affectedComponents,commands:[{commandId:'storybook',name:'Storybook',command:'npm run test-storybook',
      exitCode:0,durationMs:10,status:'passed',stdout:'ok',stderr:'',diagnostic:'',artifacts:[]}],
    artifacts:[],failureClassification:null,blockerReasons:[],summary:'ok',log:'',storybookUrl:null,
    createdAt:1,startedAt:1,finishedAt:2,staleReason:null,canCancel:false,canRetry:false
  })
  it('blocks missing components, scenarios and incomplete Storybook coverage', () => {
    const value = readiness()
    value.testCases = []
    value.affectedComponents[0].coverage!.visual = false
    expect(componentQaLaunchReasons(value)).toEqual(['missing_required_component_scenarios','missing_storybook_visual:button'])
  })
  it('accepts explicit Storybook exclusion with alternative verification', () => {
    const value = readiness()
    value.affectedComponents[0] = { ...value.affectedComponents[0], storybookStoryId:null, coverage:null, exclusionReason:'Canvas only', alternativeVerification:'DOM fixture test' }
    expect(componentQaLaunchReasons(value)).toEqual([])
  })
  it('pins SHA and semantic scenario version and requires every command/scenario', () => {
    const value = readiness(), current = run(value)
    expect(canCompleteComponentQa({run:current,currentCommitSha:'abc',currentReadinessVersion:componentQaSemanticVersion(value),acceptanceCriteriaConflict:false}).allowed).toBe(true)
    current.scenarios[0].status='failed'
    expect(canCompleteComponentQa({run:current,currentCommitSha:'def',currentReadinessVersion:'new',acceptanceCriteriaConflict:false}).reasons).toEqual(expect.arrayContaining(['commit_sha_mismatch','scenario_version_mismatch','failed:TC-1']))
  })
  it('only allows uiImpact none through an auditable skipped run', () => {
    const value = readiness(); value.uiImpact='none'; value.affectedComponents=[]
    const current=run(value); current.status='skipped'; current.uiImpact='none'; current.scenarios=[]; current.commands=[]
    expect(canCompleteComponentQa({run:current,currentCommitSha:'abc',currentReadinessVersion:componentQaSemanticVersion(value),acceptanceCriteriaConflict:false}).allowed).toBe(true)
  })
})

describe('integration test creation gate',()=>{
  it('accepts only test-directory or spec/test files in the committed diff',()=>{
    expect(validateIntegrationTestDiff(['apps/server/src/foo.ts','apps/server/src/foo.test.ts','tests/api.spec.ts'])).toEqual(['apps/server/src/foo.ts'])
  })
  it('pins the run to SHA and semantic automatable snapshot and reuses canCompleteAutomation',()=>{
    const cases=[testCase({automationLinks:[{testId:'TC-1',path:'tests/tc1.test.ts',updatedAt:1,commitSha:'abc'}]})]
    const run={id:'i1',projectId:'p1',taskId:'t1',developmentRunId:'d1',linkedFixRunId:null,branch:'feature',commitSha:'abc',attempt:1,status:'passed',readinessRunId:'prep',snapshotVersion:integrationTestSemanticVersion(cases),testCases:cases,automationLinks:cases[0].automationLinks,commands:[{commandId:'stage-1',name:'tests',command:'npm test',exitCode:0,durationMs:1,status:'passed',diagnostic:'',stdout:'',stderr:''}],log:'',failureClassification:null,failureReason:null,blockerReasons:[],summary:'ok',createdAt:1,startedAt:1,finishedAt:2,staleReason:null,canCancel:false,canRetry:false} satisfies IntegrationTestRun
    expect(integrationTestGate(run,'abc',cases).allowed).toBe(true)
    expect(integrationTestGate(run,'def',cases).reasons).toEqual(expect.arrayContaining(['commit_sha_mismatch','missing_automation:TC-1']))
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
    expect(validateQaResult('blocked', blank)).toEqual(['comment', 'blockerReason', 'blockerType', 'blockerOwner'])
    expect(validateQaResult('not_applicable', blank)).toEqual([])
  })
})
