import { describe, expect, it, vi } from 'vitest'
import { recommendedProjectMachineDirectories, type MergeRun, type ProjectMachineDirectoryAssignments } from '@voicechat/shared'
import { MergeRunManager, type MergeConflictFixContext, type MergeKbUpdateContext, type MergeTestFixContext } from './runManager.js'
import type { VoiceChatDb } from '../db/database.js'
import type { CommandExecutor } from '../ci/types.js'

const source='1'.repeat(40), target='2'.repeat(40), merged='3'.repeat(40)
const base=():MergeRun=>({id:'r1',projectId:'p1',taskId:'t1',status:'queued',triggeredBy:'admin',sourceBranch:'CHAT-178',targetBranch:'main',sourceSha:source,targetSha:null,mergeSha:null,revertSha:null,agentId:'a1',machineName:'Mac',llmEngineId:null,llmProvider:'claude',llmModel:'',stage:'queued',stages:[],conflicts:[],conflictDetails:[],checks:[],deployId:null,deployVersion:null,productionStatus:null,error:null,recommendedAction:null,log:'',canCancel:true,canRetry:false,pushStartedAt:null,startedAt:null,finishedAt:null,createdAt:1})

type Out=string|{output:string;exitCode:number}
function setup(outputs:Out[], initial:MergeRun=base(), testCommand='npm run affected-check', gitUrl='git@example/repo.git', kbUpdate:(ctx:MergeKbUpdateContext)=>Promise<{ok:boolean;message:string;llmEngineId?:string|null;llmProvider?:'claude'|'codex';llmModel?:string}>=async()=>({ok:true,message:'Нечего обновлять'}), isOnline:(agentId:string)=>boolean=()=>true, kbFiles:string[]=[], conflictFix:(ctx:MergeConflictFixContext)=>Promise<{ok:boolean;message:string}>=async()=>({ok:false,message:'Модель не исправила конфликты'}), testFix?:(ctx:MergeTestFixContext)=>Promise<{ok:boolean;message:string}>){
  const kbSha=kbFiles.length?'5'.repeat(40):merged
  let lastPushed:string|undefined
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
    findLatestPushedCiWorkspace:()=>({path:'/repo/task',pushed:true,agentId:'a1'}),
    getProjectMachine:(_p:string,agentId:string)=>agentId==='a1'?{agentId,path:'/repo',reposRoot:'/legacy-repos',storageId:null,storageRoot:null,storageFormatVersion:null,directories:null}:agentId==='a2'?{agentId,path:'/other/project',reposRoot:'/other-repos',storageId:null,storageRoot:null,storageFormatVersion:null,directories:null}:agentId==='a3'?{agentId,path:'/missing-root/project',reposRoot:null,storageId:null,storageRoot:null,storageFormatVersion:null,directories:null}:null,
    upsertTaskRepository:(_p:string,_t:string,agentId:string,path:string,kind:string)=>{repositories.push({agentId,path,kind,state:'active'})},
    markTaskRepositoryDeleted:(_t:string,agentId:string,path:string)=>{const item=repositories.find(r=>r.agentId===agentId&&r.path===path);if(item)item.state='deleted'},
    listActiveTaskRepositories:()=>repositories.filter(r=>r.state==='active').map(r=>({taskId:'t1',agentId:r.agentId,path:r.path}))
  }
  const executor:CommandExecutor={run:vi.fn(async (req,onChunk)=>{
    if(req.script.includes('git ls-remote --exit-code')){onChunk(`${target}\trefs/heads/main\n${source}\trefs/heads/${run.sourceBranch}\n`);return{exitCode:0,timedOut:false}}
    if(req.script.includes("printf 'TARGET=%s\\nSOURCE=%s\\n'")){outputs.shift();onChunk(`TARGET=${target}\nSOURCE=${run.sourceSha ?? source}\n`);return{exitCode:0,timedOut:false}}
    if(req.script.includes('git worktree add --detach'))return{exitCode:0,timedOut:false}
    if(req.script.includes('git worktree remove --force')||req.script==='git worktree prune')return{exitCode:0,timedOut:false}
    if(req.script.includes('git add -- docs/kb')){onChunk(`${kbFiles.length?'KB_COMMITTED':'KB_TREE_UNCHANGED'}\nFINAL=${kbSha}\nCHANGED\n${kbFiles.join('\n')}\n`);return{exitCode:0,timedOut:false}}
    if(req.script.includes('git push --porcelain')){
      // Запоминаем, что именно ушло в origin: проверка после push сверяется с
      // этим, иначе тест с автоисправлением видел бы «неопределённый результат».
      lastPushed=req.script.match(/([0-9a-f]{40}):refs\/heads\/main/i)?.[1]??lastPushed
      onChunk('push ok\n');return{exitCode:0,timedOut:false}
    }
    if(req.script==='git ls-remote origin refs/heads/main'){onChunk(`${lastPushed??kbSha} refs/heads/main\n`);return{exitCode:0,timedOut:false}}
    if(req.script.includes('git checkout --ours -- docs/kb/README.md'))return{exitCode:0,timedOut:false}
    const item=outputs.shift()??'';const spec=typeof item==='string'?{output:item,exitCode:0}:item;onChunk(spec.output);return{exitCode:spec.exitCode,timedOut:false}
  })}
  const manager=new MergeRunManager({db:db as unknown as VoiceChatDb,executor,conflictFix,...(testFix?{testFix}:{}),kbUpdate,isOnline,broadcast:()=>{},boardChanged:()=>{},now:(()=>{let n=10;return()=>++n})()})
  return{manager,get run(){return run},moves,executor,repositories}
}

