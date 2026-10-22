import { expect, it } from 'vitest'
import { parseApplications } from '@voicechat/shared'
import { enabledMcp } from '../deploymentApplications.js'
import { RunnerFsClient } from './runnerFsClient.js'

it('filters the real runner HTTP inventory by deployed applications', async () => {
  const manifest = { coreId: 'test-core', applications: parseApplications('chat,make') }
  const client = new RunnerFsClient({ claudeBaseUrl: 'http://runner',
    mcpFilter: name => enabledMcp(name, manifest),
    fetchImpl: async input => {
      expect(String(input)).toContain('/v1/mcp/servers')
      return Response.json([{ name: 'make' }, { name: 'browser' }, { name: 'kanban' }, { name: 'history' }])
    },
  })
  expect(await client.listMcpServers('alice')).toEqual([{ name: 'make' }, { name: 'history' }])
})
