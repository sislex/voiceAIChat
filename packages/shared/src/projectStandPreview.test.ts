import { describe, expect, it } from 'vitest'
import { parseProjectStandPreview } from './projectStandPreview'

describe('parseProjectStandPreview', () => {
  it('accepts a valid config and rejects unsafe values', () => {
    expect(parseProjectStandPreview({ command: 'npm start', port: 4200, workdir: 'apps/web', readinessPath: '/health' }))
      .toEqual({ command: 'npm start', port: 4200, workdir: 'apps/web', readinessPath: '/health' })
    expect(parseProjectStandPreview({ command: 'npm start', port: 4200, workdir: '.' })).toEqual({ command: 'npm start', port: 4200, workdir: '.' })
    for (const bad of [null, [], { command: '', port: 4200 }, { command: 'a\nb', port: 4200 }, { command: 'x', port: 80 },
      { command: 'x', port: 4200, workdir: '../up' }, { command: 'x', port: 4200, workdir: '.git/hooks' }, { command: 'x', port: 4200, workdir: '/abs' },
      { command: 'x', port: 4200, readinessPath: 'health' }, { command: 'x', port: 4200, extra: 1 }, { command: 'x'.repeat(2001), port: 4200 }])
      expect(parseProjectStandPreview(bad)).toBeNull()
    expect(parseProjectStandPreview({ command: 'x', port: 28810 }, [28810])).toBeNull()
  })
})
