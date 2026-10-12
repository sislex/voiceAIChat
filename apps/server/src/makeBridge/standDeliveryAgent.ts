import { z } from 'zod'
import { shellQuote } from '../util/shell.js'
import type { StandMachines } from './standWorkspace.js'
import type { StandSyncResult } from '@voicechat/shared'

// Fixed program; paths and refs travel as JSON, never shell source.
export const STAND_DELIVERY_PROGRAM = String.raw`
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const a = JSON.parse(Buffer.from(process.argv[1], 'base64').toString());
const fail = error => { throw new Error(error) };
const git = (args, optional = false) => {
  const r = cp.spawnSync('git', args, { cwd: a.root, shell: false, encoding: 'utf8',
    timeout: 60000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no' } });
  if (r.error) fail('stand_git_unavailable');
  if (r.status !== 0 && !optional) fail('stand_git_failed');
  return { ok: r.status === 0, output: r.stdout || '' };
};
const repo = value => value.trim().replace(/^git@github.com:/, '').replace(/^https?:\/\/github.com\//, '').replace(/^ssh:\/\/git@github.com\//, '').replace(/\.git\/?$/, '').replace(/\/$/, '').toLowerCase();
try {
  if (!path.isAbsolute(a.root) || !path.isAbsolute(a.allowedRoot)) fail('stand_path_forbidden');
  const root = fs.realpathSync(a.root), allowed = fs.realpathSync(a.allowedRoot);
  if (root !== path.resolve(a.root) || !(root === allowed || root.startsWith(allowed + path.sep))) fail('stand_path_forbidden');
  if (fs.realpathSync(git(['rev-parse', '--show-toplevel']).output.trim()) !== root) fail('stand_path_forbidden');
  const common = fs.realpathSync(path.resolve(root, git(['rev-parse', '--git-common-dir']).output.trim()));
  if (!(common === allowed || common.startsWith(allowed + path.sep))) fail('stand_path_forbidden');
  if (repo(git(['remote', 'get-url', 'origin']).output) !== a.repository.toLowerCase()) fail('stand_repository_mismatch');
  const branch = git(['symbolic-ref', '--short', 'HEAD']).output.trim();
  if (a.branch && branch !== a.branch) fail('stand_branch_mismatch');
  let result;
  if (a.action === 'head') {
    git(['check-ref-format', '--branch', a.branch]);
    result = { headSha: git(['rev-parse', '--verify', 'HEAD^{commit}']).output.trim() };
  } else {
    git(['fetch', 'origin']);
    const merge = git(['merge', '--no-edit', 'origin/dev'], true);
    const conflicts = git(['diff', '--name-only', '--diff-filter=U', '-z']).output.split('\0').filter(Boolean);
    if (!merge.ok && !conflicts.length) fail('stand_merge_failed');
    const behind = Number(git(['rev-list', '--count', 'HEAD..origin/dev']).output.trim());
    result = { merged: merge.ok, behind, conflicts };
  }
  process.stdout.write(JSON.stringify(result));
} catch (e) { process.stdout.write(JSON.stringify({ error: e.message })); process.exitCode = 1; }
`

const head = z.object({ headSha: z.string().regex(/^[a-f0-9]{40,64}$/) })
const sync = z.object({ merged: z.boolean(), behind: z.number().int().nonnegative(), conflicts: z.array(z.string()) })
export interface StandDeliveryWorkspace { agentId: string; root: string; allowedRoot: string; repository: string }
export async function standDeliveryCommand(
  machines: Pick<StandMachines, 'exec'>, user: string, workspace: StandDeliveryWorkspace,
  operation: { action: 'head'; branch: string } | { action: 'sync' }
): Promise<{ headSha: string } | StandSyncResult> {
  const payload = Buffer.from(JSON.stringify({ ...workspace, ...operation })).toString('base64')
  const result = await machines.exec(workspace.agentId,
    'node -e ' + shellQuote(STAND_DELIVERY_PROGRAM) + ' ' + shellQuote(payload),
    300_000, undefined, { source: 'console', userId: user })
  let value: unknown
  try { value = JSON.parse(result.output) } catch { throw Object.assign(new Error('invalid_stand_agent_response'), { statusCode: 502 }) }
  if (result.timedOut || result.exitCode !== 0) {
    const error = z.object({ error: z.enum(['stand_path_forbidden', 'stand_repository_mismatch', 'stand_branch_mismatch', 'stand_merge_failed', 'stand_git_failed', 'stand_git_unavailable']) }).safeParse(value)
    throw Object.assign(new Error(error.success ? error.data.error : 'stand_git_failed'), { statusCode: 409 })
  }
  const parsed = (operation.action === 'head' ? head : sync).safeParse(value)
  if (!parsed.success) throw Object.assign(new Error('invalid_stand_agent_response'), { statusCode: 502 })
  return parsed.data
}
