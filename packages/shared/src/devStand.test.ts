import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  DEV_COMPONENT_IDS, DEV_COMPONENT_REGISTRY, DEV_STAND_ERROR_CODES, DEV_STAND_ERROR_STATUS,
  formatDevBuildId, parseDevBuildId, isDevBuildVersion, isDevStandManifest,
  validateDevStandManifest, isCreateDevStandRequest, isStartDevStandComponentRequest,
  type DevStandManifest
} from './devStand'
import { REST } from './protocol'
import {
  DEV_PROCESS_REQUEST_TYPES, DEV_PROCESS_RESPONSE_TYPES,
  type DevProcessRequestMessage, type DevProcessResponseMessage, type ServerToAgent, type AgentToServer
} from './agentProtocol'

const sha = '862e4f2ada90' + 'a'.repeat(28)
function manifest(): DevStandManifest {
  return {
    schemaVersion: 1, standId: 'stand-1', machineId: 'm1', baseEnvironmentId: 'base-1',
    components: Object.fromEntries(DEV_COMPONENT_IDS.map(id => [id, {
      repository: DEV_COMPONENT_REGISTRY[id].repository, sha, source: 'base'
    }])) as DevStandManifest['components']
  }
}
describe('dev build IDs', () => {
  it('round trips a release version and exactly twelve SHA characters', () => {
    expect(formatDevBuildId('1.5.3', sha)).toBe('1.5.3-dev.862e4f2ada90')
    expect(parseDevBuildId(formatDevBuildId('1.5.3', sha))).toEqual({ version: '1.5.3', sha12: sha.slice(0, 12) })
    expect(isDevBuildVersion(formatDevBuildId('0.0.0', sha))).toBe(true)
  })
  it.each(['1.5.3', 'v1.5.3-dev.862e4f2ada90', '01.5.3-dev.862e4f2ada90',
    '1.5.3-dev.862e4f2ada9', '1.5.3-dev.862e4f2ada900', '1.5.3-dev.862E4F2ADA90',
    '1.5.3-dev.862e4f2ada90+meta', '1.5.3-dev.862e4f2ada90\n', '', null])('rejects invalid ID %s', value => {
    expect(parseDevBuildId(value)).toBeNull()
    expect(isDevBuildVersion(value)).toBe(false)
  })
  it('rejects ambiguous versions and short/nonhex commits at formatting', () => {
    for (const version of ['v1.0.0', '1.0', '1.0.0-beta.1', '1.0.0+meta', '01.0.0', '1.0.0\n'])
      expect(() => formatDevBuildId(version, sha)).toThrow('invalid_dev_build_id')
    for (const commit of [sha.slice(0, 12), sha + 'a', 'g'.repeat(40), sha.toUpperCase(), sha + '\n'])
      expect(() => formatDevBuildId('1.0.0', commit)).toThrow('invalid_dev_build_id')
  })
})
describe('strict stand manifests', () => {
  it('accepts base composition and mixed dev overrides without mutating input', () => {
    const value = manifest()
    expect(validateDevStandManifest(value)).toBe(value)
    value.components['core-ui'] = { ...value.components['core-ui'], source: 'dev',
      devBuildId: formatDevBuildId('1.5.3', sha), url: 'http://machine.local:24000/', startedAt: 0 }
    expect(validateDevStandManifest(JSON.parse(JSON.stringify(value)))).toEqual(value)
  })
  it.each([null, [], {}, { ...manifest(), schemaVersion: 2 }, { ...manifest(), extra: true },
    { ...manifest(), standId: '' }, { ...manifest(), machineId: 123 },
    { ...manifest(), baseEnvironmentId: '../base' }, { ...manifest(), components: {} },
    { ...manifest(), components: { ...manifest().components, other: {} } }])('rejects invalid root %#', value => {
    expect(isDevStandManifest(value)).toBe(false)
    expect(() => validateDevStandManifest(value)).toThrow('invalid_dev_stand_manifest')
  })
  it('requires each own component and each required field', () => {
    for (const id of DEV_COMPONENT_IDS) {
      const value = manifest()
      delete (value.components as Partial<DevStandManifest['components']>)[id]
      expect(isDevStandManifest(value)).toBe(false)
    }
    for (const field of ['repository', 'sha', 'source']) {
      const value = manifest()
      delete (value.components.core as unknown as Record<string, unknown>)[field]
      expect(isDevStandManifest(value)).toBe(false)
    }
    expect(isDevStandManifest(Object.create(manifest()))).toBe(false)
  })
  it.each([
    { sha: 'abc123' }, { sha: 'g'.repeat(40) }, { sha: sha.toUpperCase() }, { sha: sha + '\n' },
    { source: 'branch' }, { repository: 'https://token@github.com/sislex/core' },
    { extra: true }, { url: 'file:///etc/passwd' }, { url: 'http://user:secret@host' },
    { url: 'bad url' }, { url: undefined }, { startedAt: -1 }, { startedAt: 1.5 },
    { startedAt: Infinity }, { startedAt: '2026-10-05' },
    { devBuildId: formatDevBuildId('1.0.0', sha) },
    { source: 'dev', devBuildId: '1.0.0-dev.bbbbbbbbbbbb' },
    { source: 'dev', devBuildId: '1.0.0' }
  ])('rejects invalid component %#', patch => {
    const value = manifest()
    Object.assign(value.components.core, patch)
    expect(isDevStandManifest(value)).toBe(false)
  })
})
describe('dev stand REST and agent wire contracts', () => {
  it('validates creation and mutually exclusive exact/branch refs', () => {
    expect(isCreateDevStandRequest({ machineId: 'm1', baseEnvironmentId: 'base' })).toBe(true)
    expect(isCreateDevStandRequest({ machineId: 'm1' })).toBe(false)
    expect(isCreateDevStandRequest({ machineId: 'm1', baseEnvironmentId: 'base', extra: true })).toBe(false)
    const repository = 'sislex/voiceAIChat'
    expect(isStartDevStandComponentRequest({ repository, sha })).toBe(true)
    expect(isStartDevStandComponentRequest({ repository, branch: 'feature/dev-lane' })).toBe(true)
    for (const value of [{ repository }, { repository, sha, branch: 'dev' }, { repository, sha: 'short' },
      { repository, sha, extra: true }, ...['', '../main', 'a..b', 'a.lock', 'a//b', '-main', 'a b', 'a@{b', 'a\\b']
        .map(branch => ({ repository, branch }))]) expect(isStartDevStandComponentRequest(value)).toBe(false)
  })
  it('encodes dynamic REST segments', () => {
    expect(REST.projectDevStands('a/b')).toBe('/api/projects/a%2Fb/dev-stands')
    expect(REST.projectDevStand('p', 'a?#')).toBe('/api/projects/p/dev-stands/a%3F%23')
    expect(REST.projectDevStandComponent('p', 's', 'core-ui')).toBe('/api/projects/p/dev-stands/s/components/core-ui')
  })
  it('pins routing/readiness data and stable error status', () => {
    expect(DEV_COMPONENT_IDS).toEqual(['core', 'core-ui', 'make', 'kanban', 'playwright-reader', 'image-studio'])
    expect(DEV_COMPONENT_REGISTRY.make.routePrefixes).toEqual(['/api/make', '/api/preview/make', '/api/preview/make-shared', '/p/', '/s/'])
    expect(DEV_COMPONENT_REGISTRY.kanban.routePrefixes).toEqual([])
    for (const id of DEV_COMPONENT_IDS) {
      expect(DEV_COMPONENT_REGISTRY[id].defaultPort).toBeGreaterThan(1024)
      expect(DEV_COMPONENT_REGISTRY[id].readinessPath).toBe(id === 'core-ui' ? '/' : '/api/health')
    }
    expect(DEV_STAND_ERROR_CODES).toEqual(Object.keys(DEV_STAND_ERROR_STATUS))
    expect(DEV_STAND_ERROR_STATUS.operation_conflict).toBe(409)
    expect(DEV_STAND_ERROR_STATUS.readiness_timeout).toBe(504)
  })
  it('keeps RPC registries, envelopes and exported agent unions synchronized', () => {
    expect(DEV_PROCESS_REQUEST_TYPES).toEqual(['devProcess.start', 'devProcess.stop', 'devProcess.status', 'devProcess.logs'])
    expect(DEV_PROCESS_RESPONSE_TYPES).toEqual([...DEV_PROCESS_REQUEST_TYPES.map(t => t + '.result'), 'devProcess.error'])
    expectTypeOf<DevProcessRequestMessage>().toMatchTypeOf<ServerToAgent>()
    expectTypeOf<DevProcessResponseMessage>().toMatchTypeOf<AgentToServer>()
    const start = { t: 'devProcess.start', requestId: 'r1', standId: 's', component: 'core',
      repository: 'sislex/voiceAIChat', sha, command: ['npm', 'run', 'dev:component'], env: {}, port: 24000
    } satisfies DevProcessRequestMessage
    expect(start.sha).toHaveLength(40)
    expectTypeOf<Extract<DevProcessRequestMessage, { t: 'devProcess.start' }>['command']>()
      .toEqualTypeOf<[string, ...string[]]>()
  })
})
