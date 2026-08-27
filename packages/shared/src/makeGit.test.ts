import { describe, expect, it } from 'vitest'
import { githubArchiveUrls, parseGithubUrl } from './makeGit'

describe('импорт GitHub (п.27)', () => {
  it('разбирает ссылки на репозиторий, ветку и подкаталог', () => {
    expect(parseGithubUrl('https://github.com/octocat/Hello-World')).toEqual({ owner: 'octocat', repo: 'Hello-World', branch: null, subdir: null })
    expect(parseGithubUrl('https://github.com/octocat/Hello-World.git')).toMatchObject({ repo: 'Hello-World' })
    expect(parseGithubUrl('https://github.com/o/r/tree/feature%2Fx/site/src')).toEqual({ owner: 'o', repo: 'r', branch: 'feature/x', subdir: 'site/src' })
    expect(parseGithubUrl('https://example.com/o/r')).toBeNull()
    expect(parseGithubUrl('https://github.com/only')).toBeNull()
    expect(parseGithubUrl('not a url')).toBeNull()
  })

  it('адреса архива: указанная ветка или main → master', () => {
    expect(githubArchiveUrls({ owner: 'o', repo: 'r', branch: null, subdir: null })).toEqual([
      'https://codeload.github.com/o/r/zip/refs/heads/main', 'https://codeload.github.com/o/r/zip/refs/heads/master'
    ])
    expect(githubArchiveUrls({ owner: 'o', repo: 'r', branch: 'dev/x', subdir: null })).toEqual(['https://codeload.github.com/o/r/zip/refs/heads/dev/x'])
  })
})
