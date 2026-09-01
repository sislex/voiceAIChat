// Скрипты git — единственное место, где наш код превращается в команду на чужой
// машине, поэтому тесты здесь про безопасность, а не про удобство: инъекция,
// запрещённые политикой конструкции и опасные формы git.
import { describe, expect, it } from 'vitest'
import { isDangerousCommand, evaluateAgentCommand, DEFAULT_AGENT_POLICY } from '@voicechat/shared'
import { buildShellCommand } from '../ci/executor.js'
import {
  branchesScript, checkoutScript, commitScript, createBranchScript, discardScript,
  fileAtRefScript, gitBaseEnv, pullScript, pushScript, statusScript, treeScript
} from './scripts.js'

const ALL = () => [
  statusScript('main'),
  branchesScript(false),
  branchesScript(true),
  treeScript('HEAD', ''),
  treeScript('HEAD', 'apps/server'),
  fileAtRefScript('HEAD', 'a.txt'),
  checkoutScript('feature/x'),
  createBranchScript('feature/y', 'HEAD'),
  commitScript({ message: 'fix', paths: ['a.txt'], all: false, user: 'bob', email: 'bob@x' }),
  commitScript({ message: 'fix', paths: [], all: true, user: 'bob', email: 'bob@x' }),
  pushScript('feature/x'),
  pullScript('feature/x', 'rebase'),
  pullScript('feature/x', 'merge')
]

const command = (script: { script: string; env: Record<string, string> }): string =>
  buildShellCommand(script.script, '/repo', { ...gitBaseEnv(), ...script.env })

describe('безопасность скриптов', () => {
  it('в тексте скрипта нет перенаправлений и запрещённых политикой слов', () => {
    // `>`/`tee`/`mkdir`/`rm` рубит WRITE_RE в evaluateAgentCommand: на машине с
    // allowWrite: false панель перестала бы даже читать состояние.
    for (const { script } of ALL()) {
      expect(script, script).not.toMatch(/>/)
      expect(script, script).not.toMatch(/\b(rm|mv|rmdir|truncate|dd|tee|mkdir)\b/)
    }
  })

  it('читающие скрипты проходят политику машины без allowWrite и без сети', () => {
    const readOnly = { ...DEFAULT_AGENT_POLICY, allowWrite: false, allowNetwork: false }
    for (const script of [statusScript('main'), branchesScript(false), treeScript('HEAD', ''), fileAtRefScript('HEAD', 'a.txt')]) {
      const verdict = evaluateAgentCommand(readOnly, command(script))
      expect(verdict.allowed, verdict.reason ?? '').toBe(true)
    }
  })

  it('ни один скрипт, кроме отбрасывания правок, не является опасной командой', () => {
    // push --force / reset --hard / branch -D мы не генерируем вовсе; тест ловит
    // попытку «дописать для удобства».
    for (const script of ALL()) {
      expect(isDangerousCommand(command(script)), script.script).toBeNull()
    }
  })

  it('отбрасывание правок — единственная опасная команда, и это осознанно', () => {
    // `git clean` попадает в DANGEROUS_COMMAND_PATTERNS, и правильно: операция
    // необратима. Поэтому её вызывает только явное действие с вводом имени ветки, а
    // сервер сверяет подтверждение сам (`workspaceService.discard`).
    const cmd = command(discardScript(['src/a.ts']))
    expect(isDangerousCommand(cmd)).toBe('git reset --hard / clean -f / branch -D')
    // Порядок важен: checkout возвращает отслеживаемые файлы, и только потом clean
    // убирает неотслеживаемые — иначе clean удалил бы восстановимый файл.
    const { script } = discardScript(['src/a.ts'])
    expect(script.indexOf('git checkout --')).toBeLessThan(script.indexOf('git clean -fd --'))
  })

  it('имя ветки не может вырваться из кавычек и породить вторую команду', () => {
    const evil = "x'; rm -rf / #"
    const cmd = command(checkoutScript(evil))
    // Значение целиком остаётся одним shell-словом: закрытая кавычка экранирована.
    expect(cmd).toContain(`VC_GIT_BRANCH='x'\\''; rm -rf / #'`)
    // И в самом теле скрипта пользовательских данных нет — только имя переменной.
    expect(checkoutScript(evil).script).not.toContain('rm -rf')
    expect(checkoutScript(evil).script).toContain('"$VC_GIT_BRANCH"')
  })

  it('сообщение коммита с кавычками и переводами строк остаётся одним аргументом', () => {
    const message = "fix: don't break\n\nвторая строка '"
    const script = commitScript({ message, paths: ['a b.txt'], all: false, user: 'bob', email: 'b@x' })
    expect(script.script).not.toContain('fix:')
    expect(script.env.VC_GIT_MESSAGE).toBe(message)
    expect(command(script)).toContain(`VC_GIT_MESSAGE='fix: don'\\''t break`)
  })

  it('пути к файлам передаются переводами строк и раскрываются через xargs -0', () => {
    const script = commitScript({ message: 'm', paths: ['a b.txt', 'папка/файл.md'], all: false, user: 'u', email: 'e' })
    expect(script.env.VC_GIT_PATHS).toBe('a b.txt\nпапка/файл.md')
    expect(script.script).toContain("tr '\\n' '\\0' | xargs -0 git add --")
  })
})

