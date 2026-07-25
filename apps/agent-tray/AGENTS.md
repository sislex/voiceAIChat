# @voicechat/agent-tray — Electron-трей вокруг агента

Обёртка, чтобы пользователь-неразработчик подключил свою машину: иконка в трее,
экран настройки (адрес сервера + токен), лог работы, просмотр и правка разрешений
машины (синхронно с сервером), обновление агента.

**Вне npm workspaces** — свой `node_modules` с Electron. Ставится и собирается
отдельно:

```bash
npm --prefix apps/agent-tray install
npm run typecheck:agent-tray
npm run test:agent-tray
npm run dist:agent-tray        # .dmg в apps/agent-tray/release
```

Собранный `.dmg` сервер автоматически находит в `apps/agent-tray/release` и
раздаёт на `/api/agents/app` (см. `VC_AGENT_APP` в `apps/server/src/config.ts`).

Раскладка: `src/main/` (`index.ts`, `configStore.ts`, `serverUrl.ts`, `trayIcon.ts`),
`src/preload/`, `src/renderer/` (`setup`, `log`, `permissions` — простые
html+ts-страницы, без React).

Сама логика агента здесь **не дублируется** — трей запускает `@voicechat/agent`.
Меняешь поведение агента — правь `apps/agent`, а тут только UI/упаковку.
Версия пакета (`0.2.0`) — версия трея, не агента: канонная версия агента живёт в
`packages/shared/src/version.ts`.

Детали: `docs/kb/machines.md`, `README.md`.
