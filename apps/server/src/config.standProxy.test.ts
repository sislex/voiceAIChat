import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

describe('stand proxy public scheme configuration', () => {
  it.each([
    [{}, 'http'],
    [{ VC_PUBLIC_URL: 'https://core.test' }, 'https'],
    [{ VC_PUBLIC_URL: 'http://core.test' }, 'http'],
    [{ VC_PUBLIC_URL: 'https://core.test', VC_STAND_PROXY_PUBLIC_SCHEME: '' }, 'https'],
    [{ VC_PUBLIC_URL: 'https://core.test', VC_STAND_PROXY_PUBLIC_SCHEME: 'http' }, 'http'],
    [{ VC_STAND_PROXY_PUBLIC_SCHEME: 'https' }, 'https'],
  ])('resolves %j to %s', (env, scheme) => {
    expect(loadConfig(env).standProxyPublicScheme).toBe(scheme)
  })

  it('rejects unsupported schemes', () => {
    expect(() => loadConfig({ VC_STAND_PROXY_PUBLIC_SCHEME: 'ftp' })).toThrow('Invalid VC_STAND_PROXY_PUBLIC_SCHEME')
  })
})
