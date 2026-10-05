import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { expect, it, vi } from 'vitest'
import { gitStoreCredentials } from './sources.js'

vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(), execFile: vi.fn()
}))

it('reads repository-scoped credentials without putting them in process arguments or logging failures', async () => {
  const fixtureUsername = randomUUID()
  const fixturePassword = randomUUID()
  const end = vi.fn()
  const on = vi.fn()
  const execute = vi.mocked(execFile)
  execute.mockImplementation(((...args: unknown[]) => {
    const done = args.at(-1) as (error: Error | null, stdout: string) => void
    queueMicrotask(() => done(null, [["username", fixtureUsername], ["password", fixturePassword]]
      .map(([key, value]) => [key, value].join("=")).join("\n") + "\n"))
    return { stdin: { end, on } }
  }) as unknown as typeof execFile)
  const resolve = gitStoreCredentials()
  expect(await resolve('https://example.test/team/module.git')).toEqual({ username: fixtureUsername, password: fixturePassword })
  expect(end).toHaveBeenCalledWith('protocol=https\nhost=example.test\npath=team/module.git\n\n')
  expect(execute).toHaveBeenCalledWith('git', ['credential', 'fill'], expect.objectContaining({
    timeout: 15_000, env: expect.objectContaining({ GIT_TERMINAL_PROMPT: '0' })
  }), expect.any(Function))
  expect(JSON.stringify(execute.mock.calls)).not.toContain(fixturePassword)
  execute.mockImplementation(((...args: unknown[]) => {
    const done = args.at(-1) as (error: Error | null, stdout: string) => void
    queueMicrotask(() => done(Error(fixturePassword), ''))
    return { stdin: { end, on } }
  }) as unknown as typeof execFile)
  expect(await resolve('https://example.test/team/module.git')).toBeNull()
})
