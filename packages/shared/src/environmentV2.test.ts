import { describe, expect, it } from 'vitest'
import { ACTIVE_ENVIRONMENT_OPERATION_STATUSES, ENVIRONMENT_SETTINGS, RESERVED_ENVIRONMENT_SETTINGS, environmentComposeProject, environmentDataVolume, managedStandPaths, parseCoreSelection, parseEnvironmentSettingsPatch } from './environment.js'
import { parseEnvironmentManifest } from './manifests.js'

describe('Core selections', () => {
  it.each([undefined, null])('accepts absence %s', value => expect(parseCoreSelection(value)).toBeNull())
  it('copies a canonical identity without normalization', () => {
    const value = { version: '0.1.15', commit: 'AB'.repeat(20) }
    expect(parseCoreSelection(value)).toEqual(value)
    expect(parseCoreSelection(value)).not.toBe(value)
  })
  it.each([false, 1, 'release', [], {}, { version: '1.2.3' }, { version: '1.2.3', commit: 'a'.repeat(40), extra: true }])('rejects malformed shape %j', value => expect(() => parseCoreSelection(value)).toThrow())
  it.each(['v1.2.3', '01.2.3', '1.2', '1.2.3-beta', '1.2.3\n', '', null, 123])('rejects version %j', version => expect(() => parseCoreSelection({ version, commit: 'a'.repeat(40) })).toThrow('Invalid version'))
  it.each(['a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), 'a'.repeat(40) + '\n', null, 123])('rejects commit %j', commit => expect(() => parseCoreSelection({ version: '1.2.3', commit })).toThrow('Invalid commit'))
})

describe('environment settings', () => {
  it('accepts the entire catalog, deletions and literal shell characters', () => {
    const input = ENVIRONMENT_SETTINGS.map(({ key }) => ({ key, value: 'literal-$`\\value' }))
    expect(parseEnvironmentSettingsPatch(input)).toEqual(input)
    expect(parseEnvironmentSettingsPatch(input)[0]).not.toBe(input[0])
    expect(parseEnvironmentSettingsPatch(input.map(item => ({ ...item, value: null })))).toHaveLength(20)
    expect(parseEnvironmentSettingsPatch([{ key: 'VC_PUBLIC_URL', value: 'x'.repeat(4096) }])[0].value).toHaveLength(4096)
    expect(parseEnvironmentSettingsPatch([{ key: 'VC_ADMIN_PASSWORD', value: 'x'.repeat(12) }])).toHaveLength(1)
  })
  it.each([null, {}, '[]', [], Array(51)])('rejects bounds/shape %j', value => expect(() => parseEnvironmentSettingsPatch(value)).toThrow('Expected 1..50 environment settings'))
  it.each([null, [], false, 1, 'setting', undefined])('rejects item %j', value => expect(() => parseEnvironmentSettingsPatch([value])).toThrow('Invalid environment setting'))
  it.each([{}, { key: 'VC_PUBLIC_URL' }, { key: 'VC_PUBLIC_URL', value: 'x', extra: true }])('rejects fields %j', value => expect(() => parseEnvironmentSettingsPatch([value])).toThrow('Unexpected environment setting fields'))
  it.each([1, null, 'A', 'lower', 'VC_PUBLIC_URL\n', 'A'.repeat(65)])('rejects key %j', key => expect(() => parseEnvironmentSettingsPatch([{ key, value: null }])).toThrow('Invalid environment setting key'))
  it('rejects unknown and duplicate keys and sparse arrays', () => {
    expect(() => parseEnvironmentSettingsPatch([{ key: 'UNKNOWN', value: null }])).toThrow('Unknown environment setting: UNKNOWN')
    expect(() => parseEnvironmentSettingsPatch(Array(1))).toThrow('Invalid environment setting')
    expect(() => parseEnvironmentSettingsPatch([{ key: 'VC_PUBLIC_URL', value: null }, { key: 'VC_PUBLIC_URL', value: 'x' }])).toThrow('Duplicate environment setting: VC_PUBLIC_URL')
  })
  it.each(RESERVED_ENVIRONMENT_SETTINGS)('rejects reserved %s', key => expect(() => parseEnvironmentSettingsPatch([{ key, value: null }])).toThrow(`Reserved environment setting: ${key}`))
  it.each(['', 'x'.repeat(4097), "a'b", 'a\rb', 'a\nb', 'a\0b', undefined, 123, {}, []])('rejects unsafe value %j', value => expect(() => parseEnvironmentSettingsPatch([{ key: 'VC_PUBLIC_URL', value }])).toThrow('Invalid value for VC_PUBLIC_URL'))
  it('rejects short administrator passwords', () => expect(() => parseEnvironmentSettingsPatch([{ key: 'VC_ADMIN_PASSWORD', value: 'x'.repeat(11) }])).toThrow('Invalid value for VC_ADMIN_PASSWORD'))
  it('keeps catalog flags and reserved keys disjoint', () => {
    expect(new Set(ENVIRONMENT_SETTINGS.map(item => item.key)).size).toBe(20)
    expect(ENVIRONMENT_SETTINGS.filter(item => item.required).map(item => item.key)).toEqual(['VC_ADMIN_PASSWORD'])
    expect(ENVIRONMENT_SETTINGS.filter(item => item.generated)).toHaveLength(8)
    expect(ENVIRONMENT_SETTINGS.filter(item => item.secret)).toHaveLength(12)
    expect(ENVIRONMENT_SETTINGS.every(item => !RESERVED_ENVIRONMENT_SETTINGS.includes(item.key))).toBe(true)
    expect(RESERVED_ENVIRONMENT_SETTINGS).toHaveLength(14)
  })
})

describe('managed stands', () => {
  it.each(['linux', 'darwin'])('builds the complete %s layout', platform => {
    const root = '/storage/projects/project-1/environments/stands/dev-1'
    expect(managedStandPaths('/storage/', 'project-1', 'dev-1', platform)).toEqual({ root, app: `${root}/app`, config: `${root}/config`, logs: `${root}/logs`, artifacts: `${root}/artifacts`, temporary: `${root}/temporary`, repository: `${root}/temporary/repository`, manifest: `${root}/environment.json`, envFile: `${root}/config/stand.env`, overrides: `${root}/config/overrides` })
  })
  it('rejects Windows and production', () => {
    expect(() => managedStandPaths('C:\\storage', 'p1', 'dev', 'win32')).toThrow('Stands are not supported on Windows')
    expect(() => managedStandPaths('/storage', 'p1', 'production', 'linux')).toThrow('Production is not a managed stand')
  })
  it.each(['../other', '/absolute', 'nested/project', 'nested\\project', '', '..'])('rejects project traversal %s', project => expect(() => managedStandPaths('/storage', project, 'dev', 'linux')).toThrow())
  it.each(['../other', 'Production', 'dev/other', 'dev\n'])('rejects invalid stand %s', id => expect(() => managedStandPaths('/storage', 'p1', id, 'darwin')).toThrow('Invalid environment id'))
  it.each(['relative', '/', '/storage/../other'])('rejects unsafe storage %s', storage => expect(() => managedStandPaths(storage, 'p1', 'dev', 'linux')).toThrow())
  it('uses FNV-1a reference vectors and isolated volume names', () => {
    expect(environmentComposeProject('', 'dev')).toBe('sx-dev-811c9dc5')
    expect(environmentComposeProject('a', 'dev')).toBe('sx-dev-e40c292c')
    expect(environmentComposeProject('foobar', 'dev')).toBe('sx-dev-bf9cf968')
    expect(environmentDataVolume(environmentComposeProject('foobar', 'dev'))).toBe('sx-dev-bf9cf968-server-data')
    expect(ACTIVE_ENVIRONMENT_OPERATION_STATUSES).toEqual(['pending', 'preparing', 'pulling', 'building', 'starting', 'switching', 'health_check', 'removing'])
  })
})

describe('stand manifests', () => {
  const stand = { formatVersion: 1, projectId: 'p1', kind: 'stand', environmentId: 'dev', machineId: 'm1', storageId: 's1', createdAt: '2026-10-03T00:00:00Z' }
  it('accepts stand identity', () => expect(parseEnvironmentManifest(stand)).toEqual(stand))
  it.each([undefined, null, '', ' ', 123])('requires environmentId %j', environmentId => expect(() => parseEnvironmentManifest({ ...stand, environmentId })).toThrow('environmentId must be a non-empty string'))
  it('rejects an omitted environmentId', () => { const { environmentId, ...value } = stand; expect(() => parseEnvironmentManifest(value)).toThrow('environmentId must be a non-empty string') })
  it.each([undefined, null, '', 'task'])('forbids taskId presence %j', taskId => expect(() => parseEnvironmentManifest({ ...stand, taskId })).toThrow('taskId is not allowed for stands'))
  it.each(['production', 'staging', 'test', 'preview'])('forbids environmentId on %s', kind => expect(() => parseEnvironmentManifest({ ...stand, kind })).toThrow('environmentId is only allowed for stands'))
})