describe('MergeRunManager',()=>{
  it('computes and repeatedly validates one managed merge clone without reposRoot',async()=>{
    const paths=recommendedProjectMachineDirectories('/srv/ChatAI','p1','linux')
    const directories=Object.fromEntries(Object.entries(paths).map(([kind,path])=>[kind,{path,override:false}])) as ProjectMachineDirectoryAssignments
    const executor:CommandExecutor={run:vi.fn(async (_req,onChunk)=>{onChunk(`git@example/repo.git\n${target}\trefs/heads/main\n${source}\trefs/heads/CHAT-178\n`);return{exitCode:0,timedOut:false}})}
    const db={getProject:()=>({gitUrl:'git@example/repo.git'}),findLatestPushedCiWorkspace:()=>({path:'/tasks/t1',pushed:true,agentId:'a1',branch:'CHAT-178'}),getProjectMachine:()=>({agentId:'a1',path:'',reposRoot:null,storageId:'s1',storageRoot:'/srv/ChatAI',storageFormatVersion:1,directories})}
    const marker=Buffer.from(JSON.stringify({id:'s1',formatVersion:1})).toString('base64')
    const manager=new MergeRunManager({db:db as unknown as VoiceChatDb,executor,isOnline:()=>true,platformOf:()=> 'linux',policyOf:()=>({allowedDirs:['/srv']}),fsRead:async()=>({dataBase64:marker}),fsWrite:async()=>({}),fsDelete:async()=>({}),broadcast:()=>{},boardChanged:()=>{}})
    const first=await manager.checkReadiness('admin','p1','t1','a1')
    const second=await manager.checkReadiness('admin','p1','t1','a1')
    expect(first).toMatchObject({ready:true,mode:'managed',clonePath:'/srv/ChatAI/projects/p1/merge-clones/repository'})
    expect(second.clonePath).toBe(first.clonePath)
  })
  it('blocks offline storage before filesystem and Git operations',async()=>{
    const executor:CommandExecutor={run:vi.fn()}
    const manager=new MergeRunManager({db:{} as VoiceChatDb,executor,isOnline:()=>false,broadcast:()=>{},boardChanged:()=>{}})
    expect(await manager.checkReadiness('admin','p1','t1','a1')).toMatchObject({ready:false,code:'machine_offline'})
    expect(executor.run).not.toHaveBeenCalled()
  })
  it('keeps the task in merge when an active run is cancelled',()=>{
    const s=setup([])
    s.manager.start(s.run)
    expect(s.manager.cancel(s.run.id,'admin')?.status).toBe('cancelled')
    expect(s.moves).toEqual(['merge'])
  })
  it('merges from a temporary clone when the released CI workspace no longer exists',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','','',merged+'\n','deps ok\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(['success','failed','decision_required']).toContain(s.run.status))
    expect(s.run.status, `${s.run.error}\n${s.run.log}`).toBe('success')
    expect(s.moves).toContain('done')
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    expect(scripts.find(v=>v.includes('git push')&&v.includes('refs/heads/main'))).toContain(`--force-with-lease=refs/heads/main:${target}`)
    expect(scripts.findIndex(v=>v.includes(`refs/heads/${s.run.sourceBranch}`))).toBeLessThan(scripts.findIndex(v=>v.includes('refs/heads/main')&&v.includes('git push')))
    expect(scripts.findIndex(v=>v.includes('npm ci'))).toBeLessThan(scripts.findIndex(v=>v.includes('affected-check')))
    expect(scripts.findIndex(v=>v.includes('affected-check'))).toBeLessThan(scripts.findIndex(v=>v.includes('git push')))
    expect(scripts.find(v=>v.includes('git worktree add'))).toContain('.merge-run-r1-tests')
    expect(scripts.find(v=>v.includes('git worktree add'))).toContain('.merge-run-r1-kb')
    expect(scripts.find(v=>v.includes('kb.mjs index'))).toContain('kb.mjs check')
    expect(scripts.find(v=>v.includes('npm ci'))).toContain('npm_config_cache')
    expect(scripts.filter(v=>v.includes('npm ci'))).toHaveLength(1)
    const calls=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0][0]).toMatchObject({workdir:'/repo',script:expect.stringContaining('git ls-remote --exit-code')})
    expect(calls.find(call=>call[0].script.includes('git clone'))?.[0]).toMatchObject({workdir:'/repo',script:expect.stringContaining('git clone --no-checkout')})
    expect(calls.some(call=>call[0].workdir==='/repo/.merge')).toBe(true)
  })
  it('finishes instantly with success when the branch is already merged into main',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'MERGED\n',''])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    expect(s.moves).toContain('done')
    expect(s.run.mergeSha).toBe(target)
    expect(s.run.stages.find(stage=>stage.stage==='merging')?.message).toBe('Ветка уже вмержена в main')
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    expect(scripts.some(v=>v.includes('npm'))).toBe(false)
    expect(scripts.some(v=>v.includes('git push'))).toBe(false)
  })
  it('auto-resolves a conflict that touches only the regenerated KB index',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','',{output:'CONFLICT\n',exitCode:1},'docs/kb/README.md\n','',merged+'\n','deps ok\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    expect(s.run.conflicts).toEqual([])
    expect(s.run.stages.find(stage=>stage.stage==='resolving_conflicts')?.status).toBe('passed')
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    expect(scripts.some(v=>v.includes('kb.mjs index'))).toBe(true)
  })
  it('resolves multi-file KB conflicts by normalizing topic metadata and regenerating the index',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','',{output:'CONFLICT\n',exitCode:1},'docs/kb/README.md\ndocs/kb/ui.md\n','',merged+'\n','deps ok\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    expect(s.run.conflicts).toEqual([])
    const resolve=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script).find(v=>v.includes('kb.mjs touch'))
    expect(resolve).toContain("'docs/kb/ui.md'")
    expect(resolve).toContain('git merge-file --stdout')
    expect(resolve).toContain('kb.mjs check')
    expect((s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script).some(v=>v.includes('kb.mjs index'))).toBe(true)
  })
  it('runs the additional step after deterministic KB resolution fails',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','',{output:'CONFLICT\n',exitCode:1},'docs/kb/README.md\ndocs/kb/ui.md\n',{output:'',exitCode:65}])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('failed'))
    expect(s.run.conflicts).toEqual(['docs/kb/ui.md'])
    expect(s.run.stages.find(stage=>stage.stage==='resolving_conflicts')?.message).toContain('Модель не исправила конфликты')
  })
  it('stops for a decision when conflicts touch anything beyond the KB index',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','',{output:'CONFLICT\n',exitCode:1},'docs/kb/README.md\napps/server/src/index.ts\n','','apps/server/src/index.ts\n'])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('failed'))
    expect(s.run.conflicts).toEqual(['apps/server/src/index.ts'])
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    expect(scripts.some(v=>v.includes('git checkout --ours -- docs/kb/README.md'))).toBe(true)
    expect(scripts.some(v=>v.includes('kb.mjs index'))).toBe(false)
  })
  it('runs one additional model step for an ambiguous conflict and continues after server verification',async()=>{
    const enc=(value:string)=>Buffer.from(value).toString('base64')
    const path='apps/server/src/index.ts'
    const stages=`100644 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1\t${path}\n100644 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2\t${path}\n100644 cccccccccccccccccccccccccccccccccccccccc 3\t${path}\nSTAGE1=${enc('a\nb\n')}\nSTAGE2=${enc('a\nours\n')}\nSTAGE3=${enc('a\ntheirs\n')}\n`
    const fix=vi.fn(async(ctx:MergeConflictFixContext)=>({ok:true,message:`Исправлен ${ctx.conflicts.join(', ')}`}))
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','',{output:'CONFLICT\n',exitCode:1},path+'\n',stages,path+'\n','','',merged+'\n','deps ok\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''],base(),'npm run affected-check','git@example/repo.git',async()=>({ok:true,message:'Нечего обновлять'}),()=>true,[],fix)
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(['success','failed']).toContain(s.run.status))
    expect(s.run.status,`${s.run.error}\\n${s.run.log}`).toBe('success')
    expect(fix).toHaveBeenCalledTimes(1)
    expect(fix.mock.calls[0][0]).toMatchObject({repo:'/repo/.merge',conflicts:[path]})
    expect(s.run.conflicts).toEqual([])
    expect(s.run.stages.find(stage=>stage.stage==='resolving_conflicts')).toMatchObject({status:'passed'})
  })

  it('auto-resolves all independent text conflicts and continues through gates',async()=>{
    const enc=(value:string)=>Buffer.from(value).toString('base64')
    const path='packages/ui/src/styles/app.css', baseCss='.automation-progress {}\n'
    const stageOutput=`100644 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1\t${path}\n100644 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2\t${path}\n100644 cccccccccccccccccccccccccccccccccccccccc 3\t${path}\nSTAGE1=${enc(baseCss)}\nSTAGE2=${enc(baseCss+'.turn-queue {}\n')}\nSTAGE3=${enc(baseCss+'.personalization-page {}\n')}\n`
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','',{output:'CONFLICT\n',exitCode:1},path+'\n',stageOutput,'','',merged+'\n',merged+'\n','deps ok\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(['success','failed','decision_required']).toContain(s.run.status))
    expect(s.run.status,`${s.run.error}\n${s.run.log}`).toBe('success')
    expect(s.run.conflicts).toEqual([])
    expect(s.run.log).toContain('classification=same-anchor-independent-insert')
    expect(s.run.log).toContain('rule=same-anchor-ours-then-theirs')
    expect((s.executor.run as ReturnType<typeof vi.fn>).mock.calls.some(call=>call[0].script.includes('git add --')&&call[0].script.includes(path))).toBe(true)
    expect((s.executor.run as ReturnType<typeof vi.fn>).mock.calls.some(call=>call[0].script.includes('affected-check'))).toBe(true)
  })

  it('indexes safe files but keeps only ambiguous conflicts for a decision',async()=>{
    const enc=(value:string)=>Buffer.from(value).toString('base64')
    const stages=(baseText:string,oursText:string,theirsText:string,path:string)=>`100644 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1\t${path}\n100644 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2\t${path}\n100644 cccccccccccccccccccccccccccccccccccccccc 3\t${path}\nSTAGE1=${enc(baseText)}\nSTAGE2=${enc(oursText)}\nSTAGE3=${enc(theirsText)}\n`
    const safe='safe.css',ambiguous='ambiguous.ts'
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','',{output:'CONFLICT\n',exitCode:1},safe+'\n'+ambiguous+'\n',stages('a\n','a\nours\n','a\ntheirs\n',safe),'',stages('a\nb\n','a\nB\n','a\nX\n',ambiguous),ambiguous+'\n'])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('failed'))
    expect(s.run.conflicts).toEqual([ambiguous])
    expect(s.run.log).toContain(`Авторазрешение ${safe}: classification=same-anchor-independent-insert, applied=yes`)
    expect(s.run.log).toContain(`Авторазрешение ${ambiguous}: classification=ambiguous, applied=no`)
  })

  it('stops stale source before creating a worktree',async()=>{
    const changed='4'.repeat(40), s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${changed}\nTARGET=${target}\n`,'PENDING\n',''])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('decision_required'))
    expect(s.run.error).toContain('stale source')
    expect((s.executor.run as ReturnType<typeof vi.fn>).mock.calls.some(call=>call[0].script.includes('git checkout --detach'))).toBe(false)
  })
  it('pins the fetched source SHA for a retry after conflicts',async()=>{
    const resolved='4'.repeat(40), s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${resolved}\nTARGET=${target}\n`,'PENDING\n','','',merged+'\n','deps ok\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''],{...base(),sourceSha:null})
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    expect(s.run.sourceSha).toBe(resolved)
  })
  it('accepts an equivalent HTTPS origin URL for an SSH project URL (insteadOf rewrite)',async()=>{
    const s=setup(['','https://github.com/sislex/voiceAIChat.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','','',merged+'\n','deps ok\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''],base(),'npm run affected-check','git@github.com:sislex/voiceAIChat.git')
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
  })
  it('rejects a foreign origin URL',async()=>{
    const s=setup(['','https://github.com/attacker/other.git\ntrue\n'],base(),'npm run affected-check','git@github.com:sislex/voiceAIChat.git')
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('failed'))
    expect(s.run.error).toContain('URL origin')
    expect(s.moves).toContain('merge')
  })
  it('clones into the chosen machine repos_root when it differs from the workspace machine',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','','',merged+'\n','deps ok\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''],{...base(),agentId:'a2'})
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    const calls=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls
    const preflight=calls[0][0]
    expect(preflight.workdir).toBe('/other-repos')
    expect(preflight.script).toContain('git ls-remote --exit-code')
    const clone=calls.find(call=>call[0].script.includes('git clone'))?.[0]
    expect(clone?.script).toContain('/other-repos/repo/.merge')
    expect(clone?.script).toContain('mkdir -p')
    expect(s.repositories.some(r=>r.agentId==='a1'&&r.path==='/repo/task'&&r.kind==='dev-workspace')).toBe(true)
  })
  it('releases all task repositories after a successful merge',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','','',merged+'\n','deps ok\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n','',''])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    await vi.waitFor(()=>expect(s.repositories.filter(r=>r.state==='active')).toHaveLength(0))
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    expect(scripts.some(v=>v.includes('rm -rf')&&v.includes("'/repo/task'"))).toBe(true)
    expect(scripts.some(v=>v.includes('rm -rf')&&v.includes('.merge'))).toBe(false)
  })
  it('fails with a clear configuration error when the chosen machine has no repos_root',async()=>{
    const s=setup([],{...base(),agentId:'a3'})
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('failed'))
    expect(s.run.error).toBe('MachineStorage отсутствует и legacy reposRoot не настроен')
    expect(s.executor.run).not.toHaveBeenCalled()
  })
  it('keeps repositories on unavailable machines pending after successful cleanup',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'MERGED\n',''],base(),'npm run affected-check','git@example/repo.git',async()=>({ok:true,message:'Нечего обновлять'}),agentId=>agentId!=='offline')
    s.repositories.push({agentId:'offline',path:'/offline/repo/task',kind:'dev-workspace',state:'active'})
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    await vi.waitFor(()=>expect(s.repositories.find(repo=>repo.agentId==='a1')?.state).toBe('deleted'))
    expect(s.repositories.find(repo=>repo.agentId==='offline')?.state).toBe('active')
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    expect(scripts.some(script=>script.includes('/offline/repo/task'))).toBe(false)
  })
  it('does not release repositories when checks fail',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','','',merged+'\n','deps ok\n',{output:'tests failed\n',exitCode:1}])
    s.repositories.push({agentId:'a1',path:'/repo/old-task-copy',kind:'merge-clone',state:'active'})
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('failed'))
    expect(s.repositories.every(repo=>repo.state==='active')).toBe(true)
    expect(s.moves).toContain('merge')
    expect((s.executor.run as ReturnType<typeof vi.fn>).mock.calls.some(call=>call[0].script.includes('rm -rf'))).toBe(false)
  })
  it('releases repositories when reconcile confirms an earlier push',async()=>{
    const s=setup([merged+' refs/heads/main\n',''],{...base(),pushStartedAt:5,mergeSha:merged})
    s.repositories.push({agentId:'a1',path:'/repo/task',kind:'dev-workspace',state:'active'})
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    await vi.waitFor(()=>expect(s.repositories[0].state).toBe('deleted'))
  })
  it('runs kb_update on the merged tree before tests and persists its LLM outcome',async()=>{
    const seen:{repo?:string;targetRef?:string}={}
    const hook=vi.fn(async(ctx:MergeKbUpdateContext)=>{seen.repo=ctx.repo;seen.targetRef=ctx.targetRef;return{ok:true,message:'Файловая БЗ обновлена',llmEngineId:'engine-1',llmProvider:'codex' as const,llmModel:'gpt-5.6-luna'}})
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','','',merged+'\n','deps ok\n','tests ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''],base(),'npm run affected-check','git@example/repo.git',hook)
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    expect(seen).toEqual({repo:'/repo/.merge-run-r1-kb',targetRef:'refs/merge-runs/r1/target'})
    expect(s.run.stages.map(stage=>stage.stage)).toEqual(expect.arrayContaining(['merging','kb_update','testing','pushing']))
    expect(s.run.stages.find(stage=>stage.stage==='kb_update')).toMatchObject({status:'passed',message:expect.stringContaining('Файловая БЗ обновлена')})
    expect(s.run).toMatchObject({llmEngineId:'engine-1',llmProvider:'codex',llmModel:'gpt-5.6-luna'})
  })
  it('stops before tests and push when mandatory kb_update fails',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','','',merged+'\n'],base(),'npm run affected-check','git@example/repo.git',async()=>({ok:false,message:'Ответ модели неразборчив'}))
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('failed'))
    expect(s.run.stages.find(stage=>stage.stage==='kb_update')).toMatchObject({status:'failed'})
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    // Проверки уже стартовали параллельно с БЗ, но публикация всё равно запрещена.
    expect(scripts.some(script=>script.includes('affected-check'))).toBe(true)
    expect(scripts.some(script=>script.includes('git push'))).toBe(false)
  })

  it('runs a JSON test pipeline sequentially',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','','',merged+'\n','deps ok\n','one ok\n','two ok\n',`TARGET=${target}\n`,'push ok\n',merged+' refs/heads/main\n',''],base(),JSON.stringify(['npm run one','npm run two']))
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    expect(scripts.indexOf('npm run one')).toBeLessThan(scripts.indexOf('npm run two'))
    expect(s.run.checks[0].command).toBe('npm run one\nnpm run two')
    expect((s.executor.run as ReturnType<typeof vi.fn>).mock.calls.find(call=>call[0].script==='npm run one')?.[0].timeoutMs).toBe(1800000)
  })

  it('creates a separate KB commit in feature and pushes exactly that SHA to main',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','','',merged+'\n','deps ok\n','tests ok\n','deps repeat\n','docs ok\n',`TARGET=${target}\n`],base(),'npm run affected-check','git@example/repo.git',async()=>({ok:true,message:'БЗ обновлена'}),()=>true,['docs/kb/merge.md'])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    const kbCommit=scripts.find(script=>script.includes('docs(kb): update after merge'))
    expect(kbCommit).toBeTruthy()
    expect(kbCommit).not.toContain('commit --amend')
    const final='5'.repeat(40)
    expect(scripts.find(script=>script.includes(`refs/heads/${s.run.sourceBranch}`)&&script.includes('git push'))).toContain(final)
    expect(scripts.find(script=>script.includes('refs/heads/main')&&script.includes('git push'))).toContain(final)
    expect(s.run.checks.map(check=>check.name)).toEqual(['Проверки проекта','Документальный гейт после БЗ'])
  })

  it('lets the model fix failing checks once and continues after the server commits and re-runs the gate',async()=>{
    const fixed='7'.repeat(40)
    // Первая пара «deps + tests» падает, затем идут проверка результата модели,
    // коммит фикса и повторный проход гейта уже от нового SHA.
    const s=setup([
      '','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','','',merged+'\n',
      'deps ok\n',{output:'tests failed\n',exitCode:1},
      `HEAD=${merged}\nDIRTY\n M packages/ui/src/styles/app.css\nMARKERS\n`,
      `FIXED=${fixed}\n`,
      'deps ok\n','tests ok\n',
      `TARGET=${target}\n`
    ],base(),'npm run affected-check','git@example/repo.git',async()=>({ok:true,message:'БЗ обновлена'}),()=>true,[],undefined,async()=>({ok:true,message:'Модель поправила токен'}))
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'),{timeout:3000})
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    // Сервер сам закоммитил правку модели, и дальше ран пошёл от нового SHA:
    // KB-шаг сравнивает дерево именно с ним.
    expect(scripts.find(script=>script.includes('fix(merge): автоисправление упавших проверок'))).toBeTruthy()
    expect(scripts.find(script=>script.includes('docs(kb): update after merge'))).toContain(fixed)
    expect(s.run.checks.map(check=>check.status)).toContain('passed')
    // Гейт прогоняется заново после исправления (и ещё раз после KB-коммита).
    expect(scripts.filter(script=>script==='npm run affected-check').length).toBeGreaterThanOrEqual(2)
    expect(s.moves).toContain('done')
  })

  it('rejects a fix that changed nothing and keeps the task in merge',async()=>{
    const s=setup([
      '','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','','',merged+'\n',
      'deps ok\n',{output:'tests failed\n',exitCode:1},
      `HEAD=${merged}\nDIRTY\nMARKERS\n`
    ],base(),'npm run affected-check','git@example/repo.git',async()=>({ok:true,message:'БЗ обновлена'}),()=>true,[],undefined,async()=>({ok:true,message:'Модель считает, что всё исправила'}))
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('failed'))
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    expect(scripts.some(script=>script.includes('fix(merge): автоисправление'))).toBe(false)
    expect(scripts.some(script=>script.includes('git push'))).toBe(false)
    expect(s.run.error).toContain('автоисправление не помогло')
    expect(s.moves).toContain('merge')
  })

  it('does not try a second fix inside one run',async()=>{
    const fixed='7'.repeat(40)
    const s=setup([
      '','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','','',merged+'\n',
      'deps ok\n',{output:'tests failed\n',exitCode:1},
      `HEAD=${merged}\nDIRTY\n M app.css\nMARKERS\n`,
      `FIXED=${fixed}\n`,
      'deps ok\n',{output:'tests failed again\n',exitCode:1}
    ],base(),'npm run affected-check','git@example/repo.git',async()=>({ok:true,message:'БЗ обновлена'}),()=>true,[],undefined,async()=>({ok:true,message:'Модель поправила'}))
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('failed'))
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    // Ровно один коммит автоисправления: второй заход не запускается.
    expect(scripts.filter(script=>script.includes('fix(merge): автоисправление')).length).toBe(1)
    expect(s.run.error).toContain('Проверки упали')
    expect(s.moves).toContain('merge')
  })

  it('starts by merging main into the feature branch, not the other way round',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','','',merged+'\n','deps ok\n','tests ok\n',`TARGET=${target}\n`])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    const prepared=scripts.find(script=>script.includes('git checkout -f --detach'))!
    const mergeCommand=scripts.find(script=>script.includes('merge --no-ff'))!
    // Встаём на ветку задачи и вливаем в неё main: merge-коммит принадлежит
    // ветке, а main догоняет её fast-forward.
    expect(prepared).toContain(`refs/merge-runs/${s.run.id}/source`)
    expect(prepared).not.toContain(`refs/merge-runs/${s.run.id}/target`)
    expect(mergeCommand).toContain(`refs/merge-runs/${s.run.id}/target`)
    expect(mergeCommand).toContain(`Merge main into ${s.run.sourceBranch}`)
  })

  it('fixes the post-KB gate too and publishes the repaired SHA',async()=>{
    const kbSha='5'.repeat(40), fixed='7'.repeat(40)
    // Первый гейт проходит, KB-коммит меняет сборочный файл, повторный полный
    // гейт падает — и вот его лечит та же одна попытка автоисправления.
    const s=setup([
      '','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','','',merged+'\n',
      'deps ok\n','tests ok\n',
      'deps repeat\n',{output:'repeat failed\n',exitCode:1},
      `HEAD=${kbSha}\nDIRTY\n M apps/server/src/config.ts\nMARKERS\n`,
      `FIXED=${fixed}\n`,
      'deps repeat 2\n','tests ok\n',
      `TARGET=${target}\n`
    ],base(),'npm run affected-check','git@example/repo.git',async()=>({ok:true,message:'БЗ и код обновлены'}),()=>true,['apps/server/src/config.ts'],undefined,async()=>({ok:true,message:'Модель поправила сборку'}))
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'),{timeout:3000})
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    expect(scripts.find(script=>script.includes('fix(merge): автоисправление упавших проверок'))).toBeTruthy()
    // В main уходит SHA после автоисправления, а не упавший KB-коммит.
    expect(scripts.find(script=>script.includes('refs/heads/main')&&script.includes('git push'))).toContain(fixed)
    expect(s.moves).toContain('done')
  })

  it('keeps the old behaviour when no test-fix hook is wired',async()=>{
    const s=setup([
      '','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','','',merged+'\n',
      'deps ok\n',{output:'tests failed\n',exitCode:1}
    ],base(),'npm run affected-check','git@example/repo.git',async()=>({ok:true,message:'БЗ обновлена'}))
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('failed'))
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    expect(scripts.some(script=>script.includes('fix(merge): автоисправление'))).toBe(false)
    expect(s.run.error).toBe('Проверки упали (exit 1)')
  })

  it('repeats the full gate when the KB worktree changes build-affecting files',async()=>{
    const s=setup(['','git@example/repo.git\ntrue\n',`SOURCE=${source}\nTARGET=${target}\n`,'PENDING\n','','',merged+'\n','deps ok\n','tests ok\n','deps repeat\n','tests repeat\n',`TARGET=${target}\n`],base(),'npm run affected-check','git@example/repo.git',async()=>({ok:true,message:'БЗ и код обновлены'}),()=>true,['apps/server/src/config.ts'])
    s.manager.start(s.run)
    await vi.waitFor(()=>expect(s.run.status).toBe('success'))
    expect(s.run.checks.map(check=>check.name)).toEqual(['Проверки проекта','Полный повторный гейт после БЗ'])
    const scripts=(s.executor.run as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0].script)
    expect(scripts.filter(script=>script==='npm run affected-check')).toHaveLength(2)
  })
})
