import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import { RELEASE_TEST_TIMEOUT_MS, ReleaseManager, releaseCheckoutCommand, releaseKnowledgeBaseCommand, releaseRegressionCleanupCommand, releaseRegressionInstallCommand, releaseRegressionSetupCommand, releaseRegressionStageCommand, releaseSwitchCommand, releaseTestCommands, type ProductionTarget, type ReleaseProjectTarget, type ReleaseRuntime } from './releaseManager.js'

let db:VoiceChatDb
let projectId:string
const ci=():ReleaseProjectTarget=>({projectId,agentId:'ci',path:'/ci',baseBranch:'main',testCommand:'npm run verify:release',gitUrl:'git@example/repo.git',prepareCheckout:false})
const prod=():ProductionTarget=>({...ci(),agentId:'prod',path:'/prod',deployCommand:'npm run deploy:prod',healthCheckCommand:'npm run health:prod',expectedRepository:'git@example/repo.git'})
const tick=()=>new Promise(resolve=>setTimeout(resolve,0))
beforeEach(()=>{let id=0;db=new VoiceChatDb(':memory:',{newId:()=>`id-${++id}`,now:()=>1000+id});db.createUser('owner','','developer');projectId=db.createProject('owner',{name:'P'}).id})
afterEach(()=>db.close())

