// Статус авторизации CLI claude/codex: читает файлы авторизации из HOME
// (те же каталоги, что монтируются в Docker) и делегирует разбор чистой логике
// из @voicechat/shared. Отсутствие/битость файла деградирует к «не залогинен».

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { claudeLoginStatus, codexLoginStatus, type LoginStatusMap } from '@voicechat/shared'

export type ReadTextFn = (path: string) => Promise<string | null>

const defaultRead: ReadTextFn = async (path) => {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

export interface LoginStatusOptions {
  /** Чтение файла (для тестов). По умолчанию — fs.readFile, null при отсутствии. */
  read?: ReadTextFn
  /** Домашний каталог (для тестов). По умолчанию os.homedir(). */
  home?: string
  /** Окружение (для проверки API-ключей). По умолчанию process.env. */
  env?: NodeJS.ProcessEnv
  /** Текущее время (ms) — проверка срока refresh-токена Claude. */
  now?: number
}

/** Собирает статус входа обоих движков из файлов авторизации + переменных окружения. */
export async function getLoginStatus(opts: LoginStatusOptions = {}): Promise<LoginStatusMap> {
  const read = opts.read ?? defaultRead
  const home = opts.home ?? homedir()
  const env = opts.env ?? process.env
  const now = opts.now ?? Date.now()

  const [claudeRaw, codexRaw] = await Promise.all([
    read(join(home, '.claude', '.credentials.json')),
    read(join(home, '.codex', 'auth.json'))
  ])

  return {
    claude: claudeLoginStatus(claudeRaw, now, Boolean(env.ANTHROPIC_API_KEY)),
    codex: codexLoginStatus(codexRaw, Boolean(env.OPENAI_API_KEY))
  }
}
