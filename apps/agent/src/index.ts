// Компаньон-агент: выполняет shell-команды голосового ассистента на этой машине.
// Подключается к серверу voiceAIChat по WS и ждёт команды (проброс Bash через MCP).

import { loadConfig } from './config.js'
import { startConnection, consoleHandlers } from './connection.js'
import { installSignalHandlers } from './shutdown.js'
import { acquireInstanceLock } from './singleInstance.js'
import { acquireWakeLock } from './wakeLock.js'

const config = loadConfig()

// Второй агент с тем же токеном не запускается: он бы вытеснял первого по кругу.
// Немного ждём внутри acquire — при обновлении новый процесс стартует раньше, чем
// уходит старый, и без ожидания машина осталась бы вообще без агента.
const lock = acquireInstanceLock(config.token)
if (!lock.ok) {
  console.error(
    `[agent] уже работает другой агент с этим токеном (pid ${lock.heldByPid}) — выхожу.\n` +
      `Если это не так, удалите ${lock.path} и запустите снова.`
  )
  process.exit(0)
}

// Только победивший single-instance процесс получает платформенный wake lock.
const wakeLock = acquireWakeLock()

console.log(`[agent] подключаюсь к ${config.serverUrl}…`)
const connection = startConnection(config, consoleHandlers())
const stop = (): void => {
  try {
    connection.stop()
  } finally {
    wakeLock.release()
    lock.release()
  }
}
installSignalHandlers({ stop })
// Обычный выход (например, сервер отозвал токен) тоже освобождает оба ресурса.
// release идемпотентен, поэтому exit после signal cleanup безопасен.
process.on('exit', () => {
  wakeLock.release()
  lock.release()
})
