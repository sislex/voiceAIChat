import { createHash } from 'node:crypto'
import { evaluateAgentCommand } from '@sislexa/agent-contracts'
import { parseProjectStandPreview, type ProjectStandPreview } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { MachinesService } from '../machines/service.js'
import type { CommandGate } from '../agents/commandGate.js'
import { shellQuote } from '../util/shell.js'

export type PreviewMachines = Pick<MachinesService, 'exec' | 'isOnline' | 'policyOf'>
export type ProjectPreviewStatus = 'stopped' | 'starting' | 'running' | 'failed'

// Only this fixed program and a base64 JSON argument cross the exec shell. The owner's
// command runs detached in its own process group with output in a private log file;
// neither the command nor the log is ever reported back.
export const PROJECT_PREVIEW_PROGRAM = String.raw`
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), os = require('node:os'), http = require('node:http'), net = require('node:net');
const a = JSON.parse(Buffer.from(process.argv[1], 'base64').toString());
const fail = code => { throw new Error(code) };
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const alive = pid => { if (!pid) return false; try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } };
const listening = port => new Promise(done => { const s = net.connect({ host: '127.0.0.1', port }); const end = v => { s.destroy(); done(v) }; s.setTimeout(1000, () => end(false)); s.once('connect', () => end(true)); s.once('error', () => end(false)) });
const ready = (port, p) => new Promise(done => { const r = http.get({ host: '127.0.0.1', port, path: p || '/', timeout: 1000 }, res => { res.resume(); done(true) }); r.on('timeout', () => { r.destroy(); done(false) }); r.on('error', () => done(false)) });
const rel = (value, missing) => {
  const relative = value || '.';
  if (path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p => p === '..' || p.toLowerCase() === '.git')) fail('path_outside_working_copy');
  const target = path.resolve(root, relative);
  if (!inside(root, target)) fail('path_outside_working_copy');
  let segment = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    segment = path.join(segment, part);
    try { if (fs.lstatSync(segment).isSymbolicLink()) fail('path_outside_working_copy') } catch (e) { if (e.code !== 'ENOENT' || !missing) throw e }
  }
  let cursor = target;
  while (true) { try { fs.lstatSync(cursor); break } catch (e) { if (e.code !== 'ENOENT' || !missing) throw e; cursor = path.dirname(cursor) } }
  if (!inside(root, fs.realpathSync(cursor))) fail('path_outside_working_copy');
  return target;
};
let root;
(async () => {
  if (typeof a.root !== 'string' || !path.isAbsolute(a.root) || !/^[A-Za-z0-9_-]+$/.test(a.id || '')) fail('path_outside_working_copy');
  root = fs.realpathSync(a.root);
  if (a.action === 'check') {
    const target = rel(a.relative, a.allowMissing);
    const stat = fs.existsSync(target) ? fs.statSync(target) : null;
    if (stat?.isFile() && stat.size > 2 * 1024 * 1024) fail('file_too_large');
    return { root, target, directory: stat?.isDirectory() || false };
  }
  const dir = path.join(os.homedir(), '.voicechat', 'project-previews');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700);
  const stateFile = path.join(dir, a.id + '.json'), logFile = path.join(dir, a.id + '.log');
  let state = null;
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) } catch {}
  const save = value => fs.writeFileSync(stateFile, JSON.stringify(value), { mode: 0o600 });
  const kill = () => {
    if (state?.pid && alive(state.pid)) {
      try { process.kill(-state.pid, 'SIGTERM') } catch {}
      // Dev servers such as nx serve may ignore SIGTERM; escalate after 5 s.
      for (let i = 0; i < 50 && alive(state.pid); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      if (alive(state.pid)) { try { process.kill(-state.pid, 'SIGKILL') } catch {} }
    }
    try { fs.unlinkSync(stateFile) } catch {} state = null };
  const status = async () => {
    const port = state?.port ?? a.port;
    if (!state) return { status: 'stopped' };
    if (await ready(port, a.readinessPath)) return { status: 'running', adopted: !state.pid };
    return { status: state.pid && alive(state.pid) ? 'starting' : 'stopped' };
  };
  if (a.action === 'status') return status();
  if (a.action === 'stop') { kill(); return { status: 'stopped' } }
  if (a.action !== 'start') fail('invalid_action');
  if (typeof a.command !== 'string' || !a.command || /[\0\r\n]/.test(a.command) || !Number.isInteger(a.port)) fail('preview_invalid_config');
  if (state && state.hash === a.hash && (alive(state.pid) || !state.pid)) {
    const current = await status();
    if (current.status !== 'stopped') return current;
  }
  if (state && state.hash !== a.hash) { kill(); await new Promise(r => setTimeout(r, 500)) }
  if (await listening(a.port)) {
    // Someone else's server already answers on the port: adopt it, never kill it.
    state = { pid: null, port: a.port, hash: a.hash, startedAt: Date.now() }; save(state);
    return status();
  }
  const cwd = rel(a.workdir, false);
  if (fs.realpathSync(cwd) !== cwd || !fs.statSync(cwd).isDirectory()) fail('path_outside_working_copy');
  const fd = fs.openSync(logFile, 'a', 0o600); fs.chmodSync(logFile, 0o600);
  const child = cp.spawn(a.command, { cwd, shell: true, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, PORT: String(a.port) } });
  child.unref(); fs.closeSync(fd);
  state = { pid: child.pid, port: a.port, hash: a.hash, startedAt: Date.now() }; save(state);
  return { status: 'starting' };
})().then(result => process.stdout.write(JSON.stringify(result)),
  e => { process.stdout.write(JSON.stringify({ error: e.code === 'ENOENT' ? 'path_outside_working_copy' : e.message })); process.exitCode = 1 });
`

