import { describe, expect, it } from 'vitest'
import { ManifestError, assertManifestEquivalent, parseEnvironmentManifest, parseManifestJson, parseRunManifest, parseRunReportManifest, serializeManifest } from './manifests.js'

const at='2026-08-22T10:20:30.000Z',sha='0123456789abcdef0123456789abcdef01234567'
describe('manifest contracts',()=>{
  it.each(['production','staging'] as const)('validates %s environment allowlist',kind=>{
    const value={formatVersion:1,projectId:'p1',kind,machineId:'m1',storageId:'s1',createdAt:at}
    expect(parseEnvironmentManifest(value)).toEqual(value)
    expect(()=>parseEnvironmentManifest({...value,token:'secret'})).toThrow(/unknown fields: token/)
  })
  it.each(['test','preview'] as const)('requires task identity for %s',kind=>{
    const value={formatVersion:1,projectId:'p1',taskId:'t1',kind,machineId:'m1',storageId:'s1',createdAt:at}
    expect(parseEnvironmentManifest(value).taskId).toBe('t1')
    expect(()=>parseEnvironmentManifest({...value,taskId:undefined})).toThrow()
  })
  it('rejects corrupt and future versions diagnostically',()=>{
    expect(()=>parseManifestJson('{','environment.json',parseEnvironmentManifest)).toThrow(ManifestError)
    try{parseEnvironmentManifest({formatVersion:999},'/x/environment.json')}catch(error){expect(error).toMatchObject({code:'unsupported',path:'/x/environment.json'})}
  })
  it('validates all run types and strips no unknown input',()=>{
    for(const runType of ['development','qa','merge','preview','release'] as const){
      const value={formatVersion:1 as const,runId:'r1',runType,initiator:'u1',machineId:'m1',workspace:'/workspace',branch:'CHAT-1',sourceCommit:sha,createdAt:at,startedAt:at}
      expect(parseRunManifest(value)).toEqual(value)
      expect(serializeManifest(value,parseRunManifest)).not.toContain('secret')
    }
  })
  it.each(['success','failed','cancelled','interrupted'] as const)('validates %s report',status=>{
    const value={formatVersion:1 as const,runId:'r1',status,sourceCommit:sha,finalCommit:status==='success'?sha:null,checks:[],errors:[],artifacts:[],finishedAt:at,...(status==='cancelled'?{cancelledAt:at}:{}),...(status==='interrupted'?{interruptedAt:at}:{})}
    expect(parseRunReportManifest(value)).toEqual(value)
  })
  it('rejects unsafe artifacts and conflicting immutable content',()=>{
    const base={formatVersion:1 as const,runId:'r1',status:'failed' as const,sourceCommit:sha,finalCommit:null,checks:[],errors:[],finishedAt:at}
    expect(()=>parseRunReportManifest({...base,artifacts:[{path:'../token'}]})).toThrow(/inside managed storage/)
    expect(()=>parseRunReportManifest({...base,artifacts:[{path:'/tmp/token'}]})).toThrow(/relative/)
    expect(()=>assertManifestEquivalent({...base,artifacts:[]},{...base,artifacts:[],runId:'r2'},'report.json')).toThrowError(expect.objectContaining({code:'conflict'}))
  })
})
