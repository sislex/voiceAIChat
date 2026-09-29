import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// @testCase TC-BUNDLE
// @testCase TC-ELECTRON
// @testCase TC-GATES
it('measures the real production Web renderer and the enabled Electron renderer', () => {
  execFileSync(process.execPath, ['scripts/route-gate.mjs'], { stdio: 'inherit' })
  const report = JSON.parse(readFileSync('artifacts/route-budgets/report.json', 'utf8'))
  expect(report.tools.web).toBeTruthy()
  const clients = process.env.VC_ELECTRON_TESTS === '1' ? ['web', 'electron'] : ['web']
  if (clients.includes('electron')) expect(report.tools.electron).toBeTruthy()
  else expect(report.tools.electron).toBeUndefined()
  expect(report.activations['web/editor'].workers.length).toBeGreaterThan(0)
  for (const client of clients) for (const route of ['account', 'settings']) {
    expect(report.routes[client + '/' + route + '/navigation'].ready).toBe(true)
    expect(report.routes[client + '/' + route + '/navigation'].additionalResources.length).toBeGreaterThan(0)
  }
  if (clients.includes('electron')) {
    expect(report.activations['electron/editor'].ready).toBe(true)
    expect(report.activations['electron/editor'].workers.length).toBeGreaterThan(0)
  }
  for (const client of clients) for (const route of ['chat', 'account', 'settings']) for (const cache of ['cold', 'warm']) {
    const measured = report.routes[client + '/' + route + '/' + cache]
    expect(measured.ready).toBe(true)
    expect(measured.initial.length).toBeGreaterThan(0)
    expect(measured.waterfall.length).toBeGreaterThan(0)
    expect(measured.errors).toEqual([])
  }
}, 600000)
