import { describe, expect, it } from 'vitest'
import { isForbiddenStandAddress, resolveExternalStand } from './standExternal.js'

const resolver = (address: string) => async () => [{ address, family: address.includes(':') ? 6 : 4 }]

describe('external stand SSRF guard', () => {
  it('refuses loopback, private, link-local, ULA, metadata and non-http URLs', async () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '100.64.0.1', '169.254.169.254', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00:ec2::254', '::ffff:127.0.0.1'])
      expect(isForbiddenStandAddress(address), address).toBe(true)
    await expect(resolveExternalStand('https://stg.example.com/', { lookup: resolver('10.0.0.5'), allowPrivate: false })).rejects.toThrow('stand_url_forbidden')
    await expect(resolveExternalStand('http://127.0.0.1:8080/', { allowPrivate: false })).rejects.toThrow('stand_url_forbidden')
    await expect(resolveExternalStand('http://[::1]/', { allowPrivate: false })).rejects.toThrow('stand_url_forbidden')
    await expect(resolveExternalStand('http://metadata.google.internal/', { lookup: resolver('8.8.8.8'), allowPrivate: false })).rejects.toThrow('stand_url_forbidden')
    await expect(resolveExternalStand('file:///etc/passwd', { allowPrivate: false })).rejects.toThrow('stand_url_forbidden')
    await expect(resolveExternalStand('https://u:p@stg.example.com/', { lookup: resolver('93.184.216.34'), allowPrivate: false })).rejects.toThrow('stand_url_forbidden')
    // One private answer among public ones is enough to refuse (rebinding via multi-answer).
    await expect(resolveExternalStand('https://stg.example.com/', { lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }], allowPrivate: false })).rejects.toThrow('stand_url_forbidden')
  })
  it('allows and pins a public address; private only with the explicit opt-in', async () => {
    expect(await resolveExternalStand('https://stg-02.mrdstaging.com/webapp/?a=1', { lookup: resolver('93.184.216.34'), allowPrivate: false }))
      .toEqual({ kind: 'external', origin: 'https://stg-02.mrdstaging.com', address: '93.184.216.34', family: 4 })
    expect((await resolveExternalStand('http://127.0.0.1:9/', { allowPrivate: true })).address).toBe('127.0.0.1')
  })
})
