---
title: "Make: браузер ассистента"
updated: 2026-09-30
checked: b19c1c99
areas:
  - apps/server/src/turns.ts
  - apps/server/src/routes/rest.ts
  - apps/server/src/db/repos/chat.ts
---

# Make: браузер ассистента

План: [`make-browser-v1`](../../plans/make-browser.md). Этот срез делает первую часть
задач B01 и C01.

Исполнитель и браузер разделены. Claude или Codex выполняет ход, а страница
открывается в браузере привязанного чата Web Reader или Playwright Reader того же
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

## Выпуск (2026-09-30)

Core закрепляет Web Reader 1.3.0 (`3a662223`, маршрут в каждом ответе и
`browser_capabilities`), его контракты 1.3.0 из того же коммита, Make 1.3.0
(`94eab4f5`, `make_preview_link`), core-ui 1.4.8 и Desktop 1.0.11 (выбор браузера и
строка маршрута). Образы по умолчанию в `docker-compose.yml`: `webreader-api` и
`make-api` на этих коммитах, `llm-runner` на `849f1397` (0.3.6). Запись llm-runner в
`deploy/tools.lock.json` остаётся на пакете, закреплённом манифестом S3.

`SISLEXA_BROWSER_RUNNER_MACHINE` и `SISLEXA_BROWSER_RUNNER_IP` передаются сервису
`reader`; прод-оверлей `deploy/compose.components.yml` задаёт «Prod 89.125.68.35» и
`89.125.68.35`. Сквозная проверка — `remote.integration.test.ts`, сценарий Make в трёх
режимах встраивания.
