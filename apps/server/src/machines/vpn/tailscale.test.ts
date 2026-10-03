import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { encryptVpnSecret, decryptVpnSecret, managedPolicy, TailscaleApi } from './tailscale.js'

const fixtureCredential1 = randomBytes(24).toString('hex')
const fixtureCredential2 = randomBytes(24).toString('hex')
const fixtureCredential3 = randomBytes(24).toString('hex')
const fixtureEncryptionKey = randomBytes(32).toString('hex')

describe('Tailscale policy and credentials', () => {
  it('writes device tags through the concrete Tailscale endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
    await new TailscaleApi(fixtureCredential2, 'test.ts.net', fetcher).setDeviceTags(
      { id: 'api/device', nodeId: 'node', authorized: true, addresses: ['100.64.0.1'] }, ['tag:existing', 'tag:chatai-env-test'])
    expect(fetcher.mock.calls[0][0]).toBe('https://api.tailscale.com/api/v2/device/api%2Fdevice/tags')
    expect(fetcher.mock.calls[0][1]?.method).toBe('POST')
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ tags: ['tag:existing', 'tag:chatai-env-test'] })
  })
  // @testCase TC-SECRETS
  it('encrypts with fresh nonces and binds ciphertext to its owner', () => {
    const key = fixtureEncryptionKey, secret = fixtureCredential1
    const encrypted = encryptVpnSecret(secret, key, 'alice')
    expect(encrypted).not.toContain(secret)
    expect(encryptVpnSecret(secret, key, 'alice')).not.toBe(encrypted)
    expect(decryptVpnSecret(encrypted, key, 'alice')).toBe(secret)
    expect(() => decryptVpnSecret(encrypted, key, 'bob')).toThrow('secret_storage')
    expect(() => encryptVpnSecret(secret, undefined, 'alice')).toThrow('secret_storage')
  })
  // @testCase TC-API
  it('preserves unrelated local rules and rejects broad or ambiguous internet permissions', () => {
    const policy = { acls: [{ action: 'accept', src: ['*'], dst: ['tag:database:5432'] }], ssh: [{ action: 'check' }] }
    expect(managedPolicy(policy, {}, [])).toMatchObject(policy)
    for (const dst of ['*:*', 'autogroup:internet:*', '0.0.0.0/0:*', '::/0:*', 'public-host:443']) {
      expect(() => managedPolicy({ acls: [{ dst: [dst] }] }, {}, [])).toThrow('policy')
    }
    expect(() => managedPolicy({ grants: [{ src: ['*'], dst: ['*'], ip: ['*'] }] }, {}, [])).toThrow('policy')
    expect(() => managedPolicy({ acls: [{ action: 'accept', src: ['*'], dst: ['tag:chatai-env-foreign:*'] }] }, {}, [])).toThrow('policy')
  })
  // @testCase TC-API
  // @testCase TC-SECRETS
  it('uses optimistic policy versioning and excludes upstream errors from diagnostics', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(fixtureCredential3, { status: 412 }))
    const api = new TailscaleApi(fixtureCredential3, 'test.ts.net', fetcher)
    await expect(api.setPolicy({ acls: [] }, '"version-123"')).rejects.toThrow('policy')
    const init = fetcher.mock.calls[0][1]!
    expect(init.headers).toMatchObject({ 'If-Match': '"version-123"' })
    expect(init.redirect).toBe('error')
  })
  // @testCase TC-API
  it('preserves existing enabled routes and verifies exit-node approval', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(Response.json({ advertisedRoutes: ['0.0.0.0/0', '::/0'], enabledRoutes: ['10.1.0.0/16'] }))
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(Response.json({ enabledRoutes: ['0.0.0.0/0', '::/0', '10.1.0.0/16'] }))
    await new TailscaleApi(fixtureCredential2, 'test.ts.net', fetcher).prepareExit(
      { id: 'api1', nodeId: 'node1', addresses: ['100.64.0.1'], authorized: true, tags: ['tag:existing'] }, 'tag:chatai-vpn-test')
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ tags: ['tag:existing', 'tag:chatai-vpn-test'] })
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toEqual({ routes: ['10.1.0.0/16', '0.0.0.0/0', '::/0'] })
  })
})
