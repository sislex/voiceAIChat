---
title: Playwright Reader и browser-runner
updated: 2026-09-10
checked: bdb1706c
areas:
  - apps/browser-runner/src
  - apps/server/src/browser
  - apps/playwright-reader
  - apps/server/src/playwrightReaderBridge
  - apps/server/src/routes/browserShots.ts
  - packages/shared/src/playwrightReader.ts
  - packages/shared/src/browserFrames.ts
  - packages/shared/src/browserProfile.ts
  - packages/shared/src/types.ts
  - packages/shared/src/ipc.ts
  - packages/playwright-reader-app
  - packages/ui/src/App.tsx
  - packages/ui/src/components/BrowserSessionPane.tsx
  - packages/ui/src/remote
  - packages/ui/src/store/domains/chatStore.ts
  - apps/server/src/db/database.ts
  - apps/server/src/routes/rest.ts
---

# Playwright Reader и browser-runner

## Независимый frontend domain

`@voicechat/playwright-reader-app` владеет route `#/playwright-reader[/conversationId]`, фильтруемым по `assistantKind: 'playwright-reader'` conversation read model, browser-панелью и собственным store/module lifecycle. Chat приходит через `ReaderChatPort`, а сессия — через создаваемый host-адаптером `BrowserSessionPort`; прямых imports host, Web Reader, `chatStore`, transport, browser storage или исходников browser-runner в пакете нет.

Локальная frontend-модель `BrowserSessionState` имеет состояния `idle`, `starting`, `connected`, `stopped`, `error` и capabilities `chromium`, `navigate`, `screencast`. При активации предыдущая session отписывается и dispose-ится, новая запускается для выбранного `conversationId`; смена разговора защищена generation token, `stop` делегируется session, общий dispose очищает подписки и session. UI не заявляет Chromium подключённым при `capabilities.chromium === false`, показывает явную недоступность и блокирует навигацию без `navigate`. Это деградация по возможностям adapter. Серверная оркестрация уже работает и принадлежит `apps/playwright-reader`; registry frontend пока остаётся переходным composition path (см. `architecture.md`).

## Что это и чем отличается от Web Reader

