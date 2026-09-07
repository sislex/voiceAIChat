// Гейт границы модуля машин (docs/plans/machines-service.md, круг 1): реестр, WS агентов, роуты машин,
// журнал команд и watchdog собираются в `machines/module.ts`, а потребители видят только порт
// `MachinesService`. Прямой импорт `agents/registry` разрешён модулю машин и файлам самих машин —
// иначе в режиме отдельного процесса потребитель получит объект, которого в ядре больше нет.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { AgentRegistry } from '../agents/registry.js'
import type { MachinesService } from './service.js'

const srcDir = join(__dirname, '..')
const server = readFileSync(join(srcDir, 'server.ts'), 'utf8')
const module = readFileSync(join(srcDir, 'machines', 'module.ts'), 'utf8')

/** Кому положено знать реальный реестр: сам модуль машин и его части, порт (реэкспорт типов), тестовый harness. */
const ALLOWED_REGISTRY_IMPORTERS = new Set(['machines/module.ts', 'machines/service.ts', 'machines/standalone/server.ts', 'agents/wsAgent.ts', 'routes/agents.ts', 'routes/restHarness.ts', 'server.ts', 'kanban/core.ts'])

function listTs(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listTs(full))
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

describe('граница модуля машин', () => {
  it('server.ts не собирает машины сам: реестр, WS /agent, роуты, журнал команд, watchdog — в machines/module.ts', () => {
    for (const marker of ['new AgentRegistry(', 'attachAgentWs(', 'registerAgentRoutes(', 'createAgentWatchdog(', 'registerStorageMigrationRoutes(', 'createCommandGate(', '.onCommand(', '.onAgentReady(']) {
      expect(server, `server.ts содержит ${marker}`).not.toContain(marker)
      expect(module, `machines/module.ts не содержит ${marker}`).toContain(marker)
    }
    expect(server).toContain('createMachinesModule(')
  })

  it('agents/registry импортируют только модуль машин и его части; потребители — порт MachinesService', () => {
    const offenders: string[] = []
    for (const file of listTs(srcDir)) {
      const rel = relative(srcDir, file)
      if (rel.startsWith('agents/') || ALLOWED_REGISTRY_IMPORTERS.has(rel)) continue
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/^import\s+(type\s+)?([^'\n]*)from\s+'[./]*agents\/registry\.js'/gm)) {
        const names = m[2]!.replace(/[{}]/g, '').split(',').map((n) => n.trim()).filter(Boolean)
        // Классы ошибок реестра (`AgentFsError`) — часть контракта результата, их можно; сам реестр — нет.
        const bad = names.filter((n) => /\bAgentRegistry\b/.test(n))
        if (bad.length) offenders.push(`${rel}: ${bad.join(', ')}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('AgentRegistry структурно удовлетворяет порту MachinesService', () => {
    expectTypeOf<AgentRegistry>().toMatchTypeOf<MachinesService>()
  })
})
