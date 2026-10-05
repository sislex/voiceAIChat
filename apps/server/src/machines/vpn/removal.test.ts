import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { VpnService, type VpnRepository } from './service.js'
import { encryptVpnSecret, environmentTag, TailscaleApi, vpnTag, type TailDevice, type TailPolicy } from './tailscale.js'

const environment = { projectId: 'project', environmentId: 'u04-check' }
const tag = environmentTag(environment)

function fixture() {
  const secret = randomBytes(24).toString('hex'), key = randomBytes(32).toString('hex')
  const devices: TailDevice[] = ['MacBook', 'M1', 's1'].map((name, i) => ({
    id: name, nodeId: 'node-' + name, name, authorized: true, addresses: ['100.64.0.' + (i + 1)], tags: [tag]
  }))
  const grant = { src: [tag], dst: [tag], ip: ['tcp:443'] }
  let policy: TailPolicy = { tagOwners: Object.fromEntries([tag, ...devices.map(d => vpnTag(d.id))].map(t => [t, ['autogroup:admin']])), grants: [grant] }
  let row = { tailnet: 'test.ts.net', encryptedSecret: encryptVpnSecret(secret, key, 'owner'), generation: 0, state: JSON.stringify({
    verifiedAt: 1, states: {}, bindings: Object.fromEntries(devices.map(d => [d.id, { apiId: d.id, deviceId: d.nodeId, addresses: d.addresses, approved: false }])),
    grants: [grant], environments: { [tag]: { environment, tag, machines: devices.map(d => d.id).sort(), ports: [443], phase: 'applied', appliedAt: 1 } }
  }) }
  const repo: VpnRepository = {
    agentOwnerId: async () => 'owner', listAgents: async () => [], readVpnNetwork: async () => structuredClone(row),
    saveVpnNetwork: async (_, next, expected) => { expect(expected).toBe(row.generation); row = structuredClone(next); return true }
  }
  const writes: string[] = []
  let reject = ''
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname
    if (init?.method === 'GET') return path.endsWith('/acl') ? Response.json(policy, { headers: { etag: '"1"' } }) : Response.json({ devices })
    const body = JSON.parse(String(init?.body))
    if (path.endsWith('/acl')) {
      writes.push('policy')
      if (reject === 'policy') return Response.json({ message: 'policy changed concurrently' }, { status: 412 })
      if (devices.some(d => d.tags?.some(t => !body.tagOwners?.[t]))) return Response.json({ message: 'tag is still on device' }, { status: 400 })
      policy = body
    } else {
      const device = devices.find(d => path.includes('/' + d.id + '/'))!
      writes.push(device.id)
      if (reject === device.id) return Response.json({ message: 'rejected ' + secret + '\n' + Buffer.from(secret + ':').toString('base64') }, { status: 403 })
      if (!body.tags.length || body.tags.some((t: string) => !policy.tagOwners?.[t])) return Response.json({ message: 'invalid tags' }, { status: 400 })
      device.tags = body.tags
    }
    return Response.json({})
  }
  const service = new VpnService(repo, { isOnline: () => true, vpn: async () => { throw Error('unused') } }, () => key,
    () => new TailscaleApi(secret, 'test.ts.net', fetcher))
  return { service, devices, writes, secret, policy: () => policy, reject: (id: string) => { reject = id } }
}

describe('environment removal through the concrete Tailscale API', () => {
  it('detaches all devices before removing policy, retains base tags and repeats without writes', async () => {
    const s = fixture()
    await s.service.removeEnvironmentGrant('owner', environment)
    expect(s.writes).toEqual(['MacBook', 'M1', 's1', 'policy'])
    expect(s.policy().tagOwners).not.toHaveProperty(tag)
    expect(s.policy().grants).toEqual([])
    expect(s.devices.map(d => d.tags)).toEqual(s.devices.map(d => [vpnTag(d.id)]))
    await s.service.removeEnvironmentGrant('owner', environment)
    expect(s.writes).toHaveLength(4)
    expect(await s.service.environmentGrantState('owner', environment)).toMatchObject({ phase: 'removed', remainingDevices: [] })
    s.writes.length = 0
    await s.service.ensureEnvironmentGrant('owner', environment, ['M1'], [443])
    expect(s.writes).toEqual(['policy', 'M1'])
  })

  it('keeps removing with a named reauthentication error when no base tag exists', async () => {
    const s = fixture()
    delete s.policy().tagOwners![vpnTag('MacBook')]
    await expect(s.service.removeEnvironmentGrant('owner', environment)).rejects.toMatchObject({ code: 'vpn_untag_requires_reauth', message: 'vpn_untag_requires_reauth: MacBook' })
    expect(s.writes).toEqual([])
    expect(await s.service.environmentGrantState('owner', environment)).toMatchObject({ phase: 'removing', remainingDevices: s.devices.map(d => ({ id: d.id, name: d.name })) })
    s.policy().tagOwners![vpnTag('MacBook')] = ['autogroup:admin']
    await expect(s.service.removeEnvironmentGrant('owner', environment)).resolves.toMatchObject({ phase: 'removed' })
  })

  it('logs sanitized API rejection, reports remaining devices and resumes a partial removal', async () => {
    const s = fixture()
    s.reject('M1')
    await expect(s.service.removeEnvironmentGrant('owner', environment)).rejects.toMatchObject({ code: 'network' })
    const state = await s.service.environmentGrantState('owner', environment)
    expect(state).toMatchObject({ phase: 'removing', remainingDevices: [{ id: 'M1', name: 'M1' }, { id: 's1', name: 's1' }], operationLog: [{ code: 'network', message: 'network: rejected [redacted] [redacted]' }] })
    expect(JSON.stringify(state)).not.toContain(s.secret)
    expect(s.policy().grants).toHaveLength(1)
    s.reject('')
    s.writes.length = 0
    await s.service.removeEnvironmentGrant('owner', environment)
    expect(s.writes).toEqual(['M1', 's1', 'policy'])
  })

  it('retries policy rejection after all tags have been removed', async () => {
    const s = fixture()
    s.reject('policy')
    await expect(s.service.removeEnvironmentGrant('owner', environment)).rejects.toMatchObject({ code: 'policy' })
    expect(await s.service.environmentGrantState('owner', environment)).toMatchObject({ phase: 'removing', remainingDevices: [] })
    await expect(s.service.ensureEnvironmentGrant('owner', environment, ['M1'], [443])).rejects.toMatchObject({ code: 'conflict' })
    s.reject('')
    s.writes.length = 0
    await s.service.removeEnvironmentGrant('owner', environment)
    expect(s.writes).toEqual(['policy'])
  })
})

describe('pending environment removal', () => {
  it('does not block VPN changes outside the environment being removed', async () => {
    const s = fixture()
    s.reject('policy')
    await expect(s.service.removeEnvironmentGrant('owner', environment)).rejects.toMatchObject({ code: 'policy' })
    s.reject('')
    const other = { projectId: environment.projectId, environmentId: 'other-env' }
    await expect(s.service.ensureEnvironmentGrant('owner', other, ['M1'], [443])).resolves.toMatchObject({ phase: 'applied' })
  })
})