describe('ReleaseManager separated preparation and deploy',()=>{
  it('supports staged release test commands while keeping strings backward compatible',()=>{
    expect(releaseTestCommands('["npm run typecheck","npm run test"]')).toEqual(['npm run typecheck','npm run test'])
    expect(releaseTestCommands('npm run verify')).toEqual(['npm run verify'])
    expect(RELEASE_TEST_TIMEOUT_MS).toBe(600_000)
  })

  it('prepares the knowledge base in an isolated worktree with a guarded push',()=>{
    const command=releaseKnowledgeBaseCommand(ci(),'release/1.2.3')
    expect(command).toContain('mktemp -d')
    expect(command).toContain('git worktree add --detach')
    expect(command).toContain("+refs/heads/release/1.2.3:refs/voicechat/preflight/release/1.2.3")
    expect(command).toContain("git rev-parse 'refs/voicechat/preflight/release/1.2.3'")
    expect(command).toContain("git update-ref -d 'refs/voicechat/preflight/release/1.2.3'")
    expect(command).toContain("--force-with-lease='refs/heads/release/1.2.3':$expected")
    expect(command).not.toContain('FETCH_HEAD')
    expect(command).not.toContain('git checkout -B')
    // На машине агента глобальный user.email может быть не настроен: без флагов
    // git отказывается угадывать его по хосту, и сборка падает на шаге БЗ.
    expect(command).toContain("git -c user.name='voiceAIChat release' -c user.email='release@voicechat.local' commit")
  })

  it('builds an idempotent checkout command that refuses a foreign origin',()=>{
    const command=releaseCheckoutCommand({...ci(),path:'/repos/.release_repo',prepareCheckout:true})
    expect(command).toContain("git clone -- 'git@example/repo.git' '/repos/.release_repo'")
    expect(command).toContain('другой remote.origin.url')
    expect(command).toContain("find '/repos/.release_repo' -mindepth 1 -maxdepth 1 -print -quit")
    expect(command).not.toContain('rm -rf')
  })

  it('keeps a compound regression stage inside the project checkout',async()=>{
    const commands:string[]=[]
    const target={...ci(),testCommand:'npm run shared & p1=$!; npm run ui & p2=$!; wait $p1; wait $p2'}
    const runtime:ReleaseRuntime={
      isOnline:()=>true,
      prepareKnowledgeBase:async()=>{},
      exec:async(_target,command)=>{
        commands.push(command)
        if(command.includes('ls-remote'))return {exitCode:0,output:commands.some(x=>x.includes('git branch'))?'prepared-sha\trefs/heads/release/1.2.3\n':''}
        if(command.includes('git branch'))return {exitCode:0,output:'prepared-sha\n'}
        return {exitCode:0,output:'ok'}
      }
    }
    const release=await new ReleaseManager(db,runtime).createBranch('owner',target,'release/1.2.3','main')
    await tick();await tick()
    const setup=releaseRegressionSetupCommand(target,release.id,'prepared-sha')
    const install=releaseRegressionInstallCommand(target,release.id)
    const stage=releaseRegressionStageCommand(target,release.id,target.testCommand)
    const cleanup=releaseRegressionCleanupCommand(target,release.id)
    expect(commands).toContain(setup)
    expect(commands).toContain(install)
    expect(commands).toContain(stage)
    expect(commands).toContain(cleanup)
    expect(commands.indexOf(setup)).toBeLessThan(commands.indexOf(install))
    expect(commands.indexOf(install)).toBeLessThan(commands.indexOf(stage))
    expect(commands.indexOf(stage)).toBeLessThan(commands.indexOf(cleanup))
    expect(commands.join('\n')).not.toContain("git checkout --detach 'prepared-sha' && (npm run shared")
    expect(db.getProjectRelease('owner',projectId,release.id)?.status).toBe('ready')
  })

  it('logs a reproducible dependency installation failure and cleans the isolated worktree',async()=>{
    const commands:string[]=[]
    const runtime:ReleaseRuntime={
      isOnline:()=>true,
      prepareKnowledgeBase:async()=>{},
      exec:async(_target,command,_timeout,onChunk)=>{
        commands.push(command)
        if(command.includes('ls-remote'))return {exitCode:0,output:commands.some(x=>x.includes('git branch'))?'prepared-sha\trefs/heads/release/1.2.3\n':''}
        if(command.includes('git branch'))return {exitCode:0,output:'prepared-sha\n'}
        if(command.includes('(npm ci)')){onChunk?.('npm ERR! lock mismatch\n');return {exitCode:1,output:'npm ERR! lock mismatch\n'}}
        return {exitCode:0,output:'ok'}
      }
    }
    const target={...ci(),testCommand:'npm run verify:release'}
    const release=await new ReleaseManager(db,runtime).createBranch('owner',target,'release/1.2.3','main')
    await tick();await tick()
    const stored=db.getProjectRelease('owner',projectId,release.id)
    expect(commands).toContain(releaseRegressionInstallCommand(target,release.id))
    expect(commands).not.toContain(releaseRegressionStageCommand(target,release.id,target.testCommand))
    expect(commands).toContain(releaseRegressionCleanupCommand(target,release.id))
    expect(stored?.status).toBe('failed')
    expect(stored?.steps.find(step=>step.kind==='regression')?.log).toContain('npm ERR! lock mismatch')
  })

  it('cleans the isolated regression worktree after a failed stage without switching the shared checkout',async()=>{
    const commands:string[]=[]
    const runtime:ReleaseRuntime={
      isOnline:()=>true,
      prepareKnowledgeBase:async()=>{},
      exec:async(_target,command)=>{
        commands.push(command)
        if(command.includes('ls-remote'))return {exitCode:0,output:commands.some(x=>x.includes('git branch'))?'prepared-sha\trefs/heads/release/1.2.3\n':''}
        if(command.includes('git branch'))return {exitCode:0,output:'prepared-sha\n'}
        if(command.includes('(npm run fail)'))return {exitCode:1,output:'failed stage'}
        return {exitCode:0,output:'ok'}
      }
    }
    const target={...ci(),testCommand:'npm run fail'}
    const release=await new ReleaseManager(db,runtime).createBranch('owner',target,'release/1.2.3','main')
    await tick();await tick()
    expect(commands).toContain(releaseRegressionCleanupCommand(target,release.id))
    expect(commands.join('\n')).not.toMatch(/git checkout --detach 'prepared-sha' &&/)
    expect(db.getProjectRelease('owner',projectId,release.id)?.status).toBe('failed')
  })

  it('cleans the isolated regression worktree after a timed out stage',async()=>{
    const commands:string[]=[]
    const runtime:ReleaseRuntime={
      isOnline:()=>true,
      prepareKnowledgeBase:async()=>{},
      exec:async(_target,command)=>{
        commands.push(command)
        if(command.includes('ls-remote'))return {exitCode:0,output:commands.some(x=>x.includes('git branch'))?'prepared-sha\trefs/heads/release/1.2.3\n':''}
        if(command.includes('git branch'))return {exitCode:0,output:'prepared-sha\n'}
        if(command.includes('(npm run slow)'))return {exitCode:null,output:'still running',timedOut:true}
        return {exitCode:0,output:'ok'}
      }
    }
    const target={...ci(),testCommand:'npm run slow'}
    const release=await new ReleaseManager(db,runtime).createBranch('owner',target,'release/1.2.3','main')
    await tick();await tick()
    expect(commands).toContain(releaseRegressionCleanupCommand(target,release.id))
    expect(db.getProjectRelease('owner',projectId,release.id)?.status).toBe('failed')
    expect(db.getProjectRelease('owner',projectId,release.id)?.steps.find(step=>step.kind==='regression')?.log).toContain('превысила лимит')
  })

  it('prepares KB and runs regression while creating the branch',async()=>{
    const commands:string[]=[]
    const runtime:ReleaseRuntime={
      isOnline:()=>true,
      prepareKnowledgeBase:vi.fn(async()=>{}),
      exec:async(_target,command,_timeout,onChunk)=>{
        commands.push(command)
        if(command.includes('ls-remote'))return {exitCode:0,output:commands.some(x=>x.includes('git branch'))?'prepared-sha\trefs/heads/release/1.2.3\n':''}
        if(command.includes('git branch'))return {exitCode:0,output:'prepared-sha\n'}
        if(command.includes('verify:release'))onChunk?.('[affected-check] active package: server; elapsed: 30s; stage: running\n')
        return {exitCode:0,output:'ok'}
      }
    }
    const manager=new ReleaseManager(db,runtime)
    const release=await manager.createBranch('owner',ci(),'release/1.2.3','main')
    await tick();await tick()
    expect(runtime.prepareKnowledgeBase).toHaveBeenCalledWith('release/1.2.3',ci())
    expect(commands.some(command=>command.includes('npm run verify:release'))).toBe(true)
    expect(commands.some(command=>command.includes('affected-check'))).toBe(false)
    const stored=db.getProjectRelease('owner',projectId,release.id)
    expect(stored?.status).toBe('ready')
    expect(stored?.steps.find(step=>step.kind==='regression')?.log).toContain('active package: server')
  })

  it('switches production through an attempt-specific ref instead of FETCH_HEAD',()=>{
    const command=releaseSwitchCommand(prod(),{id:'attempt-7',branch:'release/1.2.3',sha:'fixed-sha'})
    expect(command).toContain("+refs/heads/release/1.2.3:refs/voicechat/releases/attempt-7")
    expect(command).toContain("git rev-parse 'refs/voicechat/releases/attempt-7'")
    expect(command).toContain("git update-ref -d 'refs/voicechat/releases/attempt-7'")
    expect(command).not.toContain('FETCH_HEAD')
  })

  it('passes the release branch version to production without merging main or creating a tag',async()=>{
    const commands:string[]=[]
    const runtime:ReleaseRuntime={isOnline:()=>true,prepareKnowledgeBase:async()=>{},exec:async(_target,command)=>{commands.push(command);return command.includes('ls-remote')?{exitCode:0,output:'fixed-sha\trefs/heads/release/0.1.27\n'}:command.includes('health:prod')?{exitCode:0,output:'{"ok":true,"version":"0.1.27","commit":"fixed-sha"}'}:{exitCode:0,output:'ok'}}}
    const prepared=db.createProjectRelease('owner',projectId,{branch:'release/0.1.27',version:'0.1.27',sha:'fixed-sha',status:'ready'})
    const manager=new ReleaseManager(db,runtime)
    const attempt=await manager.start('owner',ci(),prod(),'release/0.1.27')
    await tick();await tick()
    expect(commands.join('\n')).not.toMatch(/affected-check|merge |tag |push .*main/)
    expect(commands.some(command=>command.includes("checkout -B 'release/0.1.27' 'fixed-sha'"))).toBe(true)
    expect(commands).toContain("cd '/prod' && export VC_RELEASE_VERSION='0.1.27' VC_RELEASE_VERSION_SOURCE='release-manager' && echo 'Ожидаемые production metadata: version=0.1.27 commit=fixed-sha source=release-manager' && npm run deploy:prod")
    expect(commands.join('\n')).not.toContain('install -m 755 scripts/prod/deploy.sh')
    expect(db.getProjectRelease('owner',projectId,attempt.id)?.status).toBe('released')
    expect(prepared.status).toBe('ready')
  })

  it('checks free disk before build: prunes docker cache when low and fails explicitly if still low (roadmap-3 п.1)',async()=>{
    const commands:string[]=[]
    let pruned=false
    const runtime:ReleaseRuntime={isOnline:()=>true,prepareKnowledgeBase:async()=>{},exec:async(_target,command)=>{
      commands.push(command)
      if(command.includes('ls-remote'))return{exitCode:0,output:'fixed-sha\trefs/heads/release/0.1.50\n'}
      if(command.includes('docker builder prune')){pruned=true;return{exitCode:0,output:'3000000\n'}}
      if(command.includes("df -Pk"))return{exitCode:0,output:'1000000\n'}
      return{exitCode:0,output:'ok'}
    }}
    db.createProjectRelease('owner',projectId,{branch:'release/0.1.50',version:'0.1.50',sha:'fixed-sha',status:'ready'})
    const manager=new ReleaseManager(db,runtime)
    const attempt=await manager.start('owner',ci(),prod(),'release/0.1.50')
    await tick();await tick()
    expect(pruned).toBe(true)
    expect(commands.some(command=>command.includes('npm run deploy:prod'))).toBe(false)
    const release=db.getProjectRelease('owner',projectId,attempt.id)
    expect(release?.status).toBe('failed')
    expect(release?.steps.find(step=>step.kind==='building')?.log).toMatch(/свободно 2\.9 ГБ, нужно не меньше 5\.0 ГБ/)
  })

  it('refreshes the installed production launcher from the verified release checkout',async()=>{
    const commands:string[]=[]
    const runtime:ReleaseRuntime={isOnline:()=>true,prepareKnowledgeBase:async()=>{},exec:async(_target,command)=>{commands.push(command);return command.includes('ls-remote')?{exitCode:0,output:'fixed-sha\trefs/heads/release/0.1.44\n'}:command.includes('health:prod')?{exitCode:0,output:'{"ok":true,"version":"0.1.44","commit":"fixed-sha"}'}:{exitCode:0,output:'ok'}}}
    db.createProjectRelease('owner',projectId,{branch:'release/0.1.44',version:'0.1.44',sha:'fixed-sha',status:'ready'})
    const target={...prod(),deployCommand:'git branch --set-upstream-to=origin/$(git branch --show-current) && /usr/local/bin/voicechat-deploy'}
    await new ReleaseManager(db,runtime).start('owner',ci(),target,'release/0.1.44')
    await tick();await tick()
    expect(commands).toContain("cd '/prod' && export VC_RELEASE_VERSION='0.1.44' VC_RELEASE_VERSION_SOURCE='release-manager' && echo 'Ожидаемые production metadata: version=0.1.44 commit=fixed-sha source=release-manager' && install -m 755 scripts/prod/deploy.sh /usr/local/bin/voicechat-deploy && git branch --set-upstream-to=origin/$(git branch --show-current) && /usr/local/bin/voicechat-deploy")
  })

  it('does not release when health reports the expected commit with another version',async()=>{
    const limits={checkoutMs:1_000,knowledgeBaseMs:1_000,regressionMs:1_000,switchingMs:1_000,buildingMs:1_000,healthCheckMs:1_000}
    const runtime:ReleaseRuntime={isOnline:()=>true,prepareKnowledgeBase:async()=>{},exec:async(target,command)=>target.agentId==='ci'?{exitCode:0,output:'fixed-sha\trefs/heads/release/0.1.35\n'}:command.includes('health:prod')?{exitCode:0,output:'{"ok":true,"version":"0.1.0","commit":"fixed-sha"}'}:{exitCode:0,output:'ok'}}
    db.createProjectRelease('owner',projectId,{branch:'release/0.1.35',version:'0.1.35',sha:'fixed-sha',status:'ready'})
    const attempt=await new ReleaseManager(db,runtime).start('owner',ci(),{...prod(),limits},'release/0.1.35')
    await new Promise(resolve=>setTimeout(resolve,1_050))
    const stored=db.getProjectRelease('owner',projectId,attempt.id)
    expect(stored?.status).toBe('failed')
    expect(stored?.steps.find(step=>step.kind==='health_check')?.log).toContain('version=0.1.0')
  })

  it('resumes an active health check after server restart and verifies the expected commit and version',async()=>{
    const release=db.createProjectRelease('owner',projectId,{branch:'release/1.0.0',version:'1.0.0',sha:'fixed-sha',status:'health_check'})
    db.setProjectReleaseStep(release.id,'health_check','running','waiting','owner')
    const runtime:ReleaseRuntime={isOnline:()=>true,prepareKnowledgeBase:async()=>{},exec:async()=>({exitCode:0,output:'{"ok":true,"version":"1.0.0","commit":"fixed-sha"}'})}
    const manager=new ReleaseManager(db,runtime)
    manager.reconcile(()=>prod())
    await tick();await tick()
    expect(db.getProjectRelease('owner',projectId,release.id)?.status).toBe('released')
  })

  it('blocks mismatched prepared version before changing production',async()=>{
    const commands:string[]=[]
    const runtime:ReleaseRuntime={isOnline:()=>true,prepareKnowledgeBase:async()=>{},exec:async(_target,command)=>{commands.push(command);return {exitCode:0,output:'fixed-sha\trefs/heads/release/0.1.35\n'}}}
    db.createProjectRelease('owner',projectId,{branch:'release/0.1.35',version:'0.1.0',sha:'fixed-sha',status:'ready'})
    await expect(new ReleaseManager(db,runtime).start('owner',ci(),prod(),'release/0.1.35')).rejects.toThrow('Версия подготовки 0.1.0 не соответствует ветке release/0.1.35 (0.1.35)')
    expect(commands).toEqual([])
    const list=db.listProjectReleaseSummaries('owner',projectId)
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual(expect.objectContaining({id:expect.any(String),branch:'release/0.1.35',sha:'fixed-sha',status:'ready',previousReleaseId:null,durationMs:null}))
    expect(list[0]).not.toHaveProperty('steps')
    expect(list[0]).not.toHaveProperty('triggeredBy')
  })

  it('blocks changed SHA, offline production and concurrent deploy',async()=>{
    const runtime:ReleaseRuntime={isOnline:()=>false,prepareKnowledgeBase:async()=>{},exec:async()=>({exitCode:0,output:'moved-sha\trefs/heads/release/1.0.0\n'})}
    db.createProjectRelease('owner',projectId,{branch:'release/1.0.0',version:'1.0.0',sha:'fixed-sha',status:'ready'})
    await expect(new ReleaseManager(db,runtime).start('owner',ci(),prod(),'release/1.0.0')).rejects.toThrow('offline')
    runtime.isOnline=()=>true
    await expect(new ReleaseManager(db,runtime).start('owner',ci(),prod(),'release/1.0.0')).rejects.toThrow('SHA')
  })

  it('numbers a retry deploy after a failed attempt without hitting the unique constraint',async()=>{
    const runtime:ReleaseRuntime={isOnline:()=>true,prepareKnowledgeBase:async()=>{},exec:async(target,command)=>{if(target.agentId==='ci')return {exitCode:0,output:'fixed-sha\trefs/heads/release/2.0.0\n'};return command.includes('health:prod')?{exitCode:0,output:'{"ok":true,"version":"2.0.0","commit":"fixed-sha"}'}:{exitCode:1,output:'dirty checkout'}}}
    db.createProjectRelease('owner',projectId,{branch:'release/2.0.0',version:'2.0.0',sha:'fixed-sha',status:'ready'})
    const manager=new ReleaseManager(db,runtime)
    const failed=await manager.start('owner',ci(),prod(),'release/2.0.0')
    await tick();await tick()
    expect(db.getProjectRelease('owner',projectId,failed.id)?.status).toBe('failed')
    expect(failed.attempt).toBe(2)
    const retry=await manager.start('owner',ci(),prod(),'release/2.0.0')
    expect(retry.attempt).toBe(3)
  })

  it('fails before build when production checkout validation fails',async()=>{
    const commands:string[]=[]
    const runtime:ReleaseRuntime={isOnline:()=>true,prepareKnowledgeBase:async()=>{},exec:async(target,command)=>{commands.push(command);if(target.agentId==='ci')return {exitCode:0,output:'fixed-sha\trefs/heads/release/1.0.0\n'};return {exitCode:1,output:'dirty checkout'}}}
    db.createProjectRelease('owner',projectId,{branch:'release/1.0.0',version:'1.0.0',sha:'fixed-sha',status:'ready'})
    const attempt=await new ReleaseManager(db,runtime).start('owner',ci(),prod(),'release/1.0.0')
    await tick();await tick()
    expect(db.getProjectRelease('owner',projectId,attempt.id)?.status).toBe('failed')
    expect(commands.some(command=>command.includes('npm run deploy:prod'))).toBe(false)
  })
})
