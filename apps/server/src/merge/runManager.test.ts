import { describe, expect, it, vi } from 'vitest'
import type { MergeRun } from '@voicechat/shared'
import { MergeRunManager } from './runManager.js'
import type { VoiceChatDb } from '../db/database.js'
import type { CommandExecutor } from '../ci/types.js'

const source='1'.repeat(40), target='2'.repeat(40), merged='3'.repeat(40)
const base=():MergeRun=>({id:'r1',projectId:'p1',taskId:'t1',status:'queued',triggeredBy:'admin',sourceBranch:'CHAT-178',targetBranch:'main',sourceSha:source,targetSha:null,mergeSha:null,revertSha:null,agentId:'a1',machineName:'Mac',llmEngineId:null,llmProvider:'claude',llmModel:'',stage:'queued',stages:[],conflicts:[],conflictDetails:[],checks:[],deployId:null,deployVersion:null,productionStatus:null,error:null,recommendedAction:null,log:'',canCancel:true,canRetry:false,pushStartedAt:null,startedAt:null,finishedAt:null,createdAt:1})

function setup(outputs:string[], initial:MergeRun=base(), testCommand='npm run affected-check'){
  let run=initial
  const moves:string[]=[]
  const db={
    getMergeRunRaw:()=>run,
    getMergeRun:()=>run,
    listActiveMergeRuns:()=>[run],
    updateMergeRun:(_id:string,fields:Partial<MergeRun>)=>(run={...run,...fields}),
    appendMergeLog:(_id:string,chunk:string)=>(run={...run,log:run.log+chunk}),
    moveMergeTask:(_p:string,_t:string,column:string)=>moves.push(column),
    getProject:()=>({gitUrl:'git@example/repo.git',testCommand}),
    findLatestCiWorkspace:()=>({path:'/repo/task',pushed:true,agentId:'a1'})
  }
  const executor:CommandExecutor={run:vi.fn(async (_req,onChunk)=>{const output=outputs.shift()??'';onChunk(output);return{exitCode:0,timedOut:false}})}
  const manager=new MergeRunManager({db:db as unknown as VoiceChatDb,executor,isOnline:()=>true,broadcast:()=>{},boardChanged:()=>{},now:(()=>{let n=10;return()=>++n})()})
  return{manager,get run(){return run},moves,executor}
}

describe('MergeRunManager',()=>{
  it('merges from a temporary clone when the released CI workspace no longer exists',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'','',merged+'\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    expect(s.moves).toContain('done')
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    expect(scripts.find(v=>v.includes('git push'))).toContain(`--force-with-lease=refs/heads/main:${target}`)
    expect(scripts.findIndex(v=>v.includes('affected-check'))).toBeLessThan(scripts.findIndex(v=>v.includes('git push')))
    const calls=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0][0]).toMatchObject({workdir:'/repo',script:expect.stringContaining("git clone --no-checkout")})
    expect(calls.some(call=>call[0].workdir==='/repo/task.merge-r1')).toBe(true)
  })
  it('stops stale source before creating a worktree',async()=>{
    const changed='4'.repeat(40), s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${changed}\nTARGET=${target}\n`,''])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('decision_required'))
    expect(s.run.error).toContain('stale source')
    expect((s.executor.run as ReturnType<typeof vi.fn>).mock.calls.some(call=>call[0].script.includes('git checkout --detach'))).toBe(false)
  })
  it('pins the fetched source SHA for a retry after conflicts',async()=>{
    const resolved='4'.repeat(40), s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${resolved}\nTARGET=${target}\n`,'','',merged+'\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''],{...base(),sourceSha:null})
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    expect(s.run.sourceSha).toBe(resolved)
  })
  it('runs a JSON test pipeline sequentially',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'','',merged+'\n','one ok\n','two ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''],base(),JSON.stringify(['npm run one','npm run two']))
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    expect(scripts.indexOf('npm run one')).toBeLessThan(scripts.indexOf('npm run two'))
    expect(s.run.checks[0].command).toBe('npm run one\nnpm run two')
  })
})
