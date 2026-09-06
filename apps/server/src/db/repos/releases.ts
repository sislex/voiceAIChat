// Домен «releases»: таблицы project_releases, project_release_steps, project_release_events.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import { RELEASE_STEP_ORDER, type ProjectRelease, type ProjectReleaseSummary, type ReleaseStepKind, type ReleaseStepStatus, type ReleaseTimeouts, DEFAULT_RELEASE_TIMEOUTS, validateReleaseTimeouts, releaseStepLimit } from '@voicechat/shared'
import { BaseRepo } from './base.js'

// ============== Релизы: строки БД ==================
interface ReleaseRow { id:string;project_id:string;version:string;branch:string;commit_sha:string;status:string;triggered_by:string;attempt:number;previous_release_id:string|null;created_at:number;released_at:number|null;agent_id:string|null;checkout_path:string|null;deleted_at:number|null }

interface ReleaseSummaryRow { id:string;branch:string;commit_sha:string;status:string;previous_release_id:string|null;created_at:number;started_at:number|null;finished_at:number|null;running:number }

interface ReleaseStepRow { id:string;release_id:string;kind:string;position:number;status:string;model:string|null;attempt:number;log:string;started_at:number|null;finished_at:number|null;limit_ms:number|null }
export class ReleasesRepo extends BaseRepo {
  createProjectRelease(userId: string, projectId: string, input: { branch: string; version: string; sha: string; status?: ProjectRelease['status']; models?: Partial<Record<ReleaseStepKind, string>>; previousReleaseId?: string | null; agentId?: string; checkoutPath?: string; limits?: ReleaseTimeouts }): ProjectRelease {
    if (!this.repos.projects.isProjectOwner(userId, projectId)) throw new Error('release permission required')
    const previous = input.previousReleaseId ? this.releaseRow(input.previousReleaseId) : null
    if (input.previousReleaseId && (!previous || previous.project_id !== projectId || previous.branch !== input.branch)) throw new Error('invalid previous release')
    // Номер попытки — всегда max+1 по ветке: после неудачного deploy повторная
    // попытка от того же подготовленного релиза не должна падать в UNIQUE.
    const nextByBranch = ((this.db.prepare(`SELECT MAX(attempt) AS n FROM project_releases WHERE project_id=? AND branch=?`).get(projectId,input.branch) as {n:number|null}).n ?? 0) + 1
    const attempt = previous ? Math.max(previous.attempt + 1, nextByBranch) : nextByBranch
    const id=this.newId(), now=this.now()
    this.db.transaction(()=>{
      const limits=validateReleaseTimeouts(input.limits??DEFAULT_RELEASE_TIMEOUTS)
      this.db.prepare(`INSERT INTO project_releases (id,project_id,version,branch,commit_sha,status,triggered_by,attempt,previous_release_id,created_at,agent_id,checkout_path) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id,projectId,input.version,input.branch,input.sha,input.status??'preparing',userId,attempt,input.previousReleaseId??null,now,input.agentId??null,input.checkoutPath??null)
      RELEASE_STEP_ORDER.forEach((kind,position)=>this.db.prepare(`INSERT INTO project_release_steps (id,release_id,kind,position,status,model,attempt,limit_ms) VALUES (?,?,?,?,?,?,?,?)`).run(this.newId(),id,kind,position,'queued',input.models?.[kind]??null,attempt,releaseStepLimit(kind,limits)))
      this.addReleaseEvent(id,'release.created',userId,{branch:input.branch,version:input.version,sha:input.sha,attempt})
    })()
    return this.getProjectRelease(userId,projectId,id) as ProjectRelease
  }

  listProjectReleases(userId:string,projectId:string):ProjectRelease[] {
    if (!this.repos.projects.isProjectMember(userId,projectId)) return []
    return (this.db.prepare(`SELECT id FROM project_releases WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at DESC`).all(projectId) as Array<{id:string}>).map(({id})=>this.mapProjectRelease(this.releaseRow(id)!))
  }

  listProjectReleaseSummaries(userId:string,projectId:string):ProjectReleaseSummary[] {
    if (!this.repos.projects.isProjectMember(userId,projectId)) return []
    const rows=this.db.prepare(`SELECT r.id,r.branch,r.commit_sha,r.status,r.previous_release_id,r.created_at,MIN(s.started_at) AS started_at,MAX(s.finished_at) AS finished_at,MAX(CASE WHEN s.started_at IS NOT NULL AND s.finished_at IS NULL THEN 1 ELSE 0 END) AS running FROM project_releases r LEFT JOIN project_release_steps s ON s.release_id=r.id WHERE r.project_id=? AND r.deleted_at IS NULL GROUP BY r.id ORDER BY r.created_at DESC`).all(projectId) as ReleaseSummaryRow[]
    const now=this.now()
    return rows.map(row=>({id:row.id,branch:row.branch,sha:row.commit_sha,status:row.status as ProjectRelease['status'],previousReleaseId:row.previous_release_id,createdAt:row.created_at,durationMs:row.started_at==null?null:(row.running?now:row.finished_at??now)-row.started_at}))
  }

  listActiveProjectReleases():ProjectRelease[] {
    return (this.db.prepare(`SELECT * FROM project_releases WHERE status IN ('switching','building','health_check') ORDER BY created_at`).all() as ReleaseRow[])
      .map(row=>this.mapProjectRelease(row))
  }

  getProjectRelease(userId:string,projectId:string,id:string):ProjectRelease|null {
    if (!this.repos.projects.isProjectMember(userId,projectId)) return null
    const row=this.releaseRow(id)
    return row?.project_id===projectId?this.mapProjectRelease(row):null
  }

  setProjectReleaseSha(id:string,sha:string):void {
    this.db.prepare(`UPDATE project_releases SET commit_sha=? WHERE id=?`).run(sha,id)
  }

  setProjectReleaseStatus(id:string,status:ProjectRelease['status'],actor:string):void {
    const now=this.now()
    this.db.prepare(`UPDATE project_releases SET status=?,released_at=? WHERE id=?`).run(status,status==='released'?now:null,id)
    this.addReleaseEvent(id,`release.${status}`,actor,{})
  }

  setProjectReleaseStep(id:string,kind:ReleaseStepKind,status:ReleaseStepStatus,log:string,actor:string):void {
    const now=this.now()
    this.db.prepare(`UPDATE project_release_steps SET status=?,log=?,started_at=CASE WHEN ?='running' THEN COALESCE(started_at,?) ELSE started_at END,finished_at=CASE WHEN ? IN ('passed','failed','skipped') THEN ? ELSE NULL END WHERE release_id=? AND kind=?`)
      .run(status,log,status,now,status,now,id,kind)
    this.addReleaseEvent(id,`step.${status}`,actor,{kind,log})
  }

  softDeleteProjectRelease(userId:string,projectId:string,id:string):boolean {
    if(!this.repos.projects.isProjectOwner(userId,projectId))throw new Error('release permission required')
    const row=this.releaseRow(id)
    if(!row||row.project_id!==projectId||row.previous_release_id||!['ready','failed'].includes(row.status))throw new Error('Этот релиз нельзя удалить')
    const active=this.db.prepare(`SELECT 1 FROM project_releases WHERE project_id=? AND previous_release_id=? AND status IN ('queued','switching','building','health_check')`).get(projectId,id)
    const current=this.db.prepare(`SELECT previous_release_id FROM project_releases WHERE project_id=? AND status='released' ORDER BY released_at DESC LIMIT 1`).get(projectId) as {previous_release_id:string|null}|undefined
    if(active)throw new Error('У релиза есть активный deploy')
    if(current?.previous_release_id===id)throw new Error('Текущий production-релиз удалить нельзя')
    this.db.prepare(`UPDATE project_releases SET deleted_at=? WHERE id=?`).run(this.now(),id)
    this.addReleaseEvent(id,'release.deleted',userId,{branch:row.branch})
    return true
  }

  private releaseRow(id:string):ReleaseRow|undefined {
    return this.db.prepare(`SELECT * FROM project_releases WHERE id=?`).get(id) as ReleaseRow|undefined
  }

  private mapProjectRelease(row:ReleaseRow):ProjectRelease {
    const steps=(this.db.prepare(`SELECT * FROM project_release_steps WHERE release_id=? ORDER BY position`).all(row.id) as ReleaseStepRow[]).map(s=>({id:s.id,kind:s.kind as ReleaseStepKind,status:s.status as ReleaseStepStatus,model:s.model,attempt:s.attempt,log:s.log,startedAt:s.started_at,finishedAt:s.finished_at,limitMs:s.limit_ms??null}))
    return {id:row.id,projectId:row.project_id,version:row.version,branch:row.branch,sha:row.commit_sha,status:row.status as ProjectRelease['status'],triggeredBy:row.triggered_by,attempt:row.attempt,previousReleaseId:row.previous_release_id,createdAt:row.created_at,releasedAt:row.released_at,agentId:row.agent_id??null,checkoutPath:row.checkout_path??null,deletedAt:row.deleted_at??null,steps}
  }

  private addReleaseEvent(releaseId:string,type:string,actor:string,payload:unknown):void {
    this.db.prepare(`INSERT INTO project_release_events (id,release_id,type,actor,payload_json,created_at) VALUES (?,?,?,?,?,?)`).run(this.newId(),releaseId,type,actor,JSON.stringify(payload),this.now())
  }
}
