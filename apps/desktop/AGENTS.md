# @voicechat/desktop — исходное Electron-приложение

Первая версия продукта: renderer (React) + main (SQLite, Whisper, claude CLI,
Piper) через IPC. Сервер вырос из этого кода переносом абстракций, поэтому
`apps/desktop/src/main/**` и `apps/server/src/**` содержат почти одноимённые
модули (`stt/whisperEngine`, `tts/piperTts`, `claude/claudeCli`, `db/schema`).

**Приложение поддерживается как есть и не переписывается.** Дубликация с сервером
осознанная. Меняешь поведение движка или схему БД на сервере — проверь, нужна ли
та же правка здесь, и напиши об этом в коммите.

## Особенности

- **Вне npm workspaces**: свой `node_modules` с Electron, корневой `npm install`
  его не трогает → `npm --prefix apps/desktop install`.
- `better-sqlite3` нативный: `npm run rebuild:electron` перед dev/dist (в скриптах
  это `predev`/`predist`), `npm run rebuild:node` перед тестами (`pretest`).
- Renderer использует общий `@voicechat/ui`; мосты `window.*` реализует
  `src/preload/index.ts` поверх IPC (`src/main/ipc/handlers.ts`, `register.ts`).
  Формы мостов те же, что у web — `@shared/ipc`.
- Умеет работать **тонким клиентом**: `src/main/remoteConfig.ts` +
  `installRemoteBridges` — тогда движки берутся с сервера, а не локальные.
- Есть режим агента (`src/main/agentMode.ts`) и трей (`trayIcon.ts`).

## Команды

```bash
npm --prefix apps/desktop install
npm run typecheck:desktop
npm run test:desktop
npm --prefix apps/desktop run dev        # electron-vite dev
npm --prefix apps/desktop run dist       # .dmg в apps/desktop/release
```

Собранный `.dmg` сервер раздаёт на `/api/app/desktop` (`VC_DESKTOP_APP`).
`apps/desktop/resources/piper-voices` и собранный whisper.cpp внутри его
`node_modules` **переиспользуются сервером в dev-режиме** (см. `docs/kb/stt-tts.md`) —
не удаляй их «как мусор».
