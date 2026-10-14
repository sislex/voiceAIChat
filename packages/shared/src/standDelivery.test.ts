import { expect, it } from 'vitest'
import { REST } from './protocol'

it('encodes project and stand identifiers in delivery routes', () => {
  expect(REST.projectDevStandDeliveries('project/a', 'stand?b')).toBe('/api/projects/project%2Fa/dev-stands/stand%3Fb/deliveries')
  expect(REST.projectDevStandSyncDev('project/a', 'stand?b')).toBe('/api/projects/project%2Fa/dev-stands/stand%3Fb/sync-dev')
})

it('lists unique stand and Storybook error codes', async () => {
  const { STAND_ERROR_CODES } = await import('./standDelivery')
  const { PROJECT_STORYBOOK_ERROR_CODES } = await import('./projectComponents')
  expect(new Set(STAND_ERROR_CODES).size).toBe(STAND_ERROR_CODES.length)
  expect(STAND_ERROR_CODES).toEqual(expect.arrayContaining(['stand_fetch_failed', 'stand_git_timeout', 'stand_worktree_dirty',
    'stand_agent_timeout', 'machine_unavailable', 'machine_offline', 'storybook_no_free_port']))
  expect(PROJECT_STORYBOOK_ERROR_CODES).toEqual(expect.arrayContaining(['storybook_exit_nonzero', 'storybook_exited_before_ready', 'pty_error', 'storybook_port_busy']))
})
