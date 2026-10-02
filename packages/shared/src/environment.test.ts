import { describe, expect, it } from 'vitest'
import { parseEnvironmentId, parseModuleSelections } from './environment'

const selection = { repository: 'https://github.com/sislex/voiceAIChat', version: '0.1.14', commit: 'a'.repeat(40) }
describe('environment contracts', () => {
  it('accepts and copies release selections, including an empty configuration', () => {
    expect(parseModuleSelections([])).toEqual([])
    expect(parseModuleSelections([selection])).toEqual([selection])
    expect(parseModuleSelections([selection])[0]).not.toBe(selection)
  })
  it.each([null, {}, '[]', [null], [1], [[]], new Array(1), [{ ...selection, extra: true }], [{ repository: selection.repository, version: selection.version }], [selection, selection], [selection, { ...selection, repository: selection.repository.toLowerCase() }]])('rejects malformed or duplicate selections: %j', value => {
    expect(() => parseModuleSelections(value)).toThrow()
  })
  it.each(['http://github.com/sislex/core', 'https://github.com/other/core', 'https://github.com/sislex/core.git', 'https://github.com/sislex/core/', 'https://github.com/sislex/../core', ' https://github.com/sislex/core', 'https://github.com/sislex/core?x=1'])('rejects repository %s', repository => {
    expect(() => parseModuleSelections([{ ...selection, repository }])).toThrow()
  })
  it.each(['1.2', 'v1.2.3', '01.2.3', '1.2.3-beta', '1.2.3 ', 123, null])('rejects version %j', version => {
    expect(() => parseModuleSelections([{ ...selection, version }])).toThrow()
  })
  it.each(['a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), null, 123])('rejects commit %j', commit => {
    expect(() => parseModuleSelections([{ ...selection, commit }])).toThrow()
  })
  it('accepts slug boundaries without normalization', () => {
    expect(parseEnvironmentId('ab')).toBe('ab')
    expect(parseEnvironmentId('a' + '1-'.repeat(19) + 'z')).toHaveLength(40)
  })
  it.each(['a', '', 'a'.repeat(41), 'Production', '1prod', 'prod_test', 'prod/test', ' prod', 'prod\n', null, 12])('rejects slug %j', id => {
    expect(() => parseEnvironmentId(id)).toThrow()
  })
})
