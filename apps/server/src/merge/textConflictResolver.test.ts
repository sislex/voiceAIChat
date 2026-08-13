import { describe, expect, it } from 'vitest'
import { mergeIndependentText } from './textConflictResolver.js'

describe('mergeIndependentText', () => {
  it('reproduces CHAT-184 same-EOF-anchor CSS conflict', () => {
    const base = '.automation-progress { color: gray; }\n'
    const ours = base + '.turn-queue { display: grid; }\n.turn-queue__item { gap: 8px; }\n'
    const theirs = base + '.personalization-page { max-width: 60rem; }\n.personalization-page__title { font-weight: 700; }\n'
    const result = mergeIndependentText(base, ours, theirs)
    expect(result).toMatchObject({ ok: true, classification: 'same-anchor-independent-insert', rule: 'same-anchor-ours-then-theirs' })
    if (result.ok) expect(result.content).toBe(base + ours.slice(base.length) + theirs.slice(base.length))
  })

  it('merges different same-anchor inserts before a base line in ours-theirs order', () => {
    const result = mergeIndependentText('first\nanchor\nlast\n', 'first\nours\nanchor\nlast\n', 'first\ntheirs\nanchor\nlast\n')
    expect(result.ok && result.content).toBe('first\nours\ntheirs\nanchor\nlast\n')
  })

  it('deduplicates identical inserts', () => {
    const result = mergeIndependentText('a\nb\n', 'a\nx\nb\n', 'a\nx\nb\n')
    expect(result).toMatchObject({ ok: true, classification: 'identical-insert' })
    expect(result.ok && result.content).toBe('a\nx\nb\n')
  })

  it('merges inserts at different anchors and independent replacements', () => {
    const inserts = mergeIndependentText('a\nb\nc\n', 'x\na\nb\nc\n', 'a\nb\nc\ny\n')
    expect(inserts.ok && inserts.content).toBe('x\na\nb\nc\ny\n')
    const replacements = mergeIndependentText('a\nb\nc\nd\n', 'A\nb\nc\nd\n', 'a\nb\nc\nD\n')
    expect(replacements.ok && replacements.content).toBe('A\nb\nc\nD\n')
  })

  it('rejects overlapping replacements and insertion inside a replacement', () => {
    expect(mergeIndependentText('a\nb\nc\n', 'a\nB\nc\n', 'a\nX\nc\n')).toMatchObject({ ok: false, reason: expect.stringContaining('общие строки') })
    expect(mergeIndependentText('a\nb\nc\nd\n', 'a\nBC\nd\n', 'a\nb\nx\nc\nd\n')).toMatchObject({ ok: false, reason: expect.stringContaining('внутрь') })
  })

  it('rejects same-anchor inserts adjacent to another changed base range', () => {
    const result = mergeIndependentText('a\nb\nc\n', 'a\nours\nB\nc\n', 'a\ntheirs\nb\nc\n')
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('прилегает') })
  })

  it('fails closed for binary data, ambiguous line mapping, and newline changes', () => {
    expect(mergeIndependentText('a\0b', 'a\0b', 'a\0b')).toMatchObject({ ok: false, classification: 'invalid-text' })
    expect(mergeIndependentText('same\nsame\n', 'same\n', 'same\nsame\nx\n')).toMatchObject({ ok: false, reason: expect.stringContaining('сопоставить') })
    expect(mergeIndependentText('a\n', 'a', 'a\n')).toMatchObject({ ok: false, reason: expect.stringContaining('перевод строки') })
  })

  it('rejects generated conflict markers', () => {
    const result = mergeIndependentText('a\n', 'a\n<<<<<<< ours\n', 'a\ntheirs\n')
    expect(result).toMatchObject({ ok: false, classification: 'invalid-text' })
  })
})
