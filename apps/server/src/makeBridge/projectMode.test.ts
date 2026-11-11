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

  it('discovers packages in a source tree larger than the byte limit without reading source files', async () => {
    const largeSources = Array.from({ length: 17 }, (_, index) => ({
      name: `source-${index}.ts`, kind: 'file' as const, size: 256 * 1024, content: 'x'.repeat(256 * 1024),
    }))
    const { core, read, list } = fixture({
      '/repo': [{ name: 'package.json', kind: 'file', size: 30, content: '{"name":"root"}' }, { name: 'apps', kind: 'dir', size: 0 }, ...largeSources],
      '/repo/apps': [{ name: 'web', kind: 'dir', size: 0 }, { name: '.nx', kind: 'dir', size: 0 }],
      '/repo/apps/web': [{ name: 'package.json', kind: 'file', size: 40, content: '{"name":"@x/web"}' }, { name: 'Button.stories.tsx', kind: 'file', size: 256 * 1024, content: 'x'.repeat(256 * 1024) }],
      '/repo/apps/.nx': [{ name: 'package.json', kind: 'file', size: 30, content: '{"name":"cache"}' }],
    })

    expect(await core.projectStructure('ann', 'p1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '.', packageName: 'root' }),
      expect.objectContaining({ path: 'apps/web', packageName: '@x/web', stories: 1 }),
    ]))
    expect(read.mock.calls.map(call => call[1])).toEqual(['/repo/package.json', '/repo/apps/web/package.json'])
    expect(list).not.toHaveBeenCalledWith('a1', '/repo/apps/.nx')
  })

  it('builds the design from style files in a tree larger than the byte limit of non-style files', async () => {
    const largeSources = Array.from({ length: 17 }, (_, index) => ({
      name: `source-${index}.ts`, kind: 'file' as const, size: 256 * 1024, content: 'x'.repeat(256 * 1024),
    }))
    const { core, read } = fixture({
      '/repo/apps/web': [{ name: 'styles.scss', kind: 'file', size: 30, content: ':root { --brand: #f00; }' },
        { name: 'Button.stories.ts', kind: 'file', size: 10, content: 'export {}' }, ...largeSources],
    })
    expect(await core.projectDesign('ann', 'p1', 'apps/web')).toEqual({
      tokens: [expect.objectContaining({ name: '--brand', value: '#f00', file: 'styles.scss' })], themes: [],
      components: [{ name: 'Button', kind: 'story', file: 'Button.stories.ts' }],
    })
    expect(read.mock.calls.map(call => call[1])).toEqual(['/repo/apps/web/styles.scss'])
  })

  it('discovers packages when traversal contains more than 2,000 mostly excluded entries', async () => {
    const excludedSources = Array.from({ length: 4_000 }, (_, index) => ({
      name: `source-${index}.ts`, kind: 'file' as const, size: 1,
    }))
    const { core } = fixture({
      '/repo': [{ name: 'apps', kind: 'dir', size: 0 }, ...excludedSources],
      '/repo/apps': [{ name: 'web', kind: 'dir', size: 0 }],
      '/repo/apps/web': [
        { name: 'package.json', kind: 'file', size: 40, content: '{"name":"@x/web"}' },
        { name: 'Button.stories.tsx', kind: 'file', size: 1 },
      ],
    })

    expect(await core.projectStructure('ann', 'p1')).toContainEqual(
      expect.objectContaining({ path: 'apps/web', packageName: '@x/web', stories: 1 }),
    )
  })

  it('stops traversal after 50,000 filesystem entries', async () => {
    const traversalEntries = Array.from({ length: 50_001 }, (_, index) => ({
      name: `source-${index}.ts`, kind: 'file' as const, size: 1,
    }))
    const { core } = fixture({ '/repo': traversalEntries })

    await expect(core.projectStructure('ann', 'p1')).rejects.toMatchObject({
      statusCode: 413,
      message: 'project_file_limit_exceeded',
    })
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

  it('lists and reads donor files inside the selected subproject without write operations', async () => {
    const { core, list, read } = fixture({
      '/repo/apps/web': [
        { name: 'src', kind: 'dir', size: 0 },
        { name: 'index.html', kind: 'file', size: 18, content: '<main>Donor</main>' },
      ],
    })
    expect(await core.projectReferenceList('ann', 'p1', 'apps/web', '.')).toEqual({
      path: '.',
      entries: [
        { path: 'src', kind: 'directory', size: 0 },
        { path: 'index.html', kind: 'file', size: 18 },
      ],
    })
    expect(await core.projectReferenceRead('ann', 'p1', 'apps/web', 'index.html')).toEqual({
      path: 'index.html', content: '<main>Donor</main>', size: 18,
    })
    expect(list).toHaveBeenCalledWith('a1', '/repo/apps/web')
    expect(read).toHaveBeenCalledWith('a1', '/repo/apps/web/index.html')
  })

  it('does not read oversized files', async () => {
    const { core, read } = fixture({ '/repo': [{ name: 'huge.css', kind: 'file', size: 300 * 1024, content: ':root { --secret: red; }' }] })
    expect(await core.projectDesign('ann', 'p1', '.')).toEqual({ tokens: [], themes: [], components: [] })
    expect(read).not.toHaveBeenCalled()
  })

  it('returns safe current-project context, aggregate usage and deduplicated attachments', async () => {
    const usageReport = vi.fn(async () => ({ total: { tokens: 42, costUsd: 0.12 } }))
    const db = {
      projects: {
        getProject: vi.fn(async () => ({ id: 'p1', name: 'Product', role: 'owner', ciExecAuthRef: 'secret-ref' })),
      },
      chat: {
        getConversation: vi.fn(async () => ({ id: 'c1', title: 'Make Product', projectId: 'p1' })),
        usageReport,
        historyFiles: vi.fn(async () => [
          { attachments: [{ path: 'upload-1', name: 'brief.pdf', mimeType: 'application/pdf', size: 128 }] },
          { attachments: [{ path: 'upload-1', name: 'brief.pdf', mimeType: 'application/pdf', size: 128 }] },
        ]),
      },
    } as unknown as VoiceChatDb
    const core = new LocalMakeCore({ db })

    const context = await core.currentContext('ann', 'c1')
    expect(context).toEqual(expect.objectContaining({
      conversation: { id: 'c1', title: 'Make Product', projectId: 'p1' },
      project: expect.objectContaining({ id: 'p1', name: 'Product' }),
      capabilities: expect.objectContaining({ projectUsage: true, attachments: true, uiActions: true }),
    }))
    expect(context.project).not.toHaveProperty('ciExecAuthRef')

    expect(await core.projectUsage('ann', 'c1', 'day')).toEqual({
      projectId: 'p1', unit: 'day', report: { total: { tokens: 42, costUsd: 0.12 } },
    })
    expect(usageReport).toHaveBeenCalledWith('ann', 'day', undefined, undefined, undefined, 'p1')

    expect(await core.conversationAttachments('ann', 'c1')).toEqual({
      conversationId: 'c1', projectId: 'p1',
      attachments: [{ uploadId: 'upload-1', name: 'brief.pdf', mimeType: 'application/pdf', size: 128, conversationId: 'c1' }],
    })
  })
})
