import { describe, expect, it } from 'vitest'
import { parseComponentConfig, parseComponentContract } from './componentConfig'
const dependency = { applicationId: 'core', minVersion: '0.1.0', maxVersionExclusive: '1.0.0', minApiVersion: '1.0.0', maxApiVersionExclusive: '2.0.0', scopes: ['identity.verify'] }
const contract = { schemaVersion: 1, applicationId: 'make', provides: ['make.service'], legacyScopes: [], dependencies: [dependency] }
const config = { schemaVersion: 1, environmentId: 'development', registryDirectory: '/private/provider', grants: [{ consumerId: 'core', scopes: ['make.service'], maxTtlSeconds: 3600 }], legacyScopes: [], dependencies: [{ applicationId: 'core', url: 'http://localhost:8799', tokenFile: '/private/core.token' }] }
describe('release-owned component configuration', () => {
  it('normalizes endpoints and defensively copies input', () => {
    const parsed = parseComponentContract(contract), result = parseComponentConfig(config, parsed)
    expect(parsed.dependencies[0].optional).toBe(false)
    expect(result.dependencies[0].url).toBe('http://localhost:8799')
    result.grants[0].scopes.push('make.other')
    expect(config.grants[0].scopes).toEqual(['make.service'])
  })
  it.each([
    { ...contract, version: 'fake' }, { ...contract, schemaVersion: 2 },
    { ...contract, provides: ['*'] }, { ...contract, provides: ['make.service', 'make.service'] },
    { ...contract, legacyScopes: ['other.scope'] }, { ...contract, dependencies: [dependency, dependency] },
    ...[{ minVersion: '01.0.0' }, { maxVersionExclusive: '0.1.0' }, { minApiVersion: '2.0.0' }, { optional: 'true' }, { applicationId: 'make' }].map(change => ({ ...contract, dependencies: [{ ...dependency, ...change }] }))
  ])('rejects malformed release contracts %#', value => expect(() => parseComponentContract(value)).toThrow())
  it.each([
    { ...config, dependencies: [] }, { ...config, registryDirectory: undefined }, { ...config, version: '0.0.0' },
    { ...config, legacyScopes: ['make.service'] }, { ...config, grants: [...config.grants, ...config.grants] },
    ...[{ scopes: ['make.admin'] }, { maxTtlSeconds: 0 }, { maxTtlSeconds: 1e9 }, { consumerId: 'make' }].map(change => ({ ...config, grants: [{ ...config.grants[0], ...change }] })),
    ...['https://user:pass@example.com', 'http://example.com/path', 'http://example.com/?token=x', 'file:///tmp/config', 'http://example.com/#x'].map(url => ({ ...config, dependencies: [{ ...config.dependencies[0], url }] })),
    { ...config, dependencies: [{ ...config.dependencies[0], minVersion: '0.0.0' }] },
    { ...config, dependencies: [{ ...config.dependencies[0], applicationId: 'unknown' }] },
    { ...config, dependencies: [{ ...config.dependencies[0], tokenFile: 'relative' }] }
  ])('rejects installation attempts to bypass release policy %#', value => expect(() => parseComponentConfig(value, parseComponentContract(contract))).toThrow())
  it('allows an explicitly optional dependency to be absent', () => {
    expect(parseComponentConfig({ ...config, dependencies: [] }, parseComponentContract({ ...contract, dependencies: [{ ...dependency, optional: true }] })).dependencies).toEqual([])
  })
})
