import { describe, expect, it, vi } from 'vitest'
import type { VoiceChatDb } from '../db/database.js'
import type { ReleaseManager } from './releaseManager.js'
import { ManagedEnvironmentResolver } from './managedEnvironmentResolver.js'

const project = {
  id:'p1', createdAt:1_700_000_000_000, productionAgentId:'a1', productionEnvironmentMode:'managed' as const,
  gitUrl:'git@example/repo.git', productionDeployCommand:'npm run deploy',
  productionHealthCheckCommand:'npm run health', ciBaseBranch:'main'
}
const machine = {
  agentId:'a1', path:'', reposRoot:null, storageId:'s1', storageRoot:'/data/ChatAI',
  storageFormatVersion:1, directories:{
    production:{path:'/data/ChatAI/projects/p1/environments/production',override:false},
    staging:{path:'/data/ChatAI/projects/p1/environments/staging',override:false}
  }
}
const deps=(online=true,exitCode=0)=>{
  const db={getProject:()=>project,getProjectMachine:()=>machine} as unknown as VoiceChatDb
  const releases={isOnline:()=>online,runPreflight:vi.fn(async()=>({exitCode,output:exitCode?'failed':'ok'}))} as unknown as ReleaseManager
  return {db,releases}
}

describe('ManagedEnvironmentResolver',()=>{
  it('resolves physically isolated canonical production and staging repositories',()=>{
    const {db,releases}=deps()
    const resolver=new ManagedEnvironmentResolver(db,releases)
    const production=resolver.resolve('owner','p1','production')
    const staging=resolver.resolve('owner','p1','staging')
    expect(production.target.path).toBe('/data/ChatAI/projects/p1/environments/production/temporary/repository')
    expect(staging.target.path).toBe('/data/ChatAI/projects/p1/environments/staging/temporary/repository')
    expect(production.paths.root).not.toContain(staging.paths.root)
    expect(production.target.managedManifest).toMatchObject({projectId:'p1',kind:'production',machineId:'a1',storageId:'s1'})
  })

  it('rejects an offline machine before running filesystem commands',async()=>{
    const {db,releases}=deps(false)
    const resolver=new ManagedEnvironmentResolver(db,releases)
    await expect(resolver.preflight('owner','p1')).rejects.toThrow(/offline/)
    expect(releases.runPreflight).not.toHaveBeenCalled()
  })

  it('returns a structured mandatory checklist',async()=>{
    const {db,releases}=deps()
    const result=await new ManagedEnvironmentResolver(db,releases).preflight('owner','p1')
    expect(result.ok).toBe(true)
    expect(Object.keys(result.checks)).toEqual(['marker','manifest','origin','branch','write','freeSpace','deployCommand','healthCheckCommand'])
    expect(releases.runPreflight).toHaveBeenCalledOnce()
  })
})
