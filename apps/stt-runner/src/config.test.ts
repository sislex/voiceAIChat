import { describe, expect, it } from 'vitest'
import { loadSttRunnerConfig } from './config.js'
describe('STT runner config', () => {
  it('uses bounded defaults for an 8 CPU/8 GiB node', () => {
    const c = loadSttRunnerConfig({ HOME: '/tmp/home' })
    expect(c).toMatchObject({ maxConcurrentRuns: 2, maxQueueSize: 4, maxSessionMs: 300000, maxPcmBytes: 9600000, maxPcmBufferBytes: 524288, idleTimeoutMs: 15000, whisperTimeoutMs: 120000, orphanTimeoutMs: 30000, killGraceMs: 5000 })
  })
  it('rejects invalid administrative limits', () => {
    expect(() => loadSttRunnerConfig({ VC_STT_MAX_QUEUE_SIZE: '0' })).toThrow('VC_STT_MAX_QUEUE_SIZE')
    expect(() => loadSttRunnerConfig({ VC_STT_MAX_PCM_BYTES: '1.5' })).toThrow('VC_STT_MAX_PCM_BYTES')
  })
})
