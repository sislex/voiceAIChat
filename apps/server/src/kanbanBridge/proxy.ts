// Прокси путей канбана в ядре для режима `remote`. Пути канбана нарочно идут только через ядро (Caddy
// их не выделяет, в отличие от Make): под `/api/projects/*` у ядра живут и свои роуты (git-панель,
// KB-исследование), а проверка прав проекта делается в preHandler ядра по пути запроса — прямой
// маршрут в канбан обошёл бы её. Конкретные роуты ядра выигрывают у wildcard прокси по правилам
// Fastify, остальное уходит в процесс канбана, который перепроверяет сессию через `whoami`.
import type { FastifyInstance } from 'fastify'
import { registerServiceProxy } from '../makeBridge/proxy.js'

/** Всё, что регистрируют роуты кластера и его MCP; полноту списка держит `proxy.test.ts` по исходникам кластера. */
export const KANBAN_PROXY_PREFIXES = [
  '/api/projects', '/api/ci', '/api/qa', '/api/project-types', '/api/widget-tools', '/api/merge', '/api/invitations',
  '/api/improvements', '/api/orchestrations', '/api/task-preparation', '/api/session/invitation', '/api/admin/project-types',
  '/mcp/kanban', '/mcp/ci-commands'
] as const

export function registerKanbanProxy(app: FastifyInstance, opts: { kanbanUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }): void {
  // Загрузка скриншотов QA — до 10 МБ base64 в JSON; запас на обёртку.
  registerServiceProxy(app, { name: 'kanban', baseUrl: opts.kanbanUrl, prefixes: KANBAN_PROXY_PREFIXES, bodyLimit: 32 * 1024 * 1024, ...opts })
}
