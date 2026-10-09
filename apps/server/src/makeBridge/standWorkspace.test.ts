import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import { STAND_WORKSPACE_PROGRAM, conversationWorktree } from './standWorkspace.js'
import { GitWorkspaceService, type GitWorkspaceDeps } from '../git/workspaceService.js'

const directories: string[] = []
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

function fixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(process.env.DELIVERY_ATTEMPT_ROOT ? path.join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : tmpdir(), 'stand-workspace-')))
  directories.push(dir)
  const project = path.join(dir, 'project'), root = path.join(dir, 'make-worktrees', 'conversation')
  fs.mkdirSync(project)
  let registered = false, current = 'make/test'
  const refs = new Set(['refs/remotes/origin/dev', 'refs/heads/existing', 'refs/remotes/origin/remote'])
  const spawnSync = vi.fn((_bin: string, argv: string[], options: { cwd: string; shell: boolean }) => {
    expect(options.shell).toBe(false)
    expect(options.cwd).toBe(project)
    if (argv[0] === 'worktree' && argv[1] === 'list') return { status: 0, stdout: `worktree ${project}\nbranch refs/heads/dev\n\n${registered ? `worktree ${root}\nbranch refs/heads/${current}\n` : ''}`, stderr: '' }
    if (argv[0] === 'worktree' && argv[1] === 'add') {
      fs.mkdirSync(root, { recursive: true }); registered = true
      current = argv[2] === '-b' ? argv[3]! : argv.at(-1)!
      return { status: 0, stdout: '', stderr: '' }
    }
    if (argv[0] === 'show-ref') return { status: refs.has(argv.at(-1)!) ? 0 : 1, stdout: '', stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  })
  const run = (operation: Record<string, unknown>) => {
    let output = ''
    const process = { argv: ['node', Buffer.from(JSON.stringify({ projectPath: project, conversation: 'conversation', baseBranch: 'dev', defaultBranch: 'make/test', ...operation })).toString('base64')],
      env: {}, exitCode: 0, stdout: { write: (chunk: string) => { output += chunk } } }
    vm.runInNewContext(STAND_WORKSPACE_PROGRAM, { require: (id: string) => id === 'node:fs' ? fs : id === 'node:path' ? path : { spawnSync }, Buffer, process })
    return { ...JSON.parse(output), exitCode: process.exitCode }
  }
  const prepare = () => run({ action: 'prepare' })
  return { dir, project, root, spawnSync, refs, run, prepare }
}

