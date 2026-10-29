---
title: "Make: браузер ассистента"
updated: 2026-10-29
checked: 4aa06d23
areas:
  - apps/server/src/turns.ts
  - apps/server/src/routes/rest.ts
  - apps/server/src/db/repos/chat.ts
  - apps/server/src/server.ts
---

# Make: браузер ассистента

План: `make-browser-v1`. Этот срез делает первую часть
задач B01 и C01. В Core нет локального `docs/plans/make-browser.md`, поэтому имя
плана приведено как текст, без относительной ссылки.

Этот файл — тема Core для поиска сведений о make-browser. Исполнитель и браузер
разделены. Claude или Codex выполняет ход, а страница открывается в браузере привязанного чата Web Reader или Playwright Reader того же
пользователя. Чат Make хранит ссылку на такой чат в `conversations.make_browser_session`
(`Conversation.makeBrowserSessionId`).

- `GET /api/conversations/:id/make-browser` — сессии пользователя в его пространстве:
  движок (`panel` или `chromium`), место выполнения (`user_panel` или
  `browser_runner`), текущий адрес, доступность и причина недоступности.
- `POST /api/conversations/:id/make-browser` `{ sessionId | null }` — привязка.
  Цель ищется по id вызывающего пользователя, поэтому чужую сессию привязать нельзя;
  привязываются только чаты Web Reader и Playwright Reader и только к чату Make.

Поле не входит в канонические настройки чата (`CHAT_SETTING_OWNERS`): этот список —
часть замороженного публичного контракта с опубликованным хэшем.

В ходе Make `turns.ts` выдаёт токен Browser MCP на привязанный чат, а не на сам чат
Make, и передаёт `previewSurface`: `chromium` для Playwright и для Web Reader в режиме
Chromium, иначе `panel`. Движок меняется переключением движка самого чата Web Reader,
без смены модели и чата Make. Промпт получает блок «Браузер Make»: какой чат и движок,
где выполняется действие, требование называть маршрут и писать «неизвестно» для
неизвестной машины, запрет молча подменять браузер и правило «файлы — только make_*».
Без нужной возможности (`web-reader.use` или `playwright-reader.use`) инструменты не
подключаются, а блок объясняет причину.

Режим `panel` выполняет действия только в клиенте, где открыт этот чат Web Reader.
Для работы без открытой панели нужен движок Chromium.

## Scoped Make execution

Browser binding is independent of machine selection. Make uses only an explicitly
configured conversation `execTarget` and `workdir`; no implicit project-machine
fallback is applied. Both Claude and Codex receive `toolOnly: true`. Core provides
scoped remote file tools and optional transfers to Make through owner raw-file
routes; `mcp/makeFiles.ts` enforces a 10 MiB limit and rejects traversal, symlinks
and protected paths. Attachment bytes are not forwarded as ordinary runner
attachments in Make turns. `makeBrowserSession` still verifies the linked chat's
owner, Reader kind and required capability before exposing browser tools.

## Historical release (2026-09-30)

Core закрепляет Web Reader 1.3.0 (`3a662223`, маршрут в каждом ответе и
`browser_capabilities`), его контракты 1.3.0 из того же коммита, Make 1.3.1
(`e43736e6`, `make_preview_link`, квоты 256 МБ на проект и 2 ГБ на пользователя,
поддержка длинного подписанного URL предпросмотра), core-ui 1.4.8 и Desktop 1.0.11
(выбор браузера и строка маршрута). Образы по умолчанию в `docker-compose.yml`: `webreader-api` и
`make-api` на этих коммитах, `llm-runner` на `849f1397` (0.3.6). Запись llm-runner в
`deploy/tools.lock.json` остаётся на пакете, закреплённом манифестом S3.

`SISLEXA_BROWSER_RUNNER_MACHINE` и `SISLEXA_BROWSER_RUNNER_IP` передаются сервису
`reader`; прод-оверлей `deploy/compose.components.yml` задаёт «Prod 89.125.68.35» и
`89.125.68.35`. Сквозная проверка — `remote.integration.test.ts`, сценарий Make в трёх
режимах встраивания.

## Signed preview URL routing

`make_preview_link` signs a UUID conversation ID and expiry into the `/p/<token>/`
path. The resulting token exceeds Fastify's 100-character route-parameter default.
Core's `/p/*` proxy and the standalone Make `/p/:token/*` route both allow parameters
up to 1024 characters; longer parameters still return HTTP 414. A release must update
both services before browser engines can read a project's own preview.
