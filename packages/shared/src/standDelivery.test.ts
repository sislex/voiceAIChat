import { expect, it } from 'vitest'
import { REST } from './protocol'

it('encodes project and stand identifiers in delivery routes', () => {
  expect(REST.projectDevStandDeliveries('project/a', 'stand?b')).toBe('/api/projects/project%2Fa/dev-stands/stand%3Fb/deliveries')
  expect(REST.projectDevStandSyncDev('project/a', 'stand?b')).toBe('/api/projects/project%2Fa/dev-stands/stand%3Fb/sync-dev')
})
