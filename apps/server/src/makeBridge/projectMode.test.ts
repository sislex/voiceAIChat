import { describe, expect, it, vi } from 'vitest'
import type { VoiceChatDb } from '../db/database.js'
import { LocalMakeCore } from './localCore.js'

type Entry = { name: string; kind: 'file' | 'dir'; size: number; content?: string; mtime?: number }

function fixture(tree: Record<string, Entry[]>) {
  const list = vi.fn(async (_agent: string, path: string) => ({ root: '/repo', cwd: path, entries: (tree[path] ?? []).map(entry => ({ ...entry, mtime: entry.mtime ?? 0 })) }))
  const read = vi.fn(async (_agent: string, path: string) => {
    const parent = path.slice(0, path.lastIndexOf('/'))
    const entry = tree[parent]?.find(item => item.name === path.slice(path.lastIndexOf('/') + 1))
    return { root: '/repo', cwd: path, dataBase64: Buffer.from(entry?.content ?? '').toString('base64') }
  })
  const project = { id: 'p1', name: 'Product', typeId: 'git', gitUrl: 'git@example/repo', role: 'owner' as const,
    defaultAgentId: 'a1', machines: [{ agentId: 'a1', name: 'Mac', canUse: true, path: '/repo', directories: undefined }] }
  const db = { projects: { listProjects: vi.fn(async () => [project]), getProject: vi.fn(async () => project) } } as unknown as VoiceChatDb
  return { core: new LocalMakeCore({ db, machineFs: { list, read, isOnline: () => true } }), list, read }
}

describe('MakeCore project mode', () => {
  it('lists authorized projects with role and working copies', async () => {
    const { core } = fixture({})
    expect(await core.listProjects('ann')).toEqual([expect.objectContaining({ id: 'p1', role: 'owner', hasGit: true,
      machines: [expect.objectContaining({ agentId: 'a1', path: '/repo', online: true })] })])
  })

  it('discovers packages, styles and stories through the bounded machine filesystem', async () => {
    const { core } = fixture({
      '/repo': [{ name: 'package.json', kind: 'file', size: 30, content: '{"name":"root"}' }, { name: 'apps', kind: 'dir', size: 0 }],
      '/repo/apps': [{ name: 'web', kind: 'dir', size: 0 }],
      '/repo/apps/web': [{ name: 'package.json', kind: 'file', size: 40, content: '{"name":"@x/web"}' }, { name: 'Button.stories.tsx', kind: 'file', size: 10, content: 'export {}' }, { name: 'theme.css', kind: 'file', size: 10, content: ':root{}' }]
    })
    expect(await core.projectStructure('ann', 'p1')).toContainEqual({ path: 'apps/web', name: '@x/web', packageName: '@x/web', kind: 'app', stories: 1, styleFiles: ['apps/web/theme.css'] })
  })

  it('extracts CSS themes, token maps, stories and component exports', async () => {
    const { core } = fixture({ '/repo': [
      { name: 'theme.css', kind: 'file', size: 100, content: ':root { --space: 8px; }\n[data-theme="dark"] { --surface: #000; }' },
      { name: 'tokens.json', kind: 'file', size: 30, content: '{"radius":"4px"}' },
      { name: 'Button.tsx', kind: 'file', size: 50, content: 'export function Button() {}' },
      { name: 'Button.stories.tsx', kind: 'file', size: 20, content: 'export default {}' }
    ] })
    const design = await core.projectDesign('ann', 'p1', '.')
    expect(design.themes).toEqual(['dark'])
    expect(design.tokens).toEqual(expect.arrayContaining([expect.objectContaining({ name: '--space', value: '8px', source: 'css' }), expect.objectContaining({ name: 'radius', source: 'json' })]))
    expect(design.components).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Button', kind: 'component' }), expect.objectContaining({ name: 'Button', kind: 'story' })]))
  })

  it('does not read oversized files', async () => {
    const { core, read } = fixture({ '/repo': [{ name: 'huge.css', kind: 'file', size: 300 * 1024, content: ':root { --secret: red; }' }] })
    expect(await core.projectDesign('ann', 'p1', '.')).toEqual({ tokens: [], themes: [], components: [] })
    expect(read).not.toHaveBeenCalled()
  })
})
