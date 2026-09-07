// Гейт границы канбан-кластера (docs/plans/kanban-service.md, круг 1): сборка кластера живёт в
// `kanban/module.ts`, а `server.ts` зовёт её одной функцией. Список зависимостей от ядра
// (`KanbanDeps`) зафиксирован снимком: новая зависимость — осознанное решение, а не побочный эффект,
// потому что каждая из них завтра станет методом порта `KanbanCore` или RPC к ядру.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(__dirname, '..')
const server = readFileSync(join(srcDir, 'server.ts'), 'utf8')
const module = readFileSync(join(srcDir, 'kanban', 'module.ts'), 'utf8')

describe('граница канбан-кластера', () => {
  it('server.ts не собирает кластер сам: менеджеры ранов, релизов, мержа, оркестрации и автопилот — в kanban/module.ts', () => {
    for (const marker of ['createCiRunManager(', 'createCiModelHooks(', 'new ReleaseManager(', 'new MergeRunManager(', 'createOrchestrationManager(', 'autoPilotTick', 'registerProjectRoutes(', 'registerCiRoutes(', 'registerQaRoutes(', 'registerReleaseRoutes(']) {
      expect(server, `server.ts содержит ${marker}`).not.toContain(marker)
      expect(module, `kanban/module.ts не содержит ${marker}`).toContain(marker)
    }
    expect(server).toContain('createKanbanModule(')
  })

  it('KanbanDeps — зафиксированный список того, что кластер берёт у ядра', () => {
    const block = /export interface KanbanDeps \{([\s\S]*?)\n\}/.exec(module)![1]!
    const keys = [...block.matchAll(/^\s+(\w+)[?]?:/gm)].map((m) => m[1]).sort()
    expect(keys).toEqual([
      'agentRegistry', 'app', 'automatedQaScenarioRunner', 'automatedQaScreenshotDir', 'boardHub', 'browserRunner',
      'ciCommandsMcpBaseUrl', 'ciExecutor', 'ciExecutorOverride', 'ciKbUpdate', 'ciRunManagerRef', 'claude', 'codex', 'config',
      'db', 'ensureProjectMainCurrent', 'featurePreviewsRef', 'kb', 'kbMcpBaseUrl', 'kbUsage', 'mailer', 'make', 'notificationHub',
      'previewMcpBaseUrl', 'remoteBashMcpBaseUrl', 'uploads'
    ])
  })
})
