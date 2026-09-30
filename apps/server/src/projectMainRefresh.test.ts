// Синхронизация общей копии проекта перед ходом модели (`ensureProjectMainCurrent` в server.ts):
// скрипт ядра, который исполняет машина проекта. Живёт в ядре, потому что копию обновляет ядро —
// канбан только просит об этом портом `KanbanCore.ensureProjectMainCurrent`.
import { describe, it, expect } from 'vitest'
import { execFileSync, execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectMainRefreshScript } from './server.js'

describe('синхронизация общей базовой ветки перед подготовкой', () => {
  it('совместима с zsh и fast-forward обновляет отставший main до origin/main', () => {
    const script = projectMainRefreshScript('/srv/project', 'main')

    expect(script).toContain('worktree_status="$(git -C "$repo" status --porcelain --untracked-files=all)"')
    expect(script).not.toMatch(/(?:^|\n)status=/)
    expect(script).toContain('origin "refs/heads/${base}:refs/remotes/origin/${base}"')
    expect(script).not.toContain('$base:refs')
    expect(script.indexOf(' fetch --no-tags origin ')).toBeLessThan(script.indexOf(' merge --ff-only '))
    expect(script).toContain('merge --ff-only "refs/remotes/origin/$base"')
    expect(script).toContain('test "$local_sha" = "$remote_sha"')
  })

  /** Общая копия проекта: origin + свежий клон на базовой ветке. */
  function seedSharedCheckout(prefix: string): { root: string; origin: string; seed: string; checkout: string; head: string; git: (...args: string[]) => string } {
    const root = mkdtempSync(join(tmpdir(), prefix))
    const origin = join(root, 'origin.git')
    const seed = join(root, 'seed')
    const checkout = join(root, 'checkout')
    const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()
    git('init', '--bare', origin)
    git('init', '-b', 'main', seed)
    git('-C', seed, 'config', 'user.email', 'test@example.com')
    git('-C', seed, 'config', 'user.name', 'Test')
    writeFileSync(join(seed, 'value.txt'), 'one\n')
    git('-C', seed, 'add', 'value.txt')
    git('-C', seed, 'commit', '-m', 'first')
    git('-C', seed, 'remote', 'add', 'origin', origin)
    git('-C', seed, 'push', '-u', 'origin', 'main')
    git('clone', '--branch', 'main', origin, checkout)
    return { root, origin, seed, checkout, head: git('-C', seed, 'rev-parse', 'HEAD'), git }
  }

  it('грязную копию лечит автоматически: правки уезжают в stash, синхронизация продолжается', () => {
    const { root, checkout, head, git } = seedSharedCheckout('vc-main-dirty-')
    try {
      // Незакоммиченная правка и неотслеживаемый файл: оба должны быть спрятаны.
      writeFileSync(join(checkout, 'value.txt'), 'local\n')
      writeFileSync(join(checkout, 'scratch.log'), 'temp\n')

      const output = execSync(projectMainRefreshScript(checkout, 'main'), { shell: '/bin/sh', stdio: 'pipe', encoding: 'utf8' })

      expect(output).toContain(`BASE_SHA=${head}`)
      const autoheal = output.match(/AUTOHEAL=(.*)/)?.[1] ?? ''
      expect(autoheal).toContain('2 зап.')
      expect(autoheal).toContain('value.txt')
      expect(autoheal).toContain('scratch.log')
      // Копия действительно чистая и на базовой ветке — подготовка не блокируется.
      expect(git('-C', checkout, 'status', '--porcelain', '--untracked-files=all')).toBe('')
      expect(git('-C', checkout, 'branch', '--show-current')).toBe('main')

      // Ничего не потеряно: stash назван в отчёте, и по нему правки возвращаются.
      const stashName = autoheal.match(/vc-autosync-[0-9]{8}-[0-9]{6}/)?.[0]
      expect(stashName).toBeTruthy()
      expect(git('-C', checkout, 'stash', 'list')).toContain(stashName!)
      git('-C', checkout, 'stash', 'apply', `stash^{/${stashName}}`)
      expect(readFileSync(join(checkout, 'value.txt'), 'utf8')).toBe('local\n')
      expect(readFileSync(join(checkout, 'scratch.log'), 'utf8')).toBe('temp\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('копию, оставленную на ветке задачи или в detached HEAD, возвращает на базовую ветку', () => {
    const { root, checkout, head, git } = seedSharedCheckout('vc-main-branch-')
    try {
      // Так копия выглядит после Git-панели или чата задачи: чужая ветка и правка.
      git('-C', checkout, 'checkout', '-b', 'CHAT-407')
      writeFileSync(join(checkout, 'value.txt'), 'branch work\n')

      const output = execSync(projectMainRefreshScript(checkout, 'main'), { shell: '/bin/sh', stdio: 'pipe', encoding: 'utf8' })

      expect(output).toContain(`BASE_SHA=${head}`)
      expect(output).toContain('копия возвращена на main с ветки «CHAT-407»')
      expect(git('-C', checkout, 'branch', '--show-current')).toBe('main')
      expect(git('-C', checkout, 'status', '--porcelain', '--untracked-files=all')).toBe('')

      // Detached HEAD (например после `git worktree add --detach`) — тот же путь.
      git('-C', checkout, 'checkout', '--detach', head)
      const detached = execSync(projectMainRefreshScript(checkout, 'main'), { shell: '/bin/sh', stdio: 'pipe', encoding: 'utf8' })
      expect(detached).toContain('копия возвращена на main с ветки «detached HEAD»')
      expect(git('-C', checkout, 'branch', '--show-current')).toBe('main')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('когда спрятать изменения нельзя, останавливается и называет мешающие файлы', () => {
    const { root, seed, checkout, git } = seedSharedCheckout('vc-main-unstashable-')
    try {
      // Незавершённый merge с конфликтом: индекс unmerged, и git отказывает stash.
      git('-C', seed, 'checkout', '-b', 'aside')
      writeFileSync(join(seed, 'value.txt'), 'aside\n')
      git('-C', seed, 'commit', '-am', 'aside')
      git('-C', seed, 'push', 'origin', 'aside')
      git('-C', checkout, 'fetch', 'origin', 'aside')
      writeFileSync(join(checkout, 'value.txt'), 'local\n')
      git('-C', checkout, 'config', 'user.email', 'test@example.com')
      git('-C', checkout, 'config', 'user.name', 'Test')
      git('-C', checkout, 'commit', '-am', 'local')
      try { execFileSync('git', ['-C', checkout, 'merge', 'origin/aside'], { stdio: 'pipe' }) } catch { /* конфликт ожидаем */ }
      expect(git('-C', checkout, 'status', '--porcelain')).toContain('UU')

      let message = ''
      try {
        execSync(projectMainRefreshScript(checkout, 'main'), { shell: '/bin/sh', stdio: 'pipe' })
      } catch (error) {
        message = String((error as { stderr?: Buffer }).stderr ?? '')
      }
      expect(message).toContain('спрятать их в stash не удалось')
      expect(message).toContain(checkout)
      expect(message).toContain('Изменено записей: 1')
      expect(message).toContain('value.txt')
      // Конфликт не тронут: молча ломать чужой merge автолечение не имеет права.
      expect(git('-C', checkout, 'status', '--porcelain')).toContain('UU')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('обновляет реальную локальную main из origin/main без склеенной ссылки', () => {
    const root = mkdtempSync(join(tmpdir(), 'vc-main-sync-'))
    const origin = join(root, 'origin.git')
    const seed = join(root, 'seed')
    const checkout = join(root, 'checkout')
    const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()
    try {
      git('init', '--bare', origin)
      git('init', '-b', 'main', seed)
      git('-C', seed, 'config', 'user.email', 'test@example.com')
      git('-C', seed, 'config', 'user.name', 'Test')
      writeFileSync(join(seed, 'value.txt'), 'one\n')
      git('-C', seed, 'add', 'value.txt')
      git('-C', seed, 'commit', '-m', 'first')
      git('-C', seed, 'remote', 'add', 'origin', origin)
      git('-C', seed, 'push', '-u', 'origin', 'main')
      git('clone', '--branch', 'main', origin, checkout)

      writeFileSync(join(seed, 'value.txt'), 'two\n')
      git('-C', seed, 'commit', '-am', 'second')
      git('-C', seed, 'push', 'origin', 'main')
      const remoteHead = git('-C', seed, 'rev-parse', 'HEAD')

      execSync(projectMainRefreshScript(checkout, 'main'), { shell: '/bin/sh', stdio: 'pipe' })

      expect(git('-C', checkout, 'rev-parse', 'HEAD')).toBe(remoteHead)
      expect(git('-C', checkout, 'rev-parse', 'refs/remotes/origin/main')).toBe(remoteHead)
      expect(git('-C', checkout, 'for-each-ref', '--format=%(refname)')).not.toContain('refs/heads/mainefs/remotes/origin/main')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('пустой или отсутствующий projectWorkdir клонирует по gitUrl, непустой чужой каталог отвергает', () => {
    const root = mkdtempSync(join(tmpdir(), 'vc-main-bootstrap-'))
    const origin = join(root, 'origin.git')
    const seed = join(root, 'seed')
    const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()
    try {
      git('init', '--bare', origin)
      git('init', '-b', 'main', seed)
      git('-C', seed, 'config', 'user.email', 'test@example.com')
      git('-C', seed, 'config', 'user.name', 'Test')
      writeFileSync(join(seed, 'value.txt'), 'one\n')
      git('-C', seed, 'add', 'value.txt')
      git('-C', seed, 'commit', '-m', 'first')
      git('-C', seed, 'remote', 'add', 'origin', origin)
      git('-C', seed, 'push', '-u', 'origin', 'main')
      const remoteHead = git('-C', seed, 'rev-parse', 'HEAD')

      // Так выглядит каталог после привязки машины: materialize сделал только mkdir.
      const empty = join(root, 'projects', 'p1', 'worktree')
      mkdirSync(empty, { recursive: true })
      const fromEmpty = execSync(projectMainRefreshScript(empty, 'main', origin), { shell: '/bin/sh', stdio: 'pipe', encoding: 'utf8' })
      expect(fromEmpty).toContain(`BASE_SHA=${remoteHead}`)
      expect(git('-C', empty, 'branch', '--show-current')).toBe('main')
      expect(git('-C', empty, 'config', '--get', 'remote.origin.url')).toBe(origin)

      const missing = join(root, 'projects', 'p2', 'worktree')
      const fromMissing = execSync(projectMainRefreshScript(missing, 'main', origin), { shell: '/bin/sh', stdio: 'pipe', encoding: 'utf8' })
      expect(fromMissing).toContain(`BASE_SHA=${remoteHead}`)

      // Повторный вызов на уже склонированном каталоге — обычный fast-forward, без клона.
      const again = execSync(projectMainRefreshScript(empty, 'main', origin), { shell: '/bin/sh', stdio: 'pipe', encoding: 'utf8' })
      expect(again).toContain(`BASE_SHA=${remoteHead}`)

      // Без gitUrl пустой каталог — прежняя ошибка «не Git-репозиторий».
      const noUrl = join(root, 'projects', 'p3', 'worktree')
      mkdirSync(noUrl, { recursive: true })
      expect(() => execSync(projectMainRefreshScript(noUrl, 'main'), { shell: '/bin/sh', stdio: 'pipe' })).toThrow(/не является Git-репозиторием/)

      // Непустой каталог без репозитория не перезаписывается даже при известном gitUrl.
      const foreign = join(root, 'projects', 'p4', 'worktree')
      mkdirSync(foreign, { recursive: true })
      writeFileSync(join(foreign, 'notes.txt'), 'чужое\n')
      expect(() => execSync(projectMainRefreshScript(foreign, 'main', origin), { shell: '/bin/sh', stdio: 'pipe' })).toThrow(/не является Git-репозиторием/)
      expect(readFileSync(join(foreign, 'notes.txt'), 'utf8')).toBe('чужое\n')

      // Подкаталог чужого репозитория — не корень рабочего дерева, а значит не копия проекта.
      const nested = join(seed, 'nested')
      mkdirSync(nested)
      writeFileSync(join(nested, 'x.txt'), 'x\n')
      expect(() => execSync(projectMainRefreshScript(nested, 'main', origin), { shell: '/bin/sh', stdio: 'pipe' })).toThrow(/не является Git-репозиторием/)

      // Каталог от `git worktree add` — полноценный корень с `.git`-файлом, принимается.
      git('-C', seed, 'branch', 'aside')
      git('-C', seed, 'checkout', 'aside')
      const linked = join(root, 'linked')
      git('-C', seed, 'worktree', 'add', linked, 'main')
      const fromLinked = execSync(projectMainRefreshScript(linked, 'main', origin), { shell: '/bin/sh', stdio: 'pipe', encoding: 'utf8' })
      expect(fromLinked).toContain(`BASE_SHA=${remoteHead}`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
