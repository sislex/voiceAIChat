import { describe, it, expect } from 'vitest'
import { AgentCommandExecutor, buildShellCommand, maskSecrets, shellQuote } from './executor.js'

describe('ci executor: сборка команды', () => {
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

describe('ci executor: маскирование секретов', () => {
  it('заменяет секрет на ***, короткие игнорирует', () => {
    const mask = maskSecrets(['s3cr3t-token', 'ab'])
    expect(mask('token=s3cr3t-token done')).toBe('token=*** done')
    expect(mask('ab')).toBe('ab')
  })
})

describe('ci executor: поток через реестр', () => {
  it('форвардит чанки (маскированные) и возвращает exitCode', async () => {
    const chunks: string[] = []
    const fakeRegistry = {
      execStream: async (_a: string, _c: string, _t: number, onChunk: (d: string) => void) => {
        onChunk('secret=p@ssw0rd12\n')
        onChunk('ok\n')
        return { exitCode: 0, timedOut: false }
      }
    }
    const ex = new AgentCommandExecutor(fakeRegistry)
    const res = await ex.run({ agentId: 'a', script: 'x', workdir: '/w', env: {}, timeoutMs: 1000, secrets: ['p@ssw0rd12'] }, (d) => chunks.push(d))
    expect(res.exitCode).toBe(0)
    expect(chunks.join('')).toBe('secret=***\nok\n')
  })
})
