// Компаньон-агент: выполняет shell-команды голосового ассистента на этой машине.
// Подключается к серверу voiceAIChat по WS и ждёт команды (проброс Bash через MCP).

import { loadConfig } from './config.js'
import { startConnection, consoleHandlers } from './connection.js'
import { installSignalHandlers } from './shutdown.js'
import { acquireInstanceLock } from './singleInstance.js'

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

console.log(`[agent] подключаюсь к ${config.serverUrl}…`)
const connection = startConnection(config, consoleHandlers())
installSignalHandlers({
  stop: () => {
    connection.stop()
    lock.release()
  }
})
// Обычный выход (например, сервер отозвал токен) тоже должен освобождать блокировку.
process.on('exit', () => lock.release())
