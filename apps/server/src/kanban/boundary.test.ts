// Граница с канбаном (docs/plans/kanban-service.md): код кластера — доска, CI/QA, мерж, релизы,
// оркестрация, превью, очистка ресурсов — живёт только в `sislexa-kanban`. Ядро держит порт
// `KanbanCore` (что канбан берёт у ядра), порт `KanbanService` (ленты от канбана), клиент и прокси
// `kanbanBridge`. Встроенного режима нет: вернуть сюда копию кластера — значит снова держать две
// реализации, которые расходятся (так прод однажды жил со старым менеджером релизов).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { AgentRegistry } from '../agents/registry.js'
import type { KanbanMachines } from './core.js'

const srcDir = join(__dirname, '..')
const server = readFileSync(join(srcDir, 'server.ts'), 'utf8')

/** Каталоги и файлы кластера, которых в ядре быть не должно. */
const CLUSTER_DIRS = ['ci', 'merge', 'cleanup', 'orchestration', 'releases', 'preview', 'projects', 'kanban/standalone']
const CLUSTER_FILES = [
  'kanban/module.ts', 'kanban/preparation.ts', 'manifests.ts', 'mcp/kanbanMcp.ts',
  'routes/projects.ts', 'routes/ci.ts', 'routes/qa.ts', 'routes/releases.ts', 'routes/applicationReleases.ts',
  'routes/featurePreview.ts', 'routes/projectTypes.ts', 'routes/invitations.ts'
]
/** Что осталось в `kanban/`: только порты. */
const KANBAN_PORTS = ['boundary.test.ts', 'core.ts', 'internal.ts', 'service.ts']

function listTs(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (name === 'node_modules') continue
    if (statSync(full).isDirectory()) out.push(...listTs(full))
    else if (name.endsWith('.ts')) out.push(full)
  }
  return out
}

function isCluster(rel: string): boolean {
  return CLUSTER_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}/`)) || CLUSTER_FILES.includes(rel)
}

describe('граница с канбаном', () => {
  it('кода кластера в ядре нет', () => {
    const present = [...CLUSTER_DIRS, ...CLUSTER_FILES].filter((path) => existsSync(join(srcDir, path)))
    expect(present).toEqual([])
    expect(readdirSync(join(srcDir, 'kanban')).sort()).toEqual(KANBAN_PORTS)
  })

  it('ни один файл ядра не импортирует модули кластера', () => {
    const offenders: string[] = []
    for (const file of listTs(srcDir)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/(?:from|import)\s*\(?\s*'(\.[^']+)'/g)) {
        const target = relative(srcDir, normalize(join(dirname(file), m[1]!))).replace(/\.js$/, '.ts')
        if (isCluster(target)) offenders.push(`${relative(srcDir, file)} → ${target}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('server.ts берёт канбан только отдельным сервисом или заглушкой без канбана', () => {
    expect(server).toContain('createRemoteKanban(')
    expect(server).toContain('createOfflineKanban(')
    expect(server).not.toContain('createKanbanModule')
    for (const feed of ['kanban.service.runs', 'kanban.service.board.', 'kanban.service.notifications.subscribe']) expect(server).toContain(feed)
  })

  it('AgentRegistry структурно удовлетворяет узкому фасаду KanbanMachines', () => {
    expectTypeOf<AgentRegistry>().toMatchTypeOf<KanbanMachines>()
  })
})
