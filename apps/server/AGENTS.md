# @voicechat/server — бэкенд (Fastify)

REST + WS, SQLite, Whisper, Piper/say, claude/codex CLI, реестр машин, MCP-мост,
входящий Anthropic-gateway, раздача собранного web.

## Особенности, которые надо помнить

- **Не компилируется в JS.** Запуск — `tsx src/index.ts` прямо из исходников,
  ESM. Поэтому **все относительные импорты пишутся с `.js`** (`./config.js`),
  хотя файлы `.ts`.
- **`buildServer()` отделён от `listen()`** (`server.ts` / `index.ts`), а внешние
  зависимости инъектируются через `BuildOptions`: `db`, `claude`, `codex`,
  `sttEngine`, `ttsEngine`, `createWsHandlers`, `sessionSecret`. Новый внешний
  ресурс добавляй так же — иначе тест придётся ставить на реальный CLI.
- **Ходы модели процесс-глобальны** (`turns.ts`) и переживают обрыв WS; сохранение
  ответа в БД делает сервер, не клиент.
- Per-connection состояние (микрофон, озвучка, подписки tail/PTY) — `session.ts`;
  `ws.ts` только разбирает кадры и маршрутизирует.
- Все `/api/*` закрыты Bearer-токеном (`users/auth.ts`, список публичных путей —
  `isPublic`); данные фильтруются по `uid(req)`.

## Раскладка

`config.ts` (env → артефакты репо → дефолты), `server.ts`, `index.ts`, `ws.ts`,
`session.ts`, `turns.ts`, `uploads.ts`;
`routes/` (`rest.ts`, `agents.ts`, `admin.ts`), `users/`,
`db/` (схема + `fts.ts` — экранирование запроса для FTS5-поиска по сообщениям),
`stt/` (whisper, модели, скачивание, wav), `tts/` (piper, say, каталог, голоса),
`claude/`, `codex/`, `cc/` (наблюдатель сессий Claude Code),
`agents/` (реестр машин, WS-агента, сборка `.cjs`, установка на Android),
`mcp/remoteBashMcp.ts`, `anthropic/gateway.ts`, `system/` (ресурсы и возможности),
`auth/loginStatus.ts`, `diarization/` (заглушка).

## Тесты

`vitest run`, файлы рядом. HTTP — через `app.inject()`, WS — ws-клиентом, движки и
`spawn` — моками, БД — `:memory:`. Реальные `claude`/`codex`/`whisper-cli` в тестах
не запускаются. Помни про `AUTODISCOVER = !process.env.VITEST` в `config.ts`.

Гейт: `npm run -w @voicechat/server typecheck && npm run -w @voicechat/server test`.

Детали: `docs/kb/protocol.md`, `docs/kb/llm.md`, `docs/kb/stt-tts.md`,
`docs/kb/data-auth.md`, `docs/kb/machines.md`.
