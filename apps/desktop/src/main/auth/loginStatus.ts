// Статус авторизации CLI claude/codex для desktop: читает файлы авторизации из
// HOME и делегирует разбор чистой логике из @shared/auth. Аналог серверного
// apps/server/src/auth/loginStatus.ts (общий код — в shared, ФС отдельно).

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { claudeLoginStatus, codexLoginStatus, type LoginStatusMap } from '@shared/auth'

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** Собирает статус входа обоих движков из файлов авторизации + переменных окружения. */
export async function getLoginStatus(): Promise<LoginStatusMap> {
  const home = homedir()
  const now = Date.now()
  const [claudeRaw, codexRaw] = await Promise.all([
    readText(join(home, '.claude', '.credentials.json')),
    readText(join(home, '.codex', 'auth.json'))
  ])
  return {
    claude: claudeLoginStatus(claudeRaw, now, Boolean(process.env.ANTHROPIC_API_KEY)),
    codex: codexLoginStatus(codexRaw, Boolean(process.env.OPENAI_API_KEY))
  }
}
