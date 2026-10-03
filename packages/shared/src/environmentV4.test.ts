import { describe, expect, it } from 'vitest'
import { parseEnvironmentLanAccess, parseEnvironmentPublicHost, parseModuleSelections, parseModulePlacement, type EnvironmentDefinition, type EnvironmentConfiguration, type EnvironmentLink, type EnvironmentOperationKind, type EnvironmentStage } from './environment'

const module = { repository: 'https://github.com/sislex/make', version: '1.2.3', commit: 'a'.repeat(40) }
const env = { mode: 'managed', machines: ['one', 'two'] } as EnvironmentDefinition
const config = (selection: object) => ({ modules: [selection] }) as EnvironmentConfiguration

describe('replica contracts', () => {
  it.each([1, 10])('accepts and copies %i replicas', count => {
    const machineIds = Array.from({ length: count }, (_, i) => `machine-${i}`)
    const [parsed] = parseModuleSelections([{ ...module, machineIds }])
    expect(parsed.machineIds).toEqual(machineIds)
    expect(parsed.machineIds).not.toBe(machineIds)
  })
  it.each([undefined, null, 'one', [], Array(11).fill('one')])('rejects invalid replica count/type %j', machineIds => {
    expect(() => parseModuleSelections([{ ...module, machineIds }])).toThrow('Expected 1..10 module machine ids')
  })
  it.each([[''], [null], [1], [undefined], new Array(1)].map(machineIds => ({ machineIds })))('rejects invalid replica entries %j', ({ machineIds }) => {
    expect(() => parseModuleSelections([{ ...module, machineIds }])).toThrow('Invalid machine id')
  })
  it('rejects duplicates and both placement fields, even explicitly undefined', () => {
    expect(() => parseModuleSelections([{ ...module, machineIds: ['one', 'one'] }])).toThrow('Duplicate machine id')
    for (const machineId of ['one', undefined]) {
      expect(() => parseModuleSelections([{ ...module, machineId, machineIds: ['one'] }])).toThrow('Specify either machineId or machineIds, not both')
    }
  })
  it('preserves legacy placement and gives it the same membership semantics', () => {
    for (const machineId of ['one', 'missing']) {
      const legacy = parseModuleSelections([{ ...module, machineId }])[0]
      expect(legacy).toEqual({ ...module, machineId })
      expect(parseModulePlacement(config(legacy), env)).toBe(parseModulePlacement(config({ ...module, machineIds: [machineId] }), env))
    }
  })
  it('checks every replica, external environments, and embedded modules', () => {
    const replicas = { ...module, machineIds: ['one', 'two'] }
    expect(parseModulePlacement(config(replicas), env)).toBeNull()
    expect(parseModulePlacement(config({ ...replicas, machineIds: ['one', 'missing'] }), env)).toBe('Placement machine is not in the environment')
    expect(parseModulePlacement(config(replicas), { ...env, mode: 'external' })).toBe('Placement requires a managed environment')
    for (const repository of ['voiceAIChat', 'sdk']) {
      expect(parseModulePlacement(config({ ...replicas, repository: `https://github.com/sislex/${repository}` }), env)).toBe('Embedded modules run with Core')
    }
  })
})

describe('environment network contracts', () => {
  it.each([null, 'stand.example.com', 'a-b.example', `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`])('accepts publicHost %j', host => {
    expect(parseEnvironmentPublicHost(host)).toBe(host)
  })
  it.each([undefined, 1, false, {}])('rejects non-host %j', host => {
    expect(() => parseEnvironmentPublicHost(host)).toThrow('Invalid publicHost: expected a lower-case DNS name or null')
  })
  it.each(['', 'a'.repeat(254)])('rejects host length', host => {
    expect(() => parseEnvironmentPublicHost(host)).toThrow('Invalid publicHost: DNS name must contain 1..253 characters')
  })
  it('rejects uppercase without normalization', () => {
    expect(() => parseEnvironmentPublicHost('Stand.example.com')).toThrow('Invalid publicHost: DNS name must be lower-case')
  })
  it.each(['localhost', '127.0.0.1', '[::1]', 'https://stand.example', 'stand.example:443', 'stand.example/path', '*.example.com', 'stand.example.', '.example.com', 'a..example', '-a.example', 'a-.example', 'a_b.example', ' stand.example', 'stand.example\n', `${'a'.repeat(64)}.example`])('rejects malformed DNS host %j', host => {
    expect(() => parseEnvironmentPublicHost(host)).toThrow('Invalid publicHost: expected a DNS name without scheme, port, path, wildcard, or IP address')
  })
  it.each([true, false])('accepts lanAccess %j', value => expect(parseEnvironmentLanAccess(value)).toBe(value))
  it.each([undefined, null, 0, 1, 'true', {}])('rejects lanAccess %j', value => {
    expect(() => parseEnvironmentLanAccess(value)).toThrow('Invalid lanAccess: expected a boolean')
  })
  it('exposes migration stages and client link addresses', () => {
    const kinds: EnvironmentOperationKind[] = ['migrate', 'cutover']
    const stages: EnvironmentStage[] = ['files', 'freeze']
    const links: Pick<EnvironmentLink, 'transport' | 'address'>[] = [
      { transport: 'vpn', address: '100.64.0.1' }, { transport: 'tunnel', address: '127.0.0.1' }
    ]
    expect(kinds).toHaveLength(2)
    expect(stages).toHaveLength(2)
    expect(links.map(link => link.address)).toEqual(['100.64.0.1', '127.0.0.1'])
  })
})
