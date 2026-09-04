// Установка зависимостей рабочей копии перед пост-development стадиями.
// Component QA и интеграционные тесты выполняются в checkout завершившегося
// development-рана, но своих `node_modules` не имеют: уборка рана и ручное
// вмешательство оставляют копию без бинарей, и первая же стадия с npm-скриптом
// падает с `command not found` (код 127). Merge-ран давно ставит зависимости
// сам — здесь то же самое, тем же изолированным кэшем задачи.

import { shellQuote } from './executor.js'

/** Сколько ждём установку зависимостей монорепо: холодный кэш качает всё. */
export const WORKSPACE_INSTALL_TIMEOUT_MS = 15 * 60_000

/**
 * Команда установки для стадии. Кэш задачи передаётся явно: общий `~/.npm`
 * ломается, когда два `npm ci` на машине идут одновременно. Пустой `cacheDir`
 * (старые записи рабочих директорий) оставляет npm его кэш по умолчанию.
 */
export function workspaceInstallCommand(cacheDir: string | null): string {
  const install = 'npm ci --no-audit --no-fund'
  return cacheDir ? `npm_config_cache=${shellQuote(cacheDir)} ${install}` : install
}
