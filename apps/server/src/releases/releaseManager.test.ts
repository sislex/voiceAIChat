import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import { RELEASE_TEST_TIMEOUT_MS, ReleaseManager, releaseKnowledgeBaseCommand, releaseSwitchCommand, releaseTestCommands, type ProductionTarget, type ReleaseProjectTarget, type ReleaseRuntime } from './releaseManager.js'

let db:VoiceChatDb
let projectId:string
const ci=():ReleaseProjectTarget=>({projectId,agentId:'ci',path:'/ci',baseBranch:'main',testCommand:'npm run verify:release'})
const prod=():ProductionTarget=>({...ci(),agentId:'prod',path:'/prod',deployCommand:'npm run deploy:prod',healthCheckCommand:'npm run health:prod',expectedRepository:'git@example/repo.git'})
const tick=()=>new Promise(resolve=>setTimeout(resolve,0))
beforeEach(()=>{let id=0;db=new VoiceChatDb(':memory:',{newId:()=>`id-${++id}`,now:()=>1000+id});db.createUser('owner','','user');projectId=db.createProject('owner',{name:'P'}).id})
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
  })

  it('keeps a compound regression stage inside the project checkout',async()=>{
    const commands:string[]=[]
    const target={...ci(),testCommand:'npm run shared & p1=$!; npm run ui & p2=$!; wait $p1; wait $p2'}
    const runtime:ReleaseRuntime={
      isOnline:()=>true,
      prepareKnowledgeBase:async()=>{},
      exec:async(_target,command)=>{
        commands.push(command)
        if(command.includes('for-each-ref'))return {exitCode:0,output:commands.some(x=>x.includes('git branch'))?'origin/release/1.2.3 prepared-sha\n':''}
        if(command.includes('git branch'))return {exitCode:0,output:'prepared-sha\n'}
        return {exitCode:0,output:'ok'}
      }
    }
    const release=await new ReleaseManager(db,runtime).createBranch('owner',target,'release/1.2.3','main')
    await tick();await tick()
    expect(commands).toContain("cd '/ci' && git checkout --detach 'prepared-sha' && (npm run shared & p1=$!; npm run ui & p2=$!; wait $p1; wait $p2)")
    expect(db.getProjectRelease('owner',projectId,release.id)?.status).toBe('ready')
  })

  it('prepares KB and runs regression while creating the branch',async()=>{
    const commands:string[]=[]
    const runtime:ReleaseRuntime={
      isOnline:()=>true,
      prepareKnowledgeBase:vi.fn(async()=>{}),
      exec:async(_target,command)=>{
        commands.push(command)
        if(command.includes('for-each-ref'))return {exitCode:0,output:commands.some(x=>x.includes('git branch'))?'origin/release/1.2.3 prepared-sha\n':''}
        if(command.includes('git branch'))return {exitCode:0,output:'prepared-sha\n'}
        return {exitCode:0,output:'ok'}
      }
    }
    const manager=new ReleaseManager(db,runtime)
    const release=await manager.createBranch('owner',ci(),'release/1.2.3','main')
    await tick();await tick()
    expect(runtime.prepareKnowledgeBase).toHaveBeenCalledWith('release/1.2.3',ci())
    expect(commands.some(command=>command.includes('npm run verify:release'))).toBe(true)
    expect(commands.some(command=>command.includes('affected-check'))).toBe(false)
    expect(db.getProjectRelease('owner',projectId,release.id)?.status).toBe('ready')
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
    const runtime:ReleaseRuntime={isOnline:()=>true,prepareKnowledgeBase:async()=>{},exec:async(_target,command)=>{commands.push(command);return command.includes('for-each-ref')?{exitCode:0,output:'origin/release/0.1.27 fixed-sha\n'}:command.includes('health:prod')?{exitCode:0,output:'{"ok":true,"version":"0.1.27","commit":"fixed-sha"}'}:{exitCode:0,output:'ok'}}}
    const prepared=db.createProjectRelease('owner',projectId,{branch:'release/0.1.27',version:'0.1.27',sha:'fixed-sha',status:'ready'})
    const manager=new ReleaseManager(db,runtime)
    const attempt=await manager.start('owner',ci(),prod(),'release/0.1.27')
    await tick();await tick()
    expect(commands.join('\n')).not.toMatch(/affected-check|merge |tag |push .*main/)
    expect(commands.some(command=>command.includes("checkout -B 'release/0.1.27' 'fixed-sha'"))).toBe(true)
    expect(commands).toContain("cd '/prod' && export VC_RELEASE_VERSION='0.1.27' && npm run deploy:prod")
    expect(db.getProjectRelease('owner',projectId,attempt.id)?.status).toBe('released')
    expect(prepared.status).toBe('ready')
  })

  it('resumes an active health check after server restart and verifies the expected commit',async()=>{
    const release=db.createProjectRelease('owner',projectId,{branch:'release/1.0.0',version:'1.0.0',sha:'fixed-sha',status:'health_check'})
    db.setProjectReleaseStep(release.id,'health_check','running','waiting','owner')
    const runtime:ReleaseRuntime={isOnline:()=>true,prepareKnowledgeBase:async()=>{},exec:async()=>({exitCode:0,output:'{"ok":true,"commit":"fixed-sha"}'})}
    const manager=new ReleaseManager(db,runtime)
    manager.reconcile(()=>prod())
    await tick();await tick()
    expect(db.getProjectRelease('owner',projectId,release.id)?.status).toBe('released')
  })

  it('blocks changed SHA, offline production and concurrent deploy',async()=>{
    const runtime:ReleaseRuntime={isOnline:()=>false,prepareKnowledgeBase:async()=>{},exec:async()=>({exitCode:0,output:'origin/release/1.0.0 moved-sha\n'})}
    db.createProjectRelease('owner',projectId,{branch:'release/1.0.0',version:'1.0.0',sha:'fixed-sha',status:'ready'})
    await expect(new ReleaseManager(db,runtime).start('owner',ci(),prod(),'release/1.0.0')).rejects.toThrow('offline')
    runtime.isOnline=()=>true
    await expect(new ReleaseManager(db,runtime).start('owner',ci(),prod(),'release/1.0.0')).rejects.toThrow('SHA')
  })

  it('fails before build when production checkout validation fails',async()=>{
    const commands:string[]=[]
    const runtime:ReleaseRuntime={isOnline:()=>true,prepareKnowledgeBase:async()=>{},exec:async(target,command)=>{commands.push(command);if(target.agentId==='ci')return {exitCode:0,output:'origin/release/1.0.0 fixed-sha\n'};return {exitCode:1,output:'dirty checkout'}}}
    db.createProjectRelease('owner',projectId,{branch:'release/1.0.0',version:'1.0.0',sha:'fixed-sha',status:'ready'})
    const attempt=await new ReleaseManager(db,runtime).start('owner',ci(),prod(),'release/1.0.0')
    await tick();await tick()
    expect(db.getProjectRelease('owner',projectId,attempt.id)?.status).toBe('failed')
    expect(commands.some(command=>command.includes('npm run deploy:prod'))).toBe(false)
  })
})
