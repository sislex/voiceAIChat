import { applicationReleaseIdentity, applicationReleaseBranch, parseApplicationReleaseManifest, parseApplicationEnvironment, validateCatalogRelease, applicationCompatibility, type ApplicationReleaseInput, type ApplicationReleaseManifest, type ApplicationReleaseRecord, type ApplicationDeploymentRecord, type ApplicationEnvironment, type ApplicationEnvironmentName, type ApplicationReleaseOverview, type ApplicationDeployInput } from '@voicechat/shared'
// Домен «releases»: таблицы project_releases, project_release_steps, project_release_events.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import { RELEASE_STEP_ORDER, type ProjectRelease, type ReleaseStepKind, type ReleaseStepStatus, type ReleaseTimeouts, DEFAULT_RELEASE_TIMEOUTS, validateReleaseTimeouts, releaseFailureSummary, releaseStepLimit } from '@voicechat/shared'
import { BaseRepo } from './base.js'

// ============== Релизы: строки БД ==================
interface ReleaseRow { id:string;project_id:string;version:string;branch:string;commit_sha:string;status:string;triggered_by:string;attempt:number;previous_release_id:string|null;created_at:number;released_at:number|null;agent_id:string|null;checkout_path:string|null;deleted_at:number|null;archived_at:number|null }

interface ReleaseStepRow { id:string;release_id:string;kind:string;position:number;status:string;model:string|null;attempt:number;log:string;started_at:number|null;finished_at:number|null;limit_ms:number|null }
export class ReleasesRepo extends BaseRepo {

  async createApplicationRelease(userId: string, projectId: string, input: ApplicationReleaseInput): Promise<{ record: ApplicationReleaseRecord; created: boolean }> {
    if (!await this.repos.projects.isProjectOwner(userId, projectId)) throw new Error('release permission required')
    const branch = applicationReleaseBranch(input.applicationId, input.version)
    return this.sql.transaction(async () => {
      const record: ApplicationReleaseRecord = { id: this.newId(), projectId, input, branch, status: 'preparing', manifest: null, createdAt: this.now(), finishedAt: null, triggeredBy: userId, log: '' }
      const inserted = await this.sql.run(`INSERT INTO application_releases (id,project_id,application_id,version,record_json) VALUES (?,?,?,?,?) ON CONFLICT(project_id,application_id,version) DO NOTHING`, [record.id, projectId, input.applicationId, input.version, JSON.stringify(record)])
      if (inserted.changes) return { record, created: true }
      const row = await this.sql.get<{ record_json: string }>(`SELECT record_json FROM application_releases WHERE project_id=? AND application_id=? AND version=?`, [projectId, input.applicationId, input.version])
      const previous = JSON.parse(row!.record_json) as ApplicationReleaseRecord
      if (JSON.stringify(previous.input) !== JSON.stringify(input)) throw new Error('Версия уже зарезервирована другой подготовкой')
      return { record: previous, created: false }
    })
  }

  async finishApplicationRelease(id: string, manifest: ApplicationReleaseManifest | null, log: string): Promise<void> {
    await this.sql.transaction(async () => {
      const row = await this.sql.get<{ record_json: string }>(`SELECT record_json FROM application_releases WHERE id=?`, [id])
      if (!row) throw new Error('Подготовка не найдена')
      const record = JSON.parse(row.record_json) as ApplicationReleaseRecord
      if (record.status !== 'preparing') throw new Error('Подготовка уже завершена')
      if (manifest) {
        manifest = parseApplicationReleaseManifest(manifest); validateCatalogRelease(manifest)
        if (manifest.applicationId !== record.input.applicationId || manifest.version !== record.input.version || JSON.stringify(manifest.requires) !== JSON.stringify(record.input.requires)) throw new Error('Артефакт не соответствует подготовке')
      }
      await this.sql.run(`UPDATE application_releases SET record_json=? WHERE id=?`, [JSON.stringify({ ...record, manifest, status: manifest ? 'ready' : 'failed', log: log.slice(-100_000), finishedAt: this.now() }), id])
    })
  }

