# @voicechat/playwright-reader — отдельное приложение Playwright Reader

REST `/api/browser/:id/{start,command,screenshot}`, остановка сессии и выполнение
браузерных инструментов модели. Работает как модуль ядра или отдельный процесс,
по той же схеме, что `apps/make`. UI — `packages/playwright-reader-app`, Chromium
и его профили — `apps/browser-runner`; приложение само браузер не запускает.

- `PlaywrightReaderCore` (`src/core.ts`) — доступный разговор, цель модели,
  ключ к прокси машины и запись кадра проверки. Локальная реализация —
  `apps/server/src/playwrightReaderBridge/localCore.ts`, HTTP — `src/standalone/httpCore.ts`.
  Своей БД, пользовательской авторизации и файлового тома у приложения нет.
- `PlaywrightReaderService` (`src/service.ts`) — `execute`/`screenshot`; сборка —
  `createPlaywrightReaderModule`. MCP `/mcp/preview` у Web Reader вызывает этот порт.
  Ответ команды находится в `result`; `null` означает обычную панель, ошибка Chromium
  возвращается явно и не запускает relay в iframe пользователя.
- В standalone cookie/Bearer/CSRF каждого запроса перепроверяются ядром через
  `/internal/whoami`; внутренние RPC закрыты общим `VC_INTERNAL_TOKEN`.
  Контракт маршрутов RPC и результатов — `packages/shared/src/playwrightReader.ts`.
- HTTP-клиент раннера импортируется только из `@voicechat/browser-runner/client`:
  этот экспорт не загружает Playwright и ничего не запускает.
- Относительные импорты с `.js`, запуск через `tsx`, комментарии по-русски.
  Граница с ядром проверяется `src/boundary.test.ts` и тестом в `playwrightReaderBridge/`.

## Запуск

`npm run -w @voicechat/playwright-reader start`: `PORT` (8797), `HOST` (127.0.0.1),
`VC_CORE_URL`, `VC_INTERNAL_TOKEN`, `VC_BROWSER_RUNNER_URL` + `VC_BROWSER_RUNNER_TOKEN`,
`VC_BROWSER_PREVIEW_BASE` (origin прокси глазами Chromium). У ядра —
`VC_PLAYWRIGHT_READER_MODE=remote`, `VC_PLAYWRIGHT_READER_URL`; по умолчанию embedded.
MCP-секрет нужен ядру/Web Reader, приложение использует только внутренний токен.

Docker: сервис `playwright-reader`, стадия `playwright-reader-runtime`, порт 8797.
Caddy отправляет `/api/browser/*` напрямую, ядро также проксирует эти пути.

## Проверки

`npm run gate:fast`. Unit-тесты рядом с исходниками; проверки ядра и приложений на
реальных HTTP-портах — `apps/server/src/playwrightReaderBridge/remote.integration.test.ts`.
Реальный Chromium в этих тестах не запускается.

Web Reader с `previewEngine: chromium` использует тот же порт и сессию. Проверяй
`isChromiumReaderConversation`, а не только assistantKind. Start выпускает cookie
preview; app.internal/machine.internal проходят через runnerFacingBase. Screenshot
добавляет логический page.url/title командой status, не меняющей lastActor.
