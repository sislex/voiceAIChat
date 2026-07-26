# @voicechat/desktop — тонкая Electron-оболочка

Renderer использует общий `@voicechat/ui` и всегда подключается к `apps/server`
через те же REST/WS-мосты, что browser. Main-процесс отвечает только за окно,
трей, настройку URL сервера и режим компаньон-агента.

`better-sqlite3` и `src/main/db` временно оставлены только как ридер старой
`userData/voicechat.db`: после первого успешного логина разговоры идемпотентно
импортируются на выбранный сервер, а URL помечается мигрированным в `remote.json`.
Пользовательский файл БД автоматически не удаляется. STT/TTS/LLM и хранение
принадлежат серверу.

## Особенности

- **Вне npm workspaces**: свой `node_modules` с Electron, корневой `npm install`
  его не трогает → `npm --prefix apps/desktop install`.
- `better-sqlite3` нужен только для legacy-импорта: `rebuild:electron` перед сборкой,
  `rebuild:node` перед тестами.
- Renderer вызывает `installRemoteBridges` из `@voicechat/ui`; preload публикует
  только управление URL, миграцию legacy-БД и окна режима агента.
- Есть режим агента (`src/main/agentMode.ts`) и трей (`trayIcon.ts`).

## Команды

```bash
npm --prefix apps/desktop install
npm run typecheck:desktop
npm run test:desktop
npm --prefix apps/desktop run dev
npm --prefix apps/desktop run dist
```

Собранный `.dmg` сервер раздаёт на `/api/app/desktop` (`VC_DESKTOP_APP`).
