import { assertReleaseBranch, type ProjectRelease, type ReleaseBranch, type ReleaseStepKind } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'

export interface ReleaseProjectTarget { projectId:string; agentId:string; path:string; baseBranch:string }
export interface ProductionTarget extends ReleaseProjectTarget { deployCommand:string; healthCheckCommand:string; expectedRepository:string }
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

/** Изолирует kb:index от общего checkout и не перезаписывает конкурентно сдвинутую release-ветку. */
export function releaseKnowledgeBaseCommand(target:ReleaseProjectTarget,releaseBranch:string):string {
  const branch=quote(releaseBranch)
  const ref=quote(`refs/heads/${releaseBranch}`)
  return at(target,`tmp="$(mktemp -d)" && cleanup(){ git worktree remove --force "$tmp" >/dev/null 2>&1 || rmdir "$tmp" >/dev/null 2>&1 || true; } && trap cleanup EXIT && git fetch origin ${branch} && expected="$(git rev-parse FETCH_HEAD)" && git worktree add --detach "$tmp" "$expected" && cd "$tmp" && npm run kb:index && changed="$(git status --porcelain --untracked-files=no)" && if [ -n "$changed" ]; then if [ "$changed" != " M docs/kb/README.md" ]; then echo "Release-preflight остановлен: kb:index изменил неожиданные файлы"; echo "$changed"; exit 1; fi; git add docs/kb/README.md && git commit -m 'docs: обновить индекс БЗ перед релизом' && git push --force-with-lease=${ref}:$expected origin HEAD:${ref}; fi`)
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

export class ReleaseManager {
  private readonly preparing=new Set<string>()
  private readonly deploying=new Set<string>()
  constructor(private readonly db:VoiceChatDb,private readonly runtime:ReleaseRuntime){}

  async listBranches(target:ReleaseProjectTarget):Promise<ReleaseBranch[]> {
    const result=await this.runtime.exec(target,git(target,`fetch --prune origin '+refs/heads/release/*:refs/remotes/origin/release/*' && git for-each-ref --format='%(refname:short) %(objectname)' refs/remotes/origin/release/`),120_000)
    if(result.exitCode!==0)throw new Error(result.output||'Не удалось обновить release-ветки')
    return result.output.split(/\r?\n/).map(line=>line.trim().split(/\s+/)).filter(parts=>parts.length===2).flatMap(([remote,sha])=>{
      const branch=remote!.replace(/^origin\//,'')
      try{return [{branch,version:assertReleaseBranch(branch),sha:sha!}]}catch{return []}
    }).sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}))
  }

  async createBranch(userId:string,target:ReleaseProjectTarget,branch:string,baseBranch:string):Promise<ProjectRelease> {
    const version=assertReleaseBranch(branch)
    if(this.preparing.has(target.projectId))throw new Error('Подготовка release-ветки уже выполняется')
    if(baseBranch!==target.baseBranch&&!assertReleaseBranch(baseBranch))throw new Error('Недопустимая базовая ветка')
    if((await this.listBranches(target)).some(item=>item.branch===branch))throw new Error('Release-ветка уже существует')
    const created=await this.runtime.exec(target,git(target,`fetch origin ${quote(baseBranch)} && git branch ${quote(branch)} FETCH_HEAD && git push origin ${quote(branch)}:refs/heads/${quote(branch)} && git rev-parse ${quote(branch)}`),120_000)
    if(created.exitCode!==0)throw new Error(created.output||'Не удалось создать release-ветку')
    const release=this.db.createProjectRelease(userId,target.projectId,{branch,version,sha:created.output.trim().split(/\r?\n/).at(-1)!,status:'preparing'})
    this.preparing.add(target.projectId)
    void this.prepare(userId,target,release).finally(()=>this.preparing.delete(target.projectId))
    return release
  }

  async start(userId:string,ciTarget:ReleaseProjectTarget,production:ProductionTarget,branch:string):Promise<ProjectRelease> {
    assertReleaseBranch(branch)
    if(this.deploying.has(ciTarget.projectId))throw new Error('Другой production deploy уже выполняется')
    if(this.runtime.isOnline?.(production.agentId)===false)throw new Error('Production-машина offline')
    const prepared=this.db.listProjectReleases(userId,ciTarget.projectId).find(item=>item.branch===branch&&item.status==='ready')
    if(!prepared)throw new Error('Release-ветка не прошла подготовку')
    const remote=(await this.listBranches(ciTarget)).find(item=>item.branch===branch)
    if(!remote)throw new Error('Выбранная release-ветка отсутствует в origin')
    if(remote.sha!==prepared.sha)throw new Error('SHA release-ветки изменился после подготовки')
    const attempt=this.db.createProjectRelease(userId,ciTarget.projectId,{branch,version:prepared.version,sha:prepared.sha,previousReleaseId:prepared.id,status:'queued'})
    this.db.setProjectReleaseStep(attempt.id,'regression','skipped','Проверка пройдена при подготовке ветки',userId)
    this.db.setProjectReleaseStep(attempt.id,'knowledge_base','skipped','Проверка пройдена при подготовке ветки',userId)
    this.deploying.add(ciTarget.projectId)
    void this.deploy(userId,production,attempt).finally(()=>this.deploying.delete(ciTarget.projectId))
    return attempt
  }

  private async prepare(actor:string,target:ReleaseProjectTarget,release:ProjectRelease):Promise<void> {
    this.db.setProjectReleaseStatus(release.id,'checking',actor)
    try{
      this.db.setProjectReleaseStep(release.id,'knowledge_base','running','',actor)
      await this.runtime.prepareKnowledgeBase(release.branch,target)
      const found=(await this.listBranches(target)).find(item=>item.branch===release.branch)
      if(!found)throw new Error('Release-ветка отсутствует в origin после проверки БЗ')
      this.db.setProjectReleaseSha(release.id,found.sha)
      this.db.setProjectReleaseStep(release.id,'knowledge_base','passed','Индекс БЗ проверен и зафиксирован',actor)
      this.db.setProjectReleaseStep(release.id,'regression','running','',actor)
      const regression=await this.runtime.exec(target,git(target,`checkout --detach ${quote(found.sha)} && npm run affected-check`),300_000)
      if(regression.exitCode!==0||regression.timedOut)throw new Error(regression.output||'Regression завершился с ошибкой')
      this.db.setProjectReleaseStep(release.id,'regression','passed',regression.output,actor)
      for(const kind of ['switching','building','health_check'] as const)this.db.setProjectReleaseStep(release.id,kind,'skipped','Выполняется только при deploy',actor)
      this.db.setProjectReleaseStatus(release.id,'ready',actor)
    }catch(error){
      const log=error instanceof Error?error.message:String(error)
      const current=this.db.getProjectRelease(actor,target.projectId,release.id)
      const kind=current?.steps.find(step=>step.status==='running')?.kind??'knowledge_base'
      this.db.setProjectReleaseStep(release.id,kind,'failed',log,actor)
      this.db.setProjectReleaseStatus(release.id,'failed',actor)
    }
  }

  private async deploy(actor:string,target:ProductionTarget,release:ProjectRelease):Promise<void> {
    try{
      this.db.setProjectReleaseStatus(release.id,'switching',actor)
      this.db.setProjectReleaseStep(release.id,'switching','running','',actor)
      const switchCommand=at(target,`test -z "$(git status --porcelain)" && test "$(git config --get remote.origin.url)" = ${quote(target.expectedRepository)} && git fetch origin ${quote(release.branch)} && test "$(git rev-parse FETCH_HEAD)" = ${quote(release.sha)} && git cat-file -e ${quote(`${release.sha}^{commit}`)} && git checkout -B ${quote(release.branch)} ${quote(release.sha)} && git reset --hard ${quote(release.sha)}`)
      const switched=await this.runtime.exec(target,switchCommand,120_000)
      if(switched.exitCode!==0||switched.timedOut)throw new Error(switched.output||'Не удалось синхронизировать production checkout')
      this.db.setProjectReleaseStep(release.id,'switching','passed',switched.output,actor)

      this.db.setProjectReleaseStatus(release.id,'building',actor)
      this.db.setProjectReleaseStep(release.id,'building','running','',actor)
      const built=await this.runtime.exec(target,at(target,target.deployCommand),300_000)
      if(built.exitCode!==0||built.timedOut)throw new Error(built.output||'Production build завершился с ошибкой')
      this.db.setProjectReleaseStep(release.id,'building','passed',built.output,actor)

      this.db.setProjectReleaseStatus(release.id,'health_check',actor)
      this.db.setProjectReleaseStep(release.id,'health_check','running','',actor)
      const health=await this.runtime.exec(target,at(target,target.healthCheckCommand),120_000)
      if(health.exitCode!==0||health.timedOut)throw new Error(health.output||'Health-check завершился с ошибкой')
      this.db.setProjectReleaseStep(release.id,'health_check','passed',health.output,actor)
      this.db.setProjectReleaseStatus(release.id,'released',actor)
    }catch(error){
      const log=error instanceof Error?error.message:String(error)
      const current=this.db.getProjectRelease(actor,target.projectId,release.id)
      const kind=current?.steps.find(step=>step.status==='running')?.kind
      if(kind)this.db.setProjectReleaseStep(release.id,kind,'failed',log,actor)
      this.db.setProjectReleaseStatus(release.id,'failed',actor)
    }
  }
}
