# Web Reader отдельным сервисом (этап 4 плана «части приложения на любом сервере»)

Статус: круг 1 ☑ (2026-09-08), круг 2 ☐, круг 3 ☐. Ветка `feat/reader-service` от `main` (после #118, #119, #121, #122).

## Зачем

Цель пользователя: все части приложения, кроме чата, базы и CLI моделей, должны запускаться на любом
сервере или локально — «указать в настройках, где лежат база и чат, и как авторизоваться». После Make,
канбана, машин и админки остаётся бэкенд Web Reader: прокси превью `/api/preview` (сайты и dev-серверы
машин через компаньон-агента), MCP «browser» `/mcp/preview` (инструменты `mcp__browser__*` модели) и
исполнение действий в изолированном Chromium (Playwright Reader и браузерная проверка задач). Рецепт тот
же: явный модуль с портом к ядру, локальная реализация в ядре, HTTP-реализация для отдельного процесса,
прокси путей в ядре, compose-профиль, по умолчанию `embedded` — прод не меняется.

## Инвентарь (2026-09-08)

**Код ридера.** `routes/previewProxy.ts` (1 191 строка: роуты `/api/preview`, `/api/preview/reset-cookies`,
`/api/preview/diagnostics`; cookie-контейнер превью `cookiesByUser` в памяти процесса; SSRF-гейт публичных
адресов; мост машин `PreviewMachineBridge {isOnline, http}` для `<agentId>.machine.internal`; кэш ответов
машин; переписывание HTML/CSS и инспектор), `mcp/previewMcp.ts` (760: stateless MCP, ход адресуется
`?turn=`, in-memory `PreviewToolBroker`; `PreviewActionRelay` — транспорт «сервер → WS-клиенты
пользователя»; `PreviewTurnContext` — машина разговора, тестовые пользователи, окружения, сброс cookie,
политика evaluate), `browser/{machinePreview,checkTarget,checkShots}.ts`, сборка в `server.ts`
(~150 строк: `PreviewRunKeys`, `runnerFacingBase`, `previewRunCookie`, `browserCheckTargetOf`,
`logBrowserCheckShot`, `browserExecutor`/`browserScreenshot`, `context`).

**Что ридеру нужно от процесса ядра** (в базе этого нет):
- `PreviewActionRelay.request` — сокеты пользователей живут у ядра (`session.ts` подписывает `preview.subscribe`,
  ответы `preview.result` приходят в ядро);
- `PreviewRunKeys.issue(userId)` — ключ Chromium к прокси превью; проверяет его авторизация ядра
  (`previewRunUser` в `users/auth.ts`), поэтому реестр ключей остаётся у ядра;
- `kanban.service.previews.list()` — живые feature-preview (у ядра или за его портом к канбану);
- кадр браузерной проверки: файл в `dataDir/ci-browser-shots` ядра (его отдаёт `routes/browser.ts`),
  строка в лог рана и кадр `ci.log` в шину кадров ядра.

**Что ридеру нужно ещё:** база (разговор → задача/проект/машина, `canUseAgentForPreview`, режим проверки
задачи, тестовые пользователи, политика команд проекта), машины (`isOnline`, `http` — порт `MachinesService`,
в remote — `HttpMachines` к процессу машин или к ядру), клиент browser-runner (`VC_BROWSER_RUNNER_URL`).

**Что ядру нужно от ридера:** ничего, кроме адреса MCP превью для ходов (`previewMcpBaseUrl`) — порт
`ReaderService` не нужен.

**Разрыв, найденный на этапе канбана:** токены ходов `previewToolBroker` — память процесса. Ход CI
регистрирует токен в процессе канбана, а `/mcp/preview` проверяет его в ядре → в remote-канбане инструменты
браузера у ранов не работают. Лечится подписанными токенами: `HMAC(mcpSecret, {userId, conversationId, exp})`
— проверяются в любом процессе без состояния. Токен теперь живёт не «ровно один ход», а до `exp` (сутки);
без `?k=<секрет процесса>` он бесполезен, а секрет у исполнителя и так есть.

## Круги

### Круг 1 — модуль ридера, порт `ReaderCore`, подписанные токены ☑ (2026-09-08)
1. ☑ `reader/turnToken.ts` — `createPreviewTurnTokens(secret)`: `issue(entry)`/`verify(token)`; заменяет
   `PreviewToolBroker` в `turns.ts`, `ci/modelHooks.ts`, `kanban/module.ts`, `mcp/previewMcp.ts`
   (`RegisterPreviewMcpOptions.turns`). Поле `previewToolToken` у хода и `unregister` уходят.
2. ☑ `reader/core.ts` — порт `ReaderCore`: `previewAction`, `issuePreviewRunKey`, `listPreviews`,
   `logBrowserShot`. `readerBridge/localCore.ts` — реализация поверх relay, `PreviewRunKeys`,
   `kanban.service`, `db.ci` + `frames` ядра.
3. ☑ `reader/module.ts` — `createReaderModule(deps)`: `registerPreviewProxy` + `registerPreviewMcp` с
   контекстом, `browserExecutor`/`browserScreenshot`; `ReaderDeps` — снимок ключей в `reader/boundary.test.ts`.
   `server.ts` собирает ридер одной функцией.
4. ☑ Гейт: `npm run gate`.

### Круг 2 — отдельный процесс ☐
1. `reader/internal.ts` — `INTERNAL_READER_CORE_PATH = /internal/reader/rpc`, список методов; ядро
   регистрирует диспетчер в `routes/internal.ts` (тело до 16 МБ — кадр PNG base64).
2. `reader/standalone/{server,index,httpCore}.ts` — `buildReaderServer`: своя база (Postgres), пересылка
   авторизации в ядро (cookie превью и ключ Chromium разбирает ядро в `whoami`), `HttpMachines` к
   `VC_MACHINES_URL` или к ядру, browser-runner по env, `HttpReaderCore` — RPC к ядру; `/v1/health`. Порт 8795.
3. Ядро: `VC_READER_MODE=remote` + `VC_READER_URL` (+ `VC_READER_MCP_PUBLIC_BASE`) → `readerBridge/proxy.ts`
   (`/api/preview`, `/api/preview/*`, `/mcp/preview`; роуты Make `/api/preview/make*` конкретнее и выигрывают),
   `previewMcpBaseUrl` указывает на ридер (в ядре и в процессе канбана — общий helper).
4. Compose: сервис `reader` (профиль `reader`, образ `reader-runtime`), у ядра и канбана переменные режима.
5. Тесты: `reader/turnToken.test.ts`, `readerBridge/proxy.test.ts` (полнота префиксов по исходникам,
   приоритет путей Make), `reader/standalone/readerRemote.integration.test.ts` (ядро remote + процесс
   ридера: превью машины через прокси ядра и мост машин, MCP через подписанный токен, действие в панель
   уходит в relay ядра по RPC).

### Круг 3 — прогон на прод-копии, документация, PR ☐
1. Прогон на копии прод-БД (Postgres): ядро 8799 + ридер 8795, открыть сайт и dev-сервер машины в Reader,
   инструмент `mcp__browser__read` из чата.
2. KB: `docs/kb/deploy.md` (таблица распределённого стенда), `server-internals.md`, `apps/server/AGENTS.md`,
   журнал; PR.

## Вне объёма

Playwright Reader REST (`routes/browser.ts`: сессии Chromium разговора, кадры проверок) остаётся у ядра:
он завязан на `dataDir` кадров и `browserRunner`, и переносить его вместе с ридером — отдельное решение.
Cookie-контейнер превью — память процесса ридера (был памятью ядра): при перекате процесса сессии
тестовых окружений сбрасываются, как и раньше при рестарте ядра.

## Риски

- Ещё один сетевой хоп на каждое действие модели в панели (ридер → ядро → WS клиента): таймаут RPC берётся
  с запасом над `PREVIEW_ACTION_TIMEOUT_MS`.
- Токены ходов живут сутки, а не ход: компенсируется секретом `?k=` и тем, что токен адресует только
  пару «пользователь-разговор» этого же пользователя.
