import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applicationLinkChecks,
  applicationLinksHealthy
} from './application-links.mjs'
const release = (id, requires = []) => ({
  schemaVersion: 1,
  applicationId: id,
  version: '1.0.0',
  apiVersion: '1.0.0',
  commit: 'a'.repeat(40),
  dataVersion: '1.0.0',
  requires,
  capabilities: [],
  artifacts: [
    {
      service: id === 'core' ? 'voicechat' : id,
      kind: 'oci',
      reference: 'test/' + id + '@sha256:' + 'a'.repeat(64)
    }
  ]
})
const core = release('core'),
  make = release('make', [
    { applicationId: 'core', minVersion: '1.0.0', maxVersionExclusive: '2.0.0' }
  ])
const environment = {
  applications: [core, make].map((manifest) => ({
    manifest,
    healthy: true,
    installedAt: 1
  }))
}
const inventory = ['voicechat', 'make'].map((id) => ({
  Id: id,
  State: { Running: true },
  Config: { Labels: { 'com.docker.compose.service': id } }
}))
test('проверяет оба направления Make/core, включая read-only RPC и remote режим', () => {
  const checks = applicationLinkChecks(environment)
  assert.equal(checks.length, 2)
  assert.equal(checks[0].contract.path, '/internal/make/core')
  assert.equal(checks[0].tokenEnv, 'VC_INTERNAL_TOKEN')
  assert.equal(checks[1].modeEnv, 'VC_MAKE_MODE')
})
test('неверная версия, неработающий контейнер или сбой RPC блокируют успех', () => {
  const execute = (args) => JSON.stringify(args[1] === 'make' ? core : make)
  assert.equal(applicationLinksHealthy(environment, inventory, execute), true)
  assert.equal(
    applicationLinksHealthy(environment, inventory, () =>
      JSON.stringify({ ...core, version: '1.1.0' })
    ),
    false
  )
  assert.equal(
    applicationLinksHealthy(environment, inventory, () => {
      throw new Error('401')
    }),
    false
  )
  assert.equal(
    applicationLinksHealthy(environment, [inventory[0]], execute),
    false
  )
})
test('frontend проверяет именно карту раздачи ядра', () => {
  const frontend = release('make-ui')
  const checks = applicationLinkChecks({
    applications: [core, frontend].map((manifest) => ({ manifest }))
  })
  assert.equal(checks.length, 1)
  assert.equal(checks[0].mapEnv, 'VC_APPLICATION_FRONTENDS')
  assert.equal(checks[0].mapKey, 'make-ui')
})

test('Web Reader использует VC_READER_URL ядра и проверяет оба своих порта', () => {
  const reader = release('web-reader', [{applicationId:'core'}, {applicationId:'playwright-reader'}])
  const checks = applicationLinkChecks({applications:[core,reader,release('playwright-reader')].map(manifest=>({manifest}))})
  assert.ok(checks.some(check=>check.service==='voicechat' && check.urlEnv==='VC_READER_URL' && check.modeEnv==='VC_READER_MODE'))
  assert.ok(checks.some(check=>check.service==='web-reader' && check.urlEnv==='VC_CORE_URL' && check.contract.body.method==='context'))
  assert.ok(checks.some(check=>check.service==='web-reader' && check.urlEnv==='VC_PLAYWRIGHT_READER_URL' && check.contract.body.method==='control'))
})
