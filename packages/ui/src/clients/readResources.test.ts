// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { createReadResources, readResources } from './readResources'
import { ReadCache } from '../lib/readCache'
import { createFakeApi } from '@voicechat/ui-foundation/test/fakeApi'
import { createBrowserClients } from './browser'
import { createAppRuntime } from '../runtime/appRuntime'
import { createTestStore } from '../test/appHarness'

// @testCase TC1
it('cold chat avoids all closed-route reads and Machines loads only on demand', async () => {
  const source = createFakeApi(['Chat'])
  const channels = ['agents:list', 'agents:listStorages', 'me:profile', 'me:security', 'usage:report',
    'mcp:list', 'system:capabilities', 'tts:catalog', 'stt:models', 'projectTypes:list'] as const
  const spies = channels.map(channel => vi.spyOn(source, channel))
  const runtime = createAppRuntime({ clients: createBrowserClients({ api: source }) })
  await runtime.start()
  for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  await runtime.operations.actions.refreshAgents()
  expect(source['agents:list']).toHaveBeenCalledTimes(1)
  await runtime.operations.actions.refreshAgents()
  expect(source['agents:list']).toHaveBeenCalledTimes(1)
  runtime.dispose()
})

// @testCase TC3
it('slow voice metadata does not block chat startup', async () => {
  const source = createFakeApi(['Chat'])
  let finish!: (value: Awaited<ReturnType<typeof source['tts:voices']>>) => void
  vi.spyOn(source, 'tts:voices').mockReturnValue(new Promise(resolve => { finish = resolve }))
  const store = createTestStore({ api: source, ttsEnabled: true })
  await store.actions.init()
  expect(store.getState().conversations.length).toBeGreaterThan(0)
  finish([])
  store.actions.dispose()
})

// @testCase TC2
it('all consumers of the same API share the same cache while other API sessions stay isolated', async () => {
  const source = createFakeApi()
  const call = vi.spyOn(source, 'agents:list')
  const first = readResources(source)
  expect(readResources(first.api)).toBe(first)
  await Promise.all([first.api['agents:list'](), readResources(source).api['agents:list']()])
  expect(call).toHaveBeenCalledTimes(1)
  const other = readResources(createFakeApi())
  expect(other.cache).not.toBe(first.cache)
  first.clear()
  await first.api['agents:list']()
  expect(call).toHaveBeenCalledTimes(2)
})

// @testCase TC2
// @testCase TC3
it('project mutation invalidates just its project and does not resurrect a pending old board', async () => {
  const source = createFakeApi()
  const p1 = await source['projects:create']({ name: 'One' })
  const p2 = await source['projects:create']({ name: 'Two' })
  const reads = createReadResources(source, new ReadCache())
  const get = vi.spyOn(source, 'board:get')
  await reads.api['board:get']({ id: p2.id, includeCompleted: false })
  let resolve!: (value: Awaited<ReturnType<typeof source['board:get']>>) => void
  const old = await source['board:get']({ id: p1.id })
  get.mockImplementationOnce(() => new Promise(yes => { resolve = yes }))
  const pending = reads.api['board:get']({ id: p1.id })
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await Promise.resolve()
  await reads.api['projects:update']({ id: p1.id, name: 'Changed' })
  await reads.api['board:get']({ id: p1.id })
  const afterMutation = get.mock.calls.length
  resolve(old)
  await rejected
  await reads.api['board:get']({ id: p2.id, includeCompleted: false })
  expect(get.mock.calls.length).toBe(afterMutation)
})

// @testCase TC3
it('saving a board view leaves an independent in-flight board snapshot usable', async () => {
  const source = createFakeApi()
  const project = await source['projects:create']({ name: 'View race' })
  const board = await source['board:get']({ id: project.id })
  let finish!: (value: typeof board) => void
  vi.spyOn(source, 'board:get').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const reads = createReadResources(source)
  const pending = reads.api['board:get']({ id: project.id, includeCompleted: true })
  await Promise.resolve()
  await reads.api['board:saveView']({ id: project.id, view: { showCompleted: true } })
  finish(board)
  await expect(pending).resolves.toEqual(board)
})

// @testCase TC3
it('refreshing a visible board preserves its snapshot and completed-task filter', async () => {
  const source = createFakeApi()
  const project = await source['projects:create']({ name: 'Refresh' })
  const clients = createBrowserClients({ api: source })
  const runtime = createAppRuntime({ clients })
  await runtime.projects.actions.openBoard(project.id)
  await runtime.projects.actions.setBoardIncludeCompleted(true)
  const previous = runtime.projects.getState().board
  let finish!: (value: NonNullable<typeof previous>) => void
  vi.spyOn(source, 'board:get').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  clients.reads!.invalidate('board:get')
  const pending = runtime.projects.actions.ensureBoard(project.id)
  await Promise.resolve()
  expect(runtime.projects.getState()).toMatchObject({ board: previous, boardLoading: false, boardIncludeCompleted: true })
  finish(previous!)
  await pending
  expect(runtime.projects.getState().boardIncludeCompleted).toBe(true)
  runtime.dispose()
})

