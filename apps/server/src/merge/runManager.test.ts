import { describe, expect, it, vi } from 'vitest'
import type { MergeRun } from '@voicechat/shared'
import { MergeRunManager } from './runManager.js'
import type { VoiceChatDb } from '../db/database.js'
import type { CommandExecutor } from '../ci/types.js'

const source='1'.repeat(40), target='2'.repeat(40), merged='3'.repeat(40)
const base=():MergeRun=>({id:'r1',projectId:'p1',taskId:'t1',status:'queued',triggeredBy:'admin',sourceBranch:'CHAT-178',targetBranch:'main',sourceSha:source,targetSha:null,mergeSha:null,revertSha:null,agentId:'a1',machineName:'Mac',llmEngineId:null,llmProvider:'claude',llmModel:'',stage:'queued',stages:[],conflicts:[],conflictDetails:[],checks:[],deployId:null,deployVersion:null,productionStatus:null,error:null,recommendedAction:null,log:'',canCancel:true,canRetry:false,pushStartedAt:null,startedAt:null,finishedAt:null,createdAt:1})

function setup(outputs:string[]){
  let run=base()
  const moves:string[]=[]
  const db={
    getMergeRunRaw:()=>run,
    getMergeRun:()=>run,
    listActiveMergeRuns:()=>[run],
    updateMergeRun:(_id:string,fields:Partial<MergeRun>)=>(run={...run,...fields}),
    appendMergeLog:(_id:string,chunk:string)=>(run={...run,log:run.log+chunk}),
    moveMergeTask:(_p:string,_t:string,column:string)=>moves.push(column),
    getProject:()=>({gitUrl:'git@example/repo.git',testCommand:'npm run affected-check'}),
    findLatestCiWorkspace:()=>({path:'/repo/task',pushed:true,agentId:'a1'})
  }
  const executor:CommandExecutor={run:vi.fn(async (_req,onChunk)=>{const output=outputs.shift()??'';onChunk(output);return{exitCode:0,timedOut:false}})}
  const manager=new MergeRunManager({db:db as unknown as VoiceChatDb,executor,isOnline:()=>true,broadcast:()=>{},boardChanged:()=>{},now:(()=>{let n=10;return()=>++n})()})
  return{manager,get run(){return run},moves,executor}
}

describe('MergeRunManager',()=>{
  it('fetches, tests and pushes with lease before moving to done',async()=>{
    const s=setup(['git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'','',merged+'\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    expect(s.moves).toContain('done')
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    expect(scripts.find(v=>v.includes('git push'))).toContain(`--force-with-lease=refs/heads/main:${target}`)
    expect(scripts.findIndex(v=>v.includes('affected-check'))).toBeLessThan(scripts.findIndex(v=>v.includes('git push')))
  })
  it('stops stale source before creating a worktree',async()=>{
    const changed='4'.repeat(40), s=setup(['git@example/repo.git\ntrue\n',`SOURCE=${changed}\nTARGET=${target}\n`,''])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('decision_required'))
    expect(s.run.error).toContain('stale source')
    expect((s.executor.run as ReturnType<typeof vi.fn>).mock.calls.some(call=>call[0].script.includes('worktree add'))).toBe(false)
  })
})
