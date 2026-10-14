import { runInNewContext } from 'node:vm'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { STAND_DELIVERY_PROGRAM, standDeliveryCommand } from './standDeliveryAgent.js'

function run(action: 'head' | 'sync', options: { conflict?: boolean; fetchFails?: boolean; mergeFails?: boolean; status?: string; timeoutOn?: string; escape?: boolean } = {}) {
  const calls: string[][] = []
  const root = '/repos/make-worktrees/conversation'
  let output = ''
  const process = { argv: ['node', Buffer.from(JSON.stringify({ action, root, allowedRoot: '/repos', repository: 'sislex/core-ui', branch: 'make/test' })).toString('base64')],
    env: {}, exitCode: 0, stdout: { write: (text: string) => { output += text } } }
  const spawnSync = vi.fn((_command: string, args: string[], opts: { cwd: string; shell: boolean }) => {
    expect(opts.cwd).toBe(root)
    expect(opts.shell).toBe(false)
    calls.push(args)
    const command = args.join(' ')
    if (options.timeoutOn && args[0] === options.timeoutOn) return { status: null, stdout: '', error: Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' }) }
    const stdout = command === 'rev-parse --show-toplevel' ? root
      : command === 'rev-parse --git-common-dir' ? '/repos/core-ui/.git'
      : command === 'remote get-url origin' ? 'git@github.com:sislex/core-ui.git'
      : command === 'symbolic-ref --short HEAD' ? 'make/test'
      : command === 'rev-parse --verify HEAD^{commit}' ? 'a'.repeat(40)
      : args[0] === 'status' ? options.status ?? ''
      : args[0] === 'diff' ? options.conflict ? 'src/a.ts\0file with spaces\0' : ''
      : args[0] === 'rev-list' ? options.conflict ? '3\n' : '0\n' : ''
    return { status: (args[0] === 'fetch' && options.fetchFails) || (args[0] === 'merge' && (options.conflict || options.mergeFails)) ? 1 : 0, stdout }
  })
  runInNewContext(STAND_DELIVERY_PROGRAM, { Buffer, process, require: (name: string) => {
    if (name === 'node:path') return path.posix
    if (name === 'node:fs') return { realpathSync: (value: string) => options.escape && value === root ? '/outside' : value }
    if (name === 'node:child_process') return { spawnSync }
    throw new Error(name)
  } })
  return { calls, result: JSON.parse(output), exitCode: process.exitCode }
}

it('submits an exact HEAD without fetching or pushing', () => {
  const r = run('head')
  expect(r.result).toEqual({ headSha: 'a'.repeat(40) })
  expect(r.calls.some(args => ['push', 'fetch', 'merge'].includes(args[0]!))).toBe(false)
})
it.each([false, true])('fetches then merges dev and preserves conflicts=%s', conflict => {
  const r = run('sync', { conflict })
  expect(r.result).toEqual({ merged: !conflict, behind: conflict ? 3 : 0, conflicts: conflict ? ['src/a.ts', 'file with spaces'] : [] })
  expect(r.calls.indexOf(r.calls.find(args => args[0] === 'fetch')!)).toBeLessThan(r.calls.indexOf(r.calls.find(args => args[0] === 'merge')!))
  expect(r.calls).toContainEqual(['merge', '--no-edit', 'origin/dev'])
  expect(r.calls.some(args => ['reset', 'checkout', 'clean', 'push'].includes(args[0]!) || args.includes('--abort'))).toBe(false)
})
it('stops on fetch failure with a specific code and distinguishes merge failures from conflicts', () => {
  const failed = run('sync', { fetchFails: true })
  expect(failed.exitCode).toBe(1)
  expect(failed.result).toEqual({ error: 'stand_fetch_failed' })
  expect(failed.calls.some(args => args[0] === 'merge')).toBe(false)
  expect(run('sync', { mergeFails: true }).result).toEqual({ error: 'stand_merge_failed' })
})
it('refuses a dirty working tree before fetching or merging', () => {
  const r = run('sync', { status: ' M src/a.ts\n' })
  expect(r.result).toEqual({ error: 'stand_worktree_dirty' })
  expect(r.calls).toContainEqual(['status', '--porcelain', '--untracked-files=no'])
  expect(r.calls.some(args => ['fetch', 'merge'].includes(args[0]!))).toBe(false)
})
it('keeps reporting conflicts of a previous sync instead of a dirty tree', () => {
  const r = run('sync', { status: 'UU src/a.ts\n', conflict: true })
  expect(r.result).toEqual({ merged: false, behind: 3, conflicts: ['src/a.ts', 'file with spaces'] })
})
it('maps a git spawn timeout to stand_git_timeout', () => {
  expect(run('sync', { timeoutOn: 'fetch' }).result).toEqual({ error: 'stand_git_timeout' })
})
it('rejects a symlink outside the allowed root before invoking git', () => {
  const r = run('sync', { escape: true })
  expect(r.result).toEqual({ error: 'stand_path_forbidden' })
  expect(r.calls).toEqual([])
})

describe('standDeliveryCommand error mapping', () => {
  const workspace = { agentId: 'agent', root: '/repos/w', allowedRoot: '/repos', repository: 'sislex/core-ui' }
  const machines = (exec: () => Promise<{ exitCode: number; timedOut: boolean; output: string }>) => ({ exec: vi.fn(exec) }) as never
  const failure = async (exec: () => Promise<{ exitCode: number; timedOut: boolean; output: string }>) =>
    standDeliveryCommand(machines(exec), 'alice', workspace, { action: 'sync' }).then(() => { throw new Error('resolved') },
      (error: Error & { statusCode?: number }) => ({ code: error.message, status: error.statusCode }))

  it('reports an agent timeout before parsing partial output', async () => {
    expect(await failure(async () => ({ exitCode: -1, timedOut: true, output: '{"mer' }))).toEqual({ code: 'stand_agent_timeout', status: 504 })
  })
  it('reports a dropped agent as machine_unavailable', async () => {
    expect(await failure(async () => { throw new Error('agent disconnected') })).toEqual({ code: 'machine_unavailable', status: 409 })
  })
  it.each([
    ['stand_worktree_dirty', 409], ['stand_fetch_failed', 409], ['stand_git_timeout', 504], ['stand_merge_failed', 409], ['unknown', 409]
  ])('passes the agent program code %s through', async (code, status) => {
    expect(await failure(async () => ({ exitCode: 1, timedOut: false, output: JSON.stringify({ error: code }) })))
      .toEqual({ code: code === 'unknown' ? 'stand_git_failed' : code, status })
  })
  it('keeps invalid output as invalid_stand_agent_response', async () => {
    expect(await failure(async () => ({ exitCode: 0, timedOut: false, output: 'not json' }))).toEqual({ code: 'invalid_stand_agent_response', status: 502 })
  })
})