// @testCase TC3
it('a server access denial clears cached project navigation and details', async () => {
  const source = createFakeApi()
  const project = await source['projects:create']({ name: 'Revoked project' })
  const clients = createBrowserClients({ api: source })
  const runtime = createAppRuntime({ clients })
  await runtime.projects.actions.refreshProjects()
  await clients.reads!.api['projects:get']({ id: project.id })
  vi.spyOn(source, 'projects:list').mockResolvedValue([])
  vi.spyOn(source, 'board:get').mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }))
  await runtime.projects.actions.openBoard(project.id)
  await vi.waitFor(() => expect(runtime.projects.getState().projects).toEqual([]))
  expect(runtime.projects.getState().activeProjectId).toBeNull()
  expect(clients.reads!.peek('projects:get', { id: project.id })).toBeUndefined()
  runtime.dispose()
})

// @testCase TC3
it('coalesces repeated settings invalidations into a current read instead of retaining startup defaults', async () => {
  const source = createFakeApi()
  const current = { ...await source['settings:get'](), onboarded: true }
  let finish!: (value: typeof current) => void
  const get = vi.spyOn(source, 'settings:get').mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue(current)
  const runtime = createAppRuntime({ clients: createBrowserClients({ api: source }) })
  runtime.handlers.settingsChanged()
  await Promise.resolve()
  runtime.handlers.settingsChanged()
  finish({ ...current, onboarded: false })
  await vi.waitFor(() => expect(runtime.settings.getState()).toMatchObject({ settingsLoaded: true, settings: { onboarded: true } }))
  expect(get).toHaveBeenCalledTimes(2)
  runtime.dispose()
})

// @testCase TC3
it('a superseded bootstrap settings read does not discard independently loaded model access', async () => {
  const source = createFakeApi()
  const current = { ...await source['settings:get'](), onboarded: true }
  let finish!: (value: typeof current) => void
  vi.spyOn(source, 'settings:get').mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue(current)
  const access = [{ provider: 'codex' as const, modelId: '*' }]
  vi.spyOn(source, 'llm:access').mockResolvedValue(access)
  const runtime = createAppRuntime({ clients: createBrowserClients({ api: source }) })
  const starting = runtime.settings.actions.load().catch(() => {})
  await Promise.resolve()
  runtime.handlers.settingsChanged()
  finish({ ...current, onboarded: false })
  await starting
  await vi.waitFor(() => expect(runtime.settings.getState().settings.onboarded).toBe(true))
  expect(runtime.settings.getState().llmAccess).toEqual(access)
  expect(runtime.settings.getState().llmEngines.length).toBeGreaterThan(0)
  runtime.dispose()
})

// @testCase TC5
it('preserves the RendererApi argument and response contract, leaving writes uncached', async () => {
  const source = createFakeApi()
  const save = vi.spyOn(source, 'settings:save')
  const reads = createReadResources(source, new ReadCache())
  const patch = { theme: 'dark' as const }
  const expected = await source['settings:save'](patch)
  save.mockClear()
  expect(await reads.api['settings:save'](patch)).toEqual(expected)
  await reads.api['settings:save'](patch)
  expect(save.mock.calls).toEqual([[patch], [patch]])
})

// @testCase TC3
it('a quick catalog failure and retry do not cancel a slow neighbouring catalog', async () => {
  const source = createFakeApi()
  const mcp = vi.spyOn(source, 'mcp:list').mockRejectedValueOnce(new Error('offline'))
  const original = await source['system:capabilities']()
  let finish!: (value: typeof original) => void
  vi.spyOn(source, 'system:capabilities').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const runtime = createAppRuntime({ clients: createBrowserClients({ api: source }) })
  const pending = runtime.settings.actions.loadCatalogs('llm')
  await vi.waitFor(() => expect(runtime.settings.getState().catalogErrors['MCP-серверы']).toBe('offline'))
  await runtime.settings.actions.loadCatalogs('llm', 'MCP-серверы')
  finish(original)
  await pending
  expect(mcp).toHaveBeenCalledTimes(2)
  expect(runtime.settings.getState().capabilities).toEqual(original)
  expect(runtime.settings.getState().catalogLoading).toEqual([])
  expect(runtime.settings.getState().catalogErrors).toEqual({})
  runtime.dispose()
})

// @testCase TC3
it('Settings retry is local and a failing catalog does not block the remaining block', async () => {
  const source = createFakeApi()
  const mcp = vi.spyOn(source, 'mcp:list').mockRejectedValueOnce(new Error('offline'))
  const capabilities = vi.spyOn(source, 'system:capabilities')
  const runtime = createAppRuntime({ clients: createBrowserClients({ api: source }) })
  await runtime.settings.actions.loadCatalogs('llm')
  expect(runtime.settings.getState().catalogErrors['MCP-серверы']).toBe('offline')
  expect(runtime.settings.getState().capabilities).not.toBeNull()
  await runtime.settings.actions.loadCatalogs('llm', 'MCP-серверы')
  expect(mcp).toHaveBeenCalledTimes(2)
  expect(capabilities).toHaveBeenCalledTimes(1)
  expect(runtime.settings.getState().catalogErrors).toEqual({})
  runtime.dispose()
})
