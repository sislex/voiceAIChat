import { markupAuditFixtures } from './markup.fixtures.js'
import { layoutAuditFixtures } from './layout.fixtures.js'
import { typographyAuditFixtures } from './typography.fixtures.js'
import { colorAuditFixtures } from './color.fixtures.js'

/** Both browser suites consume the same examples; production never imports this entry point. */
export interface AuditFixture {
  group: string
  rule: string
  name?: string
  broken: string
  fixed: string
  ready?: string
}
export const auditFixtures: AuditFixture[] = [
  ...markupAuditFixtures.map(f => ({ ...f, group: 'markup' })),
  ...layoutAuditFixtures.map(f => ({ ...f, group: 'layout' })),
  ...typographyAuditFixtures.map(f => ({ ...f, group: 'typography' })),
  ...colorAuditFixtures.map(f => ({ ...f, group: 'color' }))
]
export { markupAuditFixtures, layoutAuditFixtures, typographyAuditFixtures, colorAuditFixtures }
export { probeFixtures, probeExpectationFailures, probeResultFixture, type ProbeExpectation, type ProbeScene, type ProbeFixture } from './probe.fixtures.js'
