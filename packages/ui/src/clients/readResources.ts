import type { RendererApi } from '@shared/ipc'
import { ReadCache, type ResourceFamily } from '../lib/readCache'

// The allowlist keeps commands, searches and transport contracts outside the cache.
export const READ_RESOURCES: Partial<Record<keyof RendererApi, ResourceFamily>> = {
  'me:profile': 'profile', 'llm:access': 'access', 'usage:report': 'usage',
  'me:security': 'security', 'agents:list': 'machines', 'agents:listStorages': 'machines',
  'settings:get': 'settings', 'llm:engines': 'catalogs', 'system:capabilities': 'catalogs',
  'mcp:list': 'catalogs', 'tts:voices': 'catalogs', 'tts:catalog': 'catalogs', 'stt:models': 'catalogs', 'stt:status': 'catalogs',
  'projects:list': 'projects', 'projects:get': 'projects', 'projectTypes:list': 'projects',
  'board:get': 'board', 'board:getView': 'board', 'board:getStatuses': 'board'
}
export type ReadResources = ReturnType<typeof createReadResources>
const instances = new WeakMap<RendererApi, ReadResources>()
export function readResources(api: RendererApi): ReadResources {
  let instance = instances.get(api)
  if (!instance) {
    instance = createReadResources(api)
    instances.set(api, instance)
    instances.set(instance.api, instance)
  }
  return instance
}
export function createReadResources(source: RendererApi, cache = new ReadCache(Date.now, (event) => {
  console.debug('[read-cache]', event.resource, event.outcome)
})) {
  let rangeNow: number | undefined
  let rangeExpires = 0
  const key = (channel: keyof RendererApi, args: unknown[]) => {
    const first = args[0] as Record<string, unknown> | undefined
    if (channel === 'board:get' || channel === 'board:getStatuses') return { channel, args: [{ ...first, includeCompleted: first?.includeCompleted ?? false }] }
    if (channel === 'me:security') return { channel, args: [{ ...first, group: first?.group ?? 'all', limit: first?.limit ?? 200 }] }
    return { channel, args }
  }
  const invalidateProject = (id?: string) => {
    for (const family of ['board', 'projects'] as const) cache.invalidate(family, (params) => {
      const { channel, args } = params as { channel: string; args: Array<{ id?: string; projectId?: string }> }
      return !id || channel === 'projects:list' || args[0]?.id === id || args[0]?.projectId === id
    })
  }
  const invalidateMutation = (channel: string, args: unknown[]) => {
    const arg = args[0] as { id?: string; projectId?: string } | undefined
    if (channel === 'board:saveView') {
      cache.invalidate('board', params => {
        const value = params as { channel: string; args: Array<{ id?: string }> }
        return value.channel === 'board:getView' && value.args[0]?.id === arg?.id
      })
    } else if (/^(tasks|columns|projects|board):/.test(channel)) invalidateProject(arg?.projectId ?? arg?.id)
    if (channel.startsWith('projectTypes:')) cache.invalidate('projects')
    if (/^(agents|loginApplication):/.test(channel)) {
      cache.invalidate('machines'); cache.invalidate('profile'); cache.invalidate('security')
    }
    if (channel === 'settings:save') cache.invalidate('settings')
    if (/^(tts:delete|stt:delete|admin:.*Llm|admin:.*Engine)/.test(channel)) {
      cache.invalidate('catalogs'); cache.invalidate('access')
    }
    if (/^(messages:|conversations:(create|delete))/.test(channel)) {
      cache.invalidate('usage'); cache.invalidate('profile')
    }
  }
  // Only known mutations are wrapped: a read must never invalidate its neighbours.
  const mutation = /^(settings:save|agents:(create|delete|setPolicy|regenerateToken|revokeToken|setPinIp|update|registerStorage)|tts:deleteVoice|stt:deleteModel|board:saveView|columns:(create|rename|setHidden|reorder|delete)|tasks:(create|update|move|delete|commentAdd|commentUpdate|commentDelete|worklogAdd|worklogUpdate|worklogDelete)|projects:(create|update|delete|addMember|updateMemberRole|removeMember|linkMachine|unlinkMachine|setDefaultMachine|setUserDefaultMachine)|messages:(add|updateMeta|delete)|conversations:(create|delete)|admin:(saveLlmAccess|createLlmEngine|updateLlmEngine|deleteLlmEngine))$/
  const wrapped = new Map<PropertyKey, unknown>()
  const api = new Proxy(source, {
    get(target, property, receiver) {
      const original = Reflect.get(target, property, receiver) as unknown
      if (typeof property !== 'string' || typeof original !== 'function') return original
      if (wrapped.has(property)) return wrapped.get(property)
      const channel = property as keyof RendererApi
      const family = READ_RESOURCES[channel]
      const invoke = (...args: unknown[]) => Reflect.apply(Reflect.get(target, property) as (...input: unknown[]) => unknown, target, args) as Promise<unknown>
      const fn = family
        ? (...args: unknown[]) => cache.read(family, key(channel, args), () => invoke(...args))
        : mutation.test(property) || /^(projectTypes:(create|update|delete|publish|unpublish)|projects:(set|configure|reset|derive|link|unlink|addMember|removeMember|updateMemberRole))/.test(property)
          ? async (...args: unknown[]) => {
            invalidateMutation(property, args)
            try { return await invoke(...args) }
            finally { invalidateMutation(property, args) }
          }
          : (...args: unknown[]) => invoke(...args)
      wrapped.set(property, fn)
      return fn
    }
  })
  return {
    api, cache, invalidateProject,
    seedAgents(agents: Awaited<ReturnType<RendererApi['agents:list']>>) {
      cache.seed('machines', key('agents:list', []), agents)
    },
    periodNow(now: number) {
      if (rangeNow === undefined || now >= rangeExpires) { rangeNow = now; rangeExpires = now + 30_000 }
      return rangeNow
    },
    clear: () => { rangeNow = undefined; rangeExpires = 0; cache.clear() },
    invalidate(channel: keyof RendererApi) {
      const family = READ_RESOURCES[channel]
      if (family) cache.invalidate(family, params => (params as { channel: string }).channel === channel)
    },
    peek<K extends keyof RendererApi>(channel: K, ...args: Parameters<RendererApi[K]>): Awaited<ReturnType<RendererApi[K]>> | undefined {
      const family = READ_RESOURCES[channel]
      return family ? cache.peek(family, key(channel, args)) : undefined
    },
    fresh(channel: keyof RendererApi, ...args: unknown[]) {
      const family = READ_RESOURCES[channel]
      return family ? cache.fresh(family, key(channel, args)) : false
    }
  }
}
