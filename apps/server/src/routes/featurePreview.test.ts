import { describe, expect, it } from 'vitest'
import { isLocalPreview, manualPreviewCommand } from './featurePreview.js'

describe('feature preview access helpers', () => {
  it('determines locality only by exact companion agent id', () => {
    expect(isLocalPreview('agent-1', 'agent-1')).toBe(true)
    expect(isLocalPreview('agent-1', 'Agent 1')).toBe(false)
    expect(isLocalPreview('agent-1', null)).toBe(false)
  })

  it('uses exact selected local and service host ports with explicit SSH settings', () => {
    expect(manualPreviewCommand(19000, 18001, 'preview', 'qa.example.test'))
      .toBe('ssh -N -L 19000:127.0.0.1:18001 preview@qa.example.test')
    expect(manualPreviewCommand(19001, 18002, 'preview', '192.0.2.10'))
      .toBe('ssh -N -L 19001:127.0.0.1:18002 preview@192.0.2.10')
  })

  it('does not build a command from missing or unsafe SSH settings', () => {
    expect(manualPreviewCommand(19000, 18001, '', 'internal-agent-id')).toBeNull()
    expect(manualPreviewCommand(19000, 18001, 'preview', '')).toBeNull()
    expect(manualPreviewCommand(19000, 18001, 'preview;token', 'host')).toBeNull()
    expect(manualPreviewCommand(19000, 18001, 'preview', 'host key')).toBeNull()
  })
})