  async applicationReleaseOverview(userId: string, projectId: string, environment: ApplicationEnvironmentName): Promise<ApplicationReleaseOverview> {
    if (!await this.repos.projects.isProjectMember(userId, projectId)) throw new Error('release permission required')
    const state = await this.sql.get<{ state_json: string; active_deployment_id: string | null }>(`SELECT state_json,active_deployment_id FROM application_environments WHERE project_id=? AND environment=?`, [projectId, environment])
    const releases = await this.sql.all<{ record_json: string }>(`SELECT record_json FROM application_releases WHERE project_id=?`, [projectId])
    const deployments = await this.sql.all<{ record_json: string }>(`SELECT record_json FROM application_deployments WHERE project_id=? AND environment=?`, [projectId, environment])
    return { environment: state ? parseApplicationEnvironment(JSON.parse(state.state_json)) : { schemaVersion: 1, revision: 0, applications: [] }, activeDeploymentId: state?.active_deployment_id ?? null, releases: releases.map(row => JSON.parse(row.record_json) as ApplicationReleaseRecord).sort((a,b) => b.createdAt-a.createdAt), deployments: deployments.map(row => JSON.parse(row.record_json) as ApplicationDeploymentRecord).sort((a,b) => b.createdAt-a.createdAt) }
  }

  /** Снимок приходит только от runtime-probe, а не из HTTP-тела пользователя. */
  async observeApplicationEnvironment(userId: string, projectId: string, environment: ApplicationEnvironmentName, observed: ApplicationEnvironment, expectedRevision: number): Promise<void> {
    if (!await this.repos.projects.isProjectOwner(userId, projectId)) throw new Error('release permission required')
    const state = parseApplicationEnvironment(observed)
    await this.sql.transaction(async () => {
      await this.assertNoLegacyDeployment(projectId, environment)
      await this.ensureApplicationEnvironment(projectId, environment)
      const next = { ...state, revision: expectedRevision + 1 }
      const updated = await this.sql.run(`UPDATE application_environments SET state_json=?,revision=? WHERE project_id=? AND environment=? AND revision=? AND active_deployment_id IS NULL`, [JSON.stringify(next), next.revision, projectId, environment, expectedRevision])
      if (!updated.changes) throw new Error('Окружение изменилось или занято deploy')
    })
  }

  /** Оба исполнителя сериализуют переход через ту же SQL-транзакцию. */
  private async assertNoLegacyDeployment(projectId: string, environment: ApplicationEnvironmentName): Promise<void> {
    if (environment !== 'production') return
    const active = await this.sql.get(`SELECT id FROM project_releases WHERE project_id=? AND previous_release_id IS NOT NULL AND status IN ('queued','switching','building','health_check') LIMIT 1`, [projectId])
    if (active) throw new Error('Сначала завершите общий production deploy')
  }

  private async ensureApplicationEnvironment(projectId: string, environment: ApplicationEnvironmentName): Promise<void> {
    await this.sql.run(`INSERT INTO application_environments (project_id,environment,revision,state_json) VALUES (?,?,0,?) ON CONFLICT(project_id,environment) DO NOTHING`, [projectId, environment, JSON.stringify({ schemaVersion: 1, revision: 0, applications: [] })])
  }

