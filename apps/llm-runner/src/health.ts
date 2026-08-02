// `GET /v1/health`: есть ли бинари, какие версии и выполнен ли вход.
//
// Реестр исполнителей на сервере опрашивает этот роут, поэтому «не залогинен» —
// это нормальный ответ, а не ошибка: сервер по нему выбирает другого исполнителя.

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { claudeLoginStatus, codexLoginStatus, type LlmRunnerHealth } from '@voicechat/shared'

/** Версия бинаря (`<bin> --version`); null — бинаря нет или он не ответил. */
export type VersionProbe = (bin: string) => Promise<string | null>
export type ReadTextFn = (path: string) => Promise<string | null>

const defaultVersion: VersionProbe = (bin) =>
  new Promise((resolve) => {
    try {
      execFile(bin, ['--version'], { timeout: 8_000 }, (err, stdout) => {
        const line = (stdout ?? '').split('\n')[0].trim()
        resolve(line && !err ? line : null)
      })
    } catch {
      resolve(null)
    }
  })

const defaultRead: ReadTextFn = async (path) => {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

export interface HealthOptions {
  /** Общий HOME исполнителя: в нём файлы авторизации обоих CLI. */
  home: string
  claudeBin: string
  codexBin: string
  /** Сколько ранов исполняется сейчас. */
  runs?: () => number
  version?: VersionProbe
  read?: ReadTextFn
  env?: NodeJS.ProcessEnv
  now?: number
}

export async function runnerHealth(opts: HealthOptions): Promise<LlmRunnerHealth> {
  const version = opts.version ?? defaultVersion
  const read = opts.read ?? defaultRead
  const env = opts.env ?? process.env
  const now = opts.now ?? Date.now()

  const [claudeVersion, codexVersion, claudeRaw, codexRaw] = await Promise.all([
    version(opts.claudeBin),
    version(opts.codexBin),
    read(join(opts.home, '.claude', '.credentials.json')),
    read(join(opts.home, '.codex', 'auth.json'))
  ])

  const bins = {
    claude: { present: claudeVersion !== null, version: claudeVersion },
    codex: { present: codexVersion !== null, version: codexVersion }
  }
  return {
    // Исполнитель может нести только один CLI (`runner-personal` — лишь claude),
    // поэтому «жив» — это хотя бы один рабочий бинарь.
    ok: bins.claude.present || bins.codex.present,
    bins,
    login: {
      claude: claudeLoginStatus(claudeRaw, now, Boolean(env.ANTHROPIC_API_KEY)),
      codex: codexLoginStatus(codexRaw, Boolean(env.OPENAI_API_KEY))
    },
    runs: opts.runs?.() ?? 0
  }
}
