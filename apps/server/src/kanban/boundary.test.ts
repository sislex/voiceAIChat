// Гейт границы канбан-кластера (docs/plans/kanban-service.md, круги 1–2): сборка кластера живёт в
// `kanban/module.ts`, `server.ts` зовёт её одной функцией; состояние ядра кластер получает портом
// `KanbanCore`, ядро от кластера — портом `KanbanService`. Список зависимостей и импорты кластера
// из ядра зафиксированы снимками: новая зависимость — осознанное решение, а не побочный эффект,
// потому что каждая из них в отдельном процессе станет RPC к ядру или своим клиентом.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { AgentRegistry } from '../agents/registry.js'
import type { KanbanMachines } from './core.js'

const srcDir = join(__dirname, '..')
const server = readFileSync(join(srcDir, 'server.ts'), 'utf8')
const module = readFileSync(join(srcDir, 'kanban', 'module.ts'), 'utf8')

/** Каталоги и файлы кластера — то, что уедет в пакет `apps/kanban`. */
const CLUSTER_DIRS = ['ci', 'merge', 'orchestration', 'releases', 'preview', 'projects', 'kanban']
const CLUSTER_FILES = ['routes/projects.ts', 'routes/ci.ts', 'routes/qa.ts', 'routes/releases.ts', 'routes/applicationReleases.ts', 'routes/featurePreview.ts', 'routes/projectTypes.ts', 'routes/invitations.ts', 'mcp/kanbanMcp.ts']

/**
 * Что кластер импортирует из ядра значениями (не типами). `kb/*` — функции над сервисом KB и
 * базой, они переедут вместе с кластером или встанут за порт `core.kb` в круге 3; `users/auth` —
 * разбор пользователя из запроса, в отдельном процессе его даст whoami ядра.
 */
const ALLOWED_VALUE_IMPORTS = ['db/database.ts', 'kb/access.ts', 'kb/autoContext.ts', 'kb/kbMcp.ts', 'kb/routes.ts', 'kb/taskQuery.ts', 'llm/remoteClient.ts', 'manifests.ts', 'reader/turnToken.ts', 'users/auth.ts']
/** Состояние процесса ядра — только через `KanbanCore`, даже типами (кроме самого порта). */
const FORBIDDEN_TYPE_IMPORTS = ['agents/registry.ts', 'mcp/widgetContext.ts', 'mcp/widgetUiRelay.ts', 'frameHub.ts', 'server.ts', 'session.ts', 'turns.ts']

function listTs(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    // Сборка отдельного процесса — composition root: ей положено собирать клиентов ядра (LLM, почта, браузер).
    if (relative(srcDir, full) === 'kanban/standalone') continue
    if (statSync(full).isDirectory()) out.push(...listTs(full))
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

function clusterSources(): string[] {
  return [...CLUSTER_DIRS.flatMap((dir) => listTs(join(srcDir, dir))), ...CLUSTER_FILES.map((file) => join(srcDir, file))]
}

function isCluster(rel: string): boolean {
  return CLUSTER_DIRS.some((dir) => rel.startsWith(`${dir}/`)) || CLUSTER_FILES.includes(rel)
}

/** Относительные импорты файла, ведущие за пределы кластера: [цель относительно src, только типы?]. */
function externalImports(file: string): Array<{ target: string; typeOnly: boolean }> {
  const text = readFileSync(file, 'utf8')
  const out: Array<{ target: string; typeOnly: boolean }> = []
  for (const m of text.matchAll(/^import\s+(type\s+)?([^'\n]*)from\s+'(\.[^']+)'/gm)) {
    const target = relative(srcDir, normalize(join(dirname(file), m[3]!))).replace(/\.js$/, '.ts')
    if (isCluster(target)) continue
    // `import { type A, type B }` — тоже только типы, если ни одного имени без `type`.
    const names = m[2]!.replace(/[{}]/g, '').split(',').map((n) => n.trim()).filter(Boolean)
    const typeOnly = Boolean(m[1]) || (names.length > 0 && names.every((n) => n.startsWith('type ')))
    out.push({ target, typeOnly })
  }
  return out
}

describe('граница канбан-кластера', () => {
  it('server.ts не собирает кластер сам: менеджеры ранов, релизов, мержа, оркестрации, автопилот и MCP канбана — в kanban/module.ts', () => {
    for (const marker of ['createCiRunManager(', 'createCiModelHooks(', 'new ReleaseManager(', 'new MergeRunManager(', 'createOrchestrationManager(', 'autoPilotTick', 'registerProjectRoutes(', 'registerCiRoutes(', 'registerQaRoutes(', 'registerReleaseRoutes(', 'registerKanbanMcp(', 'registerCiCommandsMcp(', 'new BoardHub(', 'new NotificationHub(']) {
      expect(server, `server.ts содержит ${marker}`).not.toContain(marker)
      expect(module, `kanban/module.ts не содержит ${marker}`).toContain(marker)
    }
    expect(server).toContain('createKanbanModule(')
    expect(server).toContain('createLocalKanbanCore(')
  })

  it('KanbanDeps — зафиксированный список того, что кластер берёт у ядра', () => {
    const block = /export interface KanbanDeps \{([\s\S]*?)\n\}/.exec(module)![1]!
    const keys = [...block.matchAll(/^\s+(\w+)[?]?:/gm)].map((m) => m[1]).sort()
    expect(keys).toEqual([
      'app', 'automatedQaScenarioRunner', 'automatedQaScreenshotDir', 'browserRunner', 'ciCommandsMcpBaseUrl', 'ciExecutor', 'ciKbUpdate',
      'claude', 'codex', 'config', 'core', 'db', 'kbMcpBaseUrl', 'kbUsage', 'mailer', 'make', 'mcpSecret',
      'previewMcpBaseUrl', 'remoteBashMcpBaseUrl'
    ])
  })

  it('ядро берёт у кластера только порт KanbanService: ленты ранов, доски и уведомлений', () => {
    expect(server).not.toMatch(/kanban\.(ciRunManager|orchestrationManager|runLaunchers|releaseManager|mergeRunManager|featurePreviews)\b/)
    for (const feed of ['kanban.service.runs', 'kanban.service.board.', 'kanban.service.notifications.subscribe']) expect(server).toContain(feed)
  })

  it('кластер импортирует из ядра значениями только разрешённое, а состояние процесса ядра — только через KanbanCore', () => {
    const offenders: string[] = []
    for (const file of clusterSources()) {
      const rel = relative(srcDir, file)
      for (const { target, typeOnly } of externalImports(file)) {
        if (typeOnly) {
          // Сам порт описывает состояние ядра его же типами — это единственное место, где они видны кластеру.
          if (FORBIDDEN_TYPE_IMPORTS.includes(target) && rel !== 'kanban/core.ts') offenders.push(`${rel} → ${target} (тип состояния ядра)`)
        } else if (!ALLOWED_VALUE_IMPORTS.includes(target)) {
          offenders.push(`${rel} → ${target}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('сборка отдельного процесса не трогает состояние ядра напрямую — только через HttpKanbanCore', () => {
    const offenders: string[] = []
    for (const file of listTs(join(srcDir, 'kanban', 'standalone'))) {
      for (const { target } of externalImports(file)) {
        if (FORBIDDEN_TYPE_IMPORTS.includes(target)) offenders.push(`${relative(srcDir, file)} → ${target}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('AgentRegistry структурно удовлетворяет узкому фасаду KanbanMachines', () => {
    expectTypeOf<AgentRegistry>().toMatchTypeOf<KanbanMachines>()
  })
})
