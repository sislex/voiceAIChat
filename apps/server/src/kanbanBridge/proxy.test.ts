// Список прокси канбана. Полноту по исходникам кластера проверять здесь больше нечем: роуты и MCP
// канбана живут в `sislexa-kanban`. Ядро держит только то, что своё под этими префиксами не теряется.
import { describe, expect, it } from 'vitest'
import { CI_COMMANDS_MCP_PATH, KANBAN_MCP_PATH, KANBAN_PROXY_PREFIXES } from './proxy.js'
import Fastify from 'fastify'
import { registerKanbanProxy } from './proxy.js'
import { REST } from '@voicechat/shared'

function covered(path: string): boolean {
  return KANBAN_PROXY_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

describe('KANBAN_PROXY_PREFIXES', () => {
  it('delegates B01 stand operations and manifests to the environment owner', async () => {
    const app = Fastify()
    const calls: { url: string; init?: RequestInit }[] = []
    registerKanbanProxy(app, { kanbanUrl: 'http://kanban', fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({ standId: 's', schemaVersion: 1 }), { headers: { 'content-type': 'application/json' } })
    }) as typeof fetch })
    try {
      for (const [method, url] of [['GET', REST.projectDevStands('p')], ['POST', REST.projectDevStands('p')],
        ['GET', REST.projectDevStand('p', 's')], ['DELETE', REST.projectDevStand('p', 's')],
        ['POST', REST.projectDevStandComponent('p', 's', 'core')], ['DELETE', REST.projectDevStandComponent('p', 's', 'core')]] as const) {
        const response = await app.inject({ method, url, headers: { authorization: 'Bearer test' } })
        expect(response.statusCode).toBe(200)
        expect(response.json().standId).toBe('s')
        const call = calls.at(-1)!
        expect(call.url).toBe('http://kanban' + url)
        expect(call.init?.method).toBe(method)
        expect(new Headers(call.init?.headers).get('authorization')).toBe('Bearer test')
      }
    } finally { await app.close() }
  })
  it('покрывает оба MCP канбана и пути доски', () => {
    expect(covered(KANBAN_MCP_PATH)).toBe(true)
    expect(covered(CI_COMMANDS_MCP_PATH)).toBe(true)
    for (const path of ['/api/projects/p/tasks', '/api/ci/runs/r', '/api/qa/runs/r', '/api/task-preparation/t']) expect(covered(path)).toBe(true)
  })

  it('не забирает чужие пути ядра', () => {
    for (const path of ['/api/conversations', '/api/admin/users', '/mcp/remote-bash', '/api/projectsx']) expect(covered(path)).toBe(false)
  })
})
