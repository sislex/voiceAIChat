---
title: Playwright Reader и browser-runner
updated: 2026-08-30
checked: 63c210c5
areas:
  - apps/browser-runner/src
  - apps/server/src/browser
  - apps/server/src/routes/browser.ts
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

Локальная frontend-модель `BrowserSessionState` имеет состояния `idle`, `starting`, `connected`, `stopped`, `error` и capabilities `chromium`, `navigate`, `screencast`. При активации предыдущая session отписывается и dispose-ится, новая запускается для выбранного `conversationId`; смена разговора защищена generation token, `stop` делегируется session, общий dispose очищает подписки и session. UI не заявляет Chromium подключённым при `capabilities.chromium === false`, показывает явную недоступность и блокирует навигацию без `navigate`. Это честная деградация по возможностям adapter; полноценная server orchestration Chromium по-прежнему не реализована.

## Что это и чем отличается от Web Reader

Playwright Reader — отдельный продуктовый режим: слева обычный чат ChatAI, справа
предполагается настоящий изолированный Chromium под управлением Playwright.
Существующий Web Reader (`assistantKind: 'web-recorder'`, iframe поверх
`/api/preview`, `postMessage`-контракт рекордера) остаётся рабочим и не
затрагивается: см. [ui.md](../ui.md#web-reader--отдельная-страница). Общего у них
нет ничего, кроме переиспользованных React-компонентов чата и split-раскладки;
`projectId` у Playwright Reader всегда `null`, проектный контекст не применяется.

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
- **Сервер**: `apps/server/src/browser/runnerClient.ts` — HTTP-клиент раннера
  (Bearer, маппинг статусов в `BrowserRunnerError`: 404/409/503/502, screenshot —
  бинарь). `apps/server/src/routes/browser.ts` — REST-оркестрация: `guard`
  проверяет владение разговором (`db.getConversation(uid)`) и что это
  playwright-reader; `sessionId = conversationId`, `userKey = uid`; screenshot
  собирается в data-URL; без раннера — 501. Wiring в `server.ts`: клиент
  создаётся из `config.browserRunnerUrl`+`browserRunnerToken`
  (`VC_BROWSER_RUNNER_URL`/`VC_BROWSER_RUNNER_TOKEN`), инъекция —
  `BuildOptions.browserRunner`.
- **UI**: `makeBrowserBridge` в `remote/index.ts` ставит `window.browser`;
  `BrowserSessionPane` при монтировании зовёт `start` (incarnation хранит в ref),
  тянет кадры поллингом `screenshot` (screencast, 1.2 c), навигация/back/forward/
  reload/ввод идут `command`, клик по кадру пересчитывается
  `scaleBrowserCoordinates` в координаты вьюпорта, `stop` — на размонтировании.
  Деградация: нет моста или 501 → «Chromium недоступен».

Тесты: `runnerClient.test.ts`, `routes/browser.test.ts` (server),
`BrowserSessionPane.dom.test.tsx` и ветка Playwright в `App.dom.test.tsx` (UI).
Для реального запуска раннеру нужен `npx playwright install chromium`.

Не подключено к раннеру: инструменты модели `mcp__browser__*` в этом режиме
по-прежнему идут через `PreviewActionRelay`/iframe (управление настоящим Chromium
моделью — следующий шаг). Пользовательская навигация и ввод в Chromium — работают.

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
Ещё не реализованы: WS-транспорт кадров вместо поллинга, инструменты модели
`mcp__browser__*` поверх раннера, DOM/accessibility snapshot Chromium, highlight,
confirmation gates опасных действий, метрики и настоящий health-probe,
idle-timeout и retention профилей.

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
канал. Стало: опрос останавливается по `visibilitychange` и ускоряется до 400 мс
на четыре секунды после каждой команды, потому что сразу после действия страница
ещё меняется.

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
`playwright-reader` действие исполняется на сервере через `browserRunner`, а не
уходит в `PreviewActionRelay` (тот пушит его в браузер пользователя, где нужной
страницы нет). Перевод `PreviewAction` → `BrowserCommand` живёт в
`apps/server/src/browser/modelActions.ts` и покрыт тестами.

Ложатся напрямую: `open`, `back`, `forward`, `click`, `type`, `read`, `find`,
`wait`, `scroll` (через колесо; `to: top|bottom` — крупный шаг), `press`,
`console`, `errors`, `network`, `styles`, а с круга 9 — `hover`, `set`, `a11y`,
`drag` (только по селекторам), `viewport` (это `resize` раннера) и `evaluate`.

С круга 10 работают также `upload` (содержимое base64 уходит в
`setInputFiles` из памяти, потолок 8 МБ — оно едет в JSON) и снимок узла по
селектору.

**Отклоняется одно действие, и по существу** — до круга 9 общую формулировку про
Chromium получали все отказы подряд:

- `edits` — правки edit-режима копит **прокси превью**; у изолированного
  Chromium такого режима нет и быть не может;
- `drag` по координатам — раннер тянет локатор к локатору, а подменять
  координаты «примерно тем же» хуже, чем отказать (само `drag` по селекторам
  работает).

**`evaluate` включён без ослабления гейта.** `gateEvaluate` вызывается на уровне
MCP-инструмента, **до** выбора транспорта, поэтому политика команд проекта и
подтверждение опасного кода применяются к браузерному пути сами — второго гейта
писать не пришлось. Раннер сериализует результат и режет его по 20 000 символов:
в лог рана и в ответ модели уходит текст.

### Снимок экрана: единственный инструмент со своим транспортом

`screenshot` возвращает картинку, а не JSON, поэтому он не идёт через общий
`run()` — и до круга 9 звал `PreviewActionRelay` напрямую. Следствие: в разговоре
Playwright Reader снимок уходил **в браузер пользователя**, где страницы этого
разговора нет, и модель, управляющая изолированным Chromium, оставалась без вида
страницы — ровно того, ради чего Playwright и брали.

Отдельный вход `browserScreenshot` (рядом с `browserExecutor`) снимает у раннера
вьюпорт или узел по селектору (`locator.screenshot()`, круг 10); `null` означает
«этот разговор не про изолированный браузер, иди обычным путём». Область `rect`
координатами документа раннер не поддерживает — у него либо вьюпорт, либо узел.

### Ресурсы: что раннер обязан отпускать (круг 10)

- **Сессия закрывается сборщиком по простою** (`sweepIdle`, по умолчанию 30 мин,
  проверка раз в 5 мин). До этого Chromium держался до явного `stop`, а его никто
  не звал, если человек закрыл вкладку или ран оборвался: процесс жил до
  перезапуска контейнера.
- **Каталог профиля удаляется вместе с сессией.** `profilePath` детерминирован от
  `userKey` + `conversationKey`, а у QA-рана вторым ключом идёт `runId` — то есть
  каждый прогон оставлял бы свой каталог в томе навсегда.
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
Chromium — семь тестов. Теперь из словаря модели не поддержаны только
`evaluate`, `edits`, `drag` и `hover`.
