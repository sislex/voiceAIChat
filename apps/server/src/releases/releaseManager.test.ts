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
  it('fixes origin SHA and stops on a failed mandatory gate',async()=>{
    const runtime:ReleaseRuntime={
      exec:async(_target,command)=>command.includes('for-each-ref')?{exitCode:0,output:'origin/release/1.2.3 abcdef1234567890\n'}:{exitCode:1,output:'regression failed'},
      updateKnowledgeBase:async()=>{},deployProduction:async()=>{},healthCheck:async()=>{},cleanup:async()=>{}
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

  it('rejects arbitrary or missing remote branches before creating history',async()=>{
    const runtime:ReleaseRuntime={exec:async()=>({exitCode:0,output:''}),updateKnowledgeBase:async()=>{},deployProduction:async()=>{},healthCheck:async()=>{},cleanup:async()=>{}}
    const manager=new ReleaseManager(db,runtime)
    await expect(manager.start('owner',target(),'main')).rejects.toThrow('release/x.y.z')
    await expect(manager.start('owner',target(),'release/9.9.9')).rejects.toThrow('отсутствует в origin')
    expect(db.listProjectReleases('owner',projectId)).toEqual([])
  })

  it('allows publication only to a project owner',async()=>{
    const runtime:ReleaseRuntime={exec:async()=>({exitCode:0,output:'origin/release/1.0.0 abcdef\n'}),updateKnowledgeBase:async()=>{},deployProduction:async()=>{},healthCheck:async()=>{},cleanup:async()=>{}}
    await expect(new ReleaseManager(db,runtime).start('member',target(),'release/1.0.0')).rejects.toThrow('permission')
  })
})
