import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { preparationJsonObject } from './preparation.js'

// @testCase T10
// @testCase TC-BRIEF-KB
it('keeps the existing preparation article consistent with executable strict-format examples', () => {
  const article = readFileSync(resolve(__dirname, '../../../../docs/kb/features/task-preparation.md'), 'utf8')
  for (const rule of ['schemaVersion=2', 'TC-BRIEF-FORMAT', 'TC-BRIEF-NORMALIZATION', 'TC-BRIEF-CONTRACT', 'unique keys', 'missing UI tests', 'CHAT-469', 'T7', 'T8', 'T9', 'T10']) expect(article).toContain(rule)
  const original = { schemaVersion: 2, scope: ['Keep every requirement'], decisions: [{ id: 'D1', text: 'Keep scope', rationale: 'Confirmed', questionId: null }] }
  const json = JSON.stringify(original)
  const fence = String.fromCharCode(96).repeat(3)
  for (const wrapped of ['Ready. ' + json, json + '\nDone.', fence + 'json\n' + json + '\n' + fence, json + json]) expect(() => preparationJsonObject(wrapped)).toThrow()
  const normalized = preparationJsonObject(json)
  expect(normalized).toEqual({ ...original, decisions: [{ id: 'D1', text: 'Keep scope', rationale: 'Confirmed' }] })
  expect(preparationJsonObject(JSON.stringify(normalized))).toEqual(normalized)
})