  async beginApplicationDeployment(userId: string, projectId: string, environment: ApplicationEnvironmentName, input: ApplicationDeployInput, targetFingerprint?: string): Promise<{ record: ApplicationDeploymentRecord; created: boolean }> {
    if (!await this.repos.projects.isProjectOwner(userId, projectId)) throw new Error('release permission required')
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !Array.isArray(input.releaseIds) || new Set(input.releaseIds).size !== input.releaseIds.length || input.releaseIds.length > 32) throw new Error('Некорректный план deploy')
    return this.sql.transaction(async () => {
      if (targetFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(targetFingerprint)) throw new Error('Неверный отпечаток площадки')
    const request = JSON.stringify({ ...input, releaseIds: [...input.releaseIds].sort() })
      const repeat = await this.sql.get<{ request_json: string; record_json: string }>(`SELECT request_json,record_json FROM application_deployments WHERE project_id=? AND environment=? AND request_id=?`, [projectId, environment, input.requestId])
      if (repeat) {
        if (repeat.request_json !== request) throw new Error('Ключ запроса уже использован для другого плана')
        return { record: JSON.parse(repeat.record_json) as ApplicationDeploymentRecord, created: false }
      }
      await this.assertNoLegacyDeployment(projectId, environment)
      await this.ensureApplicationEnvironment(projectId, environment)
      const overview = await this.applicationReleaseOverview(userId, projectId, environment)
      if (overview.activeDeploymentId || overview.environment.revision !== input.expectedRevision) throw new Error('Окружение изменилось или занято deploy')
      let releases: ApplicationReleaseManifest[]
      if (input.rollbackOf) {
        if (input.releaseIds.length) throw new Error('Откат не принимает дополнительные выпуски')
        const previous = overview.deployments.find(record => record.id === input.rollbackOf && record.status === 'released')
        if (!previous || overview.deployments.find(record => record.status === 'released')?.id !== previous.id) throw new Error('Можно откатить только последний завершённый deploy')
        releases = previous.releases.map(release => {
          const old = previous.previous.applications.find(app => app.manifest.applicationId === release.applicationId)
          if (!old) throw new Error('Для первого выпуска нет предыдущего артефакта')
          return old.manifest
        })
      } else {
        releases = input.releaseIds.map(id => {
          const record = overview.releases.find(release => release.id === id)
          if (!record?.manifest || record.status !== 'ready') throw new Error('Нет проверенного выпуска для deploy')
          return record.manifest
        })
      }
      if (!releases.length) throw new Error('Не выбраны выпуски')
      releases.forEach(release => validateCatalogRelease(release))
      const issues = applicationCompatibility(overview.environment, releases)
      if (issues.length) throw new Error(issues.map(issue => issue.message).join('; '))
      const record: ApplicationDeploymentRecord = { id: this.newId(), projectId, environment, requestId: input.requestId, ...(targetFingerprint ? { targetFingerprint } : {}), status: 'deploying', releases, previous: overview.environment, result: null, rollbackOf: input.rollbackOf ?? null, createdAt: this.now(), finishedAt: null, triggeredBy: userId, log: '' }
      const locked = await this.sql.run(`UPDATE application_environments SET active_deployment_id=? WHERE project_id=? AND environment=? AND revision=? AND active_deployment_id IS NULL`, [record.id, projectId, environment, input.expectedRevision])
      if (!locked.changes) throw new Error('Окружение занято другим deploy')
      await this.sql.run(`INSERT INTO application_deployments (id,project_id,environment,request_id,request_json,record_json) VALUES (?,?,?,?,?,?)`, [record.id, projectId, environment, input.requestId, request, JSON.stringify(record)])
      return { record, created: true }
    })
  }

  async finishApplicationDeployment(id: string, status: 'released' | 'failed' | 'uncertain', observed: ApplicationEnvironment | null, log: string): Promise<void> {
    await this.sql.transaction(async () => {
      const row = await this.sql.get<{ record_json: string }>(`SELECT record_json FROM application_deployments WHERE id=?`, [id])
      if (!row) throw new Error('Deploy не найден')
      const record = JSON.parse(row.record_json) as ApplicationDeploymentRecord
      if (!['deploying', 'uncertain'].includes(record.status)) return
      if (status !== 'uncertain' && !observed) throw new Error('Нужна проверка фактического окружения')
      const result = observed ? { ...parseApplicationEnvironment(observed), revision: record.previous.revision + 1 } : null
      if (result && status === 'released') {
        const changed = new Set(record.releases.map(release => release.applicationId))
        const expected = new Set([...record.previous.applications.map(app => app.manifest.applicationId), ...changed])
        if (result.applications.length !== expected.size || result.applications.some(app => !expected.has(app.manifest.applicationId))) throw new Error('Неожиданный состав после deploy')
        for (const previous of record.previous.applications.filter(app => !changed.has(app.manifest.applicationId))) {
          const actual = result.applications.find(app => app.manifest.applicationId === previous.manifest.applicationId)
          if (!actual || applicationReleaseIdentity(actual.manifest) !== applicationReleaseIdentity(previous.manifest)) throw new Error('Изменился посторонний артефакт')
        }
        for (const release of record.releases) {
          const actual = result.applications.find(app => app.manifest.applicationId === release.applicationId)
          if (!actual?.healthy || applicationReleaseIdentity(actual.manifest) !== applicationReleaseIdentity(release)) throw new Error('Запущенный артефакт не соответствует deploy')
        }
        if (applicationCompatibility(result, []).length) throw new Error('Фактический состав несовместим')
      }
      if (result && status === 'failed' && JSON.stringify(result.applications) !== JSON.stringify(record.previous.applications)) throw new Error('После ошибки окружение не восстановлено')
      await this.sql.run(`UPDATE application_deployments SET record_json=? WHERE id=?`, [JSON.stringify({ ...record, status, result, log: log.slice(-100_000), finishedAt: status === 'uncertain' ? null : this.now() }), id])
      if (result && status !== 'uncertain') {
        const updated = await this.sql.run(`UPDATE application_environments SET state_json=?,revision=?,active_deployment_id=NULL WHERE project_id=? AND environment=? AND active_deployment_id=?`, [JSON.stringify(result), result.revision, record.projectId, record.environment, id])
        if (!updated.changes) throw new Error('Утеряна блокировка deploy')
      }
    })
  }


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
      if (input.previousReleaseId) {
        const component = await this.sql.get<{state_json:string;active_deployment_id:string|null}>(`SELECT state_json,active_deployment_id FROM application_environments WHERE project_id=? AND environment='production'`, [projectId])
        if (component && (component.active_deployment_id || parseApplicationEnvironment(JSON.parse(component.state_json)).applications.length)) throw new Error('Production управляется выпусками приложений; общий deploy перезаписал бы независимые артефакты')
      }
      const limits=validateReleaseTimeouts(input.limits??DEFAULT_RELEASE_TIMEOUTS)
      await this.sql.run(`INSERT INTO project_releases (id,project_id,version,branch,commit_sha,status,triggered_by,attempt,previous_release_id,created_at,agent_id,checkout_path) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [id, projectId, input.version, input.branch, input.sha, input.status??'preparing', userId, attempt, input.previousReleaseId??null, now, input.agentId??null, input.checkoutPath??null])
      for (const [position, kind] of RELEASE_STEP_ORDER.entries()) await this.sql.run(`INSERT INTO project_release_steps (id,release_id,kind,position,status,model,attempt,limit_ms) VALUES (?,?,?,?,?,?,?,?)`, [this.newId(), id, kind, position, 'queued', input.models?.[kind]??null, attempt, releaseStepLimit(kind,limits)])
      await this.addReleaseEvent(id,'release.created',userId,{branch:input.branch,version:input.version,sha:input.sha,attempt})
    })
    return (await this.getProjectRelease(userId,projectId,id)) as ProjectRelease
  }

  async getProjectRelease(userId:string,projectId:string,id:string):Promise<ProjectRelease|null> {
    if (!(await this.repos.projects.isProjectMember(userId,projectId))) return null
    const row=await this.releaseRow(id)
    return row?.project_id===projectId?await this.mapProjectRelease(row):null
  }

  async setProjectReleaseStatus(id:string,status:ProjectRelease['status'],actor:string):Promise<void> {
    const now=this.now()
    await this.sql.run(`UPDATE project_releases SET status=?,released_at=? WHERE id=?`, [status, status==='released'?now:null, id])
    await this.addReleaseEvent(id,`release.${status}`,actor,{})
    if(['ready','released','failed'].includes(status)){
      const release=await this.releaseRow(id)
      if(release){
        const owner=await this.sql.get<{username:string}>(`SELECT username FROM project_members WHERE project_id=? AND role='owner' ORDER BY added_at LIMIT 1`,[release.project_id])
        if(owner){
          const failed=(await this.sql.get(`SELECT kind,log FROM project_release_steps WHERE release_id=? AND status='failed' ORDER BY position DESC LIMIT 1`,[id])) as {kind:string;log:string}|undefined
          const title=status==='released'?`Релиз ${release.version} опубликован`:status==='ready'?`Сборка ${release.version} завершена`:`Сборка ${release.version} упала`
          const text=status==='failed'?`Сборка ${release.version} упала: ${releaseFailureSummary(failed?.kind??'',failed?.log??'')}`:status==='released'?`Релиз ${release.version} опубликован`:`Сборка ${release.version} готова к деплою`
          await this.sql.run(`INSERT INTO release_notifications (id,user_id,project_id,release_id,title,text,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM release_notifications WHERE release_id=?)`,[this.newId(),owner.username,release.project_id,id,title,text,now,id])
        }
      }
    }
  }

  private async releaseRow(id:string):Promise<ReleaseRow|undefined> {
    return (await this.sql.get(`SELECT * FROM project_releases WHERE id=?`, [id])) as ReleaseRow|undefined
  }

  private async mapProjectRelease(row:ReleaseRow):Promise<ProjectRelease> {
    const steps=((await this.sql.all(`SELECT * FROM project_release_steps WHERE release_id=? ORDER BY position`, [row.id])) as ReleaseStepRow[]).map(s=>({id:s.id,kind:s.kind as ReleaseStepKind,status:s.status as ReleaseStepStatus,model:s.model,attempt:s.attempt,log:s.log,startedAt:s.started_at,finishedAt:s.finished_at,limitMs:s.limit_ms??null}))
    return {id:row.id,projectId:row.project_id,version:row.version,branch:row.branch,sha:row.commit_sha,status:row.status as ProjectRelease['status'],triggeredBy:row.triggered_by,attempt:row.attempt,previousReleaseId:row.previous_release_id,createdAt:row.created_at,releasedAt:row.released_at,agentId:row.agent_id??null,checkoutPath:row.checkout_path??null,deletedAt:row.deleted_at??null,archivedAt:row.archived_at??null,steps}
  }

  private async addReleaseEvent(releaseId:string,type:string,actor:string,payload:unknown):Promise<void> {
    await this.sql.run(`INSERT INTO project_release_events (id,release_id,type,actor,payload_json,created_at) VALUES (?,?,?,?,?,?)`, [this.newId(), releaseId, type, actor, JSON.stringify(payload), this.now()])
  }
}
