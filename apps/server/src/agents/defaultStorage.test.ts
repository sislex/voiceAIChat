import { describe, expect, it, vi } from 'vitest'
import type { ChatStorageBinding, MachineStorage } from '@voicechat/shared'
import { defaultStorageRoot, ensureDefaultChatBinding, ensureDefaultStorage, type DefaultStorageDeps } from './defaultStorage.js'

function makeDeps(opts: { homePath?: string; platform?: string; storages?: MachineStorage[]; allowedDirs?: string[]; marker?: string; online?: boolean } = {}) {
  const storages: MachineStorage[] = [...(opts.storages ?? [])]
  const bindings = new Map<string, ChatStorageBinding>()
  const written: Record<string, string> = {}
  const mkdirs: string[] = []
  const deps: DefaultStorageDeps = {
    db: {
      agentOwnerId: () => 'u1',
      listMachineStorages: (_u, machineId) => storages.filter((s) => !machineId || s.machineId === machineId),
      saveMachineStorage: (_u, machineId, rootPath, formatVersion, preferredId) => {
        const s: MachineStorage = { id: preferredId ?? 'gen', machineId, rootPath, formatVersion, status: 'ready' as MachineStorage['status'] }
        storages.push(s)
        return s
      },
      getChatStorageBinding: (_u, id) => bindings.get(id) ?? null,
      saveChatStorageBinding: (_u, b) => { bindings.set(b.conversationId, b); return b },
      getConversation: (_u, id) => (id === 'missing' ? null : { id, projectId: id === 'proj-chat' ? 'p1' : null, taskId: null })
    },
    registry: {
      isOnline: () => opts.online ?? true,
      platformOf: () => opts.platform ?? 'linux',
      telemetryOf: () => ({ os: { homePath: opts.homePath ?? '/home/bob' } }),
      policyOf: () => (opts.allowedDirs ? { allowedDirs: opts.allowedDirs } as never : undefined),
      fsMkdir: vi.fn(async (_id, p: string) => { mkdirs.push(p) }),
      fsRead: vi.fn(async () => {
        if (!opts.marker) throw new Error('ENOENT')
        return { dataBase64: Buffer.from(opts.marker).toString('base64') }
      }),
      fsWrite: vi.fn(async (_id, p: string, data: string) => { written[p] = Buffer.from(data, 'base64').toString('utf8') })
    }
  }
  return { deps, storages, bindings, written, mkdirs }
}

describe('defaultStorageRoot', () => {
  it('строит <home>/ChatAI под платформу', () => {
    expect(defaultStorageRoot('/home/bob', 'linux')).toBe('/home/bob/ChatAI')
    expect(defaultStorageRoot('C:\\Users\\bob', 'win32')).toBe('C:\\Users\\bob\\ChatAI')
    expect(defaultStorageRoot(undefined, 'linux')).toBeNull()
  })
})

describe('ensureDefaultStorage', () => {
  it('создаёт ChatAI с маркером и служебными каталогами, когда хранилищ нет', async () => {
    const { deps, storages, written, mkdirs } = makeDeps()
    const s = await ensureDefaultStorage(deps, 'u1', 'm1')
    expect(s?.rootPath).toBe('/home/bob/ChatAI')
    expect(storages).toHaveLength(1)
    expect(mkdirs).toContain('/home/bob/ChatAI/.voicechat/index')
    expect(JSON.parse(written['/home/bob/ChatAI/.voicechat/storage.json']!)).toMatchObject({ id: s!.id })
  })

  it('возвращает существующее хранилище, ничего не создавая', async () => {
    const existing = { id: 'st', machineId: 'm1', rootPath: '/srv/x', formatVersion: 1, status: 'ready' as MachineStorage['status'] }
    const { deps } = makeDeps({ storages: [existing] })
    expect(await ensureDefaultStorage(deps, 'u1', 'm1')).toBe(existing)
    expect(deps.registry.fsMkdir).not.toHaveBeenCalled()
  })

  it('переиспользует id из уже лежащего маркера (каталог остался от прошлой регистрации)', async () => {
    const { deps, written } = makeDeps({ marker: JSON.stringify({ id: 'old-id', formatVersion: 1 }) })
    const s = await ensureDefaultStorage(deps, 'u1', 'm1')
    expect(s?.id).toBe('old-id')
    expect(Object.keys(written)).toHaveLength(0)
  })

  it('не создаёт хранилище вне allowedDirs политики и без телеметрии/офлайн', async () => {
    expect(await ensureDefaultStorage(makeDeps({ allowedDirs: ['/srv/only'] }).deps, 'u1', 'm1')).toBeNull()
    expect(await ensureDefaultStorage(makeDeps({ homePath: '' }).deps, 'u1', 'm1')).toBeNull()
    expect(await ensureDefaultStorage(makeDeps({ online: false }).deps, 'u1', 'm1')).toBeNull()
  })
})

describe('ensureDefaultChatBinding', () => {
  it('привязывает чат к ChatAI по рекомендуемому пути и создаёт каталоги чата', async () => {
    const { deps, bindings, mkdirs } = makeDeps()
    const b = await ensureDefaultChatBinding(deps, 'u1', 'c1', 'm1')
    expect(b?.relativePath).toBe('chats/c1')
    expect(bindings.get('c1')).toEqual(b)
    expect(mkdirs).toContain('/home/bob/ChatAI/chats/c1/attachments')
    // повторный вызов — та же привязка
    expect(await ensureDefaultChatBinding(deps, 'u1', 'c1', 'm1')).toEqual(b)
  })

  it('чат проекта ложится под projects/', async () => {
    const b = await ensureDefaultChatBinding(makeDeps().deps, 'u1', 'proj-chat', 'm1')
    expect(b?.relativePath).toBe('projects/p1/chats/proj-chat')
  })

  it('без беседы — null', async () => {
    expect(await ensureDefaultChatBinding(makeDeps().deps, 'u1', 'missing', 'm1')).toBeNull()
  })
})
