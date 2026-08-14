import { assertReleaseBranch, DEFAULT_RELEASE_TIMEOUTS, type ProjectRelease, type ReleaseBranch, type ReleaseStepKind, type ReleaseTimeouts } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'

export interface ReleaseProjectTarget { projectId:string; agentId:string; path:string; baseBranch:string; testCommand:string; gitUrl:string; prepareCheckout:boolean; limits?:ReleaseTimeouts }
export interface ProductionTarget extends ReleaseProjectTarget { deployCommand:string; healthCheckCommand:string; expectedRepository:string }
export const RELEASE_TEST_TIMEOUT_MS=600_000
export interface ReleaseCommandResult { exitCode:number|null; output:string; timedOut?:boolean }
export interface ReleaseRuntime {
  exec(target:ReleaseProjectTarget, command:string, timeoutMs:number):Promise<ReleaseCommandResult>
  prepareKnowledgeBase(branch:string,target:ReleaseProjectTarget):Promise<void>
  isOnline?(agentId:string):boolean
  /** Legacy hooks kept in the injected test surface; deploy no longer calls them. */
  updateKnowledgeBase?(release:ProjectRelease,target:ReleaseProjectTarget):Promise<void>
  deployProduction?():Promise<void>
  healthCheck?(release:ProjectRelease,target:ReleaseProjectTarget):Promise<void>
  cleanup?(release:ProjectRelease,target:ReleaseProjectTarget):Promise<void>
}
const quote=(value:string):string=>`'${value.replace(/'/g, `'"'"'`)}'`
const at=(target:ReleaseProjectTarget,command:string):string=>`cd ${quote(target.path)} && ${command}`
const git=(target:ReleaseProjectTarget,args:string):string=>at(target,`git ${args}`)

export function releaseCheckoutCommand(target:ReleaseProjectTarget):string {
  const parent=target.path.replace(/[\\/]+$/,'').replace(/[\\/][^\\/]+$/,'')||'/'
  return `if [ ! -e ${quote(target.path)} ]; then mkdir -p ${quote(parent)} && git clone -- ${quote(target.gitUrl)} ${quote(target.path)}; elif [ ! -d ${quote(`${target.path}/.git`)} ]; then echo 'Каталог release checkout уже существует, но не является Git-репозиторием'; exit 1; elif [ "$(git -C ${quote(target.path)} config --get remote.origin.url)" != ${quote(target.gitUrl)} ]; then echo 'Каталог release checkout содержит другой remote.origin.url и не будет перезаписан'; git -C ${quote(target.path)} config --get remote.origin.url; exit 1; else echo 'Release checkout уже подготовлен, повторный clone не требуется'; fi`
}

/** Изолирует kb:index от общего checkout и не перезаписывает конкурентно сдвинутую release-ветку. */
export function releaseKnowledgeBaseCommand(target:ReleaseProjectTarget,releaseBranch:string):string {
  const branchRef=quote(`refs/heads/${releaseBranch}`)
  const fetchedRef=quote(`refs/voicechat/preflight/${releaseBranch}`)
  const refspec=quote(`+refs/heads/${releaseBranch}:refs/voicechat/preflight/${releaseBranch}`)
  return at(target,`tmp="$(mktemp -d)" && cleanup(){ git update-ref -d ${fetchedRef} >/dev/null 2>&1 || true; git worktree remove --force "$tmp" >/dev/null 2>&1 || rmdir "$tmp" >/dev/null 2>&1 || true; } && trap cleanup EXIT && git fetch origin ${refspec} && expected="$(git rev-parse ${fetchedRef})" && git worktree add --detach "$tmp" "$expected" && cd "$tmp" && npm run kb:index && changed="$(git status --porcelain --untracked-files=no)" && if [ -n "$changed" ]; then if [ "$changed" != " M docs/kb/README.md" ]; then echo "Release-preflight остановлен: kb:index изменил неожиданные файлы"; echo "$changed"; exit 1; fi; git add docs/kb/README.md && git commit -m 'docs: обновить индекс БЗ перед релизом' && git push --force-with-lease=${branchRef}:$expected origin HEAD:${branchRef}; fi`)
}

