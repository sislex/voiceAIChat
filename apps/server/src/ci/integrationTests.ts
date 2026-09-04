import { validateIntegrationTestDiff, type IntegrationTestCommandResult, type IntegrationTestRun } from '@voicechat/shared'
import type { CommandExecutor } from './types.js'
import type { CiStageExecutionContext } from '../db/database.js'
import { classifyCiInfraFailure, formatCiInfraFailure } from './infraErrors.js'
import { workspaceInstallCommand, WORKSPACE_INSTALL_TIMEOUT_MS } from './workspaceDeps.js'

export interface IntegrationTestFinishInput {
  status: 'passed' | 'failed' | 'blocked'
  commands: IntegrationTestCommandResult[]
  summary: string
  failureClassification?: IntegrationTestRun['failureClassification']
  failureReason?: string | null
  blockerReasons?: string[]
}

export interface IntegrationTestRunnerDeps {
  db: {
    integrationTestExecutionContext(runId: string): CiStageExecutionContext | null
    getIntegrationTestRun(userId: string, runId: string): IntegrationTestRun | null
    markIntegrationTestRunning(runId: string): void
    appendIntegrationTestLog(runId: string, chunk: string): void
    recordIntegrationAutomationLinks(userId:string,runId:string,links:Array<{testId:string;path:string}>,commitSha:string):IntegrationTestRun
    finishIntegrationTestRun(userId: string, runId: string, input: IntegrationTestFinishInput): IntegrationTestRun
  }
  executor: CommandExecutor
  /** Общий бюджет рана на все стадии; каждая стадия получает остаток. */
  timeoutMs?: number
  now?: () => number
  boardChanged?: (projectId: string) => void
  completed?: (runId: string, userId: string, passed: boolean, reason: string) => void
}

export interface IntegrationTestRunner {
  launch(runId: string, userId: string): void
  cancel(runId: string): void
}

/** Исполнение Integration tests-рана: стадии из testStages последовательно через
 *  ciExecutor с CI=1, отдельная запись commands на каждую стадию, единый
 *  потоковый лог. Первый ненулевой код прерывает оставшиеся стадии. */
