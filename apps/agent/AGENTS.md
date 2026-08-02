# @voicechat/agent — компаньон-агент на машине пользователя

Консольное приложение: подключается к серверу по WS (`/agent`), авторизуется
токеном машины и выполняет команды, файловые операции, живой PTY, шлёт телеметрию.
Работает на Linux, macOS, Android (Termux) и Windows. На Windows с 0.9.2 `exec`
и PTY идут через `bash.exe` (Git for Windows), если он есть — то же самое место
поиска, что в установщике (PATH → стандартные пути Git for Windows); нет bash —
деградация в `cmd.exe` (ConPTY только если рядом собран node-pty).

## Раскладка

`index.ts` (CLI-аргументы/env, запуск), `config.ts`, `connection.ts` (WS,
реконнект с backoff до 30 с, маршрутизация сообщений), `exec.ts` (спавн команды,
стрим stdout/stderr, таймаут, отмена), `pty.ts` (живой терминал через
`@lydell/node-pty`), `fileOps.ts` (проводник), `telemetry.ts`, `platform.ts`.

## Правила

- **Любой спавн — через `platform.ts` (`resolveShell()`/`resolveShellInfo()`)**,
  никогда не хардкодь `/bin/bash`: в Termux его нет, бинарники в
  `/data/data/com.termux/files/usr/bin`, PATH бывает урезан; на Windows ищем
  `bash.exe` (PATH → пути Git for Windows) и только потом падаем в `cmd.exe`.
  `exec` и `pty` обязаны выбирать shell одинаково. `resolveShellInfo()` отдаёт
  ещё `degraded`/`ignoredOverride` — `connection.ts` логирует их через `onLog`,
  а `telemetry.ts` кладёт в `agent.telemetry.os.shell`/`shellDegraded` (видно на
  карточке машины в UI). Unix-подобный `SHELL`/`VC_PTY_SHELL` (`/bin/...`) на
  Windows не используется — это унаследованное окружение, а не путь для `spawn`.
- Агент раздаётся как **самодостаточный `voicechat-agent.cjs`**, который собирает
  сервер (`apps/server/src/agents/agentScript.ts`, esbuild, CJS). Значит: новые
  зависимости должны бандлиться или быть опциональными. `@lydell/node-pty`
  нативный и намеренно **не** бандлится — грузится `require` в рантайме, при
  отсутствии `startPty` ловит ошибку и терминал деградирует, `exec` продолжает
  работать. Такой же приём применяй к любой новой нативной зависимости.
- Новая возможность → бампни `AGENT_VERSION` и допиши `TOOL_MIN_VERSION` в
  `packages/shared/src/version.ts`, иначе сервер разрешит вызов старому агенту.
- Гейт политики (`evaluateAgentCommand`) применяется к однострочному `exec`;
  внутри живого PTY per-command гейта нет — это доверенный shell пользователя.
- Модули без WS (exec, fileOps, telemetry, platform, pty, shutdown, singleInstance)
  тестируются напрямую; так и держи — не тащи сокет в логику.
- **Один агент на токен.** `singleInstance.ts` берёт pid-блокировку по хешу токена
  (файл в `os.tmpdir()`); второй процесс с тем же токеном тихо выходит. Ключ —
  токен, а не каталог: та же машина, поставленная дважды в разные каталоги, обязана
  конфликтовать. Блокировка ждёт до 10 с — при обновлении новый процесс стартует
  раньше, чем уходит старый, и без ожидания машина осталась бы вообще без агента.
- Сигналы обрабатываются явно (`shutdown.ts`) — иначе процесс наследует от
  родителя `SIG_IGN` на SIGTERM и не гасится `pkill`.

Запуск для разработки:
`npx tsx apps/agent/src/index.ts --server ws://<сервер>:8787/agent --token <токен>`
(или `VC_AGENT_SERVER` / `VC_AGENT_TOKEN`).

Гейт: `npm run -w @voicechat/agent typecheck && npm run -w @voicechat/agent test`.
Подробности: `docs/kb/machines.md`, `README.md`, `ANDROID.md`, `WINDOWS.md`.
