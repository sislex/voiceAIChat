import { expect, it } from 'vitest'
import { validUiPerformanceBatch, validUiPerformanceQuery, uiPerformanceStats } from './uiPerformance'
const sample = { metric:'chat_ready', duration:0, route:'chat', platform:'web', lifecycle:'cold', version:'unknown', age:0 }
const batch = { schemaVersion:1, batchId:'a'.repeat(32), samples:[sample] }
// @testCase T2
it('accepts genuine zero and rejects PII, invalid durations, versions and oversized batches', () => {
  expect(validUiPerformanceBatch(batch)).toBe(true)
  for (const duration of [-1,NaN,Infinity,300001,'10',null]) expect(validUiPerformanceBatch({ ...batch, samples:[{ ...sample,duration }] })).toBe(false)
  for (const field of ['text','userId','conversationId','url','error','audio']) expect(validUiPerformanceBatch({ ...batch,samples:[{ ...sample,[field]:'private' }] })).toBe(false)
  for (const version of ['1x2x3','user@example.org','https://private/']) expect(validUiPerformanceBatch({ ...batch,samples:[{ ...sample,version }] })).toBe(false)
  expect(validUiPerformanceBatch({ ...batch,samples:Array(33).fill(sample) })).toBe(false)
  expect(validUiPerformanceBatch({ ...batch,samples:[{ ...sample,age:300001 }] })).toBe(false)
})
// @testCase T3
it('uses nearest rank and distinguishes empty, zero and insufficient samples', () => {
  expect(uiPerformanceStats([])).toEqual({ p50:null,p95:null,count:0,state:'empty' })
  expect(uiPerformanceStats([0])).toEqual({ p50:0,p95:0,count:1,state:'insufficient' })
  expect(uiPerformanceStats(Array.from({ length:100 },(_,i)=>i+1))).toEqual({ p50:50,p95:95,count:100,state:'ready' })
  expect(validUiPerformanceQuery({ from:0,to:100,buckets:2 })).toBe(true)
  for (const q of [{ from:100,to:0,buckets:1 },{ from:0,to:100,buckets:0 },{ from:0,to:100,buckets:1,userId:'private' }]) expect(validUiPerformanceQuery(q)).toBe(false)
})