export function createIntegrationTestRunner(deps: IntegrationTestRunnerDeps): IntegrationTestRunner {
  const controllers = new Map<string, AbortController>()
  const now = deps.now ?? Date.now
  const budgetMs = deps.timeoutMs ?? 30 * 60_000
  const launch = (runId: string, userId: string): void => {
    if (controllers.has(runId)) return
    const context = deps.db.integrationTestExecutionContext(runId)
    const run = deps.db.getIntegrationTestRun(userId, runId)
    if (!context || !run) {
      if (run) {
        deps.db.markIntegrationTestRunning(runId)
        deps.db.finishIntegrationTestRun(userId, runId, { status: 'blocked', commands: [], summary: 'Development workspace недоступен', failureClassification: 'infrastructure', blockerReasons: ['workspace_unavailable'] })
      }
      if (run) deps.boardChanged?.(run.projectId)
      return
    }
    const controller = new AbortController()
    controllers.set(runId, controller)
    deps.db.markIntegrationTestRunning(runId)
    deps.boardChanged?.(run.projectId)
    void (async () => {
      const startedAt = now(), deadline = startedAt + budgetMs, total = context.commands.length
      const commands: IntegrationTestCommandResult[] = []
      const inspect=async(script:string):Promise<{exitCode:number|null;timedOut:boolean;output:string}>=>{
        let output='';const remaining=deadline-now()
        const result=remaining>0?await deps.executor.run({agentId:context.agentId,script,workdir:context.workdir,env:{CI:'1'},timeoutMs:remaining},(chunk)=>{output+=chunk;deps.db.appendIntegrationTestLog(runId,chunk)},controller.signal):{exitCode:null,timedOut:true}
        return {...result,output}
      }
      const diff=await inspect('git diff-tree --no-commit-id --name-only -r HEAD')
      if(controller.signal.aborted)return
      if(diff.exitCode!==0||diff.timedOut){deps.db.finishIntegrationTestRun(userId,runId,{status:'blocked',commands:[],summary:'Не удалось проверить git diff',failureClassification:'infrastructure',failureReason:diff.timedOut?'command_timeout':'executor_disconnected',blockerReasons:[diff.timedOut?'command_timeout':'executor_disconnected']});return}
      const changed=diff.output.split(/\\r?\\n/).map((item)=>item.trim()).filter(Boolean),invalid=validateIntegrationTestDiff(changed)
      if(invalid.length){deps.db.finishIntegrationTestRun(userId,runId,{status:'blocked',commands:[],summary:'Изменены нетестовые файлы: '+invalid.join(', '),failureClassification:'implementation_defect',failureReason:'non_test_files_changed',blockerReasons:invalid.map((path)=>'non_test_file:'+path)});return}
      const shaResult=await inspect('git rev-parse HEAD'),sha=shaResult.output.trim().split(/\\s/)[0]??''
      if(!sha){deps.db.finishIntegrationTestRun(userId,runId,{status:'blocked',commands:[],summary:'Не удалось определить SHA тестового коммита',failureClassification:'infrastructure',failureReason:'executor_disconnected',blockerReasons:['executor_disconnected']});return}
      const testPath=changed.find((path)=>validateIntegrationTestDiff([path]).length===0)
      const covered=run.testCases.filter((item)=>item.required&&item.automatable&&testPath).map((item)=>({testId:item.id,path:testPath!}))
      deps.db.recordIntegrationAutomationLinks(userId,runId,covered,sha)
      let failedStage: IntegrationTestCommandResult | null = null
      let infrastructure = false
      // Как и в Component QA: checkout приходит от development-рана, зависимости
      // ставим сами и тем же кэшем задачи (см. workspaceDeps.ts).
      const runStage = async (script: string, timeoutMs: number): Promise<{ record: IntegrationTestCommandResult; passed: boolean; infrastructure: boolean } | null> => {
        const stageStartedAt = now(), remainingMs = Math.min(timeoutMs, deadline - stageStartedAt)
        deps.db.appendIntegrationTestLog(runId, `$ ${script}\n`)
        let stdout = ''
        const result = remainingMs > 0
          ? await deps.executor.run({ agentId: context.agentId, script, workdir: context.workdir, env: { CI: '1' }, timeoutMs: remainingMs }, (chunk) => {
              stdout = (stdout + chunk).slice(-500000)
              deps.db.appendIntegrationTestLog(runId, chunk)
            }, controller.signal)
          : { exitCode: null, timedOut: true }
        if (controller.signal.aborted) return null
        const passed = result.exitCode === 0 && !result.timedOut
        const infra = passed ? null : classifyCiInfraFailure({ exitCode: result.exitCode, output: stdout })
        if (infra) deps.db.appendIntegrationTestLog(runId, formatCiInfraFailure(infra))
        const stageInfrastructure = result.timedOut || result.exitCode == null || infra != null
        const diagnostic = result.timedOut ? 'command_timeout' : result.exitCode == null ? 'executor_disconnected' : passed ? '' : infra ? infra.kind : 'non_zero_exit'
        return { record: { commandId: '', name: '', command: script, exitCode: result.exitCode, durationMs: now() - stageStartedAt, status: passed ? 'passed' : stageInfrastructure ? 'blocked' : 'failed', stdout, stderr: '', diagnostic }, passed, infrastructure: stageInfrastructure }
      }
      const installed = await runStage(workspaceInstallCommand(context.npmCacheDir), WORKSPACE_INSTALL_TIMEOUT_MS)
      if (!installed) return
      commands.push({ ...installed.record, commandId: 'install', name: 'Установка зависимостей' })
      if (!installed.passed) { failedStage = commands[0]; infrastructure = installed.infrastructure }
      for (let index = 0; !failedStage && index < total; index++) {
        const stage = await runStage(context.commands[index], deadline - now())
        if (!stage) return
        const record: IntegrationTestCommandResult = { ...stage.record, commandId: `stage-${index + 1}`, name: total > 1 ? `Стадия ${index + 1} из ${total}` : 'Integration tests' }
        commands.push(record)
        if (!stage.passed) { failedStage = record; infrastructure = stage.infrastructure }
      }
      const current = deps.db.getIntegrationTestRun(userId, runId)
      if (!current || current.status !== 'running') return
      const passed = !failedStage
      deps.db.finishIntegrationTestRun(userId, runId, {
        status: passed ? 'passed' : infrastructure ? 'blocked' : 'failed',
        commands,
        summary: passed ? 'Integration tests пройден' : infrastructure ? `Integration tests заблокирован инфраструктурой: ${failedStage?.name ?? ''} (${failedStage?.diagnostic ?? ''})`.trim() : 'Integration tests выявил дефект реализации',
        failureClassification: passed ? null : infrastructure ? 'infrastructure' : 'implementation_defect',
        blockerReasons: infrastructure && failedStage ? [failedStage.diagnostic] : []
      })
      deps.completed?.(runId, userId, passed, passed ? 'Integration tests пройдены' : failedStage?.diagnostic || 'Integration tests failed')
    })().catch((error) => {
      const current = deps.db.getIntegrationTestRun(userId, runId)
      if (current?.status === 'running') deps.db.finishIntegrationTestRun(userId, runId, { status: 'blocked', commands: [], summary: String(error), failureClassification: 'infrastructure', blockerReasons: ['executor_error'] })
    }).finally(() => { controllers.delete(runId); deps.boardChanged?.(run.projectId) })
  }
  return { launch, cancel: (runId) => controllers.get(runId)?.abort() }
}
