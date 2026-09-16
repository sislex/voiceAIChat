import { describe, expect, it, vi } from 'vitest'
import { buildRunner } from './server.js'
import { PreviewCliGrants } from './previewGrants.js'
import { claudeArgs } from './cli/claudeCli.js'
import { codexInvocation } from './cli/codexCli.js'
const scope = {projectId:'project',taskId:'task',runId:'run',userId:'user',kind:'claude' as const,model:'sonnet',ttlMs:1000,operations:['generate'] as ['generate']}
describe('scoped preview generation', () => {
  // @testCase TC-INT-03
  it('binds identity, model and operation and disables all CLI tools', () => {
    const grants = new PreviewCliGrants(vi.fn())
    const {token} = grants.issue(scope)
    const body = grants.prepare(token,{prompt:'hello'})!
    expect(body).toMatchObject({userId:'user',kind:'claude',model:'sonnet',sessionId:null,textOnly:true})
    expect(claudeArgs(body)).toEqual(expect.arrayContaining(['--tools','','--strict-mcp-config','--no-session-persistence']))
    expect(grants.prepare(token,{prompt:'x',model:'opus'})).toBeNull()
    expect(grants.prepare(token,{prompt:'x',cwd:'/root'})).toBeNull()
    expect(grants.prepare(token,{prompt:'x',sessionId:'production-session'})).toBeNull()
  })
  it('revokes running children on stop and TTL, including after restart', () => {
    let now = 1
    const cancel = vi.fn(), grants = new PreviewCliGrants(cancel,()=>now)
    const first = grants.issue(scope)
    const call = grants.prepare(first.token,{prompt:'hello'})!
    now = 1001; grants.sweep()
    expect(cancel).toHaveBeenCalledWith(call.runId)
    expect(grants.accepts(first.token)).toBe(false)
    const next = grants.issue(scope)
    expect(next.token).not.toBe(first.token)
    grants.revoke(next.id)
    expect(grants.accepts(next.token)).toBe(false)
    expect(new PreviewCliGrants(cancel).accepts(first.token)).toBe(false)
  })
  it('does not grant access to files, health, cancellation or new grants over HTTP', async () => {
    const app=await buildRunner({config:{host:'127.0.0.1',port:0,token:'master',dataDir:'/unused',home:'/unused',claudeBin:'/bin/false',codexBin:'/bin/false',orphanMs:1000}})
    try {
      const issued=await app.inject({method:'POST',url:'/v1/preview-grants',headers:{authorization:'Bearer master'},payload:scope})
      expect(issued.statusCode).toBe(200)
      const headers={authorization:'Bearer '+issued.json().token}
      for(const url of ['/v1/health','/v1/files/read?userId=user&path=auth.json','/v1/auth/status?userId=user']) {
        expect((await app.inject({method:'GET',url,headers})).statusCode).toBe(401)
      }
      expect((await app.inject({method:'POST',url:'/v1/preview-grants',headers,payload:scope})).statusCode).toBe(401)
      expect((await app.inject({method:'POST',url:'/v1/run',headers,payload:{prompt:'x',kind:'claude',model:'sonnet',remote:{mcpUrl:'http://production'}}})).statusCode).toBe(403)
      await app.inject({method:'DELETE',url:'/v1/preview-grants/'+issued.json().id,headers:{authorization:'Bearer master'}})
      expect((await app.inject({method:'POST',url:'/v1/run',headers,payload:{prompt:'x'}})).statusCode).toBe(401)
    } finally {await app.close()}
  })
  it('fails closed for Codex until a tool-free adapter is verified', () => {
    expect(()=>new PreviewCliGrants(vi.fn()).issue({...scope,kind:'codex'})).toThrow('preview_text_only_unavailable')
    expect(()=>codexInvocation({prompt:'x',sessionId:null,model:'',textOnly:true})).toThrow('preview_text_only_unavailable')
  })
})
