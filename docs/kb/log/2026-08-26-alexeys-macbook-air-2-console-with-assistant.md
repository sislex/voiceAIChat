---
date: 2026-08-26
machine: alexeys-macbook-air-2
slug: console-with-assistant
---

# Инструмент «Консоль с ассистентом»

Новый третий split-режим (`assistantKind: 'console-reader'`, маршрут `#/console-reader`):
слева чат, справа живой PTY-терминал. Ключевое — **разделяемый терминал**:
пользователь и ассистент пишут в одну сессию (детерминированный
`consolePtyId(conv)` = `console:<id>`).

- shared: `CONSOLE_READER_KIND`, `isConsoleReaderConversation`, `consolePtyId`,
  `PtyContext`, agent-сообщение `pty.context`, `RunRequest.consoleMcpUrl`,
  `AGENT_VERSION 0.14.0`.
- UI: `ConsoleSessionPane` (экспортирован `TerminalView` из `MachineTerminal`),
  каркас режима в `App.tsx` (`inConsoleReader`/`inSplit`), `consoleReaderConversations`
  в chatStore, пункт меню Sidebar, второй таб «Консоль».
- server: `consoleMcp.ts` (`/mcp/console`) — инструменты `console_read/context/run/input/keys`
  поверх `registry.ptyInput/ptyBufferText/ptyContextOf` (новые методы реестра);
  `turns.ts` подключает `consoleMcpUrl` только у console-reader, `&ro=1` в Плане;
  claudeCli/codexCli регистрируют `mcpServers.console` + хинт.
- agent: `pty.ts` шлёт `pty.context` (Linux /proc: cwd/tpgid/altscreen) для PTY `console:`.
- Самодиагностика: `consoleReaderDiagnostics.ts` (bridge/machine/round-trip) + кнопка/команда.

Безопасность: write-инструменты гейтятся режимом прав (План → ro), необратимые
команды требуют confirm=true.

Тесты: consoleMcp.test (9), consoleReaderDiagnostics.test (5), consoleReader.test,
кнопка в ConversationSettings. Гейты по всем пакетам зелёные, web/storybook build ок.
