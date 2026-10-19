import { describe, it, expect } from 'vitest'
import { TrustedCoreRegistry, authenticateCoreRequest, signCoreMcpToken, verifyCoreMcpToken, verifyCoreMcpTokenWithSecret } from './sharedServices.js'

const secrets: Record<string, string> = { 'a-call': 'call-a', 'a-service': 'service-a', 'a-mcp': 'mcp-a', 'b-call': 'call-b', 'b-service': 'service-b', 'b-mcp': 'mcp-b' }
const registry = () => {
  const r = new TrustedCoreRegistry(ref => { const value = secrets[ref]; if (!value) throw new Error('missing'); return value })
  r.add({ coreId: 'core-a', url: 'https://a.example.org', credentialRef: 'a-call', serviceCredentialRef: 'a-service', mcpSecretRef: 'a-mcp' })
  r.add({ coreId: 'core-b', url: 'https://b.example.org', credentialRef: 'b-call', serviceCredentialRef: 'b-service', mcpSecretRef: 'b-mcp' })
  return r
}
const claims = (over: Partial<Parameters<typeof signCoreMcpToken>[1]> = {}) => ({ v: 1 as const, coreId: 'core-a', application: 'make' as const,
  userId: 'alice', conversationId: 'c1', turnId: 't1', expiresAt: Date.now() + 60_000, ...over })

describe('core request authentication', () => {
  it('resolves the calling core only with its own service credential', () => {
    const r = registry()
    expect(authenticateCoreRequest(r, { headers: { authorization: 'Bearer service-a', 'x-sislexa-core-id': 'core-a' } })).toEqual({ coreId: 'core-a' })
    const delegation = 'sxd_' + 'x'.repeat(43)
    expect(authenticateCoreRequest(r, { headers: { authorization: 'Bearer service-b', 'x-sislexa-core-id': 'core-b', 'x-sislexa-delegation': delegation } }))
      .toEqual({ coreId: 'core-b', delegation })
    for (const headers of [
      { authorization: 'Bearer service-b', 'x-sislexa-core-id': 'core-a' },
      { authorization: 'Bearer call-a', 'x-sislexa-core-id': 'core-a' },
      { authorization: 'Bearer service-a', 'x-sislexa-core-id': 'core-c' },
      { authorization: 'Bearer service-a' },
      { authorization: 'Bearer service-a', 'x-sislexa-core-id': 'core-a', 'x-sislexa-delegation': 'forged' },
    ]) expect(() => authenticateCoreRequest(r, { headers })).toThrow('unauthorized')
  })
  it('never exposes the new credential refs', () => {
    const entry = registry().resolve({ coreId: 'core-a' })
    expect(entry).not.toHaveProperty('serviceCredentialRef')
    expect(entry).not.toHaveProperty('mcpSecretRef')
  })
  it('loads service and MCP refs for the single-core default from env only', () => {
    const r = TrustedCoreRegistry.fromEnv({ VC_CORE_URL: 'https://a.example.org', VC_CORE_ID: 'core-a', VC_INTERNAL_TOKEN: 'internal',
      VC_CORE_SERVICE_TOKEN: 'svc', VC_CORE_MCP_SECRET: 'mcp' })
    expect(authenticateCoreRequest(r, { headers: { authorization: 'Bearer svc', 'x-sislexa-core-id': 'core-a' } }).coreId).toBe('core-a')
    expect(verifyCoreMcpToken(r, signCoreMcpToken('mcp', claims())).userId).toBe('alice')
  })
})

describe('core MCP tokens', () => {
  it('verify only for their core, secret and lifetime', () => {
    const r = registry()
    const token = signCoreMcpToken('mcp-a', claims())
    expect(verifyCoreMcpToken(r, token)).toMatchObject({ coreId: 'core-a', userId: 'alice', conversationId: 'c1', application: 'make', turnId: 't1' })
    expect(() => verifyCoreMcpToken(r, signCoreMcpToken('mcp-b', claims()))).toThrow('mcp_token_invalid')
    expect(() => verifyCoreMcpToken(r, signCoreMcpToken('mcp-a', claims({ coreId: 'core-b' })))).toThrow('mcp_token_invalid')
    expect(() => verifyCoreMcpToken(r, signCoreMcpToken('mcp-a', claims({ coreId: 'core-c' })))).toThrow('mcp_token_invalid')
    expect(() => verifyCoreMcpToken(r, signCoreMcpToken('mcp-a', claims({ expiresAt: Date.now() - 1 })))).toThrow('mcp_token_invalid')
    const [prefix, payload, mac] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...claims(), userId: 'mallory' })).toString('base64url')
    expect(() => verifyCoreMcpToken(r, `${prefix}.${forged}.${mac}`)).toThrow('mcp_token_invalid')
    expect(() => verifyCoreMcpToken(r, `${prefix}.${payload}`)).toThrow('mcp_token_invalid')
  })
  it('carry a read-only task scope that cannot be altered', () => {
    const scope = { taskId: 'task-1', projectId: 'p1', mode: 'files' as const, paths: ['a.ts'] }
    const token = signCoreMcpToken('mcp-a', claims({ conversationId: 'design-1', scope }))
    expect(verifyCoreMcpToken(registry(), token).scope).toEqual(scope)
    const [prefix, , mac] = token.split('.')
    const widened = Buffer.from(JSON.stringify({ ...claims({ conversationId: 'design-1' }), scope: { ...scope, mode: 'whole_project', paths: [] } })).toString('base64url')
    expect(() => verifyCoreMcpToken(registry(), `${prefix}.${widened}.${mac}`)).toThrow('mcp_token_invalid')
    const malformed = signCoreMcpToken('mcp-a', claims({ scope: { taskId: '', projectId: 'p1', mode: 'files', paths: [] } }))
    expect(() => verifyCoreMcpToken(registry(), malformed)).toThrow('mcp_token_invalid')
  })
  it('verify with the issuing secret for the core itself', () => {
    const token = signCoreMcpToken('mcp-a', claims())
    expect(verifyCoreMcpTokenWithSecret('mcp-a', token).userId).toBe('alice')
    expect(() => verifyCoreMcpTokenWithSecret('mcp-b', token)).toThrow('mcp_token_invalid')
    expect(() => verifyCoreMcpTokenWithSecret('', token)).toThrow('mcp_token_invalid')
    expect(() => verifyCoreMcpTokenWithSecret('mcp-a', signCoreMcpToken('mcp-a', claims({ expiresAt: Date.now() - 1 })))).toThrow('mcp_token_invalid')
  })
})