/** Использует уникальный ref попытки: глобальный FETCH_HEAD меняется любым параллельным fetch. */
export function releaseSwitchCommand(target:ProductionTarget,release:Pick<ProjectRelease,'id'|'branch'|'sha'>):string {
  const fetchedRef=`refs/voicechat/releases/${release.id}`
  const refspec=quote(`+refs/heads/${release.branch}:${fetchedRef}`)
  return at(target,`test -z "$(git status --porcelain)" && test "$(git config --get remote.origin.url)" = ${quote(target.expectedRepository)} && git fetch origin ${refspec} && test "$(git rev-parse ${quote(fetchedRef)})" = ${quote(release.sha)} && git cat-file -e ${quote(`${release.sha}^{commit}`)} && git checkout -B ${quote(release.branch)} ${quote(release.sha)} && git reset --hard ${quote(release.sha)} && git update-ref -d ${quote(fetchedRef)}`)
}

export async function waitForReleaseHealth(
  expectedVersion:string,
  probe:()=>Promise<{ok?:boolean;version?:string}>,
  options:{attempts?:number;intervalMs?:number;sleep?:(ms:number)=>Promise<void>}={}
):Promise<void>{
  const attempts=options.attempts??150, intervalMs=options.intervalMs??2_000
  const sleep=options.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms)))
  let last='production ещё не ответил'
  for(let attempt=0;attempt<attempts;attempt+=1){
    try{const health=await probe();if(health.ok===true&&health.version===expectedVersion)return;last=`ok=${String(health.ok)}, version=${health.version??'не указана'}`}catch(error){last=error instanceof Error?error.message:String(error)}
    if(attempt+1<attempts)await sleep(intervalMs)
  }
  throw new Error(`Production не перешёл на версию ${expectedVersion}: ${last}`)
}

function healthMetadata(output:string):{commit:string;version:string|null}|null {
  for(const line of output.split(/\r?\n/).reverse()){
    try{const value=JSON.parse(line) as {ok?:boolean;commit?:string;version?:unknown};if(value.ok===true&&typeof value.commit==='string')return {commit:value.commit,version:typeof value.version==='string'?value.version:null}}catch{}
  }
  return null
}
const sameCommit=(actual:string,expected:string):boolean=>actual===expected||actual.startsWith(expected)||expected.startsWith(actual)
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))

export function releaseTestCommands(value:string):string[] {
  try {
    const parsed=JSON.parse(value) as unknown
    if(Array.isArray(parsed)&&parsed.length>0&&parsed.every(item=>typeof item==='string'&&item.trim())) return parsed.map(item=>item.trim())
  } catch {}
  return [value]
}

const regressionWorktreePath=(target:ReleaseProjectTarget,releaseId:string):string=>`${target.path.replace(/[\\/]+$/,'')}.voicechat-regression-${releaseId}`
export const releaseRegressionSetupCommand=(target:ReleaseProjectTarget,releaseId:string,sha:string):string=>
  at(target,`test ! -e ${quote(regressionWorktreePath(target,releaseId))} && git worktree add --detach ${quote(regressionWorktreePath(target,releaseId))} ${quote(sha)}`)
export const releaseRegressionStageCommand=(target:ReleaseProjectTarget,releaseId:string,command:string):string=>
  `cd ${quote(regressionWorktreePath(target,releaseId))} && (${command})`
export const releaseRegressionCleanupCommand=(target:ReleaseProjectTarget,releaseId:string):string=>
  at(target,`git worktree remove --force ${quote(regressionWorktreePath(target,releaseId))}`)

export class ReleaseManager {
  private readonly preparing=new Set<string>()
  private readonly deploying=new Set<string>()
  constructor(private readonly db:VoiceChatDb,private readonly runtime:ReleaseRuntime){}

  isOnline(agentId:string):boolean{return this.runtime.isOnline?.(agentId)!==false}

