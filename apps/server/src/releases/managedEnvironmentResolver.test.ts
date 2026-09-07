import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
const deps=(online=true,exitCode=0,machineValue=machine)=>{
  const db={projects:{getProject:()=>project},machines:{getProjectMachine:()=>machineValue}} as unknown as VoiceChatDb
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

  it('requireOnline:false резолвит target при offline-машине (reconcile после рестарта)',()=>{
    const {db,releases}=deps(false)
    const resolver=new ManagedEnvironmentResolver(db,releases)
    // По умолчанию бросает offline, а с requireOnline:false — отдаёт target из БД.
    expect(()=>resolver.resolve('owner','p1','production')).toThrow(/offline/)
    const {target}=resolver.resolve('owner','p1','production',{requireOnline:false})
    expect(target.mode).toBe('managed')
    expect(target.deployCommand).toBeTruthy()
  })

  it('returns a structured mandatory checklist',async()=>{
    const {db,releases}=deps()
    const result=await new ManagedEnvironmentResolver(db,releases).preflight('owner','p1')
    expect(result.ok).toBe(true)
    expect(Object.keys(result.checks)).toEqual(['marker','manifest','origin','branch','write','freeSpace','deployCommand','healthCheckCommand'])
    expect(releases.runPreflight).toHaveBeenCalledOnce()
    const command=vi.mocked(releases.runPreflight).mock.calls[0]![1]
    expect(command).toContain("find '/data/ChatAI/projects/p1/environments/production/temporary/repository' -mindepth 1 -maxdepth 1 -print -quit")
  })

  it('executes the generated POSIX preflight without treating quotes as filename characters',async()=>{
    const root=mkdtempSync(join(tmpdir(),'voicechat-managed-preflight-'))
    try{
      mkdirSync(join(root,'.voicechat'),{recursive:true})
      writeFileSync(join(root,'.voicechat','storage.json'),JSON.stringify({id:'s1'}))
      const environmentRoot=join(root,'projects','p1','environments','production')
      const machineValue={...machine,storageRoot:root,directories:{
        ...machine.directories,
        production:{path:environmentRoot,override:false}
      }}
      const {db,releases}=deps(true,0,machineValue)
      vi.mocked(releases.runPreflight).mockImplementation(async(_target,command)=>{
        const executed=spawnSync('/bin/sh',['-c',command],{encoding:'utf8'})
        return {exitCode:executed.status??1,output:`${executed.stdout}${executed.stderr}`}
      })
      const result=await new ManagedEnvironmentResolver(db,releases,()=>[root],1).preflight('owner','p1')
      expect(result.ok).toBe(true)
      expect(readdirSync(root).some(name=>name.startsWith('.voicechat-managed-probe-'))).toBe(false)

      mkdirSync(environmentRoot,{recursive:true})
      writeFileSync(join(environmentRoot,'environment.json'),'{}\\n')
      const rejected=await new ManagedEnvironmentResolver(db,releases,()=>[root],1).preflight('owner','p1')
      expect(rejected.ok).toBe(false)
      expect(rejected.checks.manifest.message).not.toContain('cannot create')
    }finally{
      rmSync(root,{recursive:true,force:true})
    }
  })
})
