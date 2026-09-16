import { expect, it } from 'vitest'
import { preparationEnvelope, preparationJsonObject } from './preparation.js'

// @testCase TC-10
it('preserves the complete object and only trims surrounding whitespace', () => {
  const original = { schemaVersion: 2, scope: ['Keep {braces}, "quotes", null and true'], nested: { enabled: true, missing: null } }
  const json = JSON.stringify(original)
  for (const text of [json, '\n ' + json + '\t\n']) {
    const result = preparationJsonObject(preparationEnvelope(text))
    expect(result).toEqual(original)
    expect(preparationEnvelope(JSON.stringify(result))).toBe(json)
  }
})
// @testCase TC-11
it.each(['Подготовка завершена.\n', 'Исправленный Development Brief:\n', 'Explanation before JSON\n'])('rejects every prefix through the production preprocessing path: %s', prefix => {
  expect(() => preparationJsonObject(preparationEnvelope(prefix + '{"schemaVersion":2}'))).toThrow()
})
// @testCase TC-11
it.each(['Change scope.\n{}', '{}\nAlso remove auth.', '{} {}', '{"scope":1,"scope":2}', '[{}]', 'Подготовка завершена.\n{}\nExtra requirement', '```json\n{} {}\n```'])('rejects ambiguous or substantive wrapper content: %s', text => {
  expect(() => preparationJsonObject(preparationEnvelope(text))).toThrow()
})