describe('состав скриптов', () => {
  it('статус берёт всё одной командой и не держит index.lock', () => {
    const { script, env } = statusScript('develop', 5)
    expect(env).toEqual({ VC_GIT_BASE: 'develop', VC_GIT_MAX_COMMITS: '5' })
    expect(script).toContain('--no-optional-locks')
    for (const section of ['==VC:repo==', '==VC:head==', '==VC:status_b64==', '==VC:upstream==', '==VC:track==', '==VC:commits==', '==VC:done==']) {
      expect(script, section).toContain(section)
    }
    // -z + base64: иначе пути с пробелами приезжают в C-кавычках, а NUL портит журнал команд.
    expect(script).toContain('--porcelain=v1 -z -b --untracked-files=all')
    expect(script).toContain("| base64 | tr -d '\\n'")
  })

  it('обновление веток из origin — только по явному флагу', () => {
    expect(branchesScript(false).script).not.toContain('git fetch')
    expect(branchesScript(true).script).toContain('git fetch --prune --quiet origin')
  })

  it('дерево читается по одному уровню', () => {
    expect(treeScript('HEAD', '').script).toContain('ls-tree -l "$VC_GIT_REF"')
    expect(treeScript('HEAD', 'apps').script).toContain('-- "$VC_GIT_DIR/"')
    expect(treeScript('HEAD', '').script).not.toContain('ls-files')
  })

  it('файл читается с ограничением, а размер печатается до содержимого', () => {
    const { script, env } = fileAtRefScript('HEAD', 'a.txt', 1024)
    expect(env.VC_GIT_MAX).toBe('1024')
    expect(script.indexOf('==VC:size==')).toBeLessThan(script.indexOf('==VC:content_b64=='))
    expect(script).toContain('head -c "$VC_GIT_MAX"')
  })

  it('checkout идёт без -f, а отсутствующая локально ветка берётся из origin с отслеживанием', () => {
    const { script } = checkoutScript('feature/x')
    expect(script).toContain('git checkout "$VC_GIT_BRANCH"')
    expect(script).not.toMatch(/checkout\s+-f/)
    expect(script).toContain('git checkout -b "$VC_GIT_BRANCH" --track "origin/$VC_GIT_BRANCH"')
  })

  it('push отправляет ветку и обязательно сверяет SHA в origin', () => {
    const { script } = pushScript('feature/x')
    expect(script).toContain('git push origin "HEAD:refs/heads/$VC_GIT_BRANCH"')
    expect(script).toContain('git ls-remote --heads origin "refs/heads/$VC_GIT_BRANCH"')
    expect(script).not.toContain('--force')
  })

  it('мутации идут под set -e, чтение — нет', () => {
    for (const script of [commitScript({ message: 'm', paths: ['a'], all: false, user: 'u', email: 'e' }), pushScript('b'), checkoutScript('b'), createBranchScript('b', 'HEAD'), pullScript('b', 'rebase'), discardScript(['a'])]) {
      expect(script.script.startsWith('set -e'), script.script).toBe(true)
    }
    // У чтения `set -e` был бы вреден: у свежей ветки нет upstream, и статус
    // оборвался бы на середине вместо «ahead 0, behind 0».
    expect(statusScript('main').script.startsWith('set -e')).toBe(false)
  })

  it('окружение гасит интерактивные запросы git и не даёт брать index.lock', () => {
    expect(gitBaseEnv()).toEqual({
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '/bin/echo',
      GIT_OPTIONAL_LOCKS: '0',
      LC_ALL: 'C'
    })
  })
})

describe('подтягивание и отбрасывание', () => {
  it('rebase и merge откатывают начатое при конфликте, чтобы копия не осталась в середине', () => {
    expect(pullScript('x', 'rebase').script).toContain('git rebase --abort; exit 65')
    expect(pullScript('x', 'merge').script).toContain('git merge --abort; exit 65')
  })

  it('отсутствие ветки в origin отличается от ошибки git отдельной меткой', () => {
    expect(pullScript('x', 'rebase').script).toContain("'no-upstream'")
  })

  it('пути отбрасывания идут через xargs -0: пробелы и кириллица не разъезжаются', () => {
    const script = discardScript(['a b.txt', 'папка/файл.md'])
    expect(script.env.VC_GIT_PATHS).toBe('a b.txt\nпапка/файл.md')
    expect(script.script).not.toContain('a b.txt')
  })
})
