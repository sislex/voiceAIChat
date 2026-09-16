import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_DEVELOPMENT_PREVIEW, DEFAULT_CI_BROWSER_CHECK } from '@voicechat/shared'
import { DevelopmentPreviewManager, DevelopmentPreviewError, previewResourceName, redactPreviewLog, type PreviewRuntimeInput, type DevelopmentPreviewRuntime } from './developmentPreview.js'
import { previewCompose } from './developmentPreviewDocker.js'
const input = (policy:'continue'|'block'='continue'): PreviewRuntimeInput => ({
  projectId:'project',taskId:'task',runId:'run',userId:'user',agentId:'agent',workspace:'/workspace',
  kind:'claude',model:'sonnet',settings:{...DEFAULT_DEVELOPMENT_PREVIEW,enabled:true},
  check:{...DEFAULT_CI_BROWSER_CHECK,mode:'chromium',failurePolicy:policy}
})
const runtime = (): DevelopmentPreviewRuntime => ({
  prepare:vi.fn(async()=>({sha:'sha',configDigest:'digest',url:'http://agent.machine.internal:12345/',healthAttempts:1})),
  stop:vi.fn(async()=>{}),logs:vi.fn(async()=>'')
})
describe('managed development preview',()=>{
  it.each(['continue','block'] as const)('applies %s only after diagnosis while keeping tools available',async(policy)=>{
    const r=runtime(); r.prepare=vi.fn(async()=>{throw new DevelopmentPreviewError('docker_unavailable','Docker is down')})
    const m=new DevelopmentPreviewManager(r); m.register(input(policy))
    await m.invoke('run','start')
    expect(m.status('run')?.diagnostic?.code).toBe('docker_unavailable')
    expect(await m.finalize('run',new AbortController().signal)).toBe(policy==='continue')
    expect(m.status('run')?.browserResult).toBe(policy==='continue'?'warning':'blocked')
    await m.invoke('run','restart')
    await m.invoke('run','restart')
    expect(r.prepare).toHaveBeenCalledTimes(2)
    await m.finish('run')
    expect(m.status('run')?.url).toBeNull()
  })
  it('serializes duplicate starts and picks up fresh source on restart',async()=>{
    const r=runtime(),m=new DevelopmentPreviewManager(r);m.register(input())
    await Promise.all([m.invoke('run','start'),m.invoke('run','start')])
    expect(r.prepare).toHaveBeenCalledTimes(1)
    await m.invoke('run','restart')
    expect(r.prepare).toHaveBeenCalledTimes(2)
    expect(r.stop).toHaveBeenCalled()
  })
  it('does not pass an unopened browser and cleans up expired resources',async()=>{
    let now=100
    const r=runtime(),m=new DevelopmentPreviewManager(r,undefined,()=>now);m.register(input())
    await m.invoke('run','start')
    expect(await m.finalize('run',new AbortController().signal)).toBe(true)
    expect(m.status('run')?.browserResult).toBe('warning')
    now+=DEFAULT_DEVELOPMENT_PREVIEW.ttlMs
    await m.sweep()
    expect(m.status('run')?.state).toBe('expired')
    expect(r.stop).toHaveBeenCalled()
  })
  it('isolates names and rejects unpinned images',()=>{
    const i=input(),name=previewResourceName(i.projectId,i.taskId,i.runId),image='runtime@sha256:'+'a'.repeat(64)
    expect(name).not.toBe(previewResourceName(i.projectId,i.taskId,'other'))
    expect(()=>previewCompose(i,name,'latest',image,'http://runner','scoped','password','node app.js')).toThrow('Pinned')
    const c=previewCompose(i,name,image,image,'http://runner','scoped','password','node app.js') as any
    expect(c.networks.private.internal).toBe(true)
    expect(c.services.build.network_mode).toBe('none')
    expect(c.services.build.environment.SCOPED_TOKEN).toBeUndefined()
    expect(c.services.app.environment.VC_WEB_DIR).toBe('/app/apps/web/dist')
    expect(c.services.app.cap_drop).toEqual(['ALL'])
    expect(c.services.app.network_mode).toBe('service:guard')
    expect(c.services.app.environment.HOME).toBeUndefined()
    expect(c.services.app.environment.VC_DB_URL).toBeUndefined()
    expect(c.services.gateway.ports[0]).toMatchObject({host_ip:'127.0.0.1',published:'0'})
    expect(JSON.stringify(c)).not.toContain('/var/run/docker.sock')
  })
  it('cancels an in-flight startup before cleanup and retries failed cleanup',async()=>{
    const r=runtime()
    r.prepare=vi.fn(async(_i,_h,signal)=>new Promise<never>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})))
    const m=new DevelopmentPreviewManager(r);m.register(input())
    const started=m.invoke('run','start')
    await vi.waitFor(()=>expect(r.prepare).toHaveBeenCalled())
    const stopped=m.invoke('run','stop')
    await Promise.all([started,stopped])
    expect(m.status('run')?.state).toBe('stopped')
    expect(r.stop).toHaveBeenCalled()
  })
  it('preserves the old handle and refuses a new grant while cleanup is pending',async()=>{
    const r=runtime(),m=new DevelopmentPreviewManager(r);m.register(input())
    await m.invoke('run','start')
    r.stop=vi.fn(async()=>{throw new Error('machine offline')})
    await m.invoke('run','restart')
    expect(r.prepare).toHaveBeenCalledTimes(1)
    expect(m.status('run')?.diagnostic?.code).toBe('cleanup_failed')
    r.stop=vi.fn(async()=>{})
    await m.invoke('run','restart')
    expect(r.prepare).toHaveBeenCalledTimes(2)
    await m.finish('run')
  })
  it('redacts explicit secrets, bearer tokens and production DSNs',()=>{
    const output=redactPreviewLog('Bearer abc password=hello postgres://u:p@prod/db private-value',['private-value'])
    for(const value of ['abc','hello','u:p@prod','private-value']) expect(output).not.toContain(value)
  })
})
