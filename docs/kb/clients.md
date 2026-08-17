---
title: Клиенты и упаковка: web, desktop и agent-tray
updated: 2026-08-17
checked: abe980a
areas:
  - apps/web
  - apps/desktop/src
  - apps/desktop/electron-builder.yml
  - apps/agent-tray/src
  - apps/agent-tray/electron-builder.yml
---

# Клиенты и упаковка: web, desktop и agent-tray

Проект имеет три пользовательских host-приложения, но только один продуктовый React-UI. Browser и desktop renderer используют `@voicechat/ui`; agent-tray — отдельная маленькая оболочка управления компаньон-агентом без чата.

## Browser (`apps/web`)

Пакет состоит из Vite-конфига, HTML entry, `src/main.tsx` и определения server URL. `main.tsx` сначала устанавливает remote bridges, затем монтирует общий `App`. Это требование порядка: store обращается к `window.*` уже во время инициализации.

`VITE_SERVER_URL` нужен, когда backend на другом origin. В dev пустой URL идёт через Vite proxy; в Docker production web собирается для same-origin. Backend с `VC_WEB_DIR` раздаёт `dist` и SPA fallback, поэтому browser refresh на клиентском route не должен давать 404.

Здесь не размещают компоненты, состояние или fetch-логику. Исключения — host/bootstrap, Vite proxy, CSP/assets и выбор URL.

## Desktop (`apps/desktop`)

Desktop — Electron main/preload/renderer вокруг удалённого server. Он намеренно исключён из корневых npm workspaces: Electron и native `better-sqlite3` имеют отдельный lockfile/node_modules.

Main process создаёт основное окно, tray, external-link policy и хранит выбранный server URL в `remote.json`. Renderer использует тот же `installRemoteBridges`, что web; preload публикует только Electron-специфичные операции настройки URL, legacy migration и agent-mode windows. STT, TTS, LLM и новая БД не живут в desktop.

При первом запуске экран `remote-setup` просит адрес backend, нормализует/проверяет health и сохраняет его. После этого основное окно загружает общий UI. Смена адреса относится к host config и требует пересоздания remote connection.

### Legacy migration

`src/main/db` — read-only по смыслу адаптер старой `userData/voicechat.db`. После успешного входа renderer/main формирует `DesktopMigrationBundle` и отправляет его в `/api/migrations/desktop`. Серверный импорт идемпотентен по id разговоров/сообщений.

`remote.json` запоминает URL, для которого migration завершена. Один и тот же локальный архив может быть импортирован на другой выбранный сервер. Исходный файл автоматически не удаляется: это страховка и пользовательские данные.

`better-sqlite3` необходимо пересобирать под текущий ABI: `rebuild:node` перед Vitest, `rebuild:electron` перед dev/dist. Ошибка ABI обычно означает пропущенную пересборку, а не повреждение БД.

### Режим компаньон-агента

`agentMode.ts` позволяет desktop параллельно запускать локальный `@voicechat/agent`, а renderer-страницы setup/log управляют соединением. Это оболочка запуска; exec/fs/pty остаются реализацией `apps/agent`. Tray даёт быстрый доступ к основному окну и режиму машины.

Electron preload должен сохранять `contextIsolation` и публиковать минимальный API через `contextBridge`. Node primitives не выдаются renderer. Навигация и `window.open` валидируются и отправляются во внешний браузер только для разрешённых URL.

### Сборка

`electron-vite` собирает main, preload и renderer. `electron-builder.yml` определяет app id, ресурсы и macOS DMG; `afterPack.cjs` выполняет package-specific обработку. Сервер может найти DMG автоматически в `apps/desktop/release` или получить путь через `VC_DESKTOP_APP`, после чего раздаёт `/api/app/desktop`.

Команды: `npm --prefix apps/desktop install`, `npm run typecheck:desktop`, `npm run test:desktop`, `npm --prefix apps/desktop run dev`, `npm --prefix apps/desktop run dist`.

## Agent tray (`apps/agent-tray`)

Agent tray — Electron-приложение для пользователя, который предоставляет машину, но не работает с CLI. Оно хранит server URL и machine token, показывает setup, журнал, permissions и update controls, создаёт tray icon и запускает bundle агента как дочерний процесс.

`src/main/configStore.ts` отвечает за устойчивое хранение конфигурации; секрет не должен попадать в renderer log. `serverUrl.ts` нормализует http/https и производные ws/wss адреса. `trayIcon.ts` управляет меню и lifecycle окон.

Renderer намеренно простой HTML+TypeScript, без React: `setup` вводит адрес/токен, `log` показывает ограниченный поток строк, `permissions` читает и изменяет policy через сервер. Preload выдаёт только необходимые команды/события.

Поведение агента не копируется. Tray запускает распространяемый `voicechat-agent.cjs`; изменения exec/fs/pty делаются в `apps/agent`. Версия tray package и `AGENT_VERSION` независимы.

Сборка отдельная: `npm --prefix apps/agent-tray install`, `npm run typecheck:agent-tray`, `npm run test:agent-tray`, `npm run dist:agent-tray`. DMG появляется в `apps/agent-tray/release`, autodiscovery server или `VC_AGENT_APP` публикует его на `/api/agents/app`.

## Границы безопасности Electron

- renderer не получает `fs`, `child_process`, token store или произвольный IPC;
- preload валидирует аргументы и использует фиксированные channel names;
- server URL нормализуется до сохранения, credentials не включаются в URL;
- внешние ссылки открываются системно, а не навигируют privileged window;
- agent token показывается только там, где это явно нужно для setup;
- логи дочернего агента ограничиваются по размеру и не должны печатать token.

## Где делать изменение

| Изменение | Место |
|---|---|
| Новый экран/виджет чата | `packages/ui` |
| REST/WS реализация web и desktop | `packages/ui/src/remote` |
| URL/proxy/bootstrap браузера | `apps/web` |
| Окно/tray/server config/legacy import | `apps/desktop` |
| Exec/fs/pty/telemetry машины | `apps/agent` |
| Setup/log/permissions упаковки агента | `apps/agent-tray` |
| Пользовательские machines/terminal/files/LLM history/KB/CI monitor/diagnostics | `packages/operations-app` |
| Administration: users/access/history/usage, LLM engines и model prices | `packages/admin-app` |

Operations-код не знает `window`, fetch, WebSocket, SSE или Electron. Публичные интерфейсы `MachinesClient`, `TerminalClient`, `FilesClient`, `LlmObserverClient`, `KnowledgeClient`, `CiMonitorClient`, `DiagnosticsClient` и `ConsoleClient` описаны в `packages/operations-app/src/contracts.ts`; transport adapters поверх существующих host bridges в этом срезе ещё не добавлены. Транспортные протоколы не менялись.

Administration также не знает прямых transport API. `packages/ui/src/clients/browser.ts#createAdminClient` — host adapter существующего `RendererApi`: он переводит IPC channel names в методы публичного `AdminClient`. REST bridge остаётся в `packages/ui/src/remote/httpApi.ts`; backend и Electron preload не менялись.