Playwright Reader — отдельный продуктовый режим: слева обычный чат ChatAI, справа
работает изолированный Chromium под управлением Playwright.
Существующий Web Reader (`assistantKind: 'web-recorder'`, iframe поверх
`/api/preview`, `postMessage`-контракт рекордера) остаётся рабочим и не
затрагивается: см. [ui.md](../ui.md#web-reader--отдельная-страница). Они используют общий
MCP-вход `/mcp/preview`, компоненты чата и split-раскладку. Проект разговора может
давать машине и инструментам контекст; выбор Chromium не зависит от наличия проекта.

Разделение не означает «Web Reader только читает, Playwright Reader только тестирует».
В обоих режимах ассистент может читать страницу и взаимодействовать с ней. Web Reader
через `apps/web-recorder/src/Recorder.tsx` также предоставляет выбор элемента, запись
сценария и экспорт в Playwright. Его действия исполняются в проксированной странице
пользовательской панели; Playwright Reader передаёт их отдельному Chromium через
`apps/playwright-reader/src/module.ts` и browser-runner. Поэтому одинаковое имя
инструмента не означает одинаковую браузерную среду или поддержку всех действий:
например, `edits` относится к edit-режиму прокси и отклоняется в Chromium
(`packages/shared/src/browserActions.ts`).

### Открытие страниц проекта: цикл проверки 01 (2026-09-10)

Доверенный `VC_BROWSER_PREVIEW_ORIGIN` и цели `VC_BROWSER_HOST_ALIASES` проверяются
до запрета private IP в `validatePublicUrl`: собственный localhost-стенд и его
JS/fetch/iframe должны открываться и после подстановки алиаса. Доверие ограничено
конкретным `host:port`; указанный порт не разрешает соседние сервисы того же хоста.
Цель без порта разрешает только стандартные 80/443. Разбор алиасов поддерживает
IPv6 в квадратных скобках, нормализует порты и отбрасывает URL, credentials,
пути и неверные порты вместо частичной подстановки (`security.ts`).

Ручной `/api/browser/:id/start` и старт для модели устанавливают одинаковую
cookie доступа к прокси через `apps/playwright-reader/src/sessionAccess.ts`.
Ручные `navigate`/`newTab` преобразуют `*.machine.internal` через общий
`machinePreviewUrl`, как `browser.open` модели. Прежний ручной путь обходил эту
подготовку, поэтому страница машины работала у модели, но не открывалась из панели.

Команды истории, reload и newTab ждут `domcontentloaded` с пределом 30 секунд,
как navigate: зависшее изображение не задерживает готовый DOM. Неверный selectTab
возвращает `stale_tab`, сохраняя активную вкладку; newTab доступен и после закрытия
последней. Раннер выставляет MIME-тип фактического формата screenshot, в том числе
`image/jpeg` для кадров панели (`sessionManager.ts`, `server.ts`).

Живые регрессии раннера — `apps/browser-runner/src/sessionNavigation.test.ts`;
полная цепочка интерфейс → REST → Chromium и MCP → тот же Chromium —
`e2e/playwrightReader.e2e.test.ts`. E2E поднимает отдельный стенд с временной БД,
входит локальной тестовой учёткой и открывает chat/Make/Images. Журнал 20 циклов,
пункты и измеренные интервалы — `docs/plans/playwright-reader-20-cycles.md` и
соседний JSON; каждый цикл закрывается только после собственного полного гейта.

### Сохранение входа и очистка сайтов: цикл проверки 11 (2026-09-10)

Ручной REST-start и цель модели Reader передают `profileMode: persistent`, в том
числе через standalone RPC. QA сохраняет прежний одноразовый профиль. Chromium
хранит localStorage, IndexedDB, CacheStorage и service workers в своём каталоге;
`.reader-state.json` дополняет его сессионными cookie, последним публичным URL,
viewport и посещёнными origin. Запись атомарная с правами 0600, новые каталоги
0700; файл и значения cookie не выдаются по API. Повреждённое состояние не мешает
запуску. Восстанавливается активный адрес, а не весь набор вкладок или история.
SessionStorage принадлежит прежней вкладке и после перезапуска не восстанавливается.

Панель стартует без навязанного размера, отражает восстановленный пресет или
нестандартный viewport и сохраняет его при перезапуске. Явный viewport старта
важнее сохранённого. Cookie прокси устанавливаются до восстановления адреса;
переход снова проверяет политику URL и ограничен 10 секундами. Недоступная последняя
страница оставляет сессию доступной и предупреждение в журнале Chromium.
`stop/start` сериализованы по id: старая incarnation не удаляет новую запись или
каталог. Неверные cookie старта отклоняются до запуска; ошибка инициализации
после launch закрывает context. Закрытие менеджера ждёт начатые остановки и
отклоняет новые старты. Сборщик простоя освобождает процесс и сохраняет профиль Reader.

`clearSiteData` по умолчанию очищает origin активной страницы. `scope: all`
охватывает посещённые origin, включая iframe, закрытые страницы и сохранённые
посещения. Необязательный `host` ограничивает all одним реальным доменом или
публичным алиасом; ошибочная строка отклоняется до изменения данных. Нативная
очистка удаляет localStorage, IndexedDB, CacheStorage, service workers, файловые
хранилища и sessionStorage открытых документов, а также HttpOnly-cookie всех
путей соответствующего домена. Cookie принадлежат домену, а не порту: несколько
алиасов одного loopback-host разделяют cookie, даже если их хранилища различаются
по origin. Bootstrap-cookie доступа к прокси сохраняется.

MCP `reset-session` вызывает эту команду в целевом Chromium: без host — все сайты
сессии, с host — выбранный домен. После подтверждённого успеха очищается также
cookie jar прокси; обычный Web Reader сохраняет прежний jar-only путь. Поля
`ok`, `clearedCookies`, `clearedOrigins` обязательны для подтверждения: ready-ответ
старого раннера не считается выполнением. При ошибке панель показывает причину
и не перезагружает страницу. Нативные регрессии: `sessionProfiles.test.ts`;
E2E проверяет повторное открытие собственного chat после рестарта/перезагрузки
панели и вход/очистку тестового сайта через MCP и кнопку панели. Внешние аккаунты
этими проверками не затрагиваются.

## Приложение `apps/playwright-reader` (2026-09-09)

Backend вынесен в workspace `@voicechat/playwright-reader`: `routes.ts` обслуживает
прежний REST `/api/browser/*`, `module.ts` собирает его с исполнением команд модели,
`standalone/server.ts` запускает тот же модуль самостоятельным Fastify-процессом.
У приложения нет БД, своего входа пользователя или файлов профилей. Эти границы
держат тесты `boundary.test.ts` приложения и `playwrightReaderBridge/boundary.test.ts` ядра.

`PlaywrightReaderCore` — четыре метода: разговор, доступный пользователю;
цель модели (сессия Reader по разговору или Chromium-проверка по задаче);
ключ прокси машины; запись PNG в ленту проверки. Реализация над БД/ключами/лентой
живёт в `apps/server/src/playwrightReaderBridge/localCore.ts`, отдельный процесс
получает её через `/internal/playwright-reader/core`. Снимки CI по-прежнему пишет
ядро, отдаёт `routes/browserShots.ts`; переноса файлов или миграции данных нет.

`PlaywrightReaderService` (`execute`, `screenshot`, `control`) подключает Chromium к общему MCP
`/mcp/preview`. Встроенный Web Reader вызывает этот порт напрямую; отдельный —
через `/internal/playwright-reader/service` у приложения, либо у ядра, если
Playwright Reader встроен. Cookie прокси и преобразование URL `*.machine.internal`
сохраняются. HTTP-клиент раннера теперь находится в `apps/browser-runner/src/client.ts`
и экспортируется как `@voicechat/browser-runner/client`, без загрузки самого Playwright.
Старый `apps/server/src/browser/runnerClient.ts` — совместимый реэкспорт для CI/QA.

Отдельный процесс пересылает исходные cookie/Bearer/CSRF в `/internal/whoami` на
каждом запросе. Доступ к чужим разговорам закрывает ядро, тип Reader проверяет
приложение. Внутренние пути закрыты `VC_INTERNAL_TOKEN`, методы RPC перечислены в
`packages/shared/src/playwrightReader.ts`; тело до 16 МБ для PNG/upload. REST без
раннера отвечает 501. Для модели отсутствие раннера возвращает явную ошибку;
только обычные разговоры получают `null` и переходят в relay панели пользователя.
Результат чтения передаётся полем `result`: прежнее `data` терялось в MCP и
превращало успешное чтение в `{}`. Ошибки селекторов сохраняются как ошибки MCP.

В dev/desktop по умолчанию `embedded`. У ядра `VC_PLAYWRIGHT_READER_MODE=remote`
и `VC_PLAYWRIGHT_READER_URL`; приложение запускается командой
`npm run -w @voicechat/playwright-reader start` на порту 8797. Нужны `VC_CORE_URL`,
общий `VC_INTERNAL_TOKEN`, адрес/токен browser-runner и `VC_BROWSER_PREVIEW_BASE`.
В compose сервис включён по умолчанию, как Make; Caddy и прокси ядра сохраняют
тот же публичный `/api/browser/*`. Подробности окружения — `deploy.md` и
`apps/playwright-reader/AGENTS.md`. `/v1/health` показывает здоровье процесса,
версию и наличие настройки раннера, не подтверждает запуск Chromium.

Регрессии: тесты приложения и `playwrightReaderBridge/remote.integration.test.ts`
(Playwright remote + Web Reader embedded/remote, Playwright embedded + Web Reader remote):
настоящие HTTP-порты, Bearer/cookie+CSRF, чужой разговор, DELETE без тела, RPC-гейт,
текст страницы и PNG через MCP. Chromium подменён фейком.

## Связка «оркестрация + панель» (2026-08-25)

Панель Playwright Reader подключена к реальному browser-runner. На маршруте
`#/playwright-reader` `App.tsx` монтирует не `WebReaderFrame` (iframe поверх
`/api/preview`), а `BrowserSessionPane` (`packages/ui/src/components`) поверх
изолированного Chromium; `WebReaderFrame` остался только у Web Reader. Живой
прогон 2026-08-25: instagram.com (который прокси не поднимает) открылся в панели,
клик по кадру закрыл cookie-баннер Meta.

Слои связки:
- **Контракт** (`packages/shared`): REST-пути `browserSessionStart/Command/
  Screenshot` и `browserSession` (`protocol.ts`), тип `BrowserCommand` и мост
  `RendererBrowserBridge` (`ipc.ts`, `window.browser`); screenshot вынесен из
  union команды моста (`RendererBrowserCommand`) — у него отдельный роут.
- **Сервер**: HTTP-клиент `apps/browser-runner/src/client.ts` (Bearer, статусы
  `BrowserRunnerError`, бинарные снимки); `apps/playwright-reader/src/routes.ts`
  проверяет доступ через `PlaywrightReaderCore` и тип разговора. Ключи сессии:
  `sessionId = conversationId`, `userKey = uid`; без раннера — 501. В embedded
  клиент инъектируется через `BuildOptions.browserRunner`, в standalone — `runner`.
- **UI**: `makeBrowserBridge` в `remote/index.ts` ставит `window.browser`;
  `BrowserSessionPane` при монтировании зовёт `start` (incarnation хранит в ref),
  тянет кадры поллингом `screenshot` (screencast, 1.2 c), навигация/back/forward/
  reload/ввод идут `command`, клик по кадру пересчитывается
  `scaleBrowserCoordinates` в координаты вьюпорта, `stop` — на размонтировании.
  Деградация: нет моста или 501 → «Chromium недоступен».

Тесты: `apps/browser-runner/src/client.test.ts`, `apps/playwright-reader/src/routes.test.ts`,
`BrowserSessionPane.dom.test.tsx` и ветка Playwright в `App.dom.test.tsx` (UI).
Для реального запуска раннеру нужен `npx playwright install chromium`.

Инструменты модели `mcp__browser__*` подключены к изолированному Chromium через
`PlaywrightReaderService`; панель пользователя используется только Web Reader.

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

Реализовано связкой выше: серверная оркестрация сессий (REST, проверка владения,
service-токен), screencast (поллинг кадров) и пользовательский ввод в Chromium.
Первоначальный список ограничений этого круга устарел: инструменты модели уже
исполняются через `PlaywrightReaderService`, а доступные действия определяет
`packages/shared/src/browserActions.ts`. Актуальные возможности описаны ниже в
разделах про инструменты модели, осмотр страницы и освобождение ресурсов;
особенности проверки здоровья процесса — в разделе приложения выше.

## Тип разговора, scope и legacy-миграция

Playwright Reader использует `assistantKind: 'playwright-reader'` и обязательный `scope='playwright-reader'`. Список, поиск и получение истории запрашивают эту область отдельно, поэтому Playwright-разговор не появляется в обычном чате или другой мастерской и не принимается по URL чужого маршрута. Актуальные типы `AssistantKind` и `ConversationScope` находятся в `packages/shared/src/types.ts`, транспортные аргументы — в `packages/shared/src/ipc.ts`, фильтрация — в `apps/server/src/db/database.ts` и `apps/server/src/routes/rest.ts`.

При добавлении колонки `conversations.scope` миграция детерминированно использует только достоверные старые признаки. Разговор с `task_id` и `project_id`, а также `assistant_kind='kanban'` с `project_id`, становится `kanban`; `make` становится `make`, `console-reader` — `console`, `playwright-reader` — `playwright-reader`, `web-recorder` — `web-reader`. Пустой или неизвестный `assistant_kind` и kanban без `project_id` становятся безопасным обычным `chat`. SQL миграции находится рядом со схемными апгрейдами в `apps/server/src/db/database.ts`; новый schema constraint — в `apps/server/src/db/schema.ts`.

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

## Панель пользуется всем, что умеет контракт (круг 1, 29.08.2026)

`BrowserCommand` (`packages/shared/src/types.ts:174`) давно поддерживал `resize`,
`screenshot` и `input` с `wheel`, а у клика есть `button` и `clickCount` — но
`BrowserSessionPane` не использовал ничего из этого. Страницу длиннее вьюпорта
нечем было прокрутить, правой кнопкой не нажать, размер окна не сменить, а кадр
не приложить к сообщению. Всё это добавлено без единой правки сервера: не
хватало только вызовов.

Что изменилось в панели: колесо шлёт `wheel`; правый клик и двойной клик
доходят до страницы; переключатель телефон/планшет/десктоп шлёт `resize`;
кнопка «Снимок в чат» отдаёт текущий кадр через новый проп `onAttachFrame`;
клавиатура работает прямо в кадре (кадр получает фокус, `role="application"`),
а не только через отдельное поле с подсказкой «сначала кликните по нему».

### Диалоги сайтов: цикл проверки13 (2026-09-10)

`BrowserDialogs` регистрируется на каждой странице до навигации и хранит alert,
confirm, prompt и beforeunload до явного ответа. Без обработчика Chromium через
Playwright закрывал сообщения автоматически; confirm давал false, prompt — null.
При уходе с защищённой страницы исходный Reader переходил без выбора человека.
Теперь ответ `dialogs` содержит id, tabId, тип, сообщение, defaultValue и openedAt;
`handle-dialog` требует id и явный accept. promptText разрешён только при принятии
prompt: пропуск сохраняет оригинальное defaultValue, пустая строка очищает его.
Устаревший id, повторный ответ в работе и некорректные аргументы не отвечают за
пользователя. Команды требуют актуальную incarnation и авторизацию разговора.

Действие, открывшее диалог, быстро возвращает ошибку с id и инструкцией ответа:
это не подтверждение завершения click/goto. Нативное действие продолжится после
ответа, поэтому модель должна затем проверить страницу. Ответ проходит вне
очереди сырого ввода: ожидающий диалог click иначе заблокировал бы собственное
разрешение. Условное удаление записи сохраняет следующий prompt в цепочке
confirm→prompt. status, tabs и журналы доступны при блокировке JavaScript;
заголовок такой вкладки берётся из кеша. Остальные вкладки остаются управляемыми.
Начальная восстановленная навигация также отдаёт управление при диалоге;
close-tab уважает beforeunload, stop принудительно освобождает контекст.

Панель получает dialogs в метаданных, отмечает вкладки, ожидающие ответа, и
показывает диалог только активной вкладки внутри области Reader. Чат остаётся
доступен. Во время диалога status продолжает опрашиваться, снимки приостановлены:
снимок заблокированной страницы не должен создавать ложную ошибку связи.
Модель использует MCP dialogs/handle-dialog; оба инструмента есть в allow-list
Claude. Старое общее ready без dialogs не считается подтверждением ответа.

Сообщение ограничено4000, показанное начальное значение2000, отправляемый текст
20000 символами. JSON списка ограничен16000 с учётом экранирования; активный
диалог приоритетен, total/truncated сообщают о сокращённом списке. Признаки
messageTruncated/defaultValueTruncated объясняют сокращение. Оригинал prompt
хранится в нативном Dialog, поэтому неизменённый длинный ответ не обрезается.
Это только JavaScript-диалоги; браузерные разрешения, HTTP-auth и выбор файла
не выдаются за поддержку этого механизма.

### Точность ввода: цикл проверки12 (2026-09-10)

Координаты `wheel.x/y` указывают место текущего события панели: раннер сначала
перемещает мышь, затем прокручивает контейнер под ней. Раньше колесо действовало
в прежней позиции курсора, часто в (0,0). Старая команда без координат совместима;
если задана одна координата, нужны обе конечные величины. Панель переводит
DOM_DELTA_LINE в 16px/строку, DOM_DELTA_PAGE — в ширину/высоту viewport по оси.
`mouseDown` и `mouseUp` также перемещают курсор по переданным x/y вместо игнорирования.

`input.click.modifiers` удерживаются только на время клика и освобождаются при
ошибке, сохраняя ранее удержанную клавишу. Для двух физических click панели
второй передаёт `detail: 2`: mouse.down/up с этим detail создают ровно два click
и один dblclick. Прежний обработчик click+doubleClick отправлял четыре click.
`clickCount: 2` остаётся полным двойным кликом модели. Запись сворачивает пару в
один селекторный dblclick с прежним id и сохраняет модификаторы.

Кадр передаёт Shift+Tab, Delete/Home/End/PageUp/PageDown и сочетания с модификаторами.
Для выбора/отмены редактирования Ctrl/Meta переводятся в ControlOrMeta машины
раннера. Paste берёт plain text из clipboardData события, включая переносы и
Unicode; Ctrl+V не читает пустой буфер другого Chromium. Промежуточные IME
keydown игнорируются; полноценный цикл composition этим изменением не добавлен.
Отправка отдельного текстового черновика очищает только отправленный префикс
после подтверждённого успеха; отказ или продолжение набора не теряют текст.

Сырые команды `input` идут по очереди в панели и отдельно по Page в раннере;
отказ одного действия не блокирует следующие. Разные страницы независимы.
Составной drag или модифицированный клик не смешиваются с соседним сырым вводом.
Общий флаг занятости учитывает одновременно ожидающие команды и снимки.
Это не блокировка всей сессии от параллельных selector/evaluate модели.

При проверке перезапуска найден сопутствующий дефект REST-моста: DELETE не
передавал CSRF cookie-сессии и игнорировал HTTP-отказ. `makeBrowserBridge.stop`
теперь использует общие sessionHeaders и отклоняет неуспешный ответ. E2E проверяет
фактическую смену incarnation после кнопки «Перезапустить». Тестовый вход переносится
из legacy Bearer в cookie один раз, а не искусственно повторяется на каждом reload.

Регрессии: `sessionInput.test.ts`, `inputActions.test.ts`, `BrowserInput.dom.test.tsx`,
`browserInput.test.ts`, `pointerRecording.test.ts`, `remote/browserBridge.test.ts` и
полная цепочка в `e2e/playwrightReader.e2e.test.ts`. Все сайты/письма там искусственные.

Состояние сессии показывается словами (`STATE_LABELS`): раньше в шапке висело
сырое `ready`. Во время команды поверх кадра появляется отметка «Выполняется…» —
кадр в это время ещё старый, и без неё непонятно, идёт ли работа.

Контролы разнесены на две строки (`.playwright-reader-tools`): шесть штук в один
ряд не помещались на 390px. Мобильный минимум цели — 40px, проверено снимками.

**Витрина:** `BrowserSessionPane.stories.tsx` — готовая сессия, запуск,
недоступный Chromium, отказ команды, отсутствующий мост, мобильный вьюпорт.
Кадр для витрины кодируется `encodeURIComponent`, а не `btoa`: тот не принимает
кириллицу и роняет весь набор сториз при сборке.

## Метаданные сессии доходят до человека (круг 2, 29.08.2026)

`BrowserSessionMetadata` нёс `tabs`, `title`, `activeTabId` и типизированную
`error` с `code`/`retryable`, а панель не показывала **ничего** из этого: греп по
компоненту давал ноль совпадений. Команды `newTab`/`selectTab`/`closeTab` были
объявлены в контракте, но вызвать их было неоткуда.

Добавлено: строка вкладок с переключением и закрытием, кнопка новой вкладки,
заголовок страницы рядом с адресом, снимок всей страницы (`fullPage`), кнопка
«Перезапустить» — раньше `stop` звался только при уходе с экрана, и зависшую
сессию нельзя было выкинуть.

**Ошибка команды больше не голый текст.** `BrowserError.retryable` приходил и
терялся; теперь для повторяемых отказов (`retryable`, `timeout`, `not_ready`)
показывается «Повторить», который шлёт ту же команду заново.

**Поллинг кадров стал разумным.** Было: `setInterval` на 1200 мс, который тикал
всегда — в том числе пока вкладка браузера скрыта, впустую нагружая Chromium и
канал. С 2026-09-10 опрос использует последовательный `setTimeout` после завершения
предыдущего запроса: одновременно идёт не более одного снимка. Интервал вычисляется
заново: 400 мс в течение четырёх секунд после команды, затем 1200 мс. Прежний
`setInterval` выбирал 400 мс только один раз и оставался ускоренным навсегда.
Скрытая вкладка не опрашивается; возврат видимости запускает обновление сразу.

Фоновый запрос сначала получает `BrowserCommand.status`, затем кадр выбранной
вкладки. Поэтому переходы модели, заголовки и список вкладок видны без ручной
команды. `status` работает и при пустом списке вкладок. Он и `screenshot` не
меняют `lastActor`: раньше каждый кадр панели стирал отметку о действии модели.
Новая ручная команда инвалидирует ожидаемый кадр, чтобы поздний ответ прежнего
запроса не заменил экран после действия.

`about:blank`, file/data и ошибочные адреса не задают ожидаемый origin и не входят
в историю. Черновик адреса сохраняется при фоновом обновлении; Escape возвращает
актуальный URL, Enter отправляет набранный. Смена разговора перемонтирует внутреннюю
панель по ключу: запись сценария, история, диагностика, поля и размер окна не
переносятся из чужого разговора. Три последовательных отказа кадра показывают
предупреждение при сохранении последней картинки, успешный ответ убирает его.
Перезапуск больше не скрывает отказ остановки; экран ошибки позволяет повторить
запуск. Регрессии — `BrowserSessionPane.observation.dom.test.tsx`, включая гонки
ответов и управляемые часы; браузерный E2E проверяет переходы модели, черновик и
обрыв/восстановление запросов кадров.

## Модель получила доступ к изолированному Chromium (круг 3, 29.08.2026)

**До этого круга модель Playwright Reader не видела вообще.** `actor: 'model'`
не встречался в коде нигде: единственным, кто звал `runner.command`, был REST-роут
`/api/browser/:id/command` с `actor: 'user'`. MCP-инструменты `browser`
(`previewMcp`) уходят в `PreviewActionRelay`, а тот пушит действие **в браузер
пользователя** — исполняется оно в iframe веб-превью, до изолированного Chromium
не доходя.

Почему нельзя было просто перенаправить: MCP-инструменты селекторные
(`click({selector,text})`, `read({selector})`, `wait({selector})`), а
`BrowserCommand` был координатным (`click(x,y)`, `type`, `wheel`). Разрыв
закрывается контрактом: добавлена команда `selector` с действиями
`click | type | read | find | wait` (`BrowserSelectorAction`) и типизированным
ответом `BrowserSelectorResult` — чтение и поиск возвращают данные, остальные
только факт.

Исполнение — `apps/browser-runner/src/selectorActions.ts`. Логика намеренно
вынесена из `sessionManager` и принимает узкий тип `SelectorPage`, а не
`Page` из Playwright: так она проверяется без Chromium, и у пакета появились
первые тесты (их не было ни одного).

Два решения, которые стоит помнить:
- **Ошибка возвращается значением, а не исключением** (`{ ok: false, error }`), и
  из сообщения Playwright берётся только первая строка. Модели нужна причина,
  а не стек и не «команда не выполнена».
- **Чтение обрезается лимитом** (по умолчанию 4000 символов): `innerText` у
  `body` большой страницы иначе съедает контекст хода целиком.

## Инструменты модели работают в изолированном Chromium (круг 4)

`registerPreviewMcp` получил `browserExecutor`: для разговоров
`playwright-reader` действие исполняется приложением через `PlaywrightReaderService`, а не
уходит в `PreviewActionRelay` (тот пушит его в браузер пользователя, где нужной
страницы нет). Перевод `PreviewAction` → `BrowserCommand` живёт в
`packages/shared/src/browserActions.ts` (`planModelAction`) и покрыт тестами.

С 2026-09-10 (цикл проверки 06) Chromium возвращает из `read` структуру
заголовков, ссылок, кнопок и полей, ограниченные таблицы и каталог iframe.
`selector` включает сам выбранный узел; чтение input/textarea показывает текущее
значение, select — выбранную подпись, password — пустую строку. Значение password
также исключено из `describe`, чтобы оно не попадало в запись сценария.
Пустой `innerText` не подменяется исходниками script/style из `textContent`.
Реализация — `apps/browser-runner/src/pageReading.ts`, контракт —
`BrowserSelectorResult` в shared. Ссылки и адреса iframe восстанавливают публичные
host aliases так же, как URL страницы. Поле read.frames перечисляет iframe текущего DOM; их содержимое читается явно через frame, а живое дерево и адреса после редиректов возвращает отдельный инструмент frames.

`read` принимает `limit` (100–20 000, по умолчанию 4000) и `offset`; возвращает
`total`, `offset`, а при остатке — `truncated` и `nextOffset`. Структурированные
данные имеют отдельный бюджет 8000 символов JSON и признак `structureTruncated`:
для подробностей модель ограничивает область селектором. Таблица сообщает общее
число строк/колонок и усечение; возвращается не больше 20×20 ячеек. Общие параметры
порций текста поддерживаются также iframe-поверхностью Web Reader.

`find` сообщает `total` до применения лимита и `truncated`. Необязательный
`visibleOnly` исключает скрытые копии до ограничения числа результатов в обеих
поверхностях. Chromium строит селектор по фактическому узлу, экранирует атрибуты
и проверяет уникальность, поэтому найденный текст с `>>` пригоден для следующего
действия. Скрипты локатора передаются Playwright как функции, собранные из
констант: строка со стрелочной функцией сама по себе не вызывает эту функцию.
Живые проверки — `readingActions.test.ts` и E2E `playwrightReader.e2e.test.ts`.

С 2026-09-10 (цикл проверки 08) чтение Chromium обходит открытые Shadow DOM и
слоты, в том числе вложенные: структура включает их поля, кнопки, ссылки и таблицы,
а видимый текст не дублирует назначенные слотам узлы и не включает скрытые script/style.
Закрытые shadow roots недоступны. `aria-labelledby` разрешается в root самого
поля; `disabled` учитывает fieldset с исключением для первого legend.

`domHelpers.ts` формирует кандидата селектора по узлу, `elementTargets.ts`
уточняет неоднозначность настоящим движком Playwright. CSS Chromium проходит
shadow roots, поэтому уникальный внутри document/root id может иметь несколько
совпадений у локатора. При необходимости возвращается `>> nth=N`; модель и
сценарий сохраняют селектор целиком. Служебный DOM-путь не уходит в результат.
Уникальный селектор сохраняется при вставке соседей; если узел исчез во время
уточнения, весь read/find/describe перечитывается один раз. После изменения DOM
между действиями модель снова вызывает find. `click`, `hover` и `find` учитывают
selector вместе с text через hasText. Живые регрессии — `shadowActions.test.ts`;
E2E проверяет чтение и последующий клик по двум разным кнопкам с одинаковым id.

С 2026-09-10 (цикл проверки 07) `wait` Chromium понимает условия готовности:
текст внутри selector, состояния attached/detached/visible/hidden, enabled,
editable, checked, value, count, URL с шаблоном `*`, domcontentloaded/load и
синхронный predicate приложения. Контракт и проверка сочетаний —
`packages/shared/src/browserWaiting.ts`, исполнение — `apps/browser-runner/src/waiting.ts`.
Публичный URL проверяется после восстановления host alias, включая hash-маршрут.
`count` включает скрытые узлы, ноль поддерживается; неявная видимость требуется
только без count. Пустое value и булево false сохраняют свой смысл.

Условия делят общий timeoutMs (до 30 000 мс, по умолчанию 5000), результат сообщает
waitedMs. Перед возвратом завершаются все запущенные ожидания; handle predicate
освобождается. Predicate проходит project gate evaluate без подтверждения
изменяющих действий; операция и последующее ожидание остаются отдельными шагами.
Predicate может быть выражением или функцией без аргументов;
Promise отклоняется явно, чтобы его truthy-объект не выдавался за готовность.
Сам по себе load не ждёт будущие запросы SPA — модель ждёт содержимое или флаг
готовности. Обычный iframe wait сохраняется, расширенные условия требуют Chromium
и явно отказывают при попытке перейти к прежнему relay вместо их исполнения.

Ложатся напрямую: `open`, `back`, `forward`, `click`, `type`, `read`, `find`,
`wait`, `scroll`, `press`,
`console`, `errors`, `network`, `styles`, а с круга 9 — `hover`, `set`, `a11y`,
`drag`, `viewport` (это `resize` раннера) и `evaluate`.

С круга 10 работают также `upload` (содержимое base64 уходит в
`setInputFiles` из памяти, потолок 8 МБ — оно едет в JSON) и снимок узла по
селектору.

С 2026-09-10 (цикл проверки 03) `planModelAction` сохраняет `click.modifiers` и
`press.selector`: клавиша адресуется локатору, а не прежнему фокусу. `scroll`
исполняется как селекторное действие: использует указанный контейнер или
`document.scrollingElement`, достигает настоящего края и ждёт два кадра для
доставки scroll-события странице. Прежний шаг колеса на 10 000 пикселей не достигал
конца длинного документа и игнорировал контейнер. С цикла проверки12 `dx` добавляет
горизонтальный сдвиг независимо от `dy`, в том числе внутри frame; при одном dx
вертикаль не меняется. Ответ `scrolled` содержит фактические top/left и maxTop/maxLeft.
Общий контракт ограничивает сдвиги ±100000px; MCP и Web Reader поддерживают dx,
а запись сохраняет и сливает обе оси, не стирая проверки. Команда `viewport` передаёт
только ширину; раннер сохраняет остальные параметры текущего окна. Два края drag
можно задать селекторами или координатами; координатный путь доставляет настоящие
события мыши и освобождает кнопку даже при отказе перемещения. Смешанная пара
«селектор + координаты» пока отклоняется с объяснением.

Результат селекторного действия раннера содержит `page.url` и `page.title` с учётом
обратного алиаса. Успешный MCP-ответ сохраняет этот контекст, поэтому после клика
модель видит произошедший переход. Загрузка пустого файла разрешена; неверный
base64 отклоняется до выбора файла, вместо молчаливого пропуска мусора в `Buffer.from`.
Потолок 8 МиБ теперь общий: `browserLimits.ts`, cap base64 в `PreviewAction`, схема
MCP, REST-команды Reader и HTTP-команды раннера (JSON до 16 МиБ). Внутренний RPC
использует тот же предел. Прежний HTTP-лимит раннера 1 МиБ обрывал допустимый upload
ответом 413. `sessionForms.test.ts` и общий стенд `test/readerForms.ts` проверяют
действия в Chromium; E2E доставляет пустой и предельный файл через настоящий MCP.
Выбор select по подписи и range уже работали в установленном Playwright и остались
контрольными тестами, без начисления дополнительных «исправлений».

**Неподдерживаемые действия отклоняются с объяснением** — до круга 9 общую формулировку про
Chromium получали все отказы подряд:

- `edits` — правки edit-режима копит **прокси превью**; у изолированного
  Chromium такого режима нет и быть не может;
- смешанный `drag` с селектором только на одном краю — нужны два селектора
  или две пары координат.

**`evaluate` включён без ослабления гейта.** `gateEvaluate` вызывается на уровне
MCP-инструмента, **до** выбора транспорта, поэтому политика команд проекта и
подтверждение опасного кода применяются к браузерному пути сами — второго гейта
писать не пришлось. Раннер сериализует результат и режет его по 20 000 символов:
в лог рана и в ответ модели уходит текст.

### Вложенные документы (цикл проверки 09, 2026-09-10)

`frames` возвращает живые iframe активной вкладки: path, фактический публичный URL,
заголовок, name и visible. Каталог ограничен 100 документами, восемью уровнями и
24 000 символами JSON; total/truncated сообщают усечение. Видимость вложенного
iframe учитывает родительский. `read.frames.src` остаётся атрибутом DOM и может
отличаться от адреса после редиректа. Контракт — `browserFrames.ts`, дерево и
разрешение пути — `apps/browser-runner/src/frames.ts`.

Модель передаёт `frame` как один селектор iframe или цепочку path от frames.
DOM-действия, read/find/a11y, wait, evaluate, styles, open и screenshot работают
в выбранном документе, включая другой origin и вложенные iframe. Селекторы в
результате относительны ему, верхняя страница остаётся page, выбранная — frame
в ответе. Метаданные вычисляются после действия; detached отмечает удалённый
документ. Путь заново разрешается перед каждым действием, поэтому замена iframe
в SPA не оставляет старый handle. Несколько совпадений, пустая цепочка и элемент,
не являющийся iframe, дают ошибку, без действия на родительской странице.

`open` с frame меняет только iframe и использует ту же проверку URL и host aliases.
Ожидание использует локальные URL/loadState/predicate, включая время поиска самого
iframe в общий срок. JS predicate/evaluate проходят прежнюю проектную политику
MCP. `press` с frame требует selector, drag — два селектора; координаты, общие
логи и управление вкладками не принимают frame. Fallback в Web Reader с frame
явно отклоняется. Новый MCP styles читает вычисленные свойства через локатор,
поэтому принимает и селекторы Shadow DOM. frames/styles включены в Claude allow-list.

Снимок frame показывает видимую область iframe; selector ограничивает её элементом.
Большой элемент обрезается пересечением с окнами iframe и верхней страницы,
метаданные сообщают clipped и реальные координаты документа. Нативный снимок
body внутри iframe был проверен: за границей окна он рисует пустоту. Поэтому
fullPage и rect вместе с frame явно отклоняются. Таймаут общий для поиска iframe,
прокрутки и снимка; frame/clipped доходят через HTTP-заголовок и порт приложения в MCP.

Координатное describe раскрывает iframe через Playwright Frame, не через
запрещённый cross-origin contentDocument, и учитывает рамку и CSS scale.
Описание содержит относительный selector и цепочку frame; recordClick/recordType
копируют её в шаг. runScenarioStep читает ожидаемый текст в том же frame.
Первый open с frame остаётся шагом, не заменяя startUrl верхнего документа.
Закрытые shadow roots и запись внутри повёрнутого iframe не поддерживаются;
для повёрнутого iframe описание возвращает явную ошибку.

Регрессии — `sessionFrames.test.ts`: два HTTP-origin, редирект вложенного документа,
формы, стиль Shadow DOM, замена iframe, масштаб, снимки и воспроизведение сценария.
E2E создаёт настоящую форму Make через REST в временном проекте, открывает Make
в Reader, находит его iframe через frames и вводит/нажимает/читает через MCP.
Отдельный E2E проверяет два вложенных документа и снимок с усечением.

### Вкладки модели и popup (цикл 04, 2026-09-10)

MCP предоставляет `tabs`, `new-tab {url?}`, `select-tab {tabId}`, `close-tab {tabId}`,
`reload` и `stop-loading`. Эти команды используют отдельный контракт
`BrowserControlCommand` и метод `PlaywrightReaderService.control` через тот же
локальный или удалённый порт. Цель и доступ к разговору проверяются ядром до
вызова раннера; команда обычного iframe возвращает явную ошибку и не уходит в relay.
`new-tab` разрешает `machine.internal` через ту же проверку машины, что `open`,
затем приложение преобразует URL в авторизованный прокси превью. Шесть новых
команд включены в явный allow-list Claude CLI для preview-ходов, когда список
используется; без этого объявленный MCP-инструмент мог ожидать подтверждения.

`tabs` возвращает метаданные, в том числе `openerTabId` для popup. Модель выбирает
нужное окно по этому id через `select-tab`. Закрытие активного popup возвращает к
живому opener, а если он уже закрыт — к оставшейся вкладке. Новая вкладка из команды
`newTab` получает текущий viewport, а не исходный размер браузерного контекста.
При пустом списке вкладок панель показывает объяснение и сохраняет кнопку «Новая
вкладка»: человек может продолжить без перезапуска Chromium. Ввод адреса в пустой
панели также создаёт вкладку. Пустой контейнер имеет роль `group`, поскольку
`tablist` без дочерних вкладок нарушает доступность; история/reload отключены.

Проверки: живой `sessionTabs.test.ts`, MCP и `module.test.ts`, три сочетания
embedded/remote в `playwrightReaderBridge/remote.integration.test.ts`, сквозной
сценарий вкладок/перезагрузки/popup/восстановления панели в `e2e/playwrightReader.e2e.test.ts`.

### Снимок экрана: единственный инструмент со своим транспортом

`screenshot` возвращает картинку, а не JSON, поэтому он не идёт через общий
`run()` — и до круга 9 звал `PreviewActionRelay` напрямую. Следствие: в разговоре
Playwright Reader снимок уходил **в браузер пользователя**, где страницы этого
разговора нет, и модель, управляющая изолированным Chromium, оставалась без вида
страницы — ровно того, ради чего Playwright и брали.

С 2026-09-10 (цикл проверки 05) `browserScreenshot` принимает один из режимов:
viewport без аргументов, `selector`, `rect` в координатах документа или `fullPage`.
Конфликтующие режимы отклоняются, вместо незаметной подмены другим снимком. Для
`rect` раннер использует Playwright clip с fullPage: иначе область ниже viewport
обрезалась бы границами окна. Снимок модели всегда PNG в масштабе CSS, поэтому
DPR 2 не удваивает картинку относительно координат действий. PNG по умолчанию,
как и явно заданный PNG, игнорирует допустимый `quality`; WebP уже поддерживался.

В `apps/browser-runner/src/screenshots.ts` формируются бинарь и метаданные:
реальный URL/заголовок, координаты документа и размер элемента, области или полной
страницы. Для viewport учитывается scrollX/scrollY, для элемента — смещение окна.
Метаданные передаются рядом с бинарём в base64url-заголовке
`x-vc-browser-screenshot`; заголовок ограничен 8 КиБ. Старый раннер, слишком длинный
контекст или повреждённый заголовок дают изображение без придуманных координат:
приложение больше не подставляет viewport из прежнего start. MCP сообщает
контекст страницы и область рядом с image-блоком. Параметры проходят и remote RPC,
и пользовательский REST; интерфейсные опции определены в shared.

`animations: disabled` отключает анимации на время снимка Chromium;
`timeoutMs` (100–30000, по умолчанию 10000) ограничивает ожидание, включая шрифты.
`null` от сервиса всё ещё означает обычную iframe-панель. Для неё сохраняется
прежний screenshot с selector/rect; fullPage, animations и timeoutMs возвращают
явное сообщение о доступности только в Chromium и не запускают другой снимок.

Регрессии в Chromium — `sessionScreenshots.test.ts`, доставка параметров и
контекста — MCP/module/client/routes и remote HTTP-тесты. Сквозной E2E сравнивает
размеры PNG области, элемента и полной страницы, подпись URL и смещение viewport.

### Второй вход в Chromium: браузерная проверка задачи

Тот же изолированный Chromium обслуживает браузерные проверки стадии разработки.
Выбор цели вынесен в чистый `browserCheckTarget`
(`apps/server/src/browser/checkTarget.ts`): разговор Playwright Reader остаётся
при сессии по разговору, а задача с режимом `chromium` получает сессию
`task-<taskId>`. Ключ по задаче, а не по рану — иначе каждый прогон оставлял бы
в томе свой каталог профиля; настройка режима описана в
[ci-runner.md](ci-runner.md#браузерная-проверка-результата-на-стадии-разработки).

Dev-сервер задачи живёт на loopback выбранной машины, поэтому адрес
`http://<agentId>.machine.internal:<порт>/` не открывается Chromium напрямую:
`withMachinePreviewTarget` подменяет его адресом прокси превью сервера
(`machinePreviewUrl`, база — `config.browserPreviewBase`, иначе `mcpPublicBase`;
в compose `VC_BROWSER_PREVIEW_BASE=http://voicechat:8787`). Доставку до машины
делает уже существующий агент-мост `/api/preview`, поэтому SSRF-гейт раннера не
ослаблялся, а алиасы для самих машин не нужны.

**Сервер раннеру всё равно надо разрешить, и это выяснилось живым прогоном.**
Гейт `context.route` в `sessionManager` режет не литерал адреса, а **результат
DNS-резолва**: имя без приватного литерала (`voicechat`) проходит
`validatePublicUrl`, но затем резолвится в адрес внутренней сети и получает
`route.abort('blockedbyclient')` — Chromium отвечает `ERR_BLOCKED_BY_CLIENT`, а
страница остаётся белой. Поэтому раннер принимает
`VC_BROWSER_PREVIEW_ORIGIN=http://voicechat:8787` (`previewOriginTarget` в
`security.ts`), и этот origin добавляется в те же `allowedTargets`, что и цели
алиасов, — то есть доверие даёт оператор переменной, а не пользователь адресом.
Значения `VC_BROWSER_PREVIEW_BASE` (сервер) и `VC_BROWSER_PREVIEW_ORIGIN`
(раннер) обязаны совпадать: расходятся — и проверка молча превращается в белый
экран.

Авторизует эти запросы не сессионный токен пользователя, а ключ из
`PreviewRunKeys` (`apps/server/src/browser/machinePreview.ts`): токен работал бы
Bearer-ом на всём API, а лежал бы в профиле Chromium. Ключ выдаётся на
пользователя, продлевается при каждой выдаче, живёт сутки и приходит в контекст
сессии cookie `vc_preview_run` — раннер принимает её полем `cookies` в
`StartSessionRequest` и переустанавливает при каждом идемпотентном `start`.
Читает ключ `previewRunUser` в `apps/server/src/users/auth.ts` и **только** на
точном пути `/api/preview`; доступ к машине дальше решает прежний `canUse`.

### Локальный раннер для проверки (круг 11)

`npm run browser-runner:local` поднимает один контейнер с изолированным Chromium
на порту **8892** — без сервера, без БД, без 8787. Отдельно от `docker compose`
именно поэтому: для проверки Reader нужен только браузер, а не весь стенд.
`npm run reader:probe -- <адрес> [селекторы…]` открывает страницу, читает текст,
ждёт и ищет указанные узлы, показывает ошибки страницы и снимает кадр; код
возврата ненулевой, если узел не найден или страница жаловалась.

Наш прод-сайт открывается локальным раннером **напрямую**: запрет «контейнер не
достаёт до публичного IP своего хоста» действует только на самом прод-хосте, а
снаружи `http://89.125.68.35:8787/` доступен всем.

### Сертификаты: почему не открывался собственный сайт

Стенды проекта стоят за Caddy с внутренним CA, чей корень не входит в публичные
списки доверия, — Chromium отвечал `ERR_CERT_AUTHORITY_INVALID`. Раннер умеет
доверять дополнительному корню (`VC_BROWSER_EXTRA_CA_FILE` / `..._PEM`,
подробности и проверка — в [deploy.md](../deploy.md)). Важно, что это именно
**доверие**, а не отключение проверки: `ignoreHTTPSErrors` контекстный и снял бы
проверку для всех адресов сразу.

### Ожидания догоняют страницу (круг 18)

**Проверка выполнялась мгновенно после действия**, а интерфейс обновляется
асинхронно: нажал «Создать» — карточка появится через сотню миллисекунд. Шаг с
`expectText` мигал: иногда проходил, иногда нет. Недетерминированный тест хуже
отсутствующего — ему перестают верить, и он перестаёт что-либо значить.

`runScenarioStep` теперь перечитывает страницу до 5 секунд (шаг опроса 250 мс) и
засчитывает проверку, как только она сошлась. `expectAbsentText` также допускает
асинхронное исчезновение запрещённого текста в пределах ожидания.

С 2026-09-10 (цикл проверки 10) общий исполнитель требует подтверждённый ответ
действия (`ok: true` или метаданные готовой сессии). `undefined`, пустой объект
и остановленная сессия больше не означают успех. Панель возвращает пойманную
ошибку команды в прогон; панель и Automated QA проверяют ответ начальной
навигации и останавливаются до следующих шагов, если стартовый адрес не открылся.
Некорректный `PreviewAction` отклоняется до отправки и до сохранения сценария.

`scenarioReading.ts` дочитывает текст порциями по 20 000 символов, не более
200 000 за одну попытку. Служебное многоточие `read` удаляется по cursor, поэтому
искомая фраза на границе порций не разрывается. Для отрицательного ожидания нужно
полное чтение; найденный запрещённый текст уже доказывает провал. Ошибка `read`,
отсутствующее продолжение, неверное смещение или предел чтения дают
`unverifiable`, если доступного текста недостаточно для вердикта. Это не дефект
проверяемого приложения. Все порции сохраняют frame; изменение URL документа
или размера текста между порциями отменяет их склейку. Чтение меняющегося DOM
не является атомарным снимком. Пауза опроса ограничивается остатком времени,
после достижения предела новое чтение не начинается; отдельные запросы
ограничиваются транспортом и раннером.

Не дождавшись, шаг показывает, **что было на странице** (`Видно: …`): «нет текста
X» не объясняет, куда смотреть. И различает `failure: 'action' | 'expectation'` —
«кнопка не нажалась» и «нажалась, но результат не тот» — это разные беды.

**`scenarioProblems`** проверяет сценарий до сохранения: неисполнимое действие,
пустой селектор, отсутствие стартового адреса и отсутствие проверок. Раньше такое
уезжало в проект и падало на прогоне — через сутки, на доске, у другого человека.

**Сохранённый сценарий подгружается в панель** («Загрузить сценарий проекта») —
существующий можно поправить, а не записывать заново. Стартовый адрес
возвращается шагом-переходом, иначе он потерялся бы при обратной выгрузке.

В цикле проверки 10 загрузка подбирает стартовому переходу свободный id,
исправляет дубли старой записи и сохраняет идентификаторы при удалении соседних
шагов. Новые шаги также получают свободные id. Прокрутки с ожиданиями не сливаются
с последующей прокруткой: иначе движение обратно удаляло и промежуточную
проверку. Глобальное колесо не сливается с импортированным шагом другого
контейнера или frame. Если проверка стоит на первом переходе, экспорт оставляет
её отдельным шагом `wait(loadState: domcontentloaded)` после `startUrl`, сохраняя
id; повторной навигации нет. Регрессии — `scenarioIntegrity.test.ts`,
`scenarioRecorderIntegrity.test.ts`, DOM-тесты панели и QA; настоящие длинные
страницы — `scenarioPlayback.test.ts`, полная цепочка Make/MCP — E2E Reader.

### Один сценарий — один исполнитель (круг 17)

Шаг сценария исполняли **две независимые реализации**: этап на сервере (через
`planModelAction`, весь словарь действий) и проба `scripts/reader-probe.mjs`
(вручную, только click/type/wait). Расхождение успело случиться — круг 15 научил
записывать прокрутку, этап её исполнял, а проба отвечала «действие не
исполняет».

Общая часть вынесена в `packages/shared`:

- `browserActions.ts` — перевод `PreviewAction` → `BrowserCommand` (переехал из
  `apps/server/src/browser/modelActions.ts`: он чистый и нужен трём сторонам);
- `scenarioStep.ts` — исполнение шага с разбором ожиданий (`runScenarioStep`),
  свёртка ошибки Playwright в первую строку (`firstLine`) и подсказка
  (`stepHint`): «локатор не найден» не говорит, что делать, а «возможно, элемент
  ещё не появился — добавьте ожидание или уточните селектор» говорит.

Транспорт остаётся снаружи: у сервера и пробы это HTTP к раннеру, у панели —
мост `window.browser`. Проба из-за общего кода запускается через `tsx`.

**Прогон прямо в панели** («Прогнать сценарий») закрывает цикл «записал →
проверил → поправил»: раньше запись была в Reader, а прогон — на доске. Итог
показывается у каждого шага. Кнопка считает **исполнимые** шаги, а не
записанные: шаг-переход уходит в `startUrl`, и запись из одного перехода
прогонять нечем — это нашёл тест круга.

### Запись как черновик, который правят (круг 15)

- **Виды клика различаются**: правый и двойной пишутся отдельными действиями
  (`button: 'right'`, `dblclick`), обычный остаётся без лишних полей — сценарий
  так читается лучше.
- **Прокрутка сливается в один шаг.** Человек крутит колесо десяток раз подряд;
  без слияния сценарий превращался бы в простыню бессмысленных шагов.
- **Название шага правится на месте** — именно оно читается в отчёте этапа.
- **Пауза перед шагом запоминается** (`pauseMs`). Долгая пауза почти всегда
  значит, что человек ждал страницу, и без явного ожидания прогон будет нажимать
  раньше, чем элемент появится, — панель об этом предупреждает.
- **«Начать заново»** оставляет запись включённой, в отличие от очистки.
- **Пустой сценарий не сохраняется молча**: раньше этап потом блокировался, и
  узнавалось это только на прогоне.

Служебные поля записи (`stability`, `matches`, `pauseMs`) в сценарий не уезжают:
они нужны, пока человек пишет, а этапу важно только что делать и чего ждать.

### Из записи получается тест, а не список кликов (круг 14)

Круг 12 научил записывать действия; тестом такая запись ещё не была.

- **Ожидания.** Сценарий без единой проверки зелёный, пока клики попадают, — даже
  если страница показала ошибку. Панель прямо говорит об этом
  («Ни одной проверки…») и даёт повесить `expectText` / `expectAbsentText` на
  последний шаг.
- **Ввод текста записывается** и привязывается к последнему описанному элементу:
  раньше в записи оставался клик по полю и пустое поле.
- **Сохранение прямо в проект** (`onSaveScenario` → `projects:update`). До этого
  запись жила только в буфере обмена, и её переносили руками на другой экран —
  для «много автотестов» это и был главный барьер. Отказ показывается, а не
  теряется.
- **Шаг можно убрать**, остальные перенумеровываются: промах мышью больше не
  стоит всей записи.
- **Уникальность селектора.** `describe` возвращает `matches` — сколько узлов
  отвечает селектору. Одинаковый `aria-label` встречается по десять раз, и шаг
  молча нажал бы первый. С цикла проверки 08 раннер уточняет селектор до одного
  узла; позиционные уточнения помечаются stability: path.
- **Подъём к опознаваемому предку.** `elementFromPoint` отдаёт самый верхний
  узел — `<span>` внутри кнопки, тогда как `data-testid` стоит на кнопке. Ищем
  интерактивного предка без прежнего лимита четырёх уровней, включая открытые
  shadow roots. Если его нет, используем ближайший testid/id или исходный узел.
- **Буфер обмена больше не отказывает молча**: вне secure-контекста
  `navigator.clipboard` недоступен, и кнопка просто ничего не делала.
- **`reader:probe --scenario <файл>`** прогоняет сохранённый сценарий с
  проверками: раньше запись можно было проверить только руками.

Грабля из этого круга: **обратные кавычки в комментарии внутри шаблонной строки**
закрывают саму строку. Скрипт `describeElementScript` — одна большая строка для
исполнения в браузере, и комментарий с примером селектора в кавычках сломал
сборку пакета.

### Отладка записи и честность клиента (круг 29)

- **Закрытая вкладка не остаётся активной** (`nextActiveTab` в `sessionManager`):
  `activeTabId` указывал на удалённую страницу, и каждая следующая команда падала
  `stale_tab` — сессия становилась непригодной, хотя другие вкладки живы.
- **«Прогнать до этого шага» на шаге-переходе** прогоняло весь сценарий: перехода
  в сценарии нет (он уезжает в `startUrl`), `findIndex` давал −1, а −1 означало
  «всё». Теперь такой запрос выполняет только переход.
- **Отметки прогона сбрасываются** перед новым прогоном и при удалении шага:
  `stepResults` ключуются по id, а `removeStep` перенумеровывает — «ок»
  удалённого шага доставался соседу.
- **Проверку можно повесить на любой шаг** (`expectOnStep`), а не только на
  последний.
- **Клиент раннера отличает отмену от таймаута**: отмена даёт 499 «Запрос к
  Browser Runner отменён», а не «не ответил вовремя» — по второму тексту идут
  искать беду в инфраструктуре, которой нет. `screenshot()` тоже слушает сигнал:
  он был единственным методом без него.
- **Тип `command()` честный** (`BrowserRunnerCommandResult`): селекторные и
  inspect-команды отдают не метаданные, и приведения `as unknown as …` больше не
  нужны.
- **Правило приватных адресов одно** — `isPrivateNetworkHost` в shared; раннер
  зовёт его же. Копии уже разошлись: shared не знал про IPv6 `::`.
- **Прокрутка туда-обратно не оставляет шаг «на 0 px»**.

### Мелочи раннера, стоившие отладки (круг 28)

- **Битый фильтр журнала** (`inspect/console` с `pattern`) улетал исключением и
  приходил наружу как 422 с сырым «Invalid regular expression»; теперь — ответ
  значением: «Фильтр «…» — не регулярное выражение».
- **`newTab` не применял алиас**, в отличие от `navigate`: новая вкладка шла на
  внешний адрес и держалась только на перехватчике маршрутов, то есть по
  случайности. Теперь путь один.
- **`data-testid` на ключевых кнопках доски** (`column-create`,
  `column-composer`, `column-create-title`): без них записанный шаг цеплялся за
  `aria-label` с именем колонки и ломался от переименования.

### Отметка обращения к сессии (круг 26)

`lastUsedAt` ставится в начале `command()`, а не в `metadata()`. Раньше её
обновляли только команды, возвращающие метаданные, — а прогон сценария состоит
из селекторных команд, разбора журналов и снимков, которые возвращаются раньше.
Сессия в работе выглядела брошенной, и сборщик (`sweepIdle`, порог 30 минут,
обход раз в 5 минут) мог закрыть Chromium прямо посреди прогона.

### Где мы находимся и кто действовал (круг 13)

- **Подмена адреса алиасом объясняется.** Раннер переписывает внешний `host:port`
  на внутренний, и человек видит в поле одно, а страница загружена с другого
  адреса; молча это выглядит как «открылось не то». **С круга 26 наружу идёт тот
  адрес, который назвал человек** (`restoreHostAlias` в `security.ts`
  разворачивает алиас в `metadata`), а факт подмены сообщается отдельным полем
  `aliasedHost`. Причина: внутренний адрес попадал в `currentUrl`, а оттуда — в
  `startUrl` записанного сценария, и такой сценарий не открывался нигде, кроме
  этого же контейнера. Побочно чинилось второе: подмену вычисляли по расхождению
  хостов, поэтому на стенде с алиасом **любой** чужой адрес объявлялся «подменой
  алиасом» и предупреждение «ушли с проверяемого сайта» не показывалось никогда.
  Подсказка теперь строится из одного ответа раннера (`currentUrl` + `aliasedHost`),
  а не из отдельно хранимого «что просили»: иначе между Enter и ответом она
  описывала старую страницу новым адресом.
- **Уход с проверяемого сайта** — тревога. Ожидаемым считается происхождение
  первого открытого адреса: смена хоста посреди проверки почти всегда редирект
  на внешний вход или промах.
- **История адресов сессии** — вернуться на посещённое, а не только «назад».
- **Кто действовал последним** приходит в метаданных (`lastActor`): сессия одна
  на разговор, человек и модель делят страницу.
- **«Прервать»** во время навигации: раньше долгая страница ничем не отличалась
  от зависшей, и оставался только перезапуск всей сессии.
- **Вход под тестовой учёткой проекта.** Селекторы угадываются по типу поля
  (`input[type=password]` — пароль, обычное поле — логин), а не по разметке
  конкретного сайта. Это эвристика, и на нераспознанной форме шаг **честно
  отвечает ошибкой**, а не делает вид, что вошёл.

Приём метаданных сведён в одну точку (`applyMeta`): старт сессии шёл мимо неё, и
история посещённого начиналась со второй страницы, а сверять уход с сайта было
не с чем. Тесты круга это и поймали.

### Запись сценария автотеста (круг 12)

Ради этого Reader и доводился до инструмента автотестов: человек проходит путь
руками, а на выходе — воспроизводимый сценарий этапа Automated QA. Раньше
сценарий набивался в настройках проекта по одному шагу.

Как устроено: клик по кадру **координатный**, а шаг сценария обязан быть
**селекторным** — координатная запись рассыпалась бы от любого сдвига вёрстки.
Поэтому в режиме записи панель сначала спрашивает раннер новым действием
`describe(x, y)`, что под курсором, и лишь затем кликает. Клик выполняется в
любом случае: запись не мешает работать.

Селектор строится в самой странице (`describeElementScript`) по убыванию
надёжности: `data-testid` → `id` → `aria-label` → `role` → путь по тегам.
С 2026-09-10 (цикл проверки 08) описание раскрывает вложенные открытые shadow roots,
а scrollTo использует локатор Playwright и принимает такие же селекторы, как click.
Выбранный уровень возвращается полем `stability`, и шаги по пути помечаются в
списке предупреждением — такой селектор ломается от вставки соседнего узла, и
честнее сказать об этом при записи, чем дать сценарию упасть потом.

Первый шаг записи — открытый адрес; при выгрузке (`toScenario`) он становится
`startUrl` и **уходит из шагов**: у сценария есть отдельное поле, и дублировать
его шагом значило бы открывать страницу дважды. `stability` в сценарий не
уезжает — он нужен только при записи.

Логика вынесена в `packages/ui/src/lib/scenarioRecorder.ts` и проверяется без
DOM; генератор селектора — в настоящем Chromium (`describeElement.test.ts`), а
не заглушками: заглушка проверила бы наши представления о DOM, а не сам DOM.
Первым же прогоном тест нашёл дефект — клик мимо содержимого попадает в `html`,
путь получался пустым, и селектор выходил `''`, то есть заведомо сломанный шаг.

### Панель: что видно человеку (круг 11)

- **Ошибки страницы и неуспешные запросы** — кнопка «Ошибки страницы» читает оба
  журнала раннера. Успешные запросы скрыты: список из полусотни строк прячет то,
  ради чего его открыли. Пустой результат — отдельная фраза «Страница не
  жаловалась», а не пустой блок.
- **Схема адреса**: адрес с явным портом (`89.125.68.35:8787`) достраивается до
  `http`, без порта — до `https`. Раньше `https` навязывался всему, и стенд по
  http из адресной строки не открывался вовсе.
- **Размер окна переживает перезапуск** сессии: проверка мобильной вёрстки
  больше не сбрасывается на десктоп.
- **Клавиши Enter/Tab/Escape** отдельными кнопками — раньше можно было отправить
  только произвольный текст.
- **«Очистить сессию сайта»** стирает cookie и хранилища: профиль persistent, и
  перезапуск сессии их не трогает. С 2026-09-10 очистка выполняется нативной
  `clearSiteData`, включая HttpOnly, IndexedDB, кеши и service workers;
  reload разрешён только после подтверждённой очистки.
- Кадр отдаётся JPEG с качеством **82** вместо 60: на 60 мелкий текст мылился, а
  панель нужна именно для разбора вёрстки.

**Контракт моста был неверен**: `RendererBrowserBridge.command()` обещал
`BrowserSessionMetadata` всегда, хотя `selector` отдаёт результат чтения, а
`inspect` — журналы. Из-за этого панель не могла показать ошибки страницы, не
соврав компилятору. Теперь тип — объединение, а разбирает его
`isBrowserSessionMetadata` из shared.

### Ресурсы: что раннер обязан отпускать (круг 10)

- **Сессия закрывается сборщиком по простою** (`sweepIdle`, по умолчанию 30 мин,
  проверка раз в 5 мин). До этого Chromium держался до явного `stop`, а его никто
  не звал, если человек закрыл вкладку или ран оборвался: процесс жил до
  перезапуска контейнера.
- **Одноразовый профиль QA удаляется вместе с сессией.** `profilePath` зависит от
  `userKey` + `conversationKey`; QA использует отдельный ключ прогона. С 2026-09-10
  Reader явно запрашивает `profileMode: persistent` и сохраняет каталог после
  stop/idle, чтобы не терять авторизацию. Значение по умолчанию — `ephemeral`.
- **Прогон этапа гасит сессию перед стартом.** `start` идемпотентен, а ран после
  рестарта сервера перезапускается с тем же id: без явного `stop` сценарий
  продолжился бы в старой странице со старым состоянием.
- **Заголовок страницы читается у страницы** (`page.title()`), а не подставляется
  литералом. Раньше `metadata()` отдавала `title: null` и пустые заголовки
  вкладок, поэтому поле заголовка в панели всегда пустовало, а модель заголовка
  не видела.

`start` у раннера идемпотентен — живая сессия переиспользуется, поэтому
исполнитель берёт `incarnation` из неё и не создаёт вторую.

**Зачем это:** этап Automated QA получил Playwright-режим, и его движок — тот
же изолированный Chromium. Доступ модели к нему был первым кирпичом; сам этап
описан в [qa-stage-runs.md](qa-stage-runs.md#два-режима-этапа), остальное — в
`docs/plans/playwright-reader-rounds.md`.

Один и тот же Chromium обслуживает два входа, и путаницы между ними быть не
должно: разговор Playwright Reader (`sessionId` = id разговора, `actor`
`user`/`assistant`) и прогон этапа (`sessionId` = `qa-<runId>`, сессия
поднимается и **гасится** внутри одного прогона). У этапа своя сессия именно
поэтому: ран не должен ни ронять открытую панель человека, ни наследовать её
состояние.

## Осмотр страницы: консоль, сеть, стили (круг 5)

Раннер собирает журналы с момента открытия страницы (`page.on('console')`,
`'response'`, `'pageerror'`) в кольцевые буферы на 500 записей: спросить их
задним числом нельзя, а этапу автотестов нужны именно они. Команда
`inspect` (`BrowserInspectAction`) отдаёт консоль с фильтром по уровню и
шаблону, сеть с фильтром по адресу и вычисленные стили узла.

Три решения:
- **Отдаётся хвост журнала**, а не начало: свежие записи полезнее первых, а
  объём ограничен лимитом (по умолчанию 50, максимум 200).
- **`errors` из словаря модели — это консоль с уровнем `error`**, отдельного
  журнала не заводили.
- **Тело `evaluate` объявляет `document`/`getComputedStyle` локальными узкими
  типами**: у пакета нет библиотеки DOM (это Node-сервис), а подключать её ради
  одной функции значило бы открыть браузерные глобальные всему серверу.

Логика вынесена в `inspectActions.ts` с узкими типами и проверяется без
Chromium — семь тестов. Ограничения первого круга не описывают текущий словарь:
`evaluate`, `hover` и `drag` по селекторам уже поддерживаются; `edits` остаётся
возможностью прокси. Перевод действий и явные отказы — в
`packages/shared/src/browserActions.ts`.
