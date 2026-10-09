import path from 'node:path'
import type { MachinesService } from '../machines/service.js'
import { shellQuote } from '../util/shell.js'

export type StandMachines = Pick<MachinesService, 'exec' | 'isOnline' | 'nameOf' | 'fsList' | 'fsRead' | 'fsWrite' | 'fsDeleteFileSafe' | 'fsRename'>
/**
 * Conversation worktrees live under the stand host project's `reposRoot`: Kanban admits live
 * working copies (and their Git common directory) only inside that machine's path or reposRoot.
 */
export function conversationWorktree(reposRoot: string, conversation: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(conversation) || !path.posix.isAbsolute(reposRoot) || reposRoot === '/') throw new Error('path_outside_working_copy')
  return path.posix.join(path.posix.resolve(reposRoot), 'make-worktrees', conversation)
}
/** Base clone of the component repository inside the host reposRoot, e.g. `sislex/sislexa-core-ui` → `sislexa-core-ui`. */
export function componentClone(repository: string): { url: string; name: string } {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('component_not_in_stand')
  return { url: 'https://github.com/' + repository + '.git', name: repository.split('/')[1]! }
}

// The exec transport is a shell string. Only a fixed program and base64 JSON
// cross it; Git receives argv with shell disabled.
export const STAND_WORKSPACE_PROGRAM = String.raw`
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const a = JSON.parse(Buffer.from(process.argv[1], 'base64').toString());
const fail = code => { throw new Error(code) };
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const git = (cwd, args, optional = false) => {
  const r = cp.spawnSync('git', args, { cwd, shell: false, encoding: 'utf8', timeout: 240000,
    maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (r.error) fail('machine_unavailable');
  if (r.status !== 0 && !optional) {
    const s = r.stderr || '';
    fail(/already exists/.test(s) ? 'branch_exists' : /invalid reference|not a valid|couldn't find remote ref/.test(s) ? 'branch_not_found' : 'operation_conflict');
  }
  return { ok: r.status === 0, output: (r.stdout || '').trim() };
};
try {
  if (!path.isAbsolute(a.reposRoot) || !/^[a-zA-Z0-9_-]+$/.test(a.conversation) || !/^[A-Za-z0-9_.-]+$/.test(a.repoName) || a.repoName === '.' || a.repoName === '..' || a.repoName === 'make-worktrees') fail('path_outside_working_copy');
  if (a.action === 'prepare') fs.mkdirSync(a.reposRoot, { recursive: true });
  const repos = fs.realpathSync(a.reposRoot);
  if (repos !== path.resolve(a.reposRoot)) fail('path_outside_working_copy');
  const project = path.join(repos, a.repoName);
  const parent = path.join(repos, 'make-worktrees');
  const root = path.join(parent, a.conversation);
  if (fs.existsSync(parent) && fs.realpathSync(parent) !== parent) fail('path_outside_working_copy');
  if (fs.existsSync(project) && fs.realpathSync(project) !== project) fail('path_outside_working_copy');
  let result;
  if (a.action === 'prepare') {
    if (!fs.existsSync(path.join(project, '.git'))) {
      if (fs.existsSync(project)) fail('operation_conflict');
      git(repos, ['clone', '--no-checkout', '--', a.repositoryUrl, project]);
    }
    if (git(project, ['remote', 'get-url', 'origin']).output.replace(/\.git$/, '') !== a.repositoryUrl.replace(/\.git$/, '')) fail('operation_conflict');
    git(project, ['fetch', 'origin']);
    const list = git(project, ['worktree', 'list', '--porcelain']).output.split('\n\n');
    const existing = list.find(x => x.split('\n').includes('worktree ' + root));
    if (existing) {
      if (fs.realpathSync(root) !== root) fail('path_outside_working_copy');
      const branch = existing.split('\n').find(x => x.startsWith('branch refs/heads/'))?.slice(18);
      if (!branch || (a.branch && a.branch !== branch) || (a.newBranch && a.newBranch !== branch)) fail('operation_conflict');
      result = { root, branch };
    } else {
      if (fs.existsSync(root)) fail('operation_conflict');
      const branch = a.branch || a.newBranch || a.defaultBranch;
      if (!git(project, ['check-ref-format', '--branch', branch], true).ok) fail('branch_not_found');
      const local = git(project, ['show-ref', '--verify', '--quiet', 'refs/heads/' + branch], true).ok;
      const remote = git(project, ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/' + branch], true).ok;
      if (!a.branch && (local || remote)) fail('branch_exists');
      fs.mkdirSync(parent, { recursive: true });
      if (a.branch) {
        if (!local && !remote) fail('branch_not_found');
        git(project, local ? ['worktree', 'add', '--', root, branch] : ['worktree', 'add', '-b', branch, '--', root, 'origin/' + branch]);
      } else {
        if (!git(project, ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/' + a.baseBranch], true).ok) fail('branch_not_found');
        git(project, ['worktree', 'add', '-b', branch, '--', root, 'origin/' + a.baseBranch]);
      }
      result = { root, branch };
    }
  } else {
    if (!fs.existsSync(path.join(project, '.git'))) fail('path_outside_working_copy');
    if (fs.realpathSync(root) !== root) fail('path_outside_working_copy');
    if (!git(project, ['worktree', 'list', '--porcelain']).output.split('\n').includes('worktree ' + root)) fail('path_outside_working_copy');
    const relative = a.relative || '.';
    if (path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p => p === '..' || p.toLowerCase() === '.git')) fail('path_outside_working_copy');
    const target = path.resolve(root, relative);
    if (!inside(root, target)) fail('path_outside_working_copy');
    // Reject symlinks even when they currently resolve inside the worktree:
    // this also prevents aliases to its protected .git metadata.
    let segment = root;
    for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
      segment = path.join(segment, part);
      try { if (fs.lstatSync(segment).isSymbolicLink()) fail('path_outside_working_copy') }
      catch (e) { if (e.code !== 'ENOENT' || !a.allowMissing) throw e }
    }
    let cursor = target;
    while (true) {
      try { fs.lstatSync(cursor); break } catch (e) { if (e.code !== 'ENOENT' || !a.allowMissing) throw e; cursor = path.dirname(cursor) }
    }
    if (!inside(root, fs.realpathSync(cursor))) fail('path_outside_working_copy');
    const stat = fs.existsSync(target) ? fs.statSync(target) : null;
    if (stat?.isFile() && stat.size > 2 * 1024 * 1024) fail('file_too_large');
    result = { root, target, directory: stat?.isDirectory() || false };
  }
  process.stdout.write(JSON.stringify(result));
} catch (e) { process.stdout.write(JSON.stringify({ error: e.code === 'ENOENT' ? 'path_outside_working_copy' : e.message })); process.exitCode = 1; }
`

export async function workspaceCommand(machines: StandMachines, user: string, agent: string, args: Record<string, unknown>): Promise<{ root: string; target: string; branch: string; directory: boolean }> {
  const payload = Buffer.from(JSON.stringify(args)).toString('base64')
  const result = await machines.exec(agent, 'node -e ' + shellQuote(STAND_WORKSPACE_PROGRAM) + ' ' + shellQuote(payload), 300_000, undefined, { source: 'console', userId: user })
    .catch(() => { throw new Error('machine_unavailable') })
  let value: { root: string; target: string; branch: string; directory: boolean; error?: string }
  try { value = JSON.parse(result.output) } catch { throw new Error('machine_unavailable') }
  if (value.error) throw new Error(value.error)
  if (result.exitCode !== 0 || result.timedOut) throw new Error('machine_unavailable')
  return value
}
