import {
  isMachineStoragePathAllowed,
  managedMergeClonePaths,
  normalizeProjectMachineDirectory,
  validateProjectMachineDirectories,
  type MergeCheck,
  type MergeMachineReadiness,
  type MergeRun,
  type MergeStage,
  type MergeStageRecord,
  type ServerMessage
} from '@voicechat/shared'
import { randomUUID } from 'node:crypto'
import type { VoiceChatDb } from '../db/database.js'
import type { CommandExecutor } from '../ci/types.js'
import { shellQuote } from '../ci/executor.js'
import { testStages } from '../ci/testStages.js'
import { mergeIndependentText } from './textConflictResolver.js'

export interface MergeKbUpdateContext {
  run: MergeRun
  repo: string
  targetRef: string
  signal: AbortSignal
  log(chunk: string): void
}
export interface MergeConflictFixContext {
  run: MergeRun
  repo: string
  conflicts: string[]
  signal: AbortSignal
  log(chunk: string): void
}
export interface MergeRunManagerDeps { db: VoiceChatDb; executor: CommandExecutor; conflictFix?(ctx:MergeConflictFixContext):Promise<{ok:boolean;message:string;llmEngineId?:string|null;llmProvider?:'claude'|'codex';llmModel?:string}>; kbUpdate?(ctx:MergeKbUpdateContext):Promise<{ok:boolean;message:string;llmEngineId?:string|null;llmProvider?:'claude'|'codex';llmModel?:string}>; isOnline(id:string):boolean; platformOf?(id:string):string|undefined; policyOf?(id:string):{allowedDirs:string[]}|undefined; fsRead?(id:string,path:string):Promise<{dataBase64?:string}>; fsWrite?(id:string,path:string,dataBase64:string):Promise<unknown>; fsDelete?(id:string,path:string):Promise<unknown>; broadcast(message:ServerMessage,userId:string):void; boardChanged(projectId:string):void; now?:()=>number }
const terminal = new Set(['success','failed','cancelled','decision_required'])
const validSha = /^[0-9a-f]{40}$/i
const validBranch = /^(?!-)(?!.*\.\.)(?!.*[~^:?*\[\]\\])[A-Za-z0-9._/-]+$/
/** Канонизирует Git URL до host/owner/repo: SSH- и HTTPS-формы одного
 *  репозитория совпадают (машинный insteadOf-rewrite меняет протокол). */
