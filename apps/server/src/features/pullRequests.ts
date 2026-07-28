export interface PullRequestService {
  merge(input: { gitUrl: string; base: string; head: string; title: string }): Promise<{ mergeCommitSha: string; url: string }>
}

function repositoryFromUrl(url: string): string {
  const match = /github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/.exec(url)
  if (!match) throw new Error('Git URL не является GitHub-репозиторием')
  return `${match[1]}/${match[2]}`
}

export class GitHubPullRequestService implements PullRequestService {
  constructor(private readonly token?: string) {}
  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.token) throw new Error('Для GitHub PR merge не задан VC_GITHUB_TOKEN')
    const response = await fetch(`https://api.github.com${path}`, { ...init, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${this.token}`, 'x-github-api-version': '2022-11-28', ...(init?.body ? { 'content-type': 'application/json' } : {}) } })
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`)
    return response.json() as Promise<T>
  }
  async merge(input: { gitUrl: string; base: string; head: string; title: string }): Promise<{ mergeCommitSha: string; url: string }> {
    const repo = repositoryFromUrl(input.gitUrl)
    const existing = await this.api<Array<{ number: number; html_url: string }>>(`/repos/${repo}/pulls?state=open&head=${encodeURIComponent(input.head)}&base=${encodeURIComponent(input.base)}`)
    const pr = existing[0] ?? await this.api<{ number: number; html_url: string }>(`/repos/${repo}/pulls`, { method: 'POST', body: JSON.stringify({ title: input.title, head: input.head, base: input.base }) })
    const merged = await this.api<{ merged: boolean; sha: string; message: string }>(`/repos/${repo}/pulls/${pr.number}/merge`, { method: 'PUT', body: JSON.stringify({ merge_method: 'merge' }) })
    if (!merged.merged) throw new Error(merged.message || 'GitHub не выполнил merge')
    return { mergeCommitSha: merged.sha, url: pr.html_url }
  }
}
