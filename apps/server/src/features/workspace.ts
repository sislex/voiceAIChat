import type { AgentRegistry, ExecResult } from '../agents/registry.js'

export interface WorkspaceExecutor {
  prepare(input: { agentId: string; root: string; path: string; gitUrl: string; baseBranch: string; featureBranch: string }): Promise<{ baseCommitSha: string }>
  commit(input: { agentId: string; path: string; policy: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'; message: string; testCommand?: string }): Promise<string>
  run(input: { agentId: string; path: string; command: string; timeoutMs?: number }): Promise<void>
  pushFeature(input: { agentId: string; path: string; featureBranch: string }): Promise<void>
  mergeLocal(input: { agentId: string; path: string; baseBranch: string; featureBranch: string; message: string; testCommand?: string }): Promise<string>
  cleanup(input: { agentId: string; path: string; baseBranch: string; featureBranch: string }): Promise<void>
  remoteMainSha(input: { agentId: string; path: string; baseBranch: string }): Promise<string>
  checkout(input: { agentId: string; path: string; sha: string }): Promise<void>
}

function q(value: string): string { return `'${value.replace(/'/g, `'\''`)}'` }

export class AgentWorkspaceExecutor implements WorkspaceExecutor {
  constructor(private readonly registry: AgentRegistry) {}

  async prepare(input: { agentId: string; root: string; path: string; gitUrl: string; baseBranch: string; featureBranch: string }): Promise<{ baseCommitSha: string }> {
    const command = [
      'set -e',
      `root=${q(input.root)}`,
      `work=${q(input.path)}`,
      `repo=${q(input.gitUrl)}`,
      `base=${q(input.baseBranch)}`,
      `branch=${q(input.featureBranch)}`,
      'case "$work" in "$root"/*) ;; *) echo "workspace outside root" >&2; exit 64;; esac',
      'mkdir -p "$root"',
      'if [ ! -d "$work/.git" ]; then git clone -- "$repo" "$work"; fi',
      'cd "$work"',
      'test "$(git remote get-url origin)" = "$repo"',
      'test -z "$(git status --porcelain)"',
      'test ! -e .git/MERGE_HEAD && test ! -d .git/rebase-merge && test ! -d .git/rebase-apply',
      'git fetch origin --prune',
      'git switch "$base"',
      'git reset --hard "origin/$base"',
      'git switch -c "$branch"',
      'git rev-parse HEAD'
    ].join('\n')
    const result: ExecResult = await this.registry.exec(input.agentId, command, 10 * 60_000)
    if (result.exitCode !== 0 || result.timedOut) throw new Error(result.output.trim() || 'Не удалось подготовить рабочую копию')
    const sha = result.output.trim().split(/\r?\n/).at(-1) ?? ''
    if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('Git не вернул базовый SHA')
    return { baseCommitSha: sha }
  }

  private async exec(agentId: string, command: string, timeoutMs = 10 * 60_000): Promise<string> {
    const result = await this.registry.exec(agentId, command, timeoutMs)
    if (result.exitCode !== 0 || result.timedOut) throw new Error(result.output.trim() || 'Команда workspace завершилась ошибкой')
    return result.output.trim()
  }

  async commit(input: { agentId: string; path: string; policy: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'; message: string }): Promise<string> {
    const common = `set -e\ncd ${q(input.path)}`
    if (input.policy === 'agent_commits') {
      return (await this.exec(input.agentId, `${common}\ntest -z "$(git status --porcelain)"\ngit rev-parse HEAD`)).split(/\r?\n/).at(-1) ?? ''
    }
    const out = await this.exec(input.agentId, `${common}\ngit add -A\nif git diff --cached --quiet; then echo "Нет изменений для коммита" >&2; exit 65; fi\ngit commit -m ${q(input.message)}\ngit rev-parse HEAD`)
    return out.split(/\r?\n/).at(-1) ?? ''
  }

  async run(input: { agentId: string; path: string; command: string; timeoutMs?: number }): Promise<void> {
    await this.exec(input.agentId, `set -e\ncd ${q(input.path)}\n${input.command}`, input.timeoutMs ?? 30 * 60_000)
  }

  async mergeLocal(input: { agentId: string; path: string; baseBranch: string; featureBranch: string; message: string; testCommand?: string }): Promise<string> {
    const gate = input.testCommand ? `\n${input.testCommand}` : ''
    const out = await this.exec(input.agentId, `set -e\ncd ${q(input.path)}\ngit fetch origin --prune\ngit switch ${q(input.baseBranch)}\ngit reset --hard ${q(`origin/${input.baseBranch}`)}\ngit merge --no-ff ${q(input.featureBranch)} -m ${q(input.message)}${gate}\ngit push origin ${q(input.baseBranch)}\ngit rev-parse HEAD`)
    return out.split(/\r?\n/).at(-1) ?? ''
  }

  async cleanup(input: { agentId: string; path: string; baseBranch: string; featureBranch: string }): Promise<void> {
    await this.exec(input.agentId, `set -e\ncd ${q(input.path)}\ngit switch ${q(input.baseBranch)}\ngit fetch origin --prune\ngit reset --hard ${q(`origin/${input.baseBranch}`)}\ngit branch -D ${q(input.featureBranch)} 2>/dev/null || true\ntest -z "$(git status --porcelain)"`)
  }

  async remoteMainSha(input: { agentId: string; path: string; baseBranch: string }): Promise<string> {
    const out = await this.exec(input.agentId, `set -e\ncd ${q(input.path)}\ngit fetch origin ${q(input.baseBranch)}\ngit rev-parse ${q(`origin/${input.baseBranch}`)}`)
    return out.split(/\r?\n/).at(-1) ?? ''
  }


  async checkout(input: { agentId: string; path: string; sha: string }): Promise<void> {
    if (!/^[0-9a-f]{40}$/i.test(input.sha)) throw new Error('Некорректный SHA деплоя')
    await this.exec(input.agentId, `set -e\ncd ${q(input.path)}\ngit checkout --detach ${q(input.sha)}`)
  }


  async pushFeature(input: { agentId: string; path: string; featureBranch: string }): Promise<void> {
    await this.exec(input.agentId, `set -e\ncd ${q(input.path)}\ngit push -u origin ${q(input.featureBranch)}`)
  }

}
