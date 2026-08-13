import type { MergeCheck, MergeRun, MergeStage, MergeStageRecord, ServerMessage } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { CommandExecutor } from '../ci/types.js'
import { shellQuote } from '../ci/executor.js'

export interface MergeKbUpdateContext {
  run: MergeRun
  repo: string
  targetRef: string
  signal: AbortSignal
  log(chunk: string): void
}
export interface MergeRunManagerDeps { db: VoiceChatDb; executor: CommandExecutor; kbUpdate?(ctx:MergeKbUpdateContext):Promise<{ok:boolean;message:string;llmEngineId?:string|null;llmProvider?:'claude'|'codex';llmModel?:string}>; isOnline(id:string):boolean; broadcast(message:ServerMessage,userId:string):void; boardChanged(projectId:string):void; now?:()=>number }
const terminal = new Set(['success','failed','cancelled','decision_required'])
const validSha = /^[0-9a-f]{40}$/i
const validBranch = /^(?!-)(?!.*\.\.)(?!.*[~^:?*\[\]\\])[A-Za-z0-9._/-]+$/
/** Канонизирует Git URL до host/owner/repo: SSH- и HTTPS-формы одного
 *  репозитория совпадают (машинный insteadOf-rewrite меняет протокол). */
function canonicalGitUrl(value:string):string {
  return value.trim().toLowerCase().replace(/^[a-z+]+:\/\//,'').replace(/^[^@/]+@/,'').replace(':','/').replace(/\.git$/,'').replace(/\/+$/,'')
}
function testStages(value:string):string[] {
  const trimmed=value.trim()
  if(!trimmed)return ['npm run affected-check']
  if(!trimmed.startsWith('['))return [trimmed]
  try { const parsed=JSON.parse(trimmed); if(Array.isArray(parsed)){ const stages=parsed.filter((item):item is string=>typeof item==='string'&&item.trim().length>0).map(item=>item.trim()); if(stages.length)return stages } } catch { /* execute malformed value as a plain command for an explicit failure */ }
  return [trimmed]
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
    this.finish(id,'cancelled','Отменено пользователем','Можно безопасно повторить merge.','awaiting_merge')
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
  private workspaceParent(path:string):string {
    const normalized=path.replace(/[\\/]+$/,'')
    const split=Math.max(normalized.lastIndexOf('/'),normalized.lastIndexOf('\\'))
    if(split<=0)throw new Error('Некорректный путь подготовленного CI-workspace')
    return normalized.slice(0,split)
  }
  /** Постоянный merge-клон проекта на машине рана: {repos_root}/{project}/.merge.
   *  На машине workspace каталог проекта берётся из пути workspace, на другой
   *  машине — из её repos_root; клон переживает раны, дерево вычищается перед
   *  каждым merge, node_modules сохраняется между ранами. */
  private mergeBase(run:MergeRun,ws:{path:string;agentId:string|null}):{repo:string;parent:string;workdir:string;cacheDir:string} {
    const parent=(():string=>{
      if(!ws.agentId||ws.agentId===run.agentId)return this.workspaceParent(ws.path)
      const machine=this.deps.db.getProjectMachine(run.projectId,run.agentId)
      const root=machine?.reposRoot?.replace(/[\\/]+$/,'')
      if(!root)throw new Error('У выбранной машины нет каталога репозиториев (repos_root)')
      const segments=ws.path.replace(/[\\/]+$/,'').split(/[\\/]+/); segments.pop(); const projectDir=segments.pop()
      if(!projectDir)throw new Error('Некорректный путь подготовленного CI-workspace')
      return `${root}/${projectDir}`
    })()
    const workdir=(!ws.agentId||ws.agentId===run.agentId)?parent:this.workspaceParent(parent)
    return {repo:`${parent}/.merge`,parent,workdir,cacheDir:`${parent}/.merge-npm-cache`}
  }
  private async execute(id:string,ctl:AbortController):Promise<void> {
    let run=this.deps.db.getMergeRunRaw(id); if(!run)return
    try {
      if(run.pushStartedAt&&run.mergeSha){
        const project=this.deps.db.getProject(run.triggeredBy,run.projectId), ws=this.deps.db.findLatestPushedCiWorkspace(run.projectId,run.taskId)
        if(!project?.gitUrl||!ws?.path)throw new Error('Push начат, но данные проекта недоступны; требуется reconcile')
        const remote=await this.cmd(run,`git ls-remote ${shellQuote(project.gitUrl)} refs/heads/main`,this.mergeBase(run,ws).workdir,30000)
        if(remote.output.toLowerCase().startsWith(run.mergeSha.toLowerCase())){
          this.finish(id,'success',null,null,'done'); return
        }
        this.finish(id,'decision_required','Push был начат, но origin/main не совпадает с merge SHA','Проверьте удалённый main вручную; автоматический повтор push запрещён.','decision_required'); return
      }
      this.stage(id,'checking','running','Проверяю задачу, проект, workspace и машину')
      const project=this.deps.db.getProject(run.triggeredBy,run.projectId), ws=this.deps.db.findLatestPushedCiWorkspace(run.projectId,run.taskId)
      if(!project||!project.gitUrl||!ws?.pushed||!ws.path)throw new Error('Подготовленный CI-workspace или Git origin недоступен')
      if(ws.agentId!==run.agentId&&!this.deps.db.getProjectMachine(run.projectId,run.agentId))throw new Error('Выбранная машина не привязана к проекту')
      if(!this.deps.isOnline(run.agentId))throw new Error('Выбранная машина не в сети')
      if(run.targetBranch!=='main'||!validBranch.test(run.sourceBranch)||(run.sourceSha!==null&&!validSha.test(run.sourceSha)))throw new Error('Некорректный серверный снимок ветки')
      const {repo,parent,workdir,cacheDir}=this.mergeBase(run,ws)
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
        // Конфликты внутри docs/kb разрешаются по правилам самой базы
        // (kb-workflow «Почему нет merge-конфликтов»): индекс перегенерируется,
        // у тем конфликтуют только метаданные updated:/checked: — их нормализует
        // kb.mjs touch. Содержательное расхождение тем — exit 65 и решение
        // пользователя, как для любого не-БЗ конфликта.
        if(files.length>0&&files.every(f=>/^docs\/kb\/.+\.md$/.test(f))){
          this.stage(id,'resolving_conflicts','running','Конфликты только в docs/kb — разрешаю по правилам БЗ')
          const topics=files.filter(f=>f!=='docs/kb/README.md')
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
          const resolved=await this.cmd(run,`set -e\n${perFile}\nrm -f .merge-kb-base .merge-kb-ours .merge-kb-theirs .merge-kb-base.n .merge-kb-ours.n .merge-kb-theirs.n\nnode scripts/kb.mjs index\ngit add docs/kb/README.md\nnode scripts/kb.mjs check\ngit -c user.name=voiceAIChat -c user.email=merge@voicechat.local commit --no-edit`,repo,300000)
          if(resolved.exitCode||resolved.timedOut){
            this.stage(id,'resolving_conflicts','failed',`Конфликты: ${files.join(', ')} — содержательное расхождение тем БЗ`)
            this.finish(id,'decision_required','Конфликты требуют решения пользователя','Разрешите файлы в ветке задачи и повторите merge.','decision_required'); return
          }
          this.deps.db.updateMergeRun(id,{conflicts:[]})
          this.stage(id,'resolving_conflicts','passed',topics.length?'Метаданные тем нормализованы, индекс БЗ перегенерирован, merge продолжен':'Индекс БЗ перегенерирован, merge продолжен')
        } else {
          this.stage(id,'resolving_conflicts','failed',`Конфликты: ${files.join(', ')||'не удалось определить'}`)
          this.finish(id,'decision_required','Конфликты требуют решения пользователя','Разрешите файлы в ветке задачи и повторите merge.','decision_required'); return
        }
      }
      const rev=await this.cmd(run,'git rev-parse HEAD',repo,30000), mergeSha=rev.output.match(/[0-9a-f]{40}/i)?.[0]
      if(!mergeSha)throw new Error('Merge-коммит не создан')
      this.deps.db.updateMergeRun(id,{mergeSha}); this.stage(id,'merging','passed',`Создан merge ${mergeSha.slice(0,8)}`)

      this.stage(id,'kb_update','running','Актуализирую базу знаний по итоговому merged diff')
      if (!this.deps.kbUpdate) throw new Error('Обязательный обработчик актуализации базы знаний не подключён')
      const kbResult = await this.deps.kbUpdate({ run: this.deps.db.getMergeRunRaw(id) ?? run, repo, targetRef, signal: ctl.signal, log: chunk => this.log(id, chunk) })
      this.deps.db.updateMergeRun(id, {
        ...(kbResult.llmEngineId !== undefined ? { llmEngineId: kbResult.llmEngineId } : {}),
        ...(kbResult.llmProvider ? { llmProvider: kbResult.llmProvider } : {}),
        ...(kbResult.llmModel !== undefined ? { llmModel: kbResult.llmModel } : {})
      })
      if (!kbResult.ok) {
        this.stage(id,'kb_update','failed',kbResult.message)
        throw new Error(kbResult.message)
      }
      const kbCommitted = await this.cmd(run,`git add -- docs/kb\nif git diff --cached --quiet; then echo KB_TREE_UNCHANGED; else git -c user.name=voiceAIChat -c user.email=merge@voicechat.local commit --amend --no-edit; fi\ngit rev-parse HEAD`,repo,300000)
      const finalMergeSha = kbCommitted.output.match(/[0-9a-f]{40}/ig)?.at(-1)
      if (kbCommitted.exitCode || !finalMergeSha) throw new Error('Не удалось включить файловую базу знаний в merge-коммит')
      this.deps.db.updateMergeRun(id,{mergeSha:finalMergeSha})
      this.stage(id,'kb_update','passed',kbResult.message)

      this.stage(id,'testing','running','Проверяю зависимости merge-клона')
      // node_modules переживает раны: установка нужна только при изменении
      // package-lock.json; маркер живёт внутри node_modules (git clean его не трёт).
      const installed=await this.cmd(run,`LOCK=$(git hash-object package-lock.json)\nif [ -f node_modules/.merge-lock-sha ] && [ "$(cat node_modules/.merge-lock-sha)" = "$LOCK" ]; then echo DEPS_UP_TO_DATE; else npm_config_cache=${shellQuote(cacheDir)} npm ci --no-audit --no-fund && printf %s "$LOCK" > node_modules/.merge-lock-sha; fi`,repo,900000)
      if(installed.exitCode||installed.timedOut)throw new Error('Не удалось установить зависимости merge-клона')
      this.stage(id,'testing','running',installed.output.includes('DEPS_UP_TO_DATE')?'Зависимости актуальны (npm ci пропущен), запускаю проверки':'Запускаю обязательные проверки до push')
      const commands=testStages(project.testCommand??''), began=this.now()
      let tested:{exitCode:number|null;timedOut:boolean;output:string}={exitCode:0,timedOut:false,output:''}
      for(const command of commands){
        const result=await this.cmd(run,command,repo,1800000)
        tested={...result,output:tested.output+result.output}
        if(result.exitCode||result.timedOut)break
      }
      const check:MergeCheck={name:'Проверки проекта',command:commands.join('\n'),status:tested.exitCode===0&&!tested.timedOut?'passed':'failed',startedAt:began,finishedAt:this.now(),durationMs:this.now()-began,exitCode:tested.exitCode,timedOut:tested.timedOut,output:tested.output}
      this.deps.db.updateMergeRun(id,{checks:[check]})
      if(tested.exitCode||tested.timedOut)throw new Error(tested.timedOut?'Проверки превысили timeout':`Проверки упали (exit ${tested.exitCode})`)
      this.stage(id,'testing','passed','Все обязательные проверки прошли')

      this.stage(id,'pushing','running','Повторно проверяю origin/main перед push')
      const refreshed=await this.cmd(run,`git fetch --no-tags origin +refs/heads/main:${shellQuote(targetRef)} +${shellQuote(run.sourceBranch)}:${shellQuote(sourceRef)}\nprintf 'TARGET=%s\\nSOURCE=%s\\n' "$(git rev-parse ${shellQuote(targetRef)})" "$(git rev-parse ${shellQuote(sourceRef)})"`,repo)
      const latest=refreshed.output.match(/TARGET=([0-9a-f]{40})/i)?.[1], latestSource=refreshed.output.match(/SOURCE=([0-9a-f]{40})/i)?.[1]
      if(!latest||latest.toLowerCase()!==target.toLowerCase())throw new Error('origin/main изменился конкурентно; повторите merge')
      if(!latestSource||latestSource.toLowerCase()!==source.toLowerCase())throw new Error('stale source: ветка изменилась перед push')
      const finalSha=this.deps.db.getMergeRunRaw(id)?.mergeSha
      if(!finalSha)throw new Error('Итоговый merge SHA отсутствует')
      this.deps.db.updateMergeRun(id,{pushStartedAt:this.now()})
      const pushed=await this.cmd(run,`git push --porcelain --force-with-lease=refs/heads/main:${target} origin ${finalSha}:refs/heads/main`,repo)
      if(pushed.exitCode)throw new Error('Безопасный push отклонён; требуется reconcile')
      const verified=await this.cmd(run,'git ls-remote origin refs/heads/main',repo,30000)
      if(!verified.output.toLowerCase().startsWith(finalSha.toLowerCase()))throw new Error('Неопределённый результат push; требуется reconcile')
      this.stage(id,'pushing','passed','origin/main подтверждён'); this.finish(id,'success',null,null,'done')
      await this.releaseTaskRepositories(run)
    } catch(error) {
      if(ctl.signal.aborted)return
      const message=error instanceof Error?error.message:String(error), decision=/stale source|конкурентно|reconcile|Неопределённый/i.test(message)
      this.finish(id,decision?'decision_required':'failed',message,decision?'Обновите ветку или main и повторите merge.':'Исправьте причину и повторите merge.',decision?'decision_required':'awaiting_merge')
    }
  }
  private finish(id:string,status:'success'|'failed'|'cancelled'|'decision_required',error:string|null,action:string|null,column:'done'|'awaiting_merge'|'decision_required'):void {
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
