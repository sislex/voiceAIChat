import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const run = args => spawnSync(process.execPath,[new URL('./run.mjs',import.meta.url).pathname,...args],{encoding:'utf8',timeout:180000})
// @testCase T5
test('the recorded control passes and an intentional browser regression fails with before/after evidence',()=>{
  const control=run([])
  assert.equal(control.status,0,control.stdout+control.stderr)
  const regression=run(['--regression'])
  assert.equal(regression.status,1,regression.stdout+regression.stderr)
  const report=JSON.parse(readFileSync(new URL('./artifacts/regression.json',import.meta.url),'utf8'))
  assert(report.comparisons.every(row=>!row.pass && row.after>row.limit && row.delta>0))
  console.log(control.stdout,regression.stdout)
})
