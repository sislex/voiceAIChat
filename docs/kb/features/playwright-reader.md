---
title: Playwright Reader и browser-runner
updated: 2026-08-25
checked: 8db94ee2
areas:
  - apps/browser-runner/src
  - packages/shared/src/types.ts
  - packages/playwright-reader-app
  - packages/ui/src/App.tsx
  - packages/ui/src/store/domains/chatStore.ts
  - apps/server/src/db/database.ts
  - apps/server/src/routes/rest.ts
---

# Playwright Reader и browser-runner

## Независимый frontend domain

`@voicechat/playwright-reader-app` владеет route `#/playwright-reader[/conversationId]`, фильтруемым по `assistantKind: 'playwright-reader'` conversation read model, browser-панелью и собственным store/module lifecycle. Chat приходит через `ReaderChatPort`, а сессия — через создаваемый host-адаптером `BrowserSessionPort`; прямых imports host, Web Reader, `chatStore`, transport, browser storage или исходников browser-runner в пакете нет.

Локальная frontend-модель `BrowserSessionState` имеет состояния `idle`, `starting`, `connected`, `stopped`, `error` и capabilities `chromium`, `navigate`, `screencast`. При активации предыдущая session отписывается и dispose-ится, новая запускается для выбранного `conversationId`; смена разговора защищена generation token, `stop` делегируется session, общий dispose очищает подписки и session. UI не заявляет Chromium подключённым при `capabilities.chromium === false`, показывает явную недоступность и блокирует навигацию без `navigate`. Это честная деградация по возможностям adapter; полноценная server orchestration Chromium по-прежнему не реализована.

## Что это и чем отличается от Web Reader