export async function previewCommand(machines: Pick<MachinesService, 'exec'>, user: string, agent: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const payload = Buffer.from(JSON.stringify(args)).toString('base64')
  const result = await machines.exec(agent, 'node -e ' + shellQuote(PROJECT_PREVIEW_PROGRAM) + ' ' + shellQuote(payload), 60_000, undefined, { source: 'console', userId: user })
    .catch(() => { throw new Error('machine_unavailable') })
  let value: Record<string, unknown> & { error?: string }
  try { value = JSON.parse(result.output) } catch { throw new Error('machine_unavailable') }
  if (value.error) throw new Error(value.error)
  if (result.exitCode !== 0 || result.timedOut) throw new Error('machine_unavailable')
  return value
}

function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode })
}

interface Deps {
  db: VoiceChatDb
  machines: PreviewMachines
  gate: CommandGate
  /** Core stand proxy listener ports; a preview may never claim one. */
  reservedPorts: number[]
}

/** Preview stands of ordinary web projects: an owner-configured dev command on a project machine. */
export class ProjectPreviews {
  constructor(private readonly deps: Deps) {}

  static previewStandId(agentId: string): string { return 'pp-' + agentId }
  static agentOf(standId: string): string | null { return standId.startsWith('pp-') && standId.length > 3 ? standId.slice(3) : null }
  previewStandId(agentId: string): string { return ProjectPreviews.previewStandId(agentId) }

  parse(input: unknown): ProjectStandPreview | null { return parseProjectStandPreview(input, this.deps.reservedPorts) }

  async config(projectId: string): Promise<ProjectStandPreview | null> {
    return this.parse(await this.deps.db.projects.getProjectStandPreview(projectId))
  }

  /** Machine working copy root of a project member's usable machine (same rule as Make project adapters). */
  async machine(user: string, projectId: string, agentId: string) {
    const project = await this.deps.db.projects.getProject(user, projectId)
    if (!project) fail(404, 'project_not_found')
    const machine = project.machines.find(m => m.canUse && m.agentId === agentId)
    const root = machine?.directories?.projectWorkdir.path || machine?.path
    if (!machine || !root) fail(403, 'stand_machine_forbidden')
    return { project, machine, root }
  }

  private async run(user: string, projectId: string, agentId: string, action: 'start' | 'status' | 'stop') {
    const config = await this.config(projectId)
    if (!config) throw new Error('preview_command_missing')
    const { root } = await this.machine(user, projectId, agentId)
    if (!this.deps.machines.isOnline(agentId)) throw new Error('machine_unavailable')
    if (action === 'start') {
      const verdict = await this.deps.gate({ command: config.command, userId: user, projectId, source: 'console' })
      const policy = this.deps.machines.policyOf(agentId)
      if (!verdict.allowed || (policy && !evaluateAgentCommand(policy, config.command).allowed)) throw new Error('preview_command_forbidden')
    }
    const hash = createHash('sha256').update(JSON.stringify([config.command, config.port, config.workdir ?? '.'])).digest('hex')
    const result = await previewCommand(this.deps.machines, user, agentId, {
      action, id: projectId, root, port: config.port, workdir: config.workdir ?? '.', readinessPath: config.readinessPath, hash,
      ...(action === 'start' ? { command: config.command } : {})
    })
    const status = (['stopped', 'starting', 'running'] as const).find(s => s === result.status) ?? 'failed'
    return { standId: this.previewStandId(agentId), status: status as ProjectPreviewStatus, root }
  }

  start(user: string, projectId: string, agentId: string) { return this.run(user, projectId, agentId, 'start') }
  status(user: string, projectId: string, agentId: string) { return this.run(user, projectId, agentId, 'status') }
  stop(user: string, projectId: string, agentId: string) { return this.run(user, projectId, agentId, 'stop') }

  /** Root-contained path check for Make files/git on the preview working copy. */
  async check(user: string, agentId: string, root: string, relative: string, allowMissing = false) {
    const result = await previewCommand(this.deps.machines, user, agentId, { action: 'check', id: 'check', root, relative, allowMissing })
    return result as { root: string; target: string; directory: boolean }
  }

  /** StandProxy resolver for `pp-` stand ids. */
  async target(user: string, projectId: string, standId: string): Promise<{ machineId: string; gatewayPort: number }> {
    const agentId = ProjectPreviews.agentOf(standId)
    if (!agentId) fail(404, 'stand_not_found')
    const config = await this.config(projectId)
    if (!config) fail(404, 'stand_not_found')
    await this.machine(user, projectId, agentId)
    return { machineId: agentId, gatewayPort: config.port }
  }
}
