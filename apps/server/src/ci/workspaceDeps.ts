// Установка зависимостей рабочей копии перед пост-development стадиями.
// Component QA и интеграционные тесты выполняются в checkout завершившегося
// development-рана, но своих `node_modules` не имеют: уборка рана и ручное
// вмешательство оставляют копию без бинарей, и первая же стадия с npm-скриптом
// падает с `command not found` (код 127). Merge-ран давно ставит зависимости
// сам — здесь то же самое, тем же изолированным кэшем задачи.

import { shellQuote } from './executor.js'

/** Сколько ждём установку зависимостей монорепо: холодный кэш качает всё. */
export const WORKSPACE_INSTALL_TIMEOUT_MS = 15 * 60_000

export interface WorkspaceInstallEnvironment {
  command: string
  homeDir: string
  npmCacheDir: string
}

/**
 * Подготовка зависимостей для конкретного QA-рана. HOME и npm cache намеренно
 * находятся внутри checkout рана: сохранённый development-кэш мог принадлежать
 * другому пользователю машины, а общий cache повреждается параллельными npm ci.
 * npm ci сам атомарно пересоздаёт node_modules — отдельного фонового удаления нет.
 */
export function workspaceInstallEnvironment(workdir: string, runId: string): WorkspaceInstallEnvironment {
  const root = `${workdir.replace(/[\\/]+$/, '')}/.component-qa/${runId.replace(/[^A-Za-z0-9._-]/g, '_')}`
  const homeDir = `${root}/home`
  const npmCacheDir = `${root}/npm-cache`
  const command = [
    `mkdir -p ${shellQuote(homeDir)} ${shellQuote(npmCacheDir)}`,
    `env HOME=${shellQuote(homeDir)} npm_config_cache=${shellQuote(npmCacheDir)} npm ci --no-audit --no-fund`
  ].join(' && ')
  return { command, homeDir, npmCacheDir }
}

/** Legacy helper for integration-test runs; their isolation is handled separately. */
export function workspaceInstallCommand(cacheDir: string | null): string {
  const install = 'npm ci --no-audit --no-fund'
  return cacheDir ? `npm_config_cache=${shellQuote(cacheDir)} ${install}` : install
}
