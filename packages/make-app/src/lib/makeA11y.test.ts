import { describe, expect, it } from 'vitest'
import { a11yPrompt } from './makeA11y'

describe('makeA11y', () => {
  it('a11yPrompt перечисляет нарушения с impact, id и селектором', () => {
    const text = a11yPrompt([{ id: 'image-alt', impact: 'critical', help: 'Images must have alternate text', helpUrl: 'x', nodes: 2, target: 'img.logo' }])
    expect(text).toContain('[Критическая]')
    expect(text).toContain('(image-alt, 2 элем., напр. img.logo)')
    expect(text).not.toContain('Images must have alternate text')
  })
})
