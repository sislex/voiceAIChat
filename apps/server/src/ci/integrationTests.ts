import { AUTOMATION_MARKER, gateSignature, parseAutomationMarkers, validateIntegrationTestDiff, type IntegrationTestCommandResult, type IntegrationTestRun } from '@voicechat/shared'
import { shellQuote } from './executor.js'
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
    findPassedGateResult(commitSha: string, signature: string): { runKind: string; runId: string; createdAt: number } | null
    recordPassedGateResult(args: { projectId: string; taskId: string; commitSha: string; signature: string; commands: readonly string[]; runKind: string; runId: string }): void
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
  /** Адресная инвалидация панели этапа: без неё она опрашивала бы состояние по таймеру. */
  qaStageChanged?: (projectId: string, taskId: string) => void
  /**
   * Итог рана для автопрохода. `classification` отличает сбой окружения от
   * дефекта реализации: за чужой сбой карточку в доработку возвращать нельзя.
   */
  completed?: (runId: string, userId: string, passed: boolean, reason: string, classification?: 'implementation_defect' | 'infrastructure' | null) => void
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
        // Без этого уведомления автопроход не узнаёт, что этап кончился, и
        // board-событие просто запускает следующий такой же ран по кругу.
        deps.completed?.(runId, userId, false, 'Development workspace недоступен', 'infrastructure')
      }
      if (run) { deps.boardChanged?.(run.projectId); deps.qaStageChanged?.(run.projectId, run.taskId) }
      return
    }
    const controller = new AbortController()
    controllers.set(runId, controller)
    deps.db.markIntegrationTestRunning(runId)
    deps.boardChanged?.(run.projectId)
    deps.qaStageChanged?.(run.projectId, run.taskId)
    void (async () => {
      const startedAt = now(), deadline = startedAt + budgetMs, total = context.commands.length
      const commands: IntegrationTestCommandResult[] = []
      const inspect=async(script:string):Promise<{exitCode:number|null;timedOut:boolean;output:string}>=>{
        let output='';const remaining=deadline-now()
        const result=remaining>0?await deps.executor.run({agentId:context.agentId,script,workdir:context.workdir,env:{CI:'1'},timeoutMs:remaining},(chunk)=>{output+=chunk;deps.db.appendIntegrationTestLog(runId,chunk)},controller.signal):{exitCode:null,timedOut:true}
        return {...result,output}
      }
      const pathsFrom=(output:string)=>output.split(/\r?\n/).map((item)=>item.trim()).filter(Boolean)
      const mergeBase=await inspect(`git merge-base ${shellQuote(`origin/${context.ciBaseBranch}`)} HEAD`)
      if(controller.signal.aborted)return
      const mergeBaseSha=mergeBase.exitCode===0&&!mergeBase.timedOut?mergeBase.output.trim().split(/\s/)[0]??'':''
      let changed:string[]=[]
      if(mergeBaseSha){
        const branchDiff=await inspect(`git diff --name-only ${shellQuote(mergeBaseSha)} HEAD`)
        if(controller.signal.aborted)return
        if(branchDiff.exitCode===0&&!branchDiff.timedOut) changed=pathsFrom(branchDiff.output)
      }
      // Если origin/<base> недоступен, основной diff сломан или пуст, first-parent
      // сохраняет merge-aware разбор HEAD и не смешивает изменения второго parent.
      if(!changed.length){
        const fallback=await inspect('git diff-tree --no-commit-id --name-only -r -m --first-parent HEAD')
        if(controller.signal.aborted)return
        if(fallback.exitCode!==0||fallback.timedOut){
          const reason=fallback.timedOut?'command_timeout':'executor_disconnected'
          const summary='Не удалось определить изменённые файлы задачи через merge-base и first-parent diff'
          deps.db.finishIntegrationTestRun(userId,runId,{status:'blocked',commands:[],summary,failureClassification:'infrastructure',failureReason:reason,blockerReasons:[reason]})
          deps.completed?.(runId,userId,false,summary,'infrastructure')
          return
        }
        changed=pathsFrom(fallback.output)
      }
      if(!changed.length){
        const summary='Не удалось определить изменённые файлы задачи: merge-base diff и first-parent diff пусты'
        deps.db.finishIntegrationTestRun(userId,runId,{status:'blocked',commands:[],summary,failureClassification:'infrastructure',failureReason:'diff_parse_failed',blockerReasons:['diff_parse_failed']})
        deps.completed?.(runId,userId,false,summary,'infrastructure')
        return
      }
      // Многофайловый вывод разбирается по настоящим переводам строк; иначе
      // нетестовый файл мог скрыться внутри строки с допустимым тестовым путём.
      const invalid=validateIntegrationTestDiff(changed)
      if(invalid.length){
        const summary='Изменены нетестовые файлы: '+invalid.join(', ')
        deps.db.finishIntegrationTestRun(userId,runId,{status:'blocked',commands:[],summary,failureClassification:'implementation_defect',failureReason:'non_test_files_changed',blockerReasons:invalid.map((path)=>'non_test_file:'+path)})
        deps.completed?.(runId,userId,false,summary,'implementation_defect')
        return
      }
      const shaResult=await inspect('git rev-parse HEAD'),sha=shaResult.output.trim().split(/\s/)[0]??''
      if(!sha){deps.db.finishIntegrationTestRun(userId,runId,{status:'blocked',commands:[],summary:'Не удалось определить SHA тестового коммита',failureClassification:'infrastructure',failureReason:'executor_disconnected',blockerReasons:['executor_disconnected']});deps.completed?.(runId,userId,false,'Не удалось определить SHA тестового коммита','infrastructure');deps.boardChanged?.(run.projectId);return}
      // Покрытие берём из маркеров `@testCase <id>` в самих тестах: разработка
      // ставит их рядом с тестом, закрывающим кейс. Fallback на прежний синтез
      // («первый тестовый путь всем обязательным кейсам») остаётся для веток,
      // написанных до появления маркеров, но честным покрытием он не является.
      const testPath=changed.find((path)=>validateIntegrationTestDiff([path]).length===0)
      const markers=changed.length?await inspect(`grep -HoE '${AUTOMATION_MARKER}[[:space:]:]+[A-Za-z0-9._-]+' -- ${changed.map(shellQuote).join(' ')} || true`):{exitCode:0,timedOut:false,output:''}
      if(controller.signal.aborted)return
      const marked=parseAutomationMarkers(markers.output)
      const byTestId=new Map(marked.map((item)=>[item.testId,item.path]))
      const required=run.testCases.filter((item)=>item.required&&item.automatable)
      const covered=byTestId.size
        ? required.filter((item)=>byTestId.has(item.id)).map((item)=>({testId:item.id,path:byTestId.get(item.id)!}))
        : required.filter(()=>Boolean(testPath)).map((item)=>({testId:item.id,path:testPath!}))
      if(byTestId.size) deps.db.appendIntegrationTestLog(runId,`Покрытие по маркерам ${AUTOMATION_MARKER}: ${covered.length} из ${required.length} обязательных кейсов\n`)
      else if(required.length) deps.db.appendIntegrationTestLog(runId,`Маркеров ${AUTOMATION_MARKER} в тестах нет — покрытие синтезировано из диффа и требует ручной сверки\n`)
      if(required.length&&covered.length===0){
        const blockerReasons=required.map((item)=>`missing_automation:${item.id}`)
        const summary=`Не найдены тесты для обязательных automatable-кейсов: ${required.map((item)=>item.id).join(', ')}`
        deps.db.finishIntegrationTestRun(userId,runId,{status:'blocked',commands:[],summary,failureClassification:'implementation_defect',failureReason:'missing_automation',blockerReasons})
        deps.completed?.(runId,userId,false,summary,'implementation_defect')
        return
      }
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
      // Проверки этого коммита мог уже прогнать Component QA или прошлая попытка
      // — см. componentQa.ts, там же мотивация кэша.
      const signature = gateSignature(context.commands)
      const cached = deps.db.findPassedGateResult(sha || run.commitSha, signature)
      if (cached) {
        deps.db.appendIntegrationTestLog(runId, `Проверки этого коммита уже пройдены (${cached.runKind} ${cached.runId}) — результат переиспользован\n`)
        const reused = deps.db.getIntegrationTestRun(userId, runId)
        if (reused && reused.status === 'running') {
          deps.db.finishIntegrationTestRun(userId, runId, {
            status: 'passed',
            commands: [{ commandId: 'cache', name: 'Результат прошлого прогона', command: context.commands.join(' && '), exitCode: 0, durationMs: 0, status: 'passed', stdout: `Источник: ${cached.runKind} ${cached.runId}`, stderr: '', diagnostic: '' }],
            summary: 'Integration tests пройден (результат прошлого прогона того же коммита)',
            failureClassification: null,
            blockerReasons: []
          })
          deps.completed?.(runId, userId, true, 'Integration tests пройдены')
        }
        return
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
      if (passed) deps.db.recordPassedGateResult({ projectId: run.projectId, taskId: run.taskId, commitSha: sha || run.commitSha, signature, commands: context.commands, runKind: 'integration_tests', runId })
      deps.db.finishIntegrationTestRun(userId, runId, {
        status: passed ? 'passed' : infrastructure ? 'blocked' : 'failed',
        commands,
        summary: passed ? 'Integration tests пройден' : infrastructure ? `Integration tests заблокирован инфраструктурой: ${failedStage?.name ?? ''} (${failedStage?.diagnostic ?? ''})`.trim() : 'Integration tests выявил дефект реализации',
        failureClassification: passed ? null : infrastructure ? 'infrastructure' : 'implementation_defect',
        blockerReasons: infrastructure && failedStage ? [failedStage.diagnostic] : []
      })
      deps.completed?.(runId, userId, passed, passed ? 'Integration tests пройдены' : failedStage?.diagnostic || 'Integration tests failed', passed ? null : infrastructure ? 'infrastructure' : 'implementation_defect')
    })().catch((error) => {
      const current = deps.db.getIntegrationTestRun(userId, runId)
      if (current?.status === 'running') {
        deps.db.finishIntegrationTestRun(userId, runId, { status: 'blocked', commands: [], summary: String(error), failureClassification: 'infrastructure', blockerReasons: ['executor_error'] })
        deps.completed?.(runId, userId, false, String(error), 'infrastructure')
      }
    }).finally(() => { controllers.delete(runId); deps.boardChanged?.(run.projectId); deps.qaStageChanged?.(run.projectId, run.taskId) })
  }
  return { launch, cancel: (runId) => controllers.get(runId)?.abort() }
}
