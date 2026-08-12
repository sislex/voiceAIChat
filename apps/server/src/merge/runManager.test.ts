import { describe, expect, it, vi } from 'vitest'
import type { MergeRun } from '@voicechat/shared'
import { MergeRunManager } from './runManager.js'
import type { VoiceChatDb } from '../db/database.js'
import type { CommandExecutor } from '../ci/types.js'

const source='1'.repeat(40), target='2'.repeat(40), merged='3'.repeat(40)
const base=():MergeRun=>({id:'r1',projectId:'p1',taskId:'t1',status:'queued',triggeredBy:'admin',sourceBranch:'CHAT-178',targetBranch:'main',sourceSha:source,targetSha:null,mergeSha:null,revertSha:null,agentId:'a1',machineName:'Mac',llmEngineId:null,llmProvider:'claude',llmModel:'',stage:'queued',stages:[],conflicts:[],conflictDetails:[],checks:[],deployId:null,deployVersion:null,productionStatus:null,error:null,recommendedAction:null,log:'',canCancel:true,canRetry:false,pushStartedAt:null,startedAt:null,finishedAt:null,createdAt:1})

function setup(outputs:string[], initial:MergeRun=base(), testCommand='npm run affected-check', gitUrl='git@example/repo.git'){
  let run=initial
  const moves:string[]=[]
  const repositories:{agentId:string;path:string;kind:string;state:string}[]=[]
  const db={
    getMergeRunRaw:()=>run,
    getMergeRun:()=>run,
    listActiveMergeRuns:()=>[run],
    updateMergeRun:(_id:string,fields:Partial<MergeRun>)=>(run={...run,...fields}),
    appendMergeLog:(_id:string,chunk:string)=>(run={...run,log:run.log+chunk}),
    moveMergeTask:(_p:string,_t:string,column:string)=>moves.push(column),
    getProject:()=>({gitUrl,testCommand}),
    findLatestCiWorkspace:()=>({path:'/repo/task',pushed:true,agentId:'a1'}),
    getProjectMachine:(_p:string,agentId:string)=>agentId==='a2'?{agentId,path:'/other/project',reposRoot:'/other-repos'}:null,
    upsertTaskRepository:(_p:string,_t:string,agentId:string,path:string,kind:string)=>{repositories.push({agentId,path,kind,state:'active'})},
    markTaskRepositoryDeleted:(_t:string,agentId:string,path:string)=>{const item=repositories.find(r=>r.agentId===agentId&&r.path===path);if(item)item.state='deleted'},
    listActiveTaskRepositories:()=>repositories.filter(r=>r.state==='active').map(r=>({taskId:'t1',agentId:r.agentId,path:r.path}))
  }
  const executor:CommandExecutor={run:vi.fn(async (_req,onChunk)=>{const output=outputs.shift()??'';onChunk(output);return{exitCode:0,timedOut:false}})}
  const manager=new MergeRunManager({db:db as unknown as VoiceChatDb,executor,isOnline:()=>true,broadcast:()=>{},boardChanged:()=>{},now:(()=>{let n=10;return()=>++n})()})
  return{manager,get run(){return run},moves,executor,repositories}
}

describe('MergeRunManager',()=>{
  it('merges from a temporary clone when the released CI workspace no longer exists',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'','',merged+'\n','deps ok\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    expect(s.moves).toContain('done')
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    expect(scripts.find(v=>v.includes('git push'))).toContain(`--force-with-lease=refs/heads/main:${target}`)
    expect(scripts.findIndex(v=>v.includes('npm ci'))).toBeLessThan(scripts.findIndex(v=>v.includes('affected-check')))
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
    const resolved='4'.repeat(40), s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${resolved}\nTARGET=${target}\n`,'','',merged+'\n','deps ok\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''],{...base(),sourceSha:null})
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    expect(s.run.sourceSha).toBe(resolved)
  })
  it('accepts an equivalent HTTPS origin URL for an SSH project URL (insteadOf rewrite)',async()=>{
    const s=setup(['','https://github.com/sislex/voiceAIChat.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'','',merged+'\n','deps ok\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''],base(),'npm run affected-check','git@github.com:sislex/voiceAIChat.git')
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
  })
  it('rejects a foreign origin URL',async()=>{
    const s=setup(['','https://github.com/attacker/other.git\ntrue\n'],base(),'npm run affected-check','git@github.com:sislex/voiceAIChat.git')
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('failed'))
    expect(s.run.error).toContain('URL origin')
  })
  it('clones into the chosen machine repos_root when it differs from the workspace machine',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'','',merged+'\n','deps ok\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''],{...base(),agentId:'a2'})
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    const first=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(first.workdir).toBe('/other-repos')
    expect(first.script).toContain('/other-repos/repo/task.merge-r1')
    expect(first.script).toContain('mkdir -p')
    expect(s.repositories.some(r=>r.agentId==='a2'&&r.path==='/other-repos/repo/task.merge-r1'&&r.kind==='merge-clone')).toBe(true)
    expect(s.repositories.some(r=>r.agentId==='a1'&&r.path==='/repo/task'&&r.kind==='dev-workspace')).toBe(true)
  })
  it('releases all task repositories after a successful merge',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'','',merged+'\n','deps ok\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n','',''])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    await vi.waitFor(()=>expect(s.repositories.filter(r=>r.state==='active')).toHaveLength(0))
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    expect(scripts.some(v=>v.includes('rm -rf')&&v.includes('/repo/task.merge-r1'))).toBe(true)
    expect(scripts.some(v=>v.includes('rm -rf')&&v.includes("'/repo/task'"))).toBe(true)
  })
  it('runs a JSON test pipeline sequentially',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'','',merged+'\n','deps ok\n','one ok\n','two ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''],base(),JSON.stringify(['npm run one','npm run two']))
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    expect(scripts.indexOf('npm run one')).toBeLessThan(scripts.indexOf('npm run two'))
    expect(s.run.checks[0].command).toBe('npm run one\nnpm run two')
    expect((s.executor.run as ReturnType<typeof vi.fn>).mock.calls.find(call=>call[0].script==='npm run one')?.[0].timeoutMs).toBe(1800000)
  })
})
