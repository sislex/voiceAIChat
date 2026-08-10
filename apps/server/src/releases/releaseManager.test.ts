import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import { ReleaseManager, type ReleaseProjectTarget, type ReleaseRuntime } from './releaseManager.js'

let db:VoiceChatDb
let projectId:string
const target=():ReleaseProjectTarget=>({projectId,agentId:'mac',path:'/repo',baseBranch:'main'})
beforeEach(()=>{let id=0;db=new VoiceChatDb(':memory:',{newId:()=>`id-${++id}`,now:()=>1000+id});db.createUser('owner','','user');db.createUser('member','','user');const project=db.createProject('owner',{name:'P'});projectId=project.id;db.addMember('owner',projectId,'member')})
afterEach(()=>db.close())
const tick=()=>new Promise(resolve=>setTimeout(resolve,0))

describe('ReleaseManager',()=>{
  it('runs for-each-ref through git after updating release refs',async()=>{
    let command=''
    const runtime:ReleaseRuntime={
      exec:async(_target,value)=>{command=value;return {exitCode:0,output:'origin/release/1.2.3 abcdef1234567890\n'}},
      prepareKnowledgeBase:async()=>{},updateKnowledgeBase:async()=>{},deployProduction:async()=>{},healthCheck:async()=>{},cleanup:async()=>{}
    }
    const branches=await new ReleaseManager(db,runtime).listBranches(target())
    expect(command).toContain('&& git for-each-ref')
    expect(branches).toEqual([{branch:'release/1.2.3',version:'1.2.3',sha:'abcdef1234567890'}])
  })

  it('fixes origin SHA and stops on a failed mandatory gate',async()=>{
    const runtime:ReleaseRuntime={
      exec:async(_target,command)=>command.includes('for-each-ref')?{exitCode:0,output:'origin/release/1.2.3 abcdef1234567890\n'}:{exitCode:1,output:'regression failed'},
      prepareKnowledgeBase:async()=>{},updateKnowledgeBase:async()=>{},deployProduction:async()=>{},healthCheck:async()=>{},cleanup:async()=>{}
    }
    const manager=new ReleaseManager(db,runtime)
    const created=await manager.start('owner',target(),'release/1.2.3')
    expect(created.sha).toBe('abcdef1234567890')
    await tick()
    const failed=db.getProjectRelease('owner',projectId,created.id)!
    expect(failed.status).toBe('failed')
    expect(failed.steps[0]).toMatchObject({kind:'regression',status:'failed',log:'regression failed'})
    expect(failed.steps.slice(1).every(step=>step.status==='queued')).toBe(true)
  })

  it('prefixes every chained branch and merge operation with git',async()=>{
    const commands:string[]=[]
    const runtime:ReleaseRuntime={
      exec:async(_target,command)=>{
        commands.push(command)
        if(command.includes('for-each-ref'))return {exitCode:0,output:'origin/release/1.2.3 abcdef1234567890\n'}
        if(command.includes('rev-parse'))return {exitCode:0,output:'fedcba0987654321\n'}
        return {exitCode:0,output:''}
      },
      prepareKnowledgeBase:async()=>{},updateKnowledgeBase:async()=>{},deployProduction:async()=>{},healthCheck:async()=>{},cleanup:async()=>{}
    }
    const manager=new ReleaseManager(db,runtime)
    await manager.createBranch(target(),'release/2.0.0','main')
    await manager.start('owner',target(),'release/1.2.3')
    await tick()

    const create=commands.find(command=>command.includes("branch 'release/2.0.0'"))!
    expect(create).toContain("&& git branch 'release/2.0.0'")
    expect(create).toContain("&& git push origin 'release/2.0.0'")
    const merge=commands.find(command=>command.includes('checkout -B'))!
    expect(merge).toContain("&& git checkout -B 'main'")
    expect(merge).toContain("&& git merge --no-ff --no-edit 'abcdef1234567890'")
    const push=commands.find(command=>command.includes('push --atomic'))!
    expect(push).toContain("git tag -f 'v1.2.3' 'abcdef1234567890'")
    expect(push).toContain("HEAD:refs/heads/'main'")
    expect(push).toContain("refs/tags/'v1.2.3'")
  })

  it('prepares the knowledge-base index before fixing the release SHA',async()=>{
    const order:string[]=[]
    let prepared=false
    const runtime:ReleaseRuntime={
      prepareKnowledgeBase:async(branch)=>{order.push(`prepare:${branch}`);prepared=true},
      exec:async(_target,command)=>{
        if(command.includes('for-each-ref')){order.push('list');return {exitCode:0,output:`origin/release/1.2.3 ${prepared?'new-sha':'old-sha'}\n`}}
        return {exitCode:0,output:''}
      },
      updateKnowledgeBase:async()=>{},deployProduction:async()=>{},healthCheck:async()=>{},cleanup:async()=>{}
    }
    const created=await new ReleaseManager(db,runtime).start('owner',target(),'release/1.2.3')
    expect(order.slice(0,2)).toEqual(['prepare:release/1.2.3','list'])
    expect(created.sha).toBe('new-sha')
    await tick()
  })

  it('does not create a release attempt when knowledge-base preflight fails',async()=>{
    const runtime:ReleaseRuntime={
      prepareKnowledgeBase:async()=>{throw new Error('неожиданные изменения')},
      exec:async()=>({exitCode:0,output:'origin/release/1.2.3 abcdef\n'}),
      updateKnowledgeBase:async()=>{},deployProduction:async()=>{},healthCheck:async()=>{},cleanup:async()=>{}
    }
    await expect(new ReleaseManager(db,runtime).start('owner',target(),'release/1.2.3')).rejects.toThrow('неожиданные изменения')
    expect(db.listProjectReleases('owner',projectId)).toEqual([])
  })

  it('rejects arbitrary or missing remote branches before creating history',async()=>{
    const runtime:ReleaseRuntime={exec:async()=>({exitCode:0,output:''}),prepareKnowledgeBase:async()=>{},updateKnowledgeBase:async()=>{},deployProduction:async()=>{},healthCheck:async()=>{},cleanup:async()=>{}}
    const manager=new ReleaseManager(db,runtime)
    await expect(manager.start('owner',target(),'main')).rejects.toThrow('release/x.y.z')
    await expect(manager.start('owner',target(),'release/9.9.9')).rejects.toThrow('отсутствует в origin')
    expect(db.listProjectReleases('owner',projectId)).toEqual([])
  })

  it('allows publication only to a project owner',async()=>{
    const runtime:ReleaseRuntime={exec:async()=>({exitCode:0,output:'origin/release/1.0.0 abcdef\n'}),prepareKnowledgeBase:async()=>{},updateKnowledgeBase:async()=>{},deployProduction:async()=>{},healthCheck:async()=>{},cleanup:async()=>{}}
    await expect(new ReleaseManager(db,runtime).start('member',target(),'release/1.0.0')).rejects.toThrow('permission')
  })
})
