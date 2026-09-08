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
  async createProjectRelease(userId: string, projectId: string, input: { branch: string; version: string; sha: string; status?: ProjectRelease['status']; models?: Partial<Record<ReleaseStepKind, string>>; previousReleaseId?: string | null; agentId?: string; checkoutPath?: string; limits?: ReleaseTimeouts }): Promise<ProjectRelease> {
    if (!(await this.repos.projects.isProjectOwner(userId, projectId))) throw new Error('release permission required')
    const previous = input.previousReleaseId ? await this.releaseRow(input.previousReleaseId) : null
    if (input.previousReleaseId && (!previous || previous.project_id !== projectId || previous.branch !== input.branch)) throw new Error('invalid previous release')
    // Номер попытки — всегда max+1 по ветке: после неудачного deploy повторная
    // попытка от того же подготовленного релиза не должна падать в UNIQUE.
    const nextByBranch = (((await this.sql.get(`SELECT MAX(attempt) AS n FROM project_releases WHERE project_id=? AND branch=?`, [projectId, input.branch])) as {n:number|null}).n ?? 0) + 1
    const attempt = previous ? Math.max(previous.attempt + 1, nextByBranch) : nextByBranch
    const id=this.newId(), now=this.now()
    await this.sql.transaction(async ()=>{
      const limits=validateReleaseTimeouts(input.limits??DEFAULT_RELEASE_TIMEOUTS)
      await this.sql.run(`INSERT INTO project_releases (id,project_id,version,branch,commit_sha,status,triggered_by,attempt,previous_release_id,created_at,agent_id,checkout_path) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [id, projectId, input.version, input.branch, input.sha, input.status??'preparing', userId, attempt, input.previousReleaseId??null, now, input.agentId??null, input.checkoutPath??null])
      for (const [position, kind] of RELEASE_STEP_ORDER.entries()) await this.sql.run(`INSERT INTO project_release_steps (id,release_id,kind,position,status,model,attempt,limit_ms) VALUES (?,?,?,?,?,?,?,?)`, [this.newId(), id, kind, position, 'queued', input.models?.[kind]??null, attempt, releaseStepLimit(kind,limits)])
      await this.addReleaseEvent(id,'release.created',userId,{branch:input.branch,version:input.version,sha:input.sha,attempt})
    })
    return (await this.getProjectRelease(userId,projectId,id)) as ProjectRelease
  }

  async listProjectReleases(userId:string,projectId:string):Promise<ProjectRelease[]> {
    if (!(await this.repos.projects.isProjectMember(userId,projectId))) return []
    return await Promise.all(((await this.sql.all(`SELECT id FROM project_releases WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at DESC`, [projectId])) as Array<{id:string}>).map(async ({id})=>await this.mapProjectRelease((await this.releaseRow(id))!)))
  }

  async listProjectReleaseSummaries(userId:string,projectId:string):Promise<ProjectReleaseSummary[]> {
    if (!(await this.repos.projects.isProjectMember(userId,projectId))) return []
    const rows=(await this.sql.all(`SELECT r.id,r.branch,r.commit_sha,r.status,r.previous_release_id,r.created_at,MIN(s.started_at) AS started_at,MAX(s.finished_at) AS finished_at,MAX(CASE WHEN s.started_at IS NOT NULL AND s.finished_at IS NULL THEN 1 ELSE 0 END) AS running FROM project_releases r LEFT JOIN project_release_steps s ON s.release_id=r.id WHERE r.project_id=? AND r.deleted_at IS NULL GROUP BY r.id ORDER BY r.created_at DESC`, [projectId])) as ReleaseSummaryRow[]
    const now=this.now()
    return rows.map(row=>({id:row.id,branch:row.branch,sha:row.commit_sha,status:row.status as ProjectRelease['status'],previousReleaseId:row.previous_release_id,createdAt:row.created_at,durationMs:row.started_at==null?null:(row.running?now:row.finished_at??now)-row.started_at}))
  }

  /** Подготовки (`preparing`/`checking`), оборванные рестартом: их регрессия шла в процессе ядра и после рестарта не продолжается. */
  async listInterruptedPreparations():Promise<ProjectRelease[]> {
    return await Promise.all(((await this.sql.all(`SELECT * FROM project_releases WHERE status IN ('preparing','checking') AND deleted_at IS NULL ORDER BY created_at`)) as ReleaseRow[]).map(async row=>(await this.getProjectRelease(row.triggered_by,row.project_id,row.id))!))
  }

  async listActiveProjectReleases():Promise<ProjectRelease[]> {
    return await Promise.all(((await this.sql.all(`SELECT * FROM project_releases WHERE status IN ('switching','building','health_check') ORDER BY created_at`)) as ReleaseRow[])
      .map(async row=>await this.mapProjectRelease(row)))
  }

  async getProjectRelease(userId:string,projectId:string,id:string):Promise<ProjectRelease|null> {
    if (!(await this.repos.projects.isProjectMember(userId,projectId))) return null
    const row=await this.releaseRow(id)
    return row?.project_id===projectId?await this.mapProjectRelease(row):null
  }

  async setProjectReleaseSha(id:string,sha:string):Promise<void> {
    await this.sql.run(`UPDATE project_releases SET commit_sha=? WHERE id=?`, [sha, id])
  }

  async setProjectReleaseStatus(id:string,status:ProjectRelease['status'],actor:string):Promise<void> {
    const now=this.now()
    await this.sql.run(`UPDATE project_releases SET status=?,released_at=? WHERE id=?`, [status, status==='released'?now:null, id])
    await this.addReleaseEvent(id,`release.${status}`,actor,{})
  }

  async setProjectReleaseStep(id:string,kind:ReleaseStepKind,status:ReleaseStepStatus,log:string,actor:string):Promise<void> {
    const now=this.now()
    // Событие таймлайна — только на смену статуса шага: живой лог `running` переписывается по ходу команды,
    // и событие с полной копией лога на каждое обновление раздуло таблицу событий до 3 ГБ на проде.
    const previous=(await this.sql.get(`SELECT status FROM project_release_steps WHERE release_id=? AND kind=?`, [id, kind])) as {status:ReleaseStepStatus}|undefined
    const progressOnly=status==='running'&&previous?.status==='running'
    await this.sql.run(`UPDATE project_release_steps SET status=?,log=?,started_at=CASE WHEN ?='running' THEN COALESCE(started_at,?) ELSE started_at END,finished_at=CASE WHEN ? IN ('passed','failed','skipped') THEN ? ELSE NULL END WHERE release_id=? AND kind=?`, [status, log, status, now, status, now, id, kind])
    if(!progressOnly)await this.addReleaseEvent(id,`step.${status}`,actor,{kind,log})
  }

  async softDeleteProjectRelease(userId:string,projectId:string,id:string):Promise<boolean> {
    if(!(await this.repos.projects.isProjectOwner(userId,projectId)))throw new Error('release permission required')
    const row=await this.releaseRow(id)
    if(!row||row.project_id!==projectId||row.previous_release_id||!['ready','failed'].includes(row.status))throw new Error('Этот релиз нельзя удалить')
    const active=await this.sql.get(`SELECT 1 FROM project_releases WHERE project_id=? AND previous_release_id=? AND status IN ('queued','switching','building','health_check')`, [projectId, id])
    const current=(await this.sql.get(`SELECT previous_release_id FROM project_releases WHERE project_id=? AND status='released' ORDER BY released_at DESC LIMIT 1`, [projectId])) as {previous_release_id:string|null}|undefined
    if(active)throw new Error('У релиза есть активный deploy')
    if(current?.previous_release_id===id)throw new Error('Текущий production-релиз удалить нельзя')
    await this.sql.run(`UPDATE project_releases SET deleted_at=? WHERE id=?`, [this.now(), id])
    await this.addReleaseEvent(id,'release.deleted',userId,{branch:row.branch})
    return true
  }

  private async releaseRow(id:string):Promise<ReleaseRow|undefined> {
    return (await this.sql.get(`SELECT * FROM project_releases WHERE id=?`, [id])) as ReleaseRow|undefined
  }

  private async mapProjectRelease(row:ReleaseRow):Promise<ProjectRelease> {
    const steps=((await this.sql.all(`SELECT * FROM project_release_steps WHERE release_id=? ORDER BY position`, [row.id])) as ReleaseStepRow[]).map(s=>({id:s.id,kind:s.kind as ReleaseStepKind,status:s.status as ReleaseStepStatus,model:s.model,attempt:s.attempt,log:s.log,startedAt:s.started_at,finishedAt:s.finished_at,limitMs:s.limit_ms??null}))
    return {id:row.id,projectId:row.project_id,version:row.version,branch:row.branch,sha:row.commit_sha,status:row.status as ProjectRelease['status'],triggeredBy:row.triggered_by,attempt:row.attempt,previousReleaseId:row.previous_release_id,createdAt:row.created_at,releasedAt:row.released_at,agentId:row.agent_id??null,checkoutPath:row.checkout_path??null,deletedAt:row.deleted_at??null,steps}
  }

  /**
   * Чистка прогресс-событий `step.running`: раньше каждое обновление живого лога шага писало событие с
   * полной копией лога (на проде — 97 тысяч событий на 3 ГБ). Оставляем по одному `step.running` на шаг
   * (момент старта), остальные удаляем пачками, чтобы не держать полосу базы. Возвращает число удалённых.
   */
  async pruneProgressEvents(batchSize=500):Promise<number> {
    const rows=(await this.sql.all(`SELECT id,release_id,created_at,rowid AS rid,substr(payload_json,1,120) AS head FROM project_release_events WHERE type='step.running' ORDER BY created_at,rowid`)) as Array<{id:string;release_id:string;created_at:number;rid:number;head:string}>
    const seen=new Set<string>()
    const doomed:string[]=[]
    for(const row of rows){
      const kind=/"kind":"([a-z_]+)"/.exec(row.head)?.[1]??''
      const key=`${row.release_id}:${kind}`
      if(seen.has(key))doomed.push(row.id);else seen.add(key)
    }
    for(let i=0;i<doomed.length;i+=batchSize){
      const batch=doomed.slice(i,i+batchSize)
      await this.sql.run(`DELETE FROM project_release_events WHERE id IN (${batch.map(()=>'?').join(',')})`, batch)
    }
    return doomed.length
  }

  private async addReleaseEvent(releaseId:string,type:string,actor:string,payload:unknown):Promise<void> {
    await this.sql.run(`INSERT INTO project_release_events (id,release_id,type,actor,payload_json,created_at) VALUES (?,?,?,?,?,?)`, [this.newId(), releaseId, type, actor, JSON.stringify(payload), this.now()])
  }
}
