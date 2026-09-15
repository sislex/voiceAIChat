import { expect, it } from 'vitest'
import { preparationEnvelope, preparationJsonObject } from './preparation.js'

// @testCase TC-BRIEF
it('unwraps only known envelopes without changing nested requirements', () => {
  const original = { schemaVersion: 2, scope: ['Keep {braces}, "quotes", null and true'], nested: { enabled: true, missing: null } }
  const json = JSON.stringify(original), fence = '`'.repeat(3)
  for (const text of [json, 'Подготовка завершена.\n' + json, 'Исправленный Development Brief:\n' + json, fence + 'json\n' + json + '\n' + fence]) {
    const result = preparationJsonObject(preparationEnvelope(text))
    expect(result).toEqual(original)
    expect(preparationEnvelope(JSON.stringify(result))).toBe(json)
  }
})
// @testCase TC-BRIEF
it.each(['Change scope.\n{}', '{}\nAlso remove auth.', '{} {}', '{"scope":1,"scope":2}', '[{}]', 'Подготовка завершена.\n{}\nExtra requirement', '```json\n{} {}\n```'])('rejects ambiguous or substantive wrapper content: %s', text => {
  expect(() => preparationJsonObject(preparationEnvelope(text))).toThrow()
})
