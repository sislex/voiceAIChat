import { expect, it } from 'vitest'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'

it('refuses to boot a public metered chat when Billing was accidentally omitted', async () => {
  const config = loadConfig({ VC_APPLICATIONS: 'chat', VC_CHAT_REQUIRE_BILLING: 'true' })
  expect(config.chatRequireBilling).toBe(true)
  await expect(buildServer({ config })).rejects.toThrow('VC_CHAT_REQUIRE_BILLING requires a configured Billing dependency')
  expect(loadConfig({}).chatRequireBilling).toBe(false)
})