  async listBranches(target:ReleaseProjectTarget):Promise<ReleaseBranch[]> {
    const result=await this.runtime.exec(target,`git ls-remote --heads ${quote(target.gitUrl)} ${quote('refs/heads/release/*')}`,120_000)
    if(result.exitCode!==0)throw new Error(result.output||'Не удалось получить release-ветки из origin')
    return result.output.split(/\r?\n/).map(line=>line.trim().split(/\s+/)).filter(parts=>parts.length===2).flatMap(([sha,ref])=>{
      const branch=ref!.replace(/^refs\/heads\//,'')
      try{return [{branch,version:assertReleaseBranch(branch),sha:sha!}]}catch{return []}
    }).sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}))
  }

  async deleteBranch(userId:string,target:ReleaseProjectTarget,releaseId:string,branch:string):Promise<void> {
    assertReleaseBranch(branch)
    if(target.prepareCheckout)await this.ensureCheckout(target)
    const release=this.db.getProjectRelease(userId,target.projectId,releaseId)
    if(!release||release.branch!==branch||release.previousReleaseId)throw new Error('Release не найден')
    if(!['ready','failed'].includes(release.status))throw new Error('Активный релиз удалить нельзя')
    const deleted=await this.runtime.exec(target,git(target,`push origin --delete ${quote(branch)}`),120_000)
    if(deleted.exitCode!==0||deleted.timedOut)throw new Error(deleted.output||'Не удалось удалить release-ветку из origin')
    this.db.softDeleteProjectRelease(userId,target.projectId,releaseId)
  }

  async createBranch(userId:string,target:ReleaseProjectTarget,branch:string,baseBranch:string):Promise<ProjectRelease> {
    const version=assertReleaseBranch(branch)
    if(this.preparing.has(target.projectId))throw new Error('Подготовка release-ветки уже выполняется')
    if(baseBranch!==target.baseBranch&&!assertReleaseBranch(baseBranch))throw new Error('Недопустимая базовая ветка')
    if((await this.listBranches(target)).some(item=>item.branch===branch))throw new Error('Release-ветка уже существует')
    const release=this.db.createProjectRelease(userId,target.projectId,{branch,version,sha:'',status:'preparing',agentId:target.agentId,checkoutPath:target.path,limits:target.limits??DEFAULT_RELEASE_TIMEOUTS})
    this.preparing.add(target.projectId)
    void this.prepare(userId,target,release,baseBranch).finally(()=>this.preparing.delete(target.projectId))
    return release
  }

  private async ensureCheckout(target:ReleaseProjectTarget):Promise<ReleaseCommandResult> {
    return this.runtime.exec(target,releaseCheckoutCommand(target),target.limits?.checkoutMs??DEFAULT_RELEASE_TIMEOUTS.checkoutMs)
  }

  async start(userId:string,ciTarget:ReleaseProjectTarget,production:ProductionTarget,branch:string):Promise<ProjectRelease> {
    const branchVersion=assertReleaseBranch(branch)
    if(this.deploying.has(ciTarget.projectId))throw new Error('Другой production deploy уже выполняется')
    if(this.runtime.isOnline?.(production.agentId)===false)throw new Error('Production-машина offline')
    const prepared=this.db.listProjectReleases(userId,ciTarget.projectId).find(item=>item.branch===branch&&item.status==='ready')
    if(!prepared)throw new Error('Release-ветка не прошла подготовку')
    if(prepared.version!==branchVersion)throw new Error(`Версия подготовки ${prepared.version} не соответствует ветке ${branch} (${branchVersion})`)
    const remote=(await this.listBranches(ciTarget)).find(item=>item.branch===branch)
    if(!remote)throw new Error('Выбранная release-ветка отсутствует в origin')
    if(remote.sha!==prepared.sha)throw new Error('SHA release-ветки изменился после подготовки')
    const attempt=this.db.createProjectRelease(userId,ciTarget.projectId,{branch,version:prepared.version,sha:prepared.sha,previousReleaseId:prepared.id,status:'queued',agentId:production.agentId,checkoutPath:production.path,limits:production.limits??DEFAULT_RELEASE_TIMEOUTS})
    this.db.setProjectReleaseStep(attempt.id,'checkout','skipped','Checkout подготовлен при создании release-ветки',userId)
    this.db.setProjectReleaseStep(attempt.id,'regression','skipped','Проверка пройдена при подготовке ветки',userId)
    this.db.setProjectReleaseStep(attempt.id,'knowledge_base','skipped','Проверка пройдена при подготовке ветки',userId)
    this.deploying.add(ciTarget.projectId)
    void this.deploy(userId,production,attempt).finally(()=>this.deploying.delete(ciTarget.projectId))
    return attempt
  }

  private async prepare(actor:string,target:ReleaseProjectTarget,release:ProjectRelease,baseBranch:string):Promise<void> {
    try{
      if(target.prepareCheckout){
        this.db.setProjectReleaseStep(release.id,'checkout','running','',actor)
        const checkout=await this.ensureCheckout(target)
        if(checkout.timedOut)throw new Error(`Подготовка checkout превысила лимит ${Math.round((target.limits?.checkoutMs??DEFAULT_RELEASE_TIMEOUTS.checkoutMs)/1000)} с\n${checkout.output}`)
        if(checkout.exitCode!==0)throw new Error(checkout.output||'Не удалось подготовить release checkout')
        this.db.setProjectReleaseStep(release.id,'checkout','passed',checkout.output,actor)
      }else this.db.setProjectReleaseStep(release.id,'checkout','skipped','Используется существующий checkout',actor)
      const created=await this.runtime.exec(target,git(target,`fetch origin ${quote(baseBranch)} && git branch ${quote(release.branch)} FETCH_HEAD && git push origin ${quote(release.branch)}:refs/heads/${quote(release.branch)} && git rev-parse ${quote(release.branch)}`),120_000)
      if(created.exitCode!==0)throw new Error(created.output||'Не удалось создать release-ветку')
      this.db.setProjectReleaseSha(release.id,created.output.trim().split(/\r?\n/).at(-1)!)
      this.db.setProjectReleaseStatus(release.id,'checking',actor)
      this.db.setProjectReleaseStep(release.id,'knowledge_base','running','',actor)
      await this.runtime.prepareKnowledgeBase(release.branch,target)
      const found=(await this.listBranches(target)).find(item=>item.branch===release.branch)
      if(!found)throw new Error('Release-ветка отсутствует в origin после проверки БЗ')
      this.db.setProjectReleaseSha(release.id,found.sha)
      this.db.setProjectReleaseStep(release.id,'knowledge_base','passed','Индекс БЗ проверен и зафиксирован',actor)
      this.db.setProjectReleaseStep(release.id,'regression','running','',actor)
      const logs:string[]=[]
      const commands=releaseTestCommands(target.testCommand)
      const setup=await this.runtime.exec(target,releaseRegressionSetupCommand(target,release.id,found.sha),30_000)
      if(setup.timedOut||setup.exitCode!==0)throw new Error(setup.output||'Не удалось создать изолированный worktree для Regression')
      try{
        for(let index=0;index<commands.length;index+=1){
          // Группировка удерживает всю составную shell-стадию (включая `&`/`wait`) внутри временного worktree.
          const limit=this.db.getProjectRelease(actor,target.projectId,release.id)?.steps.find(step=>step.kind==='regression')?.limitMs??RELEASE_TEST_TIMEOUT_MS
          const regression=await this.runtime.exec(target,releaseRegressionStageCommand(target,release.id,commands[index]!),limit)
          logs.push(`$ ${commands[index]}\n${regression.output}`)
          if(regression.timedOut)throw new Error(`Regression, стадия ${index+1}/${commands.length}: фактическая длительность превысила лимит ${Math.round(limit/1000)} с\n${regression.output}`)
          if(regression.exitCode!==0)throw new Error(regression.output||`Regression-команда ${index+1}/${commands.length} завершилась с ошибкой`)
        }
      }finally{
        await this.runtime.exec(target,releaseRegressionCleanupCommand(target,release.id),30_000)
      }
      this.db.setProjectReleaseStep(release.id,'regression','passed',logs.join('\n\n'),actor)
      for(const kind of ['switching','building','health_check'] as const)this.db.setProjectReleaseStep(release.id,kind,'skipped','Выполняется только при deploy',actor)
      this.db.setProjectReleaseStatus(release.id,'ready',actor)
    }catch(error){
      const log=error instanceof Error?error.message:String(error)
      const current=this.db.getProjectRelease(actor,target.projectId,release.id)
      const kind=current?.steps.find(step=>step.status==='running')?.kind??'checkout'
      this.db.setProjectReleaseStep(release.id,kind,'failed',log,actor)
      this.db.setProjectReleaseStatus(release.id,'failed',actor)
    }
  }

  reconcile(resolveTarget:(release:ProjectRelease)=>ProductionTarget|null):void {
    for(const release of this.db.listActiveProjectReleases()){
      const actor=release.triggeredBy
      const target=resolveTarget(release)
      if(!target){
        const kind=release.steps.find(step=>step.status==='running')?.kind
        if(kind)this.db.setProjectReleaseStep(release.id,kind,'failed','Production-конфигурация недоступна после рестарта',actor)
        this.db.setProjectReleaseStatus(release.id,'failed',actor)
        continue
      }
      if(release.status==='switching'){
        this.db.setProjectReleaseStep(release.id,'switching','failed','Перезапуск во время переключения checkout',actor)
        this.db.setProjectReleaseStatus(release.id,'failed',actor)
        continue
      }
      if(release.status==='building')this.db.setProjectReleaseStep(release.id,'building','passed','Production deploy продолжен после рестарта',actor)
      this.db.setProjectReleaseStatus(release.id,'health_check',actor)
      this.db.setProjectReleaseStep(release.id,'health_check','running','Ожидание production с ожидаемым SHA после рестарта',actor)
      this.deploying.add(release.projectId)
      void this.monitorHealth(actor,target,release).finally(()=>this.deploying.delete(release.projectId))
    }
  }

  private async monitorHealth(actor:string,target:ProductionTarget,release:ProjectRelease):Promise<void> {
    let last='Production ещё не ответил'
    const limit=this.db.getProjectRelease(actor,target.projectId,release.id)?.steps.find(step=>step.kind==='health_check')?.limitMs??DEFAULT_RELEASE_TIMEOUTS.healthCheckMs
    const started=Date.now()
    for(let attempt=0;Date.now()-started<limit;attempt+=1){
      try{
        const result=await this.runtime.exec(target,at(target,target.healthCheckCommand),15_000)
        const metadata=result.exitCode===0&&!result.timedOut?healthMetadata(result.output):null
        if(metadata&&sameCommit(metadata.commit,release.sha)&&metadata.version===release.version){
          this.db.setProjectReleaseStep(release.id,'health_check','passed',result.output,actor)
          this.db.setProjectReleaseStatus(release.id,'released',actor)
          return
        }
        last=metadata?`Production отвечает SHA ${metadata.commit}, version=${metadata.version??'не указана'}; ожидаются ${release.sha}, version=${release.version}`:(result.output||'Health-check не вернул метаданные релиза')
      }catch(error){last=error instanceof Error?error.message:String(error)}
      if(Date.now()-started<limit)await sleep(Math.min(2_000,Math.max(0,limit-(Date.now()-started))))
    }
    this.db.setProjectReleaseStep(release.id,'health_check','failed',`Health-check: фактическая длительность ${Math.round((Date.now()-started)/1000)} с, лимит ${Math.round(limit/1000)} с. ${last}`,actor)
    this.db.setProjectReleaseStatus(release.id,'failed',actor)
  }

  private async deploy(actor:string,target:ProductionTarget,release:ProjectRelease):Promise<void> {
    try{
      this.db.setProjectReleaseStatus(release.id,'switching',actor)
      this.db.setProjectReleaseStep(release.id,'switching','running','',actor)
      const switchCommand=releaseSwitchCommand(target,release)
      const switchLimit=this.db.getProjectRelease(actor,target.projectId,release.id)?.steps.find(step=>step.kind==='switching')?.limitMs??120_000
      const switched=await this.runtime.exec(target,switchCommand,switchLimit)
      if(switched.timedOut)throw new Error(`Переключение checkout: фактическая длительность превысила лимит ${Math.round(switchLimit/1000)} с\n${switched.output}`)
      if(switched.exitCode!==0)throw new Error(switched.output||'Не удалось синхронизировать production checkout')
      this.db.setProjectReleaseStep(release.id,'switching','passed',switched.output,actor)

      this.db.setProjectReleaseStatus(release.id,'building',actor)
      this.db.setProjectReleaseStep(release.id,'building','running','',actor)
      const buildLimit=this.db.getProjectRelease(actor,target.projectId,release.id)?.steps.find(step=>step.kind==='building')?.limitMs??300_000
      const built=await this.runtime.exec(target,at(target,`export VC_RELEASE_VERSION=${quote(release.version)} VC_RELEASE_SOURCE='protected-release' && echo 'production release metadata: version='"$VC_RELEASE_VERSION"' source='"$VC_RELEASE_SOURCE" && ${target.deployCommand}`),buildLimit)
      if(built.timedOut)throw new Error(`Сборка и обновление контейнеров: фактическая длительность превысила лимит ${Math.round(buildLimit/1000)} с\n${built.output}`)
      if(built.exitCode!==0)throw new Error(built.output||'Production build завершился с ошибкой')
      this.db.setProjectReleaseStep(release.id,'building','passed',built.output,actor)

      this.db.setProjectReleaseStatus(release.id,'health_check',actor)
      this.db.setProjectReleaseStep(release.id,'health_check','running','Ожидание production с ожидаемым SHA',actor)
      await this.monitorHealth(actor,target,release)
    }catch(error){
      const log=error instanceof Error?error.message:String(error)
      const current=this.db.getProjectRelease(actor,target.projectId,release.id)
      const kind=current?.steps.find(step=>step.status==='running')?.kind
      if(kind)this.db.setProjectReleaseStep(release.id,kind,'failed',log,actor)
      this.db.setProjectReleaseStatus(release.id,'failed',actor)
    }
  }
}
