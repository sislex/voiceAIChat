import { runInNewContext } from 'node:vm'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { STAND_DELIVERY_PROGRAM } from './standDeliveryAgent.js'

function run(action: 'head' | 'sync', options: { conflict?: boolean; fetchFails?: boolean; dirty?: boolean; escape?: boolean } = {}) {
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
    const stdout = command === 'rev-parse --show-toplevel' ? root
      : command === 'rev-parse --git-common-dir' ? '/repos/core-ui/.git'
      : command === 'remote get-url origin' ? 'git@github.com:sislex/core-ui.git'
      : command === 'symbolic-ref --short HEAD' ? 'make/test'
      : command === 'rev-parse --verify HEAD^{commit}' ? 'a'.repeat(40)
      : args[0] === 'diff' ? options.conflict ? 'src/a.ts\0file with spaces\0' : ''
      : args[0] === 'rev-list' ? options.conflict ? '3\n' : '0\n' : ''
    return { status: (args[0] === 'fetch' && options.fetchFails) || (args[0] === 'merge' && (options.conflict || options.dirty)) ? 1 : 0, stdout }
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
it('stops on fetch failure and distinguishes dirty-tree errors from merge conflicts', () => {
  const failed = run('sync', { fetchFails: true })
  expect(failed.exitCode).toBe(1)
  expect(failed.calls.some(args => args[0] === 'merge')).toBe(false)
  expect(run('sync', { dirty: true }).result).toEqual({ error: 'stand_merge_failed' })
})
it('rejects a symlink outside the allowed root before invoking git', () => {
  const r = run('sync', { escape: true })
  expect(r.result).toEqual({ error: 'stand_path_forbidden' })
  expect(r.calls).toEqual([])
})
