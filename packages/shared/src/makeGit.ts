// Импорт репозитория GitHub в проект Make (п.27): ссылка на репозиторий превращается в адрес ZIP-архива
// codeload — токены и git-бинарь не нужны, публичные репозитории импортируются как обычный ZIP.
// Экспорт «в git» остаётся ZIP/Vite-архивом: push требует учётных данных пользователя (см. roadmap).

export interface GithubArchive {
  owner: string
  repo: string
  /** Ветка из URL (`/tree/<branch>`); null — неизвестна, пробуем main, затем master. */
  branch: string | null
  /** Подкаталог из URL (`/tree/<branch>/<dir>`) — импортируется только он. */
  subdir: string | null
}

export function parseGithubUrl(raw: string): GithubArchive | null {
  let url: URL
  try { url = new URL(raw.trim()) } catch { return null }
  if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const owner = parts[0]!, repo = parts[1]!.replace(/\.git$/i, '')
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null
  let branch: string | null = null, subdir: string | null = null
  if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) {
    branch = decodeURIComponent(parts[3])
    if (parts.length > 4) subdir = parts.slice(4).map(decodeURIComponent).join('/')
  }
  return { owner, repo, branch, subdir }
}

/** Адреса ZIP по убыванию приоритета: указанная ветка, иначе main → master. */
export function githubArchiveUrls(a: GithubArchive): string[] {
  const branches = a.branch ? [a.branch] : ['main', 'master']
  return branches.map((b) => `https://codeload.github.com/${encodeURIComponent(a.owner)}/${encodeURIComponent(a.repo)}/zip/refs/heads/${b.split('/').map(encodeURIComponent).join('/')}`)
}
