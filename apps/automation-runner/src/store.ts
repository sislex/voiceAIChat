import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import {
  type AutomationEvent, type AutomationJob, type AutomationJobRequest,
  type AutomationJobState, type AutomationPause, type AutomationTerminalResult
} from '@voicechat/shared'

type JobRow = {
  id: string; idempotency_key: string; type: AutomationJob['type']; state: AutomationJobState
  snapshot_json: string; created_at: string; updated_at: string; result_json: string | null
}
const parseJob = (r: JobRow): AutomationJob => ({
  id:r.id,idempotencyKey:r.idempotency_key,type:r.type,state:r.state,
  snapshot:JSON.parse(r.snapshot_json),createdAt:r.created_at,updatedAt:r.updated_at,
  result:r.result_json ? JSON.parse(r.result_json) : null
})

export class AutomationStore {
  readonly db: Database.Database
  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
        state TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, result_json TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, position INTEGER NOT NULL,
        timestamp TEXT NOT NULL, type TEXT NOT NULL, payload_json TEXT NOT NULL,
        UNIQUE(job_id, position)
      );
      CREATE TABLE IF NOT EXISTS pauses (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
        prompt_json TEXT NOT NULL, session_id TEXT NOT NULL, created_at TEXT NOT NULL,
        answered_at TEXT, answer_json TEXT
      );
      CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(state, created_at);
      CREATE INDEX IF NOT EXISTS events_job_position ON events(job_id, position);
    `)
    this.recover()
  }
  close(): void { this.db.close() }
  recover(): void {
    const now=new Date().toISOString()
    this.db.prepare("UPDATE jobs SET state='queued',updated_at=? WHERE state IN ('running','cancelling')").run(now)
  }
  create(req: AutomationJobRequest): {job: AutomationJob; created: boolean} {
    const existing=this.db.prepare('SELECT * FROM jobs WHERE idempotency_key=?').get(req.idempotencyKey) as JobRow|undefined
    if (existing) return {job:parseJob(existing),created:false}
    const id=randomUUID(), now=new Date().toISOString()
    this.db.transaction(()=>{
      this.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,NULL)').run(id,req.idempotencyKey,req.type,'queued',JSON.stringify(req.snapshot),now,now)
      this.appendEvent(id,'job.queued',{type:req.type})
    })()
    return {job:this.get(id)!,created:true}
  }
  get(id:string): AutomationJob|null {
    const row=this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as JobRow|undefined
    return row ? parseJob(row) : null
  }
  next(): AutomationJob|null {
    const row=this.db.prepare("SELECT * FROM jobs WHERE state='queued' ORDER BY created_at,id LIMIT 1").get() as JobRow|undefined
    return row ? parseJob(row) : null
  }
  transition(id:string, from: readonly AutomationJobState[], to:AutomationJobState): boolean {
    const now=new Date().toISOString()
    const marks=from.map(()=>'?').join(',')
    const changed=this.db.prepare(`UPDATE jobs SET state=?,updated_at=? WHERE id=? AND state IN (${marks})`).run(to,now,id,...from).changes===1
    if(changed) this.appendEvent(id,'job.state',{state:to})
    return changed
  }
  finish(id:string,result:AutomationTerminalResult,state:'succeeded'|'failed'|'cancelled'): boolean {
    return this.db.transaction(()=>{
      const changed=this.db.prepare("UPDATE jobs SET state=?,result_json=?,updated_at=? WHERE id=? AND state NOT IN ('succeeded','failed','cancelled')")
        .run(state,JSON.stringify(result),new Date().toISOString(),id).changes===1
      if(changed) this.appendEvent(id,'job.finished',result)
      return changed
    })()
  }
  appendEvent(jobId:string,type:string,payload:unknown): AutomationEvent {
    const position=(this.db.prepare('SELECT COALESCE(MAX(position),0)+1 n FROM events WHERE job_id=?').get(jobId) as {n:number}).n
    const event={eventId:randomUUID(),jobId,position,timestamp:new Date().toISOString(),type,payload}
    this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?)').run(event.eventId,jobId,position,event.timestamp,type,JSON.stringify(payload))
    return event
  }
  events(jobId:string,after=0): AutomationEvent[] {
    return (this.db.prepare('SELECT * FROM events WHERE job_id=? AND position>? ORDER BY position').all(jobId,after) as Array<Record<string,unknown>>)
      .map(r=>({eventId:String(r.event_id),jobId:String(r.job_id),position:Number(r.position),timestamp:String(r.timestamp),type:String(r.type),payload:JSON.parse(String(r.payload_json))}))
  }
  pause(jobId:string,kind:AutomationPause['kind'],prompt:unknown,sessionId:string): AutomationPause {
    const id=randomUUID(),now=new Date().toISOString()
    this.db.transaction(()=>{
      this.db.prepare('INSERT INTO pauses VALUES(?,?,?,?,?,?,NULL,NULL)').run(id,jobId,kind,JSON.stringify(prompt),sessionId,now)
      this.transition(jobId,['running'],kind==='questions'?'waiting_for_questions':'waiting_for_plan_approval')
    })()
    return {id,jobId,kind,prompt,sessionId,createdAt:now,answeredAt:null}
  }
  resume(jobId:string,pauseId:string,answer:unknown): boolean {
    return this.db.transaction(()=>{
      const now=new Date().toISOString()
      const changed=this.db.prepare('UPDATE pauses SET answered_at=?,answer_json=? WHERE id=? AND job_id=? AND answered_at IS NULL').run(now,JSON.stringify(answer),pauseId,jobId).changes===1
      if(!changed) return false
      const resumed=this.transition(jobId,['waiting_for_questions','waiting_for_plan_approval'],'queued')
      if(resumed) this.appendEvent(jobId,'job.resumed',{pauseId})
      return resumed
    })()
  }
  counts(): {queued:number;active:number;paused:number;oldestQueuedAt:string|null} {
    const count=(states:string[])=>Number((this.db.prepare(`SELECT COUNT(*) n FROM jobs WHERE state IN (${states.map(()=>'?').join(',')})`).get(...states) as {n:number}).n)
    const oldest=this.db.prepare("SELECT MIN(created_at) v FROM jobs WHERE state='queued'").get() as {v:string|null}
    return {queued:count(['queued']),active:count(['running','cancelling']),paused:count(['waiting_for_questions','waiting_for_plan_approval']),oldestQueuedAt:oldest.v}
  }
}
