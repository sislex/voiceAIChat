// Разбор результата синхронизации общей копии проекта с origin и повтор
// нестабильных исходов. Живёт отдельно от `server.ts`, потому что это чистая
// логика поверх одного `exec`: её видно в тестах без реестра машин и WS.

/** То, что возвращает `agentRegistry.exec` — ровно нужные поля. */
export interface ProjectSyncExecResult {
  exitCode: number | null
  output: string
  timedOut: boolean
}

export interface ProjectSyncOptions {
  /** Сколько раз повторяется синхронизация до отказа. */
  attempts?: number
  /** Пауза между повторами. */
  delayMs?: number
  /** Подменяется в тестах, чтобы не ждать реальное время. */
  sleep?: (ms: number) => Promise<void>
}

export const PROJECT_SYNC_ATTEMPTS = 3
export const PROJECT_SYNC_RETRY_DELAY_MS = 2_000

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Сеть до origin и WS до машины — не детерминированные ресурсы: единственный
 * таймаут или обрыв связи ронял всю подготовку, и человек жал «Повторить»
 * руками. Повторяются только исходы, безопасные для повтора: таймаут команды и
 * недоступность машины. Сам скрипт идемпотентен (fetch + ff-only + stash),
 * поэтому лишний прогон ничего не портит.
 *
 * Отказ с ненулевым кодом — это осознанный вывод скрипта (грязная копия, не
 * репозиторий, разошедшаяся ветка). Повтор его не лечит, и он отдаётся сразу:
 * молчаливое зацикливание на сломанном окружении хуже честной остановки.
 */
export async function syncProjectWithRetry(
  exec: () => Promise<ProjectSyncExecResult>,
  options: ProjectSyncOptions = {}
): Promise<{ baseSha: string; autoHealed?: string }> {
  const attempts = options.attempts ?? PROJECT_SYNC_ATTEMPTS
  const delayMs = options.delayMs ?? PROJECT_SYNC_RETRY_DELAY_MS
  const sleep = options.sleep ?? wait
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let result: ProjectSyncExecResult
    try {
      result = await exec()
    } catch (error) {
      // «Машина не в сети» на переподключении агента: следующая попытка обычно
      // застаёт его уже онлайн.
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt === attempts) throw lastError
      await sleep(delayMs)
      continue
    }
    if (result.timedOut) {
      lastError = new Error('Синхронизация с origin завершилась по таймауту')
      if (attempt === attempts) throw lastError
      await sleep(delayMs)
      continue
    }
    if (result.exitCode !== 0) {
      throw new Error(result.output.trim() || `Синхронизация с origin завершилась с кодом ${result.exitCode ?? 'unknown'}`)
    }
    const baseSha = result.output.match(/BASE_SHA=([0-9a-f]{40})/)?.[1]
    if (!baseSha) throw new Error('Синхронизация не вернула SHA актуальной базовой ветки')
    const autoHealed = result.output.match(/AUTOHEAL=(.*)/)?.[1]?.trim()
    return { baseSha, ...(autoHealed ? { autoHealed } : {}) }
  }
  throw lastError ?? new Error('Синхронизация с origin не выполнена')
}