function canonicalGitUrl(value:string):string {
  return value.trim().toLowerCase().replace(/^[a-z+]+:\/\//,'').replace(/^[^@/]+@/,'').replace(':','/').replace(/\.git$/,'').replace(/\/+$/,'')
}

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
    this.finish(id,'cancelled','Отменено пользователем','Можно безопасно повторить merge.','merge')
    return this.deps.db.getMergeRun(userId,id)
  }
  private emit(id:string):void { const run=this.deps.db.getMergeRunRaw(id); if(run)this.deps.broadcast({t:'merge.snapshot',runId:id,run},run.triggeredBy) }
  private log(id:string,text:string):void {
    const safe=text.replace(/(authorization|token|password)\s*[:=]\s*\S+/gi,'$1=***')
    const line=`[${new Date(this.now()).toISOString()}] ${safe}\n`
    const run=this.deps.db.getMergeRunRaw(id)
    if(run){
      const stages=run.stages.map(stage=>stage.stage===run.stage?{...stage,log:stage.log+line}:stage)
      this.deps.db.updateMergeRun(id,{stages})
    }
    this.deps.db.appendMergeLog(id,line); this.emit(id)
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
  private async autoResolveTextConflict(run:MergeRun,repo:string,path:string):Promise<boolean> {
    const q=shellQuote(path)
    try {
      let output=''
      const inspected=await this.deps.executor.run({
        agentId:run.agentId,
        script:`git ls-files -u -- ${q}
f=${q}
for stage in 1 2 3; do printf 'STAGE%s=' "$stage"; git show ":$stage:$f" 2>/dev/null | base64 | tr -d '\\n' || exit 66; printf '\\n'; done`,
        workdir:repo,env:{},timeoutMs:30000,secrets:[]
      },chunk=>{output+=chunk},this.active.get(run.id)?.signal)
      if(inspected.exitCode||inspected.timedOut) {
        this.log(run.id,`Авторазрешение ${path}: classification=missing-stage, applied=no, reason=не удалось прочитать три Git-stage`)
        return false
      }
      const entries=output.split(/\r?\n/).filter(line=>/^\d{6} [0-9a-f]+ [123]\t/.test(line))
      if(entries.length!==3) {
        this.log(run.id,`Авторазрешение ${path}: classification=missing-stage, applied=no, reason=ожидались стадии 1/2/3`)
        return false
      }
      const parsed=entries.map(line=>line.match(/^(\d{6}) [0-9a-f]+ ([123])\t/)!)
      const modes=parsed.map(match=>match[1]), stages=parsed.map(match=>match[2]).sort().join('')
      if(stages!=='123'||new Set(modes).size!==1||!/^100\d{3}$/.test(modes[0])) {
        this.log(run.id,`Авторазрешение ${path}: classification=unsupported-type-or-mode, applied=no, modes=${modes.join('/')}, reason=необычный тип либо изменение режима`)
        return false
      }
      const encoded=[1,2,3].map(stage=>output.match(new RegExp(`(?:^|\\n)STAGE${stage}=([^\\n]*)`))?.[1])
      if(encoded.some(value=>value===undefined)) {
        this.log(run.id,`Авторазрешение ${path}: classification=missing-stage, applied=no, reason=данные стадии неполны`)
        return false
      }
      const buffers=encoded.map(value=>Buffer.from(value!,'base64'))
      if(buffers.some(buffer=>!Buffer.from(buffer.toString('utf8'),'utf8').equals(buffer))) {
        this.log(run.id,`Авторазрешение ${path}: classification=binary, applied=no, reason=содержимое не является корректным UTF-8`)
        return false
      }
      const [base,ours,theirs]=buffers.map(buffer=>buffer.toString('utf8'))
      const result=mergeIndependentText(base,ours,theirs)
      if(!result.ok) {
        this.log(run.id,`Авторазрешение ${path}: classification=${result.classification}, applied=no, ours_changes=${result.oursChanges}, theirs_changes=${result.theirsChanges}, reason=${result.reason}`)
        return false
      }
      const payload=Buffer.from(result.content).toString('base64'),tmp=`.merge-auto-${run.id.replace(/[^A-Za-z0-9_-]/g,'_')}`
      const written=await this.cmd(run,`set -e
tmp=${shellQuote(tmp)}
printf %s ${shellQuote(payload)} | base64 -d > "$tmp"
if grep -Eq '^(<<<<<<<|=======|>>>>>>>)( |$)' "$tmp"; then rm -f "$tmp"; exit 67; fi
mv -- "$tmp" ${q}
git add -- ${q}`,repo,30000)
      if(written.exitCode||written.timedOut) {
        this.log(run.id,`Авторазрешение ${path}: classification=${result.classification}, applied=no, ours_changes=${result.oursChanges}, theirs_changes=${result.theirsChanges}, reason=проверка или атомарная запись результата не удалась`)
        return false
      }
      this.log(run.id,`Авторазрешение ${path}: classification=${result.classification}, applied=yes, rule=${result.rule}, ours_changes=${result.oursChanges}, theirs_changes=${result.theirsChanges}`)
      return true
    } catch(error) {
      this.log(run.id,`Авторазрешение ${path}: classification=analysis-error, applied=no, reason=${error instanceof Error?error.message:String(error)}`)
      return false
    }
  }
  private workspaceParent(path:string):string {
    const normalized=path.replace(/[\\/]+$/,'')
    const split=Math.max(normalized.lastIndexOf('/'),normalized.lastIndexOf('\\'))
    if(split<=0)throw new Error('Некорректный путь подготовленного CI-workspace')
    return normalized.slice(0,split)
  }
  private blocked(code:MergeMachineReadiness['code'],message:string,mode:MergeMachineReadiness['mode']=null):MergeMachineReadiness {
    return {ready:false,selectable:false,mode,code,message}
  }
  /** Общий preflight для селектора и POST. Не создаёт merge-клон. */
  async checkReadiness(userId:string,projectId:string,taskId:string,agentId:string):Promise<MergeMachineReadiness> {
    if(!this.deps.isOnline(agentId))return this.blocked('machine_offline','Машина не в сети')
    const project=this.deps.db.getProject(userId,projectId)
    const ws=this.deps.db.findLatestPushedCiWorkspace(projectId,taskId)
    if(!project?.gitUrl||!ws?.path||!ws.pushed)return this.blocked('git_unavailable','Подготовленный workspace или Git origin недоступен')
    const machine=this.deps.db.getProjectMachine(projectId,agentId)
    if(!machine)return this.blocked('storage_missing','У машины не настроены каталоги проекта')
    let repo:string,parent:string,workdir:string,cacheDir:string,mode:'managed'|'legacy'
    const platform=this.deps.platformOf?.(agentId)??(/^(?:[A-Za-z]:[\\/]|\\\\)/.test(machine.storageRoot??'')?'win32':'linux')
    if(machine.storageId){
      mode='managed'
      if(!machine.storageRoot)return this.blocked('storage_not_found','MachineStorage не найдено у выбранной машины',mode)
      if(!machine.directories)return this.blocked('storage_path_invalid','Не настроена полная схема каталогов MachineStorage',mode)
      try {
        const directories=validateProjectMachineDirectories(machine.directories,machine.storageRoot,projectId,platform)
        const paths=managedMergeClonePaths(machine.storageRoot,projectId,platform)
        if(normalizeProjectMachineDirectory(directories.mergeClones.path,platform)!==paths.root||directories.mergeClones.override) {
          return this.blocked('storage_path_invalid','Каталог mergeClones должен быть каноническим managed-путём',mode)
        }
        const allowed=this.deps.policyOf?.(agentId)?.allowedDirs??[]
        if(!isMachineStoragePathAllowed(paths.root,allowed,platform))return this.blocked('storage_policy_denied','Каталог mergeClones находится вне разрешённых директорий машины',mode)
        repo=paths.repository; parent=paths.root; cacheDir=paths.npmCache; workdir=machine.storageRoot
      } catch(error){ return this.blocked('storage_path_invalid',error instanceof Error?error.message:String(error),mode) }
      if(!this.deps.fsRead||!this.deps.fsWrite||!this.deps.fsDelete)return this.blocked('storage_not_found','Файловая проверка MachineStorage недоступна',mode)
      const separator=platform==='win32'?'\\':'/'
      try {
        const marker=await this.deps.fsRead(agentId,`${machine.storageRoot}${separator}.voicechat${separator}storage.json`)
        const parsed=JSON.parse(Buffer.from(marker.dataBase64??'','base64').toString('utf8')) as {id?:unknown;formatVersion?:unknown}
        if(parsed.id!==machine.storageId||parsed.formatVersion!==(machine.storageFormatVersion??1))return this.blocked('storage_marker_invalid','Marker хранилища отсутствует, повреждён или принадлежит другому storage',mode)
      } catch { return this.blocked('storage_marker_invalid','Marker хранилища отсутствует, повреждён или принадлежит другому storage',mode) }
      const probe=`${machine.storageRoot}${separator}.voicechat${separator}temporary${separator}merge-probe-${randomUUID()}`
      try { await this.deps.fsWrite(agentId,probe,Buffer.from('ok').toString('base64')); await this.deps.fsDelete(agentId,probe) }
      catch { return this.blocked('storage_read_only','MachineStorage недоступно для записи',mode) }
    } else {
      mode='legacy'
      const root=machine.reposRoot?.replace(/[\\/]+$/,'')
      if(!root)return this.blocked('storage_missing','MachineStorage отсутствует и legacy reposRoot не настроен',mode)
      if(ws.agentId===agentId){
        parent=this.workspaceParent(ws.path); workdir=parent
      } else {
        const segments=ws.path.replace(/[\\/]+$/,'').split(/[\\/]+/); segments.pop(); const projectDir=segments.pop()
        if(!projectDir)return this.blocked('storage_path_invalid','Некорректный путь подготовленного CI-workspace',mode)
        parent=`${root}/${projectDir}`; workdir=this.workspaceParent(parent)
      }
      repo=`${parent}/.merge`; cacheDir=`${parent}/.merge-npm-cache`
    }
    let inspectionOutput=''
    const inspected=await this.deps.executor.run({agentId,script:`set -e
p=${shellQuote(parent)}
while [ "$p" != "/" ] && [ "$p" != "." ]; do [ ! -L "$p" ] || exit 73; p="$(dirname "$p")"; done
if [ -e ${shellQuote(repo)} ] && [ ! -d ${shellQuote(`${repo}/.git`)} ]; then exit 74; fi
if [ -d ${shellQuote(`${repo}/.git`)} ]; then git -C ${shellQuote(repo)} remote get-url origin; fi
git ls-remote --exit-code ${shellQuote(project.gitUrl)} refs/heads/main refs/heads/${shellQuote(ws.branch??'')}`,workdir,env:{},timeoutMs:30000,secrets:[]},chunk=>{inspectionOutput+=chunk})
    if(inspected.exitCode===73)return this.blocked('storage_symlink','Компонент пути merge-клона является симлинком',mode)
    if(inspected.exitCode===74)return this.blocked('clone_invalid','Каталог merge-клона существует, но не является Git-репозиторием',mode)
    if(inspected.exitCode||inspected.timedOut)return this.blocked('git_unavailable','Git origin или обязательные ветки недоступны',mode)
    const actual=inspectionOutput.split(/\r?\n/).map(v=>v.trim()).find(v=>v&&!/^[0-9a-f]{40}\s/.test(v))
    if(actual&&canonicalGitUrl(actual)!==canonicalGitUrl(project.gitUrl))return this.blocked('clone_invalid','Origin существующего merge-клона не соответствует проекту',mode)
    return {ready:true,selectable:true,mode,code:'ready',message:mode==='managed'?'Managed MachineStorage готово':'Готово через legacy reposRoot',clonePath:repo}
  }
  private async mergeBase(run:MergeRun,ws:{path:string;agentId:string|null}):Promise<{repo:string;parent:string;workdir:string;cacheDir:string}> {
    const readiness=await this.checkReadiness(run.triggeredBy,run.projectId,run.taskId,run.agentId)
    if(!readiness.ready||!readiness.clonePath)throw new Error(readiness.message)
    const repo=readiness.clonePath
    const parent=this.workspaceParent(repo)
    const machine=this.deps.db.getProjectMachine(run.projectId,run.agentId)
    const managed=readiness.mode==='managed'
    return {repo,parent,workdir:managed?(machine?.storageRoot??parent):(ws.agentId===run.agentId?parent:this.workspaceParent(parent)),cacheDir:managed?`${parent}/npm-cache`:`${parent}/.merge-npm-cache`}
  }
  private async execute(id:string,ctl:AbortController):Promise<void> {
    let run=this.deps.db.getMergeRunRaw(id); if(!run)return
    const temporaryWorktrees:string[]=[]
    let worktreeRepo:string|null=null
    const cleanupWorktrees=async():Promise<void>=>{
      if(!worktreeRepo||temporaryWorktrees.length===0)return
      const paths=[...temporaryWorktrees].reverse()
      temporaryWorktrees.length=0
      for(const path of paths){
        try {
          await this.deps.executor.run({agentId:run.agentId,script:`git worktree remove --force ${shellQuote(path)}`,workdir:worktreeRepo,env:{},timeoutMs:60000,secrets:[]},()=>{})
        } catch { /* best effort; prune ниже убирает служебную запись Git */ }
      }
      try { await this.deps.executor.run({agentId:run.agentId,script:'git worktree prune',workdir:worktreeRepo,env:{},timeoutMs:30000,secrets:[]},()=>{}) } catch { /* машина могла отключиться */ }
    }
    try {
      if(run.pushStartedAt&&run.mergeSha){
        const project=this.deps.db.getProject(run.triggeredBy,run.projectId), ws=this.deps.db.findLatestPushedCiWorkspace(run.projectId,run.taskId)
        if(!project?.gitUrl||!ws?.path)throw new Error('Push начат, но данные проекта недоступны; требуется reconcile')
        const remote=await this.cmd(run,`git ls-remote ${shellQuote(project.gitUrl)} refs/heads/main`,(await this.mergeBase(run,ws)).workdir,30000)
        if(remote.output.toLowerCase().startsWith(run.mergeSha.toLowerCase())){
          this.finish(id,'success',null,null,'done')
          await this.releaseTaskRepositories(run)
          return
        }
        this.finish(id,'decision_required','Push был начат, но origin/main не совпадает с merge SHA','Проверьте удалённый main вручную; автоматический повтор push запрещён.','decision_required'); return
      }
      this.stage(id,'checking','running','Проверяю задачу, проект, workspace и машину')
      const project=this.deps.db.getProject(run.triggeredBy,run.projectId), ws=this.deps.db.findLatestPushedCiWorkspace(run.projectId,run.taskId)
      if(!project||!project.gitUrl||!ws?.pushed||!ws.path)throw new Error('Подготовленный CI-workspace или Git origin недоступен')
      if(ws.agentId!==run.agentId&&!this.deps.db.getProjectMachine(run.projectId,run.agentId))throw new Error('У выбранной машины не настроены каталоги проекта')
      if(!this.deps.isOnline(run.agentId))throw new Error('Выбранная машина не в сети')
      if(run.targetBranch!=='main'||!validBranch.test(run.sourceBranch)||(run.sourceSha!==null&&!validSha.test(run.sourceSha)))throw new Error('Некорректный серверный снимок ветки')
      const {repo,parent,workdir,cacheDir}=await this.mergeBase(run,ws)
      // Read-only preflight идёт до mkdir/clone/checkout: обе ветки и доступ к
      // origin должны быть подтверждены прежде любой мутации репозитория.
      const preflight=await this.cmd(run,`git ls-remote --exit-code ${shellQuote(project.gitUrl)} refs/heads/main refs/heads/${run.sourceBranch}`,workdir,30000)
      const preflightRefs=preflight.output.split(/\r?\n/).filter(Boolean)
      if(preflight.exitCode||preflightRefs.length!==2)throw new Error('origin недоступен либо main/feature-ветка не существует')
      const cloned=await this.cmd(run,`mkdir -p ${shellQuote(parent)}\nif [ -d ${shellQuote(`${repo}/.git`)} ]; then echo "постоянный merge-клон уже создан"; else git clone --no-checkout --origin origin ${shellQuote(project.gitUrl)} ${shellQuote(repo)}; fi`,workdir)
      if(cloned.exitCode)throw new Error('Не удалось подготовить постоянный merge-клон')
      if(ws.agentId)this.deps.db.upsertTaskRepository(run.projectId,run.taskId,ws.agentId,ws.path,'dev-workspace')
      const origin=await this.cmd(run,'git remote get-url origin && git rev-parse --is-inside-work-tree',repo,30000)
      const actual=origin.output.split(/\r?\n/).map(v=>v.trim()).find(Boolean)
      if(origin.exitCode||!actual||canonicalGitUrl(actual)!==canonicalGitUrl(project.gitUrl))throw new Error('URL origin временного merge-клона не совпадает с проектом')
      this.stage(id,'checking','passed','Серверные проверки пройдены')

      const sourceRef=`refs/merge-runs/${id}/source`, targetRef=`refs/merge-runs/${id}/target`
      this.stage(id,'fetching','running','Получаю source и origin/main в уникальные refs')
      const fetched=await this.cmd(run,`git fetch --no-tags origin +${shellQuote(run.sourceBranch)}:${shellQuote(sourceRef)} +refs/heads/main:${shellQuote(targetRef)}\nprintf 'SOURCE=%s\\nTARGET=%s\\n' "$(git rev-parse ${shellQuote(sourceRef)})" "$(git rev-parse ${shellQuote(targetRef)})"`,repo)
      const source=fetched.output.match(/SOURCE=([0-9a-f]{40})/i)?.[1],target=fetched.output.match(/TARGET=([0-9a-f]{40})/i)?.[1]
      if(fetched.exitCode||!source||!target)throw new Error('Не удалось получить ветки из origin')
      this.deps.db.updateMergeRun(id,{sourceSha:source,targetSha:target}); this.stage(id,'fetching','passed',`Source ${source.slice(0,8)}, main ${target.slice(0,8)}`)

      // Уже влитая ветка — мгновенный успех до stale-сверки: закрытие задачи,
      // а не полный гейт с холостым push.
      const contained=await this.cmd(run,`git merge-base --is-ancestor ${shellQuote(sourceRef)} ${shellQuote(targetRef)} && echo MERGED || echo PENDING`,repo,30000)
      if(/(^|\n)MERGED/.test(contained.output)){
        this.deps.db.updateMergeRun(id,{mergeSha:target})
        this.stage(id,'merging','passed','Ветка уже вмержена в main')
        this.finish(id,'success',null,null,'done')
        await this.releaseTaskRepositories(run)
        return
      }
      if(run.sourceSha&&source.toLowerCase()!==run.sourceSha.toLowerCase())throw new Error('stale source: ветка изменилась после development-рана')

      this.stage(id,'merging','running','Вычищаю дерево постоянного merge-клона')
      const prep=await this.cmd(run,`git merge --abort 2>/dev/null || true\ngit checkout -f --detach ${shellQuote(targetRef)}\ngit reset --hard\ngit clean -fd`,repo)
      if(prep.exitCode)throw new Error('Не удалось подготовить постоянный merge-клон')
      const merged=await this.cmd(run,`git -c user.name=voiceAIChat -c user.email=merge@voicechat.local merge --no-ff ${shellQuote(sourceRef)} -m ${shellQuote(`Merge task ${run.taskId}`)}`,repo)
      if(merged.exitCode){
        const found=await this.cmd(run,'git diff --name-only --diff-filter=U',repo,30000), files=found.output.split(/\r?\n/).map(v=>v.trim()).filter(Boolean)
        this.deps.db.updateMergeRun(id,{conflicts:files})
        // README — производный индекс. Оставляем target-версию только временно:
        // после kb_update индекс безусловно строится из итогового merge-дерева.
        // Такой конфликт не должен блокировать merge или скрывать конфликт в коде.
        let unresolved=files
        if(files.includes('docs/kb/README.md')){
          this.stage(id,'resolving_conflicts','running','Откладываю генерацию индекса БЗ до итогового merge-дерева')
          const deferred=await this.cmd(run,'git checkout --ours -- docs/kb/README.md\ngit add -- docs/kb/README.md',repo,30000)
          if(deferred.exitCode||deferred.timedOut)throw new Error('Не удалось отложить генерацию индекса БЗ')
          unresolved=files.filter(f=>f!=='docs/kb/README.md')
          this.deps.db.updateMergeRun(id,{conflicts:unresolved})
        }
        const textCandidates=unresolved.filter(f=>!/^docs\/kb\/.+\.md$/.test(f))
        for(const path of textCandidates) await this.autoResolveTextConflict(run,repo,path)
        if(textCandidates.length){
          const remaining=await this.cmd(run,'git diff --name-only --diff-filter=U',repo,30000)
          if(remaining.exitCode||remaining.timedOut)throw new Error('Не удалось проверить остаток конфликтов после авторазрешения')
          unresolved=remaining.output.split(/\r?\n/).map(v=>v.trim()).filter(Boolean)
          this.deps.db.updateMergeRun(id,{conflicts:unresolved})
        }
        if(unresolved.length===0){
          const resolved=await this.cmd(run,'git -c user.name=voiceAIChat -c user.email=merge@voicechat.local commit --no-edit',repo,30000)
          if(resolved.exitCode||resolved.timedOut)throw new Error('Не удалось продолжить merge после откладывания индекса БЗ')
          this.stage(id,'resolving_conflicts','passed','Безопасные конфликты разрешены; индекс БЗ будет перегенерирован после обязательной актуализации')
        } else if(unresolved.every(f=>/^docs\/kb\/.+\.md$/.test(f))){
          this.stage(id,'resolving_conflicts','running','Конфликты только в темах docs/kb — разрешаю по правилам БЗ')
          const topics=unresolved
          // Метаданные updated:/checked: нормализуются плейсхолдером во всех трёх
          // стадиях, затем честный трёхсторонний merge-file: чистый результат
          // значит, что конфликтовали только метаданные (несовпадающие правки
          // тела с обеих сторон сохраняются), а kb.mjs touch ставит свежие
          // значения. Конфликт после нормализации — содержательное расхождение.
          const perFile=topics.map(f=>[
            `f=${shellQuote(f)}`,
            'git show ":1:$f" > .merge-kb-base 2>/dev/null || printf "" > .merge-kb-base',
            'git show ":2:$f" > .merge-kb-ours',
            'git show ":3:$f" > .merge-kb-theirs',
            `for v in base ours theirs; do sed -E 's/^(updated:).*/\\1 @@KB@@/; s/^(checked:).*/\\1 @@KB@@/' ".merge-kb-$v" > ".merge-kb-$v.n"; done`,
            'git merge-file --stdout .merge-kb-ours.n .merge-kb-base.n .merge-kb-theirs.n > "$f" || exit 65',
            'node scripts/kb.mjs touch "$f"',
            'git add -- "$f"'
          ].join('\n')).join('\n')
          const resolved=await this.cmd(run,`set -e\n${perFile}\nrm -f .merge-kb-base .merge-kb-ours .merge-kb-theirs .merge-kb-base.n .merge-kb-ours.n .merge-kb-theirs.n\nnode scripts/kb.mjs check\ngit -c user.name=voiceAIChat -c user.email=merge@voicechat.local commit --no-edit`,repo,300000)
          if(resolved.exitCode||resolved.timedOut){
            this.log(id,`Детерминированное разрешение тем БЗ не удалось; передаю дополнительному шагу: ${unresolved.join(', ')}`)
          } else {
            unresolved=[]
            this.deps.db.updateMergeRun(id,{conflicts:[]})
            this.stage(id,'resolving_conflicts','passed','Метаданные тем нормализованы; индекс будет перегенерирован после актуализации БЗ')
          }
        }
        if(unresolved.length){
          this.stage(id,'resolving_conflicts','running',`Запускаю дополнительный шаг исправления конфликтов: ${unresolved.join(', ')||'не удалось определить'}`)
          if (!this.deps.conflictFix) {
            this.stage(id,'resolving_conflicts','failed','Обработчик исправления конфликтов не подключён')
            this.finish(id,'failed','Автоматическое исправление конфликтов недоступно','Подключите модель исправления конфликтов и повторите merge.','merge'); return
          }
          const fixed=await this.deps.conflictFix({run:this.deps.db.getMergeRunRaw(id)??run,repo,conflicts:unresolved,signal:ctl.signal,log:chunk=>this.log(id,chunk)})
          this.deps.db.updateMergeRun(id,{
            ...(fixed.llmEngineId!==undefined?{llmEngineId:fixed.llmEngineId}:{}),
            ...(fixed.llmProvider?{llmProvider:fixed.llmProvider}:{}),
            ...(fixed.llmModel!==undefined?{llmModel:fixed.llmModel}:{})
          })
          if(!fixed.ok){
            this.stage(id,'resolving_conflicts','failed',fixed.message)
            this.finish(id,'failed','Дополнительный шаг не исправил конфликты','Рабочая копия сохранена; исправьте причину и повторите merge.','merge'); return
          }
          const remaining=await this.cmd(run,`unmerged="$(git diff --name-only --diff-filter=U)"
printf '%s\\n' "$unmerged"
[ -z "$unmerged" ] || exit 66
if git grep -n -E '^(<<<<<<<|=======|>>>>>>>)( |$)' -- . ':!docs/kb/README.md'; then exit 67; fi
exit 0`,repo,30000)
          const remainingFiles=remaining.output.split(/\r?\n/).map(v=>v.trim()).filter(v=>v&&!v.includes(':<<<<<<<')&&!v.includes(':=======')&&!v.includes(':>>>>>>>'))
          if(remaining.exitCode||remaining.timedOut||remainingFiles.length){
            this.deps.db.updateMergeRun(id,{conflicts:remainingFiles.length?remainingFiles:unresolved})
            this.stage(id,'resolving_conflicts','failed',`После дополнительного шага остались конфликты: ${remainingFiles.join(', ')||unresolved.join(', ')}`)
            this.finish(id,'failed','Автоматическое исправление конфликтов не прошло серверную проверку','Рабочая копия сохранена; исправьте причину и повторите merge.','merge'); return
          }
          const committed=await this.cmd(run,'git add -A\ngit -c user.name=voiceAIChat -c user.email=merge@voicechat.local commit --no-edit',repo,30000)
          if(committed.exitCode||committed.timedOut)throw new Error('Не удалось создать merge-коммит после исправления конфликтов')
          this.deps.db.updateMergeRun(id,{conflicts:[]})
          this.stage(id,'resolving_conflicts','passed',fixed.message)
        }
      }
      const rev=await this.cmd(run,'git rev-parse HEAD',repo,30000), checkedSha=rev.output.match(/[0-9a-f]{40}/i)?.[0]
      if(!checkedSha)throw new Error('Merge-коммит не создан')
      // Направление истории намеренно явное: merge-коммит строится от pinned main
      // с feature как вторым родителем; отдельный KB-коммит становится его потомком
      // в feature. В main публикуется ровно итоговый feature SHA.
      this.deps.db.updateMergeRun(id,{mergeSha:checkedSha}); this.stage(id,'merging','passed',`Проверяемый SHA ${checkedSha.slice(0,8)} (main + feature)`)

      if (!this.deps.kbUpdate) throw new Error('Обязательный обработчик актуализации базы знаний не подключён')
      worktreeRepo=repo
      const worktreeRoot=`${parent}/.merge-run-${id.replace(/[^A-Za-z0-9_-]/g,'_')}`
      const testsRepo=`${worktreeRoot}-tests`,kbRepo=`${worktreeRoot}-kb`
      const prepared=await this.cmd(run,`git worktree add --detach ${shellQuote(testsRepo)} ${shellQuote(checkedSha)}\ngit worktree add --detach ${shellQuote(kbRepo)} ${shellQuote(checkedSha)}`,repo,300000)
      if(prepared.exitCode||prepared.timedOut)throw new Error('Не удалось создать изолированные worktree для проверок и БЗ')
      temporaryWorktrees.push(testsRepo,kbRepo)

      const commands=testStages(project.testCommand??'',['npm run affected-check'])
      const parallelStarted=this.now()
      this.stage(id,'testing','running',`Параллельно запускаю проверки SHA ${checkedSha.slice(0,8)} в изолированном worktree`)
      this.stage(id,'kb_update','running',`Параллельно актуализирую БЗ SHA ${checkedSha.slice(0,8)} в отдельном worktree`)
      const branchCtl=new AbortController()
      ctl.signal.addEventListener('abort',()=>branchCtl.abort(),{once:true})
      const runGate=async(workdir:string,gateCommands:string[],name:string):Promise<MergeCheck>=>{
        const began=this.now()
        const installed=await this.cmd(run,`npm_config_cache=${shellQuote(cacheDir)} npm ci --no-audit --no-fund`,workdir,900000)
        let tested={...installed,output:installed.output}
        if(!installed.exitCode&&!installed.timedOut){
          tested={exitCode:0 as number|null,timedOut:false,output:installed.output}
          for(const command of gateCommands){
            const result=await this.cmd(run,command,workdir,1800000)
            tested={...result,output:tested.output+result.output}
            if(result.exitCode||result.timedOut)break
          }
        }
        return{name,command:gateCommands.join('\n'),status:tested.exitCode===0&&!tested.timedOut?'passed':'failed',startedAt:began,finishedAt:this.now(),durationMs:this.now()-began,exitCode:tested.exitCode,timedOut:tested.timedOut,output:tested.output}
      }
      const testsPromise=runGate(testsRepo,commands,'Проверки проекта').then(result=>{if(result.status==='failed')branchCtl.abort();return result})
      const kbPromise=this.deps.kbUpdate({run:this.deps.db.getMergeRunRaw(id)??run,repo:kbRepo,targetRef,signal:branchCtl.signal,log:chunk=>this.log(id,chunk)}).then(result=>{if(!result.ok)branchCtl.abort();return result})
      const [testsSettled,kbSettled]=await Promise.allSettled([testsPromise,kbPromise])
      const parallelDuration=this.now()-parallelStarted
      if(testsSettled.status==='rejected')throw testsSettled.reason
      const check=testsSettled.value
      this.deps.db.updateMergeRun(id,{checks:[check]})
      this.stage(id,'testing',check.status==='passed'?'passed':'failed',`Проверки ${check.status==='passed'?'прошли':'не прошли'} за ${check.durationMs} мс; параллельный участок ${parallelDuration} мс`)
      if(check.status==='failed')throw new Error(check.timedOut?'Проверки превысили timeout':`Проверки упали (exit ${check.exitCode})`)
      if(kbSettled.status==='rejected')throw kbSettled.reason
      const kbResult=kbSettled.value
      this.deps.db.updateMergeRun(id,{
        ...(kbResult.llmEngineId!==undefined?{llmEngineId:kbResult.llmEngineId}:{}),
        ...(kbResult.llmProvider?{llmProvider:kbResult.llmProvider}:{}),
        ...(kbResult.llmModel!==undefined?{llmModel:kbResult.llmModel}:{})
      })
      if(!kbResult.ok){this.stage(id,'kb_update','failed',kbResult.message);throw new Error(kbResult.message)}

      const kbCommitted=await this.cmd(run,`node scripts/kb.mjs index\nnode scripts/kb.mjs check\ngit add -- docs/kb\nif git diff --cached --quiet; then echo KB_TREE_UNCHANGED; else git -c user.name=voiceAIChat -c user.email=merge@voicechat.local commit -m "docs(kb): update after merge ${run.taskId}"; fi\nprintf 'FINAL=%s\\n' "$(git rev-parse HEAD)"\nprintf 'CHANGED\\n'\ngit diff --name-only ${shellQuote(checkedSha)} HEAD`,kbRepo,300000)
      const finalSha=kbCommitted.output.match(/FINAL=([0-9a-f]{40})/i)?.[1]
      if(kbCommitted.exitCode||!finalSha)throw new Error('Не удалось создать отдельный коммит файловой БЗ')
      const changed=kbCommitted.output.split(/CHANGED\r?\n/)[1]?.split(/\r?\n/).map(v=>v.trim()).filter(Boolean)??[]
      const kbChanged=finalSha.toLowerCase()!==checkedSha.toLowerCase()
      this.deps.db.updateMergeRun(id,{mergeSha:finalSha})
      this.stage(id,'kb_update','passed',`${kbResult.message}; ${kbChanged?`отдельный KB-коммит ${finalSha.slice(0,8)}`:'дерево не изменилось, пустой коммит не создан'}; ${parallelDuration} мс`)

      if(kbChanged){
        const docsOnly=changed.every(path=>/^docs\/(?!.*(?:generated|dist|build))/.test(path)||/^(?:\.github\/|[^/]*\.md$)/.test(path))
        const repeatCommands=docsOnly?['node scripts/kb.mjs check']:commands
        this.stage(id,'testing','running',docsOnly?'Запускаю сокращённый документальный гейт после KB-коммита':'Изменения влияют на сборку; повторяю полный гейт')
        const repeated=await runGate(kbRepo,repeatCommands,docsOnly?'Документальный гейт после БЗ':'Полный повторный гейт после БЗ')
        this.deps.db.updateMergeRun(id,{checks:[check,repeated]})
        this.stage(id,'testing',repeated.status==='passed'?'passed':'failed',`${repeated.name}: ${repeated.status}, ${repeated.durationMs} мс`)
        if(repeated.status==='failed')throw new Error(`${repeated.name} не пройден`)
      }

      this.stage(id,'pushing','running','Повторно сверяю pinned origin/main и feature перед публикацией')
      const refreshed=await this.cmd(run,`git fetch --no-tags origin +refs/heads/main:${shellQuote(targetRef)} +${shellQuote(run.sourceBranch)}:${shellQuote(sourceRef)}\nprintf 'TARGET=%s\\nSOURCE=%s\\n' "$(git rev-parse ${shellQuote(targetRef)})" "$(git rev-parse ${shellQuote(sourceRef)})"`,repo)
      const latest=refreshed.output.match(/TARGET=([0-9a-f]{40})/i)?.[1],latestSource=refreshed.output.match(/SOURCE=([0-9a-f]{40})/i)?.[1]
      if(!latest)throw new Error('Не удалось повторно прочитать origin/main')
      if(latest.toLowerCase()!==target.toLowerCase()){
        this.log(id,`origin/main изменился с ${target.slice(0,8)} до ${latest.slice(0,8)}; старые результаты не переиспользуются`)
        await cleanupWorktrees()
        return await this.execute(id,ctl)
      }
      if(!latestSource||latestSource.toLowerCase()!==source.toLowerCase())throw new Error('stale source: ветка изменилась перед push')
      this.deps.db.updateMergeRun(id,{pushStartedAt:this.now()})
      const featurePushed=await this.cmd(run,`git push --porcelain --force-with-lease=refs/heads/${run.sourceBranch}:${source} origin ${finalSha}:refs/heads/${run.sourceBranch}`,repo)
      if(featurePushed.exitCode)throw new Error('Push feature-ветки отклонён; main не изменён')
      const mainPushed=await this.cmd(run,`git push --porcelain --force-with-lease=refs/heads/main:${target} origin ${finalSha}:refs/heads/main`,repo)
      if(mainPushed.exitCode)throw new Error('Безопасный push main отклонён; требуется reconcile')
      const verified=await this.cmd(run,'git ls-remote origin refs/heads/main',repo,30000)
      if(!verified.output.toLowerCase().startsWith(finalSha.toLowerCase()))throw new Error('Неопределённый результат push; требуется reconcile')
      this.stage(id,'pushing','passed',`В main отправлен итоговый feature SHA ${finalSha}`);this.finish(id,'success',null,null,'done')
      await cleanupWorktrees()
      await this.releaseTaskRepositories(run)
    } catch(error) {
      if(ctl.signal.aborted)return
      const message=error instanceof Error?error.message:String(error), decision=/stale source|конкурентно|reconcile|Неопределённый/i.test(message)
      this.log(id,`Остановка merge: ${message}`)
      this.finish(id,decision?'decision_required':'failed',message,decision?'Обновите ветку или main и повторите merge.':'Исправьте причину и повторите merge.',decision?'decision_required':'merge')
    } finally {
      await cleanupWorktrees()
      const current=this.deps.db.getMergeRunRaw(id)
      if(current?.startedAt&&current.finishedAt)this.log(id,`Общая длительность merge: ${current.finishedAt-current.startedAt} мс`)
    }
  }
  private finish(id:string,status:'success'|'failed'|'cancelled'|'decision_required',error:string|null,action:string|null,column:'done'|'merge'|'decision_required'):void {
    const run=this.deps.db.getMergeRunRaw(id); if(!run||terminal.has(run.status))return
    this.deps.db.updateMergeRun(id,{status,stage:status,finishedAt:this.now(),error,recommendedAction:action}); this.deps.db.moveMergeTask(run.projectId,run.taskId,column); this.emit(id); this.deps.boardChanged(run.projectId)
  }
  /** Закрытие задачи: удаляет все активные копии её репозиториев на доступных
   *  машинах; недоступная машина оставляет запись до следующей очистки.
   *  Постоянный merge-клон проекта в учёте задач не значится и не трогается.
   *  Публичный: вызывается и при ручном переносе карточки в Done. */
  async releaseTaskRepositories(run:{taskId:string}):Promise<void> {
    for(const repo of this.deps.db.listActiveTaskRepositories(run.taskId)){
      if(!this.deps.isOnline(repo.agentId))continue
      try {
        const result=await this.deps.executor.run({agentId:repo.agentId,script:`rm -rf -- ${shellQuote(repo.path)}`,workdir:this.workspaceParent(repo.path),env:{},timeoutMs:60000,secrets:[]},()=>{})
        if(!result.exitCode)this.deps.db.markTaskRepositoryDeleted(repo.taskId,repo.agentId,repo.path)
      } catch { /* машина отвалилась в момент очистки — запись остаётся */ }
    }
  }
}
