import { describe, it, expect } from 'vitest'
import { buildShellCommand, shellQuote } from './shell.js'

describe('shell: сборка команды', () => {
  it('cd + export с экранированием; ключи-мусор отброшены', () => {
    const cmd = buildShellCommand('npm ci', '/repos/p 1', { TASK_NUMBER: "4'2", 'bad key': 'x', VALID_1: 'ok' })
    expect(cmd).toContain(`cd -- '/repos/p 1'`)
    expect(cmd).toContain(`export TASK_NUMBER='4'\\''2'`)
    expect(cmd).toContain(`export VALID_1='ok'`)
    expect(cmd).not.toContain('bad key')
    expect(cmd).toContain('npm ci')
  })

  it('без workdir и env — только скрипт в подоболочке', () => {
    expect(buildShellCommand('echo hi', '', {})).toBe('(\necho hi\n)')
  })

  it('shellQuote экранирует одинарную кавычку', () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`)
  })
})