Playwright Reader — отдельный продуктовый режим: слева обычный чат ChatAI, справа
предполагается настоящий изолированный Chromium под управлением Playwright.
Существующий Web Reader (`assistantKind: 'web-recorder'`, iframe поверх
`/api/preview`, `postMessage`-контракт рекордера) остаётся рабочим и не
затрагивается: см. [ui.md](../ui.md#web-reader--отдельная-страница). Общего у них
нет ничего, кроме переиспользованных React-компонентов чата и split-раскладки;
`projectId` у Playwright Reader всегда `null`, проектный контекст не применяется.

## Что реализовано, а что нет

Полной интеграции с изолированным Chromium ещё нет. Реализованы тип разговора,
маршрут с левой панелью чата, shared-контракты браузерной сессии и отдельный
сервис `apps/browser-runner`. Для рабочей панели превью маршрут Playwright Reader
пока монтирует общий `WebReaderHost`: поэтому `mcp__browser__*` доступны в этом
режиме и привязаны к активному `conversationId`, но исполняются существующим
iframe-рекордером, а не `browser-runner`. URL хранится в разговоре, поэтому host
и его привязка восстанавливаются после refresh. При переключении чатов
регистрация runner-а пересоздаётся с новым `conversationId`; команда старого
чата отклоняется до обращения к панели.

Механика привязки одна на оба Reader-режима и живёт в `AppBody`
(`packages/ui/src/App.tsx`): `previewRunnerRef` хранит не голый runner, а пару
`{ conversationId, runner }`, снятие регистрации обнуляет ссылку только для
своего чата, а обработчик моста пропускает действие лишь при совпадении
активного чата, Reader-маршрута (`inReader || inPlaywrightReader`) и
`conversationId` регистрации. После refresh чат берётся из адреса: в
`useVoiceStore` передаётся `routeChatId ?? routeReaderChatId ??
routePlaywrightReaderChatId`, поэтому `#/playwright-reader/<id>` сразу даёт
активный чат, host монтируется с сохранённым в разговоре `previewUrl` и
привязка восстанавливается без действий пользователя. Диагностика осталась
различимой: «не открыт на странице Reader» ≠ «панель активного чата не
открыта или ещё не подключена» ≠ тексты самого host-а про неготовую страницу.
Формулировки и цепочка команд — в
[ui.md](../ui.md#действия-модели-в-превью-mcp__browser__). Регрессии — в
`packages/ui/src/App.dom.test.tsx` (open/read в Playwright-чате, повторное
монтирование после refresh, отказ команде прежнего чата при переключении) и в
`packages/ui/src/WebPreview.dom.test.tsx` (жизненный цикл find/click/type).

Не реализованы: серверная оркестрация сессий browser-runner (REST/WS, проверка
владения разговором, service-токен раннера), screencast и передача кадров,
пользовательский ввод в Chromium, DOM/accessibility snapshot Chromium,
highlight, confirmation gates опасных действий, метрики и настоящий
health-probe, idle-timeout и retention профилей.

## Тип разговора и сервер

Добавлено значение `assistantKind: 'playwright-reader'` (константа
`PLAYWRIGHT_READER_KIND` и union `AssistantKind = 'web-recorder' |
'playwright-reader' | 'kanban'` в `packages/shared/src/types.ts`; поле
`Conversation.assistantKind` из `string | null` сужено до `AssistantKind | null`).
Схема SQLite не менялась — значение ложится в существующую колонку
`conversations.assistant_kind`.

В `apps/server/src/db/database.ts` тип принимает `createConversation`, оба запроса
списка/поиска разговоров пропускают его наравне с `web-recorder`
(`assistant_kind IS NULL OR assistant_kind IN ('web-recorder',
'playwright-reader')`), а маппер строки признаёт третье значение. Поэтому
Playwright-чаты приходят в обычный `conversations:list`, и отдельного серверного
списка для них нет. `setConversationProject` теперь сначала читает разговор и
возвращает `null`, если это Playwright Reader, а `projectId` не `null`: привязка к
проекту запрещена контрактом режима. `POST /api/conversations`
(`apps/server/src/routes/rest.ts`) принимает `assistantKind` из двух значений,
любое другое молча даёт обычный разговор; та же пара разрешена в IPC-аргументе
`conversations:create` (`packages/shared/src/ipc.ts`).

## Shared-контракты браузерной сессии

Формы лежат в `packages/shared/src/types.ts` и уже экспортируются наружу
(`packages/shared/src/index.ts` реэкспортирует весь `types`), но пока их
использует только browser-runner: `BrowserSessionState` (`idle | starting | ready
| reconnecting | stopping | stopped | failed`), `BrowserViewport`, `BrowserTab`,
`BrowserError` с фиксированным набором кодов, `BrowserSessionMetadata`
(с `incarnation`), `BrowserFrameMetadata` (incarnation + tabId + sequence + mime +
timestamp), `BrowserInputAction` и `BrowserCommandRequest` (requestId, incarnation,
tabId, actor `user | assistant`, командный union navigate/back/forward/reload/stop/
newTab/selectTab/closeTab/resize/input/screenshot).

Рядом три чистые функции, пригодные для юнит-тестов и будущего UI:
`isPlaywrightReaderConversation` (по `assistantKind`),
`shouldApplyBrowserFrame` (кадр применяется только при совпадении incarnation и
активной вкладки и строго возрастающем `sequence`) и `scaleBrowserCoordinates`
(пересчёт координат отрисованного кадра в координаты viewport с клампом).
Одноимённый предикат есть и в сторе UI — это разные функции.

## apps/browser-runner

Новый npm-workspace `@voicechat/browser-runner` (добавлен в корневой
`package.json`), устроенный как `apps/llm-runner`: не компилируется в JS,
запускается `tsx src/index.ts`, относительные импорты с `.js`. Зависимости —
`fastify` и `playwright` (в lock-файле 1.62.1); после появления воркспейса нужен
`npm install`, а для реального запуска — установленные бинарники Chromium, иначе
даже `npm run -w @voicechat/browser-runner typecheck` падает на отсутствующем
модуле `playwright`. Пакетные детали — `apps/browser-runner/AGENTS.md`.

`buildBrowserRunner()` (`src/server.ts`) отделён от `listen()` (`src/index.ts`) и
принимает готовый `BrowserSessionManager`, поэтому в тестах подменяется фейком.
Весь префикс `/v1/*` закрыт одним service-токеном (`VC_BROWSER_RUNNER_TOKEN`,
сравнение `timingSafeEqual` в `src/security.ts`); без токена процесс не стартует.
Роуты: `GET /v1/health`, `POST /v1/sessions` (идемпотентный старт),
`POST /v1/sessions/:id/commands`, `DELETE /v1/sessions/:id`. Health сейчас
формальный — `browser.present` и `launch.ok` захардкожены, реально считается
только число живых сессий.

Живой прогон 2026-08-25 (macOS): раннеру достаточно `npx playwright install
chromium` — качается только Chrome Headless Shell (~95 МБ), полный Chromium для
`headless: true` не нужен. Цепочка start → navigate → input(click) → screenshot
работает end-to-end: instagram.com (который через `/api/preview` зависает на
сплэше — см. server-internals) в Chromium рендерится полностью, включая форму
логина и cookie-баннер Meta; координатный клик закрывает баннер, screenshot
отдаёт PNG вьюпорта бинарным телом. SSRF-роут `context.route` внешним CDN
(static.cdninstagram.com) не мешает. Сам вход не проверялся: UI-панель Playwright
Reader к раннеру ещё не подключена (см. «Что реализовано, а что нет»), а логин с
паролем — действие пользователя, не ассистента.

Идемпотентность старта держится на том, что в `Map` кладётся **промис** сессии, а
не готовый объект: параллельные вкладки получают один Chromium, упавший старт
удаляет запись. Раннер не знает про пользователей ChatAI: он получает
непрозрачные `userKey`/`conversationKey` и лишь сверяет, что повторный старт того
же `sessionId` пришёл с той же парой (`session identity mismatch`). Ownership
обязан проверять вызывающий сервер.

Профиль — `chromium.launchPersistentContext` в каталоге
`profilePath(root, userKey, conversationKey)`: `sha256(userKey\0conversationKey)` в
base64url, шардирование по первым двум символам, `mkdir` с `mode 0o700` и явная
проверка, что результат лежит под корнем. Пользовательские идентификаторы не
становятся сегментами пути, path traversal невозможен. Корень —
`VC_BROWSER_DATA_DIR` (по умолчанию `./data/browser-profiles`), порт 8791, хост
`0.0.0.0`. Контекст запускается headless, с `acceptDownloads: false`, пустым
списком permissions и разрешёнными service workers.

Сетевая политика — один `context.route('**/*')` на весь контекст: `validatePublicUrl`
пропускает только `http`/`https`, режет `localhost`, `*.localhost`, `*.local` и
литеральные приватные адреса, вычищает user/password из URL; затем `dns.lookup`
всех адресов хоста, и любой приватный адрес в ответе даёт
`route.abort('blockedbyclient')`. Список блокируемых диапазонов — в
`isBlockedAddress` (`src/security.ts`: 0/8, 10/8, 127/8, 169.254/16, 172.16–31,
192.168/16, 224+ и IPv6 `::1`, `::`, `fe80:`, `fc*`, `fd*`). Проверенный адрес не
пиннится к соединению, так что от DNS rebinding это защищает не полностью. Ошибка
любой проверки — тоже abort, то есть политика fail-closed.

Команды исполняет `BrowserSessionManager.command`: сначала сверяется `incarnation`
(иначе `stale_incarnation`), потом вкладка (`stale_tab`), дальше прямой вызов
Playwright. `server.ts` переводит эти строки в статусы 404 / 409 / 422. Ответ на
любую команду, кроме скриншота, — актуальная `BrowserSessionMetadata`; скриншот
возвращается сырыми байтами и всегда с заголовком `image/png`, независимо от
запрошенного формата. В метаданных `state` пока всегда `'ready'`, а `title`
вкладок и страницы — пустые: раннер их не читает.

## Маршрут и UI

UI-поверхность описана в [ui.md](../ui.md#отдельный-режим-playwright-reader):
hash-маршруты `#/playwright-reader[/<conversationId>]`, пункт меню в `Sidebar`,
собственный список чатов в сторе и общая с Web Reader правая панель
`WebReaderHost` (её подпись в DOM — «Web Reader», проектный URL в этом режиме не
передаётся). Разметки-заглушки Chromium в приложении больше нет; её CSS-правила
`.playwright-browser-pane` и `.playwright-reader-header` остались в
`packages/ui/src/styles/app.css` мёртвыми и пригодятся, когда появится настоящая
панель раннера.
