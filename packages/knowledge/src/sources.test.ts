import { expect, it, vi } from 'vitest'
import { ModuleKnowledgeBaseService } from './sources.js'
import type { KbFiles } from './ports.js'

it('publishes complete generations, coalesces refreshes and retains the last good index', async () => {
  const files = new Map([
    ['/core/core.md', '# CoreTopic\n\nCore contents'],
    ['/module/topic.md', '# FirstTopic\n\nFirst contents']
  ])
  const storage: KbFiles = {
    exists: root => [...files.keys()].some(path => path.startsWith(root + '/')),
    read: path => { const text = files.get(path); if (text === undefined) throw Error('missing'); return text },
    listMarkdown: root => [...files.keys()].filter(path => path.startsWith(root + '/'))
  }
  const checkout = vi.fn(async () => ({ root: '/module', sha: 'one' }))
  const service = new ModuleKnowledgeBaseService({ root: '/core', dataDir: '/data', files: storage, git: { checkout },
    sources: [{ id: 'make', title: 'Make', repository: 'https://example.test/make.git', ref: 'main', path: 'docs/kb' }] })
  const first = service.refreshModule('make')
  expect(service.refreshModule('make')).toBe(first)
  expect((await first)?.indexedSha).toBe('one')
  expect(checkout).toHaveBeenCalledTimes(1)
  expect((await service.document('make:topic.md'))?.body).toContain('First contents')
  files.set('/module/topic.md', '# SecondTopic\n\nSecond contents')
  checkout.mockResolvedValue({ root: '/module', sha: 'two' })
  expect((await service.refreshModule('make'))?.indexedSha).toBe('two')
  expect((await service.document('make:topic.md'))?.body).toContain('Second contents')
  checkout.mockRejectedValueOnce(new Error('private host detail'))
  expect(await service.refreshModule('make')).toMatchObject({ status: 'failed', indexedSha: 'two', error: 'KB source fetch failed' })
  checkout.mockResolvedValue({ root: '/missing', sha: 'three' })
  expect(await service.refreshModule('make')).toMatchObject({ status: 'failed', indexedSha: 'two', error: 'KB source indexing failed' })
  expect((await service.document('make:topic.md'))?.body).toContain('Second contents')
  await service.close()
  expect(await service.refreshModule('make')).toBeNull()
})
