import type { MergeCheck, MergeRun, MergeStage, MergeStageRecord, ServerMessage } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { CommandExecutor } from '../ci/types.js'
import { shellQuote } from '../ci/executor.js'

export interface MergeRunManagerDeps { db: VoiceChatDb; executor: CommandExecutor; isOnline(id:string):boolean; broadcast(message:ServerMessage,userId:string):void; boardChanged(projectId:string):void; now?:()=>number }
const terminal = new Set(['success','failed','cancelled','decision_required'])
const validSha = /^[0-9a-f]{40}$/i
const validBranch = /^(?!-)(?!.*\.\.)(?!.*[~^:?*\[\]\\])[A-Za-z0-9._/-]+$/

export class MergeRunManager {
  private active = new Map<string,AbortController>()
  private now:()=>number
  constructor(private deps:MergeRunManagerDeps){ this.now=deps.now??Date.now }
  start(run:MergeRun):void {
    if(this.active.has(run.id)||terminal.has(run.status)||this.active.size>0)return
    const ctl=new AbortController(); this.active.set(run.id,ctl)
    setTimeout(()=>{ void this.execute(run.id,ctl).catch(()=>{}).finally(()=>{ this.active.delete(run.id); try { const next=this.deps.db.listActiveMergeRuns().find(item=>item.status==='queued'); if(next)this.start(next) } catch { /* server/database already closed */ } }) },25)
  }
  reconcile():void { for(const run of this.deps.db.listActiveMergeRuns()) this.start(run) }
  cancel(id:string,userId:string):MergeRun|null {
    const run=this.deps.db.getMergeRun(userId,id); if(!run)return null
    if(run.pushStartedAt)throw new Error('push уже начался; требуется reconcile')
    this.active.get(id)?.abort()
    this.finish(id,'cancelled','Отменено пользователем','Можно безопасно повторить merge.','awaiting_merge')
    return this.deps.db.getMergeRun(userId,id)
  }
  private emit(id:string):void { const run=this.deps.db.getMergeRunRaw(id); if(run)this.deps.broadcast({t:'merge.snapshot',runId:id,run},run.triggeredBy) }
  private log(id:string,text:string):void {
    const safe=text.replace(/(authorization|token|password)\s*[:=]\s*\S+/gi,'$1=***')
    this.deps.db.appendMergeLog(id,`[${new Date(this.now()).toISOString()}] ${safe}\n`); this.emit(id)
  }
  private stage(id:string,stage:MergeStage,status:MergeStageRecord['status'],message:string):void {
    const run=this.deps.db.getMergeRunRaw(id); if(!run)return
    const at=this.now(), stages=[...run.stages], old=stages.find(v=>v.stage===stage)
    if(old)Object.assign(old,{status,message,...(status==='running'?{startedAt:old.startedAt??at}:{finishedAt:at,durationMs:old.startedAt?at-old.startedAt:0})})
    else stages.push({stage,status,startedAt:status==='running'?at:null,finishedAt:status==='running'?null:at,durationMs:null,exitCode:null,timedOut:false,message,log:''})
    this.deps.db.updateMergeRun(id,{status:stage,stage,stages,...(run.startedAt?{}:{startedAt:at})}); this.log(id,message)
  }
  private async cmd(run:MergeRun,script:string,workdir:string,timeoutMs=300000):Promise<{exitCode:number|null;timedOut:boolean;output:string}> {
    let output=''; const result=await this.deps.executor.run({agentId:run.agentId,script,workdir,env:{},timeoutMs,secrets:[]},chunk=>{output+=chunk;this.log(run.id,chunk.trimEnd())},this.active.get(run.id)?.signal)
    return {...result,output}
  }
  private async execute(id:string,ctl:AbortController):Promise<void> {
    let run=this.deps.db.getMergeRunRaw(id); if(!run)return
    try {
      if(run.pushStartedAt&&run.mergeSha){
        const ws=this.deps.db.findLatestCiWorkspace(run.projectId,run.taskId)
        if(!ws?.path)throw new Error('Push начат, но workspace недоступен; требуется reconcile')
        const remote=await this.cmd(run,'git ls-remote origin refs/heads/main',ws.path,30000)
        if(remote.output.toLowerCase().startsWith(run.mergeSha.toLowerCase())){
          this.finish(id,'success',null,null,'done'); return
        }
        this.finish(id,'decision_required','Push был начат, но origin/main не совпадает с merge SHA','Проверьте удалённый main вручную; автоматический повтор push запрещён.','decision_required'); return
      }
      this.stage(id,'checking','running','Проверяю задачу, проект, workspace и машину')
      const project=this.deps.db.getProject(run.triggeredBy,run.projectId), ws=this.deps.db.findLatestCiWorkspace(run.projectId,run.taskId)
      if(!project||!project.gitUrl||!ws?.pushed||!ws.path||ws.agentId!==run.agentId)throw new Error('Подготовленный CI-workspace или Git origin недоступен')
      if(!this.deps.isOnline(run.agentId))throw new Error('Выбранная машина не в сети')
      if(run.targetBranch!=='main'||!validBranch.test(run.sourceBranch)||!validSha.test(run.sourceSha??''))throw new Error('Некорректный серверный снимок ветки')
      const origin=await this.cmd(run,'git remote get-url origin && git rev-parse --is-inside-work-tree',ws.path,30000)
      const actual=origin.output.split(/\r?\n/).map(v=>v.trim()).find(Boolean), norm=(v:string)=>v.replace(/\.git$/,'').replace(/\/$/,'')
      if(origin.exitCode||!actual||norm(actual)!==norm(project.gitUrl))throw new Error('URL origin не совпадает с проектом')
      this.stage(id,'checking','passed','Серверные проверки пройдены')

      const sourceRef=`refs/merge-runs/${id}/source`, targetRef=`refs/merge-runs/${id}/target`
      this.stage(id,'fetching','running','Получаю source и origin/main в уникальные refs')
      const fetched=await this.cmd(run,`git fetch --no-tags origin +${shellQuote(run.sourceBranch)}:${shellQuote(sourceRef)} +refs/heads/main:${shellQuote(targetRef)}\nprintf 'SOURCE=%s\\nTARGET=%s\\n' "$(git rev-parse ${shellQuote(sourceRef)})" "$(git rev-parse ${shellQuote(targetRef)})"`,ws.path)
      const source=fetched.output.match(/SOURCE=([0-9a-f]{40})/i)?.[1],target=fetched.output.match(/TARGET=([0-9a-f]{40})/i)?.[1]
      if(fetched.exitCode||!source||!target)throw new Error('Не удалось получить ветки из origin')
      if(source.toLowerCase()!==run.sourceSha!.toLowerCase())throw new Error('stale source: ветка изменилась после development-рана')
      this.deps.db.updateMergeRun(id,{targetSha:target}); this.stage(id,'fetching','passed',`Source ${source.slice(0,8)}, main ${target.slice(0,8)}`)

      const worktree=`${ws.path}.merge-${id}`
      this.stage(id,'merging','running','Создаю изолированный Git worktree')
      const prep=await this.cmd(run,`git worktree remove --force ${shellQuote(worktree)} 2>/dev/null || true\ngit worktree add --detach ${shellQuote(worktree)} ${shellQuote(targetRef)}`,ws.path)
      if(prep.exitCode)throw new Error('Не удалось создать временный worktree')
      const merged=await this.cmd(run,`git -c user.name=voiceAIChat -c user.email=merge@voicechat.local merge --no-ff ${shellQuote(sourceRef)} -m ${shellQuote(`Merge task ${run.taskId}`)}`,worktree)
      if(merged.exitCode){
        const found=await this.cmd(run,'git diff --name-only --diff-filter=U',worktree,30000), files=found.output.split(/\r?\n/).map(v=>v.trim()).filter(Boolean)
        this.deps.db.updateMergeRun(id,{conflicts:files}); this.stage(id,'resolving_conflicts','failed',`Конфликты: ${files.join(', ')||'не удалось определить'}`)
        this.finish(id,'decision_required','Конфликты требуют решения пользователя','Разрешите файлы в ветке задачи и повторите merge.','decision_required'); return
      }
      const rev=await this.cmd(run,'git rev-parse HEAD',worktree,30000), mergeSha=rev.output.match(/[0-9a-f]{40}/i)?.[0]
      if(!mergeSha)throw new Error('Merge-коммит не создан')
      this.deps.db.updateMergeRun(id,{mergeSha}); this.stage(id,'merging','passed',`Создан merge ${mergeSha.slice(0,8)}`)

      this.stage(id,'testing','running','Запускаю обязательные проверки до push')
      const testCommand=project.testCommand?.trim()||'npm run affected-check', began=this.now(), tested=await this.cmd(run,testCommand,worktree)
      const check:MergeCheck={name:'Проверки проекта',command:testCommand,status:tested.exitCode===0&&!tested.timedOut?'passed':'failed',startedAt:began,finishedAt:this.now(),durationMs:this.now()-began,exitCode:tested.exitCode,timedOut:tested.timedOut,output:tested.output}
      this.deps.db.updateMergeRun(id,{checks:[check]})
      if(tested.exitCode||tested.timedOut)throw new Error(tested.timedOut?'Проверки превысили timeout':`Проверки упали (exit ${tested.exitCode})`)
      this.stage(id,'testing','passed','Все обязательные проверки прошли')

      this.stage(id,'pushing','running','Повторно проверяю origin/main перед push')
      const refreshed=await this.cmd(run,`git fetch --no-tags origin +refs/heads/main:${shellQuote(targetRef)}\nprintf 'TARGET=%s\\n' "$(git rev-parse ${shellQuote(targetRef)})"`,ws.path), latest=refreshed.output.match(/TARGET=([0-9a-f]{40})/i)?.[1]
      if(!latest||latest.toLowerCase()!==target.toLowerCase())throw new Error('origin/main изменился конкурентно; повторите merge')
      this.deps.db.updateMergeRun(id,{pushStartedAt:this.now()})
      const pushed=await this.cmd(run,`git push --porcelain --force-with-lease=refs/heads/main:${target} origin ${mergeSha}:refs/heads/main`,worktree)
      if(pushed.exitCode)throw new Error('Безопасный push отклонён; требуется reconcile')
      const verified=await this.cmd(run,'git ls-remote origin refs/heads/main',ws.path,30000)
      if(!verified.output.toLowerCase().startsWith(mergeSha.toLowerCase()))throw new Error('Неопределённый результат push; требуется reconcile')
      this.stage(id,'pushing','passed','origin/main подтверждён'); this.finish(id,'success',null,null,'done')
    } catch(error) {
      if(ctl.signal.aborted)return
      const message=error instanceof Error?error.message:String(error), decision=/stale source|конкурентно|reconcile|Неопределённый/i.test(message)
      this.finish(id,decision?'decision_required':'failed',message,decision?'Обновите ветку или main и повторите merge.':'Исправьте причину и повторите merge.',decision?'decision_required':'awaiting_merge')
    } finally { const last=this.deps.db.getMergeRunRaw(id); if(last)this.cleanup(last) }
  }
  private finish(id:string,status:'success'|'failed'|'cancelled'|'decision_required',error:string|null,action:string|null,column:'done'|'awaiting_merge'|'decision_required'):void {
    const run=this.deps.db.getMergeRunRaw(id); if(!run||terminal.has(run.status))return
    this.deps.db.updateMergeRun(id,{status,stage:status,finishedAt:this.now(),error,recommendedAction:action}); this.deps.db.moveMergeTask(run.projectId,run.taskId,column); this.emit(id); this.deps.boardChanged(run.projectId)
  }
  private cleanup(run:MergeRun):void {
    const ws=this.deps.db.findLatestCiWorkspace(run.projectId,run.taskId); if(!ws?.path)return
    const worktree=`${ws.path}.merge-${run.id}`, script=`git worktree remove --force ${shellQuote(worktree)} 2>/dev/null || true\ngit update-ref -d ${shellQuote(`refs/merge-runs/${run.id}/source`)} || true\ngit update-ref -d ${shellQuote(`refs/merge-runs/${run.id}/target`)} || true\ngit worktree prune`
    void this.deps.executor.run({agentId:run.agentId,script,workdir:ws.path,env:{},timeoutMs:60000,secrets:[]},()=>{}).catch(()=>{})
  }
}
