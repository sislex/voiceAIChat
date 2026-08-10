import { RELEASE_STEP_ORDER, assertReleaseBranch, type ProjectRelease, type ReleaseBranch, type ReleaseStepKind } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'

export interface ReleaseProjectTarget { projectId:string; agentId:string; path:string; baseBranch:string }
export interface ReleaseCommandResult { exitCode:number|null; output:string; timedOut?:boolean }
export interface ReleaseRuntime {
  exec(target:ReleaseProjectTarget, command:string, timeoutMs:number):Promise<ReleaseCommandResult>
  updateKnowledgeBase(release:ProjectRelease,target:ReleaseProjectTarget):Promise<void>
  deployProduction():Promise<void>
  healthCheck(release:ProjectRelease,target:ReleaseProjectTarget):Promise<void>
  cleanup(release:ProjectRelease,target:ReleaseProjectTarget):Promise<void>
}
const quote=(value:string):string=>`'${value.replace(/'/g, `'"'"'`)}'`
const git=(target:ReleaseProjectTarget,args:string):string=>`cd ${quote(target.path)} && git ${args}`

export class ReleaseManager {
  private readonly running=new Set<string>()
  constructor(private readonly db:VoiceChatDb,private readonly runtime:ReleaseRuntime){}

  async listBranches(target:ReleaseProjectTarget):Promise<ReleaseBranch[]> {
    const result=await this.runtime.exec(target,git(target,`fetch --prune origin '+refs/heads/release/*:refs/remotes/origin/release/*' && git for-each-ref --format='%(refname:short) %(objectname)' refs/remotes/origin/release/`),120_000)
    if (result.exitCode!==0) throw new Error(result.output||'Не удалось обновить release-ветки')
    return result.output.split(/\r?\n/).map(line=>line.trim().split(/\s+/)).filter(parts=>parts.length===2).flatMap(([remote,sha])=>{
      const branch=remote!.replace(/^origin\//,'')
      try { return [{branch,version:assertReleaseBranch(branch),sha:sha!}] } catch { return [] }
    }).sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}))
  }

  async createBranch(target:ReleaseProjectTarget,branch:string,baseBranch:string):Promise<ReleaseBranch> {
    const version=assertReleaseBranch(branch)
    if (baseBranch!==target.baseBranch && !assertReleaseBranch(baseBranch)) throw new Error('Недопустимая базовая ветка')
    const existing=await this.listBranches(target)
    if (existing.some(item=>item.branch===branch)) throw new Error('Release-ветка уже существует')
    const result=await this.runtime.exec(target,git(target,`fetch origin ${quote(baseBranch)} && git branch ${quote(branch)} FETCH_HEAD && git push origin ${quote(branch)}:refs/heads/${quote(branch)}`),120_000)
    if (result.exitCode!==0) throw new Error(result.output||'Не удалось создать release-ветку')
    const resolved=await this.runtime.exec(target,git(target,`rev-parse refs/heads/${quote(branch)}`),30_000)
    if (resolved.exitCode!==0) throw new Error(resolved.output||'Не удалось определить SHA релиза')
    return {branch,version,sha:resolved.output.trim()}
  }

  async start(userId:string,target:ReleaseProjectTarget,branch:string,models:Partial<Record<ReleaseStepKind,string>>={},previousReleaseId?:string):Promise<ProjectRelease> {
    assertReleaseBranch(branch)
    if (this.running.has(target.projectId)) throw new Error('Публикация релиза уже выполняется')
    const found=(await this.listBranches(target)).find(item=>item.branch===branch)
    if (!found) throw new Error('Выбранная release-ветка отсутствует в origin')
    const release=this.db.createProjectRelease(userId,target.projectId,{...found,models,previousReleaseId})
    this.running.add(target.projectId)
    void this.execute(userId,target,release).finally(()=>this.running.delete(target.projectId))
    return release
  }

  private async execute(actor:string,target:ReleaseProjectTarget,release:ProjectRelease):Promise<void> {
    this.db.setProjectReleaseStatus(release.id,'running',actor)
    for (const kind of RELEASE_STEP_ORDER) {
      this.db.setProjectReleaseStep(release.id,kind,'running','',actor)
      try {
        const log=await this.runStep(kind,release,target)
        this.db.setProjectReleaseStep(release.id,kind,'passed',log,actor)
      } catch(error) {
        const log=error instanceof Error?error.message:String(error)
        this.db.setProjectReleaseStep(release.id,kind,'failed',log,actor)
        this.db.setProjectReleaseStatus(release.id,'failed',actor)
        return
      }
    }
    this.db.setProjectReleaseStatus(release.id,'released',actor)
  }

  private async runStep(kind:ReleaseStepKind,release:ProjectRelease,target:ReleaseProjectTarget):Promise<string> {
    if(kind==='knowledge_base'){await this.runtime.updateKnowledgeBase(release,target);return 'База знаний обновлена'}
    if(kind==='production_deploy'){await this.runtime.deployProduction();return 'Production deploy принят'}
    if(kind==='health_check'){await this.runtime.healthCheck(release,target);return 'Health-check пройден'}
    if(kind==='cleanup'){await this.runtime.cleanup(release,target);return 'Feature preview и workspace удалены'}
    const commands:Record<'regression'|'merge_main'|'push_main',string>={
      regression:`checkout --detach ${quote(release.sha)} && npm run affected-check`,
      merge_main:`fetch origin ${quote(target.baseBranch)} ${quote(release.branch)} && git checkout -B ${quote(target.baseBranch)} origin/${quote(target.baseBranch)} && git merge --no-ff --no-edit ${quote(release.sha)}`,
      push_main:`tag -f ${quote(`v${release.version}`)} ${quote(release.sha)} && git push --atomic origin HEAD:refs/heads/${quote(target.baseBranch)} refs/tags/${quote(`v${release.version}`)}`
    }
    const result=await this.runtime.exec(target,git(target,commands[kind]),kind==='regression'?300_000:120_000)
    if(result.exitCode!==0||result.timedOut) throw new Error(result.output||`${kind} завершился с ошибкой`)
    return result.output
  }
}
