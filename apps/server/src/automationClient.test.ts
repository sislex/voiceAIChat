import { describe,expect,it,vi } from 'vitest'
import { AUTOMATION_PROTOCOL_VERSION,type AutomationJobRequest } from '@voicechat/shared'
import { AutomationClient,AutomationClientError } from './automationClient.js'
const request:AutomationJobRequest={protocolVersion:AUTOMATION_PROTOCOL_VERSION,idempotencyKey:'key',type:'merge',snapshot:{projectId:'p',taskId:'t',userId:'u',machineId:'m',repository:'r',workspace:'w',sourceBranch:'f',sourceSha:'sha',targetBranch:'main',stages:[],readiness:{},acceptanceCriteria:[],model:{provider:'codex',model:'m'}}}
describe('AutomationClient',()=>{
  it('sends bearer auth and immutable request',async()=>{
    let captured:{url:string;init:RequestInit}|undefined
    const fetchImpl=vi.fn(async(url:URL|RequestInfo,init?:RequestInit)=>{captured={url:String(url),init:init??{}};return new Response(JSON.stringify({id:'job'}),{status:202,headers:{'content-type':'application/json'}})})
    const client=new AutomationClient('http://runner:8800','token',fetchImpl as typeof fetch)
    expect(await client.create(request)).toEqual({id:'job'})
    expect(captured?.url).toBe('http://runner:8800/v1/jobs')
    expect(captured?.init.headers).toMatchObject({authorization:'Bearer token'})
    expect(JSON.parse(String(captured?.init.body))).toEqual(request)
  })
  it('preserves runner status and error code for dispatcher retry policy',async()=>{
    const client=new AutomationClient('http://runner','token',async()=>new Response(JSON.stringify({error:'invalid_job_or_protocol'}),{status:400,headers:{'content-type':'application/json'}}))
    await expect(client.create(request)).rejects.toMatchObject({status:400,code:'invalid_job_or_protocol'} satisfies Partial<AutomationClientError>)
  })
})
