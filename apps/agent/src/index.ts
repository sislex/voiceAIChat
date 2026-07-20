// Компаньон-агент: выполняет shell-команды голосового ассистента на этой машине.
// Подключается к серверу voiceAIChat по WS и ждёт команды (проброс Bash через MCP).

import { loadConfig } from './config.js'
import { startConnection } from './connection.js'

const config = loadConfig()
console.log(`[agent] подключаюсь к ${config.serverUrl}…`)
startConnection(config)
