import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { claudeCliLoginStatus, codexLoginStatus, type ClaudeAuthProbeResult, type LoginStatusMap } from '@voicechat/shared'

export type ReadTextFn = (path: string) => Promise<string | null>

const defaultRead: ReadTextFn = async (path) => {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

export type ClaudeAuthProbe = (bin: string, home: string) => Promise<ClaudeAuthProbeResult>

const defaultClaudeProbe: ClaudeAuthProbe = (bin, home) => new Promise((resolve) => {
  if (process.env.VITEST) {
    resolve({ code: null, stdout: '', stderr: '' })
    return
  }
  try {
    execFile(bin, ['auth', 'status', '--json'], { timeout: 8_000, env: { ...process.env, HOME: home } }, (error, stdout, stderr) => {
      const code = typeof (error as NodeJS.ErrnoException | null)?.code === 'number'
        ? (error as NodeJS.ErrnoException & { code: number }).code
        : error ? 1 : 0
      resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' })
    })
  } catch {
    resolve({ code: null, stdout: '', stderr: '' })
  }
})

export interface LoginStatusOptions {
  read?: ReadTextFn
  home?: string
  env?: NodeJS.ProcessEnv
  claudeBin?: string
  claudeProbe?: ClaudeAuthProbe
}

export async function getLoginStatus(opts: LoginStatusOptions = {}): Promise<LoginStatusMap> {
  const read = opts.read ?? defaultRead
  const home = opts.home ?? homedir()
  const env = opts.env ?? process.env
  const [claudeResult, codexRaw] = await Promise.all([
    (opts.claudeProbe ?? defaultClaudeProbe)(opts.claudeBin ?? 'claude', home),
    read(join(home, '.codex', 'auth.json'))
  ])

  return {
    claude: claudeCliLoginStatus(claudeResult),
    codex: codexLoginStatus(codexRaw, Boolean(env.OPENAI_API_KEY))
  }
}