describe('agent worktree program', () => {
  it('fetches origin then adds a worktree using argv from the remote base', () => {
    const f = fixture()
    expect(f.prepare()).toMatchObject({ exitCode: 0, root: f.root, branch: 'make/test' })
    expect(f.spawnSync.mock.calls[0]?.[1]).toEqual(['fetch', 'origin'])
    expect(f.spawnSync).toHaveBeenCalledWith('git', ['worktree', 'add', '-b', 'make/test', '--', f.root, 'origin/dev'], expect.objectContaining({ cwd: f.project, shell: false }))
    expect(fs.existsSync(f.project)).toBe(true)
  })

  it('reuses the conversation worktree and refuses a different branch request', () => {
    const f = fixture(); f.prepare(); f.spawnSync.mockClear()
    expect(f.run({ action: 'prepare', newBranch: 'make/test' })).toMatchObject({ exitCode: 0, branch: 'make/test' })
    expect(f.spawnSync.mock.calls.some(([, argv]) => argv[0] === 'worktree' && argv[1] === 'add')).toBe(false)
    expect(f.run({ action: 'prepare', branch: 'existing' })).toMatchObject({ exitCode: 1, error: 'operation_conflict' })
  })

  it.each(['existing', 'remote'])('refuses a taken new branch %s', newBranch => {
    const f = fixture()
    expect(f.run({ action: 'prepare', newBranch })).toMatchObject({ exitCode: 1, error: 'branch_exists' })
    expect(fs.existsSync(f.root)).toBe(false)
  })

  it.each(['existing', 'remote'])('attaches an existing branch %s', branch => {
    const f = fixture()
    expect(f.run({ action: 'prepare', branch })).toMatchObject({ exitCode: 0, branch })
    expect(f.spawnSync).toHaveBeenCalledWith('git', branch === 'existing' ? ['worktree', 'add', '--', f.root, branch] : ['worktree', 'add', '-b', branch, '--', f.root, 'origin/' + branch], expect.any(Object))
  })

  it.each([{ branch: 'missing' }, { baseBranch: 'missing' }])('rejects missing refs %j', operation => {
    const f = fixture()
    expect(f.run({ action: 'prepare', ...operation })).toMatchObject({ exitCode: 1, error: 'branch_not_found' })
  })

  it('keeps shell metacharacters in argv, never evaluates them', () => {
    const f = fixture(), newBranch = 'make/$(touch-owned)'
    expect(f.run({ action: 'prepare', newBranch })).toMatchObject({ exitCode: 0, branch: newBranch })
    expect(f.spawnSync).toHaveBeenCalledWith('git', ['worktree', 'add', '-b', newBranch, '--', f.root, 'origin/dev'], expect.objectContaining({ shell: false }))
  })

  it('checks existing files and missing write targets against the real worktree', () => {
    const f = fixture(); f.prepare(); fs.writeFileSync(path.join(f.root, 'a'), 'hello')
    expect(f.run({ action: 'check', relative: 'a' })).toMatchObject({ exitCode: 0, target: path.join(f.root, 'a') })
    expect(f.run({ action: 'check', relative: 'new/deep/file', allowMissing: true })).toMatchObject({ exitCode: 0, target: path.join(f.root, 'new/deep/file') })
    expect(f.run({ action: 'check', relative: 'missing' })).toMatchObject({ exitCode: 1, error: 'path_outside_working_copy' })
  })

  it.each(['../secret', '/etc/passwd', '.git', 'nested/.git/config', 'nested/../../secret', 'nested\\secret'])('rejects traversal or metadata %s', relative => {
    const f = fixture(); f.prepare()
    expect(f.run({ action: 'check', relative, allowMissing: true })).toMatchObject({ exitCode: 1, error: 'path_outside_working_copy' })
  })

  it('rejects file, parent, dangling and metadata symlinks', () => {
    const f = fixture(); f.prepare()
    fs.writeFileSync(path.join(f.dir, 'secret'), 'secret')
    fs.writeFileSync(path.join(f.root, '.git'), 'gitdir: secret')
    fs.symlinkSync(path.join(f.dir, 'secret'), path.join(f.root, 'file-link'))
    fs.symlinkSync(f.dir, path.join(f.root, 'parent-link'))
    fs.symlinkSync(path.join(f.dir, 'missing'), path.join(f.root, 'dangling'))
    fs.symlinkSync(path.join(f.root, '.git'), path.join(f.root, 'metadata'))
    for (const relative of ['file-link', 'parent-link/new', 'dangling', 'metadata'])
      expect(f.run({ action: 'check', relative, allowMissing: true })).toMatchObject({ exitCode: 1, error: 'path_outside_working_copy' })
  })

  it('rejects a symlinked worktree parent before git or mkdir', () => {
    const f = fixture(); fs.symlinkSync(f.project, path.dirname(f.root))
    expect(f.prepare()).toMatchObject({ error: 'path_outside_working_copy' })
    expect(f.spawnSync).not.toHaveBeenCalled()
  })

  it('refuses an unregistered directory and files over 2 MiB', () => {
    const f = fixture(); fs.mkdirSync(f.root, { recursive: true })
    expect(f.run({ action: 'check', relative: '.' })).toMatchObject({ error: 'path_outside_working_copy' })
    fs.rmdirSync(f.root); f.prepare()
    fs.writeFileSync(path.join(f.root, 'large'), Buffer.alloc(2 * 1024 * 1024 + 1))
    expect(f.run({ action: 'check', relative: 'large' })).toMatchObject({ error: 'file_too_large' })
  })

  it('validates conversation IDs before computing a worktree', () => {
    expect(conversationWorktree('/work/ui', 'abc-123')).toBe('/work/make-worktrees/abc-123')
    expect(() => conversationWorktree('/work/ui', '../../secret')).toThrow('path_outside_working_copy')
  })
})

it('scoped Git retains original authorization and rechecks it on every operation', async () => {
  const source = new GitWorkspaceService({} as GitWorkspaceDeps)
  const resolve = vi.spyOn(source, 'resolve').mockResolvedValue({ path: '/shared', writable: true, agentId: 'machine' } as never)
  const scoped = source.atWorkingCopy('alice', 'project', 'workspace', '/worktree')
  expect(await scoped.resolve('alice', 'project', 'workspace', { write: true })).toMatchObject({ path: '/worktree', writable: true })
  expect(resolve).toHaveBeenCalledWith('alice', 'project', 'workspace', { write: true })
  await expect(scoped.resolve('bob', 'project', 'workspace', { write: false })).rejects.toMatchObject({ status: 403 })
  resolve.mockRejectedValueOnce(new Error('permission revoked'))
  await expect(scoped.resolve('alice', 'project', 'workspace', { write: true })).rejects.toThrow('permission revoked')
})
