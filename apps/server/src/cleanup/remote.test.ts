import { afterEach, beforeEach, expect, it } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TemporaryResource } from '@voicechat/shared'
import { RESOURCE_HELPER } from './remote.js'

let root: string
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'cleanup-fs-'))) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim()
function resource(category: TemporaryResource['category'] = 'process', name = 'owned'): TemporaryResource {
  return { id: name, projectId: 'p', taskId: 't', runId: 'r', userId: 'u', machineId: 'm', machineName: 'MacBook', root, path: join(root,name), category, generation: 'g', identity: null, gitCommonDir: null, gitRegistration: null, createdAt: 1, state: 'registered' }
}
function call(r: TemporaryResource, mode: string, admission = true) {
  return JSON.parse(execFileSync('python3', ['-c', RESOURCE_HELPER, JSON.stringify({ resource: r, mode, nonce: 'test' })], { encoding: 'utf8', env: { ...process.env, VC_CLEANUP_ADMISSION: admission ? 'test' : '' } }))
}
function create(r: TemporaryResource): void { const result = call(r,'create'); expect(result.reasons).toEqual([]); r.identity = result.identity }
function repository(): TemporaryResource {
  const origin=join(root,'origin.git'); mkdirSync(origin); git(origin,'init','--bare')
  const r=resource('task-environment'); create(r)
  git(root,'clone',origin,r.path); git(r.path,'checkout','-b','main')
  writeFileSync(join(r.path,'file.txt'),'saved'); git(r.path,'add','.'); git(r.path,'commit','-m','saved'); git(r.path,'push','origin','main')
  return r
}
// @testCase TC-01
it('deletes an owned temporary directory and preserves its external results', () => {
  const r=resource(); create(r); writeFileSync(join(r.path,'temporary'),'scratch')
  const report=join(root,'report.json'); writeFileSync(report,'saved result')
  r.resultsPath=join(root,'.voicechat-cleanup-results',r.id)
  writeFileSync(join(r.path,'diagnostic.log'),'diagnostic result')
  expect(call(r,'remove')).toMatchObject({ outcome:'deleted', present:true })
  expect(existsSync(r.path)).toBe(false); expect(readFileSync(report,'utf8')).toBe('saved result')
  expect(readFileSync(join(r.resultsPath!,'diagnostic.log'),'utf8')).toBe('diagnostic result')
  expect(call(r,'remove')).toMatchObject({ outcome:'absent', freedBytes:0 })
})
// @testCase TC-01
it('bootstraps a configured missing storage root without adopting existing resources', () => {
  const r = resource()
  r.root = join(root, 'new-storage'); r.path = join(r.root, 'owned')
  create(r)
  expect(existsSync(r.path)).toBe(true)
  expect(call(r, 'remove').outcome).toBe('deleted')
  expect(existsSync(r.root)).toBe(true)
})
// @testCase TC-04
it('rejects foreign directories, escapes, symlinks, replaced ancestors and excluded data', () => {
  const foreign=resource('process','foreign'); mkdirSync(foreign.path); writeFileSync(join(foreign.path,'keep'),'foreign')
  expect(call(foreign,'create').reasons).toContain('existing_resource_unconfirmed')
  expect(call({...foreign,path:join(root,'..','outside')},'remove').reasons.length).toBeGreaterThan(0)
  const r=resource(); create(r)
  renameSync(r.path,r.path+'-old'); symlinkSync(foreign.path,r.path)
  expect(call(r,'remove').outcome).toBe('deferred')
  expect(readFileSync(join(foreign.path,'keep'),'utf8')).toBe('foreign')
  const nested=resource('process','parent/child'); create(nested)
  renameSync(join(root,'parent'),join(root,'parent-old')); symlinkSync(foreign.path,join(root,'parent'))
  expect(call(nested,'remove').outcome).toBe('deferred')
  const db=resource('process','database'); create(db); writeFileSync(join(db.path,'user.sqlite'),'data')
  expect(call(db,'remove').reason).toBe('excluded_data')
  expect(existsSync(join(db.path,'user.sqlite'))).toBe(true)
})
// @testCase TC-05
it.each(['dirty','staged','untracked','unpublished'] as const)('preserves %s Git work regardless of retention', variant => {
  const r=repository()
  writeFileSync(join(r.path, variant==='untracked'?'new.txt':'file.txt'),'local work')
  if(variant==='staged'||variant==='unpublished')git(r.path,'add','.')
  if(variant==='unpublished')git(r.path,'commit','-m','unpublished')
  const result=call(r,'remove')
  expect(result.reason).toBe(variant==='unpublished'?'unpublished_commits':'git_changes')
  expect(existsSync(r.path)).toBe(true)
})
// @testCase TC-04
it('preserves ignored user data whose temporary purpose is unconfirmed', () => {
  const r = repository()
  writeFileSync(join(r.path, '.gitignore'), '.env\n')
  git(r.path, 'add', '.gitignore'); git(r.path, 'commit', '-m', 'ignore secrets'); git(r.path, 'push', 'origin', 'main')
  writeFileSync(join(r.path, '.env'), 'USER_DATA=keep')
  expect(call(r, 'remove').reason).toBe('ignored_data_unconfirmed')
  expect(readFileSync(join(r.path, '.env'), 'utf8')).toBe('USER_DATA=keep')
})
// @testCase TC-05
it('preserves unpublished commits recoverable only from the reflog', () => {
  const r = repository()
  writeFileSync(join(r.path, 'file.txt'), 'recoverable work')
  git(r.path, 'add', '.'); git(r.path, 'commit', '-m', 'recoverable work')
  const sha = git(r.path, 'rev-parse', 'HEAD')
  git(r.path, 'reset', '--hard', 'HEAD~1')
  expect(call(r, 'remove').reason).toBe('unpublished_commits')
  expect(git(r.path, 'reflog', '--format=%H')).toContain(sha)
})
// @testCase TC-05
it('removes only a published worktree and its exact Git registration', () => {
  const repo=repository(), wt=resource('merge-worktree','worktree'); create(wt)
  git(repo.path,'worktree','add','--detach',wt.path,'HEAD')
  Object.assign(wt, { gitCommonDir:null, gitRegistration:null })
  const bound=call(wt,'bind')
  wt.gitCommonDir=bound.gitCommonDir; wt.gitRegistration=bound.gitRegistration; wt.gitRegistrationIdentity=bound.gitRegistrationIdentity
  const other=join(root,'other'); git(repo.path,'worktree','add','--detach',other,'HEAD')
  const inspected=call(wt,'inspect'); expect(inspected.reasons).toEqual([])
  expect(call(wt,'remove').outcome).toBe('deleted')
  const list=git(repo.path,'worktree','list','--porcelain')
  expect(list).not.toContain(wt.path); expect(list).toContain(other)
  expect(existsSync(repo.path)).toBe(true)
})
// @testCase TC-05
it('respects an explicit Git worktree lock as a consumer', () => {
  const repo = repository(), wt = resource('merge-worktree', 'locked'); create(wt)
  git(repo.path, 'worktree', 'add', '--detach', wt.path, 'HEAD')
  const bound = call(wt, 'bind')
  wt.gitCommonDir = bound.gitCommonDir; wt.gitRegistration = bound.gitRegistration; wt.gitRegistrationIdentity = bound.gitRegistrationIdentity
  git(repo.path, 'worktree', 'lock', wt.path)
  expect(call(wt, 'remove').reason).toBe('worktree_locked')
  expect(existsSync(wt.path)).toBe(true)
})
// @testCase TC-05
it('reconciles a missing registered worktree without pruning unrelated registrations', () => {
  const repo=repository(), wt=resource('merge-worktree','missing'); create(wt)
  git(repo.path,'worktree','add','--detach',wt.path,'HEAD')
  const bound=call(wt,'bind')
  wt.gitCommonDir=bound.gitCommonDir; wt.gitRegistration=bound.gitRegistration; wt.gitRegistrationIdentity=bound.gitRegistrationIdentity
  const other=join(root,'other'); git(repo.path,'worktree','add','--detach',other,'HEAD')
  rmSync(wt.path,{recursive:true}); rmSync(other,{recursive:true})
  expect(call(wt,'remove')).toMatchObject({outcome:'absent',freedBytes:0,reasons:[]})
  expect(git(repo.path,'worktree','list','--porcelain')).toContain(other)
  expect(call(wt,'remove')).toMatchObject({outcome:'absent',freedBytes:0,reasons:[]})
})
// @testCase TC-01
it('removes a clean published task environment while keeping origin history', () => {
  const r = repository(), sha = git(r.path, 'rev-parse', 'HEAD')
  expect(call(r, 'remove').outcome).toBe('deleted')
  expect(existsSync(r.path)).toBe(false)
  expect(git(join(root, 'origin.git'), 'rev-parse', 'refs/heads/main')).toBe(sha)
})
// @testCase TC-05
it.each(['head', 'reflog'])('retains unpublished %s history of an absent worktree', variant => {
  const repo = repository(), wt = resource('merge-worktree', 'unpublished-missing'); create(wt)
  git(repo.path, 'worktree', 'add', '--detach', wt.path, 'HEAD')
  const bound = call(wt, 'bind')
  wt.gitCommonDir = bound.gitCommonDir; wt.gitRegistration = bound.gitRegistration; wt.gitRegistrationIdentity = bound.gitRegistrationIdentity
  writeFileSync(join(wt.path, 'file.txt'), 'unpublished')
  git(wt.path, 'add', '.'); git(wt.path, 'commit', '-m', 'only detached work')
  const sha = git(wt.path, 'rev-parse', 'HEAD')
  if (variant === 'reflog') git(wt.path, 'reset', '--hard', 'HEAD~1')
  rmSync(wt.path, { recursive: true })
  expect(call(wt, 'remove').reason).toBe('unpublished_commits')
  expect(existsSync(wt.gitRegistration!)).toBe(true)
  expect(git(wt.gitRegistration!, '--git-dir=.', '--work-tree=.', 'reflog', '--format=%H', 'HEAD', '--')).toContain(sha)
})
// @testCase TC-06
it('retains diagnostics when an existing archive cannot be verified', () => {
  const r = resource(); create(r)
  r.resultsPath = join(root, '.voicechat-cleanup-results', r.id)
  mkdirSync(r.resultsPath, { recursive: true })
  writeFileSync(join(r.resultsPath, 'diagnostic.log'), 'conflicting archive')
  writeFileSync(join(r.path, 'diagnostic.log'), 'result to preserve')
  expect(call(r, 'remove').reason).toBe('diagnostic_archive_conflict')
  expect(readFileSync(join(r.path, 'diagnostic.log'), 'utf8')).toBe('result to preserve')
})
// @testCase TC-03
it('requires actual process exit even when application ownership is terminal', async () => {
  const r = resource(); create(r)
  const child = spawn('sleep', ['30'], { cwd: r.path, stdio: 'ignore' })
  await once(child, 'spawn')
  try {
    expect(call(r, 'remove').reason).toBe('active_process')
    expect(existsSync(r.path)).toBe(true)
  } finally {
    const closed = once(child, 'close'); child.kill('SIGTERM'); await closed
  }
  expect(call(r, 'remove').outcome).toBe('deleted')
})
// @testCase TC-04
it('cannot redirect deletion through an ancestor replaced after final checks', () => {
  const r = resource('process', 'parent/owned'); create(r)
  const foreign = join(root, 'foreign'); mkdirSync(foreign); mkdirSync(join(foreign, 'owned'))
  writeFileSync(join(foreign, 'owned', 'keep'), 'foreign')
  const instrumented = RESOURCE_HELPER.replace('        deleting=True', `        os.rename(os.path.dirname(path),os.path.dirname(path)+'-old')
        os.symlink(${JSON.stringify(foreign)},os.path.dirname(path))
        deleting=True`)
  const result = JSON.parse(execFileSync('python3', ['-c', instrumented, JSON.stringify({ resource: r, mode: 'remove', nonce: 'test' })], { encoding: 'utf8', env: { ...process.env, VC_CLEANUP_ADMISSION: 'test' } }))
  expect(result.outcome).toBe('partial')
  expect(result.freedBytes).toBeNull()
  expect(readFileSync(join(foreign, 'owned', 'keep'), 'utf8')).toBe('foreign')
})
// @testCase TC-07
it('does not mutate during preview and requires the agent admission handshake for removal', () => {
  const r=resource(); create(r); writeFileSync(join(r.path,'file'),'keep')
  const before=readFileSync(join(r.path,'file'),'utf8')
  expect(call(r,'inspect')).toMatchObject({reasons:[],present:true})
  expect(readFileSync(join(r.path,'file'),'utf8')).toBe(before)
  expect(call(r,'remove',false).reason).toBe('agent_cleanup_admission_unavailable')
  expect(existsSync(r.path)).toBe(true)
})
