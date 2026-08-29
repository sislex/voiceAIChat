---
title: Разработка, тестирование, диагностика и эксплуатация
updated: 2026-08-29
checked: 55efa3a6
areas:
  - package.json
  - scripts
  - apps/server/vitest.config.ts
  - apps/llm-runner/vitest.config.ts
  - apps/agent/vitest.config.ts
  - packages/shared/vitest.config.ts
  - packages/ui/vitest.config.ts
  - packages/app-shell
  - Dockerfile
  - docker-compose.yml
  - docker-compose.parallel.yml
  - Caddyfile
---

# Разработка, тестирование, диагностика и эксплуатация

## Проверки Reader frontend

Оба Reader workspace имеют собственные `typecheck` и `test`. Unit-наборы проверяют route round-trip, независимые conversation selectors, preview fallback без материализации, stale-response protection, browser-session lifecycle/capability degradation и dispose. Architecture tests запрещают host/chatStore/cross-Reader imports, transports, browser storage и imports исходников recorder/browser-runner. `frontend-quality.mjs` включает оба пакета в graph, exports/CSS/lazy/story matrix, а `affected-check` знает их как отдельные workspaces. Корневые `frontend:typecheck` и `frontend:test` запускают пакеты отдельно; `verify:frontend` затем выполняет web build, bundle gate, Storybook build и desktop web build. Наличие команд в gate зафиксировано кодом, но KB не утверждает, что конкретный merge SHA прошёл их, если результат запуска не сохранён.

## Установка зависимостей

Корневой `npm install` обслуживает `packages/shared`, `packages/ui`, `apps/llm-runner`, `apps/server`, `apps/web`, `apps/agent`. `apps/desktop` и `apps/agent-tray` устанавливаются отдельно из-за Electron/native ABI и собственных lockfiles.

Не переносить Electron-пакеты в workspaces без отдельного решения миграции: корневой hoisting способен подменить native module сборкой под другой runtime.

## Development

`npm run dev:web` через `scripts/dev-web.sh` совместно запускает Fastify на `:8787`, основной Vite-клиент на `:5273` и standalone `@voicechat/web-recorder` на `:5274`. Скрипт регистрирует PID только этих трёх процессов; при штатном завершении любого из них, `EXIT`, `INT` или `TERM` он останавливает остальные. Обычно этот lifecycle принадлежит пользователю; автоматизированный агент не должен оставлять второй server на тех же портах. Для диагностического запуска использовать другой `PORT` и временный `VC_DATA_DIR`. Порты dev-режима вынесены в окружение (`apps/web/vite.config.ts`): `VC_WEB_PORT`, `VC_API_PORT`, `VC_RECORDER_PORT` — значения по умолчанию прежние (5273/8787/5274), поэтому обычный `dev:web` не меняется, а второй сеанс рядом с чужим поднимается без правки конфига: `PORT=8801 VC_DATA_DIR=… npm run -w @voicechat/server dev` плюс `VC_WEB_PORT=5299 VC_API_PORT=8801 npm run -w @voicechat/web dev`. Прокси Vite при этом смотрит на выбранный порт API — без переменной он остался бы на 8787 и второй клиент молча работал бы с чужим сервером.

`scripts/dev-web.sh` читает `.env` из корня (`set -a; . .env; set +a`) сразу после `cd`. До этого `.env` подхватывал только docker compose, и `VC_SMTP_URL`/`VC_MAIL_FROM`/`VC_PUBLIC_URL` в dev не действовали — письма молча уходили в лог вместо SMTP. Следствие: значения с пробелами и `<` в `.env` обязаны быть в кавычках (`VC_MAIL_FROM='ChatAI <no-reply@localhost>'`), потому что файл именно исполняется шеллом, а не парсится.

**E2E раздела «Проекты» — `npm run e2e:projects`** (`e2e/projects.e2e.test.ts`,
реальный Chromium, как у Make). Поднимает сервер на свободном порту с временным
`VC_DATA_DIR` и **встроенным SMTP-приёмником** на соседнем порту: Mailpit для
прогона не нужен, тест самодостаточен. Покрывает то, чего не видит jsdom: каскад
нативных селектов типа, короткую доску «Общего проекта», отсутствие вкладки
«Релизы» у выключенной подсистемы, письмо приглашения и переход по ссылке из него
до входа, а также человеческий текст отказа гейта. Разбор письма — по base64-
блокам: multipart со склеенными заголовками декодируется в мусор. Шесть сценариев,
включая приём приглашения из сайдбара вторым пользователем и отказ по чужой
ссылке. **Ловушка setup:** онбординг — настройка пользователя, а не приложения;
у только что созданной учётки его оверлей перекрывает сайдбар, и клик не доходит
до кнопки. Каждому пользователю в тесте нужен свой `PUT /api/settings` с
`onboarded: true`. Пароль в `POST /api/admin/users` не должен содержать логин —
политика такие отклоняет.

**Ловушка: брошенный `tsx watch` без `VC_DATA_DIR` правит базу по умолчанию.**
`npm run -w @voicechat/server dev` — это `tsx watch`: процесс перезапускается на
каждом изменении серверных файлов и при старте прогоняет `migrate()`. Если у него
не задан `VC_DATA_DIR`, он работает с `~/.voicechat-server` — то есть чужая
незакрытая сессия молча мигрирует основную dev-базу под код, который сейчас
редактируют. Найдено на практике: таблицы новой фичи появились в базе до того,
как её кто-либо открывал намеренно. Миграции идемпотентны и данные не портят, но
диагностический запуск обязан задавать и `PORT`, и `VC_DATA_DIR`, а брошенные
процессы — гаситься: `pgrep -f "tsx.*src/index.ts"` показывает их,
`ps -Eww -p <pid>` — с каким каталогом данных они работают.

**Мобильная раскладка — `scripts/mobile-shots.mts`** (Playwright, вьюпорт 390×844).
Окно браузера в автоматизации не всегда поддаётся ресайзу (полноэкранный режим
macOS), поэтому телефонный вид проверяется headless-прогоном. Скрипт делает
скриншоты ключевых экранов и печатает две вещи, которые глазами ловятся плохо:
горизонтальный вылет (`scrollWidth > clientWidth`) и цели нажатия ниже 32px.
Порог целей — **40px и он падающий** (`process.exitCode = 1`, переопределяется
`VC_SHOTS_MIN_TAP`): регресс раскладки виден сразу, а не «когда кто-нибудь
посмотрит скриншоты». Цель считается **эффективной**: чекбокс 20px внутри
40px-подписи нажимается по всей подписи, ругаться на него — ложная тревога, поэтому
берётся ближайший предок `label`/`button`. В отчёте печатается класс обёртки — без
него селектор для починки подбирается вслепую. Ловушка CSS: у строчного элемента
`min-height` не действует вовсе, поэтому подписи-фильтры пришлось перевести в
`inline-flex`.

Запуск при поднятом dev-стеке: `VC_SHOTS_USER=… VC_SHOTS_PASSWORD=…
VC_SHOTS_PROJECT=<id> VC_SHOTS_INVITE=<token> npx tsx scripts/mobile-shots.mts`.
Ловушка, на которой скрипт сам споткнулся: у выехавшего за экран сайдбара элементы
остаются «видимыми» для Playwright (ненулевой размер) — судить надо по координатам
(`getBoundingClientRect().left >= 0`), а не по `isVisible()`.

**Локальная проверка почты** — Mailpit в отдельном контейнере, вне `docker-compose.yml` проекта: `docker run -d --name vc-mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit`, затем `VC_SMTP_URL=smtp://localhost:1025`. Наш минимальный SMTP-клиент проходит реальный путь (EHLO → без STARTTLS → без AUTH → MAIL FROM → DATA), письмо видно на http://localhost:8025 и читается через `GET /api/v1/messages`. Это инструмент гейта: у внешнего провайдера есть лимиты, задержки и спам-фильтры. `VC_PUBLIC_URL` обязателен и указывает на origin **интерфейса** (в dev — порт Vite), потому что ссылка письма — hash-маршрут UI; с портом API она не откроется.

Server запускает исходники через tsx. Основной Web dev proxy сохраняет same-origin семантику API и WebSocket и направляет весь prefix `/web-recorder/`, включая вложенные assets, на Vite recorder-а `http://127.0.0.1:5274`; поэтому recorder доступен через origin `:5273`. Агент для разработки запускается `npx tsx apps/agent/src/index.ts --server ws://host:8787/agent --token ...`.

## Матрица проверок

| Область | Typecheck | Tests | Дополнительно |
|---|---|---|---|
| shared contract | `npm run -w @voicechat/shared typecheck` | `npm run -w @voicechat/shared test` | consumers при изменении публичного типа |
| server | `npm run -w @voicechat/server typecheck` | `npm run -w @voicechat/server test` | HTTP/WS integration |
| llm runner | `npm run -w @voicechat/llm-runner typecheck` | `npm run -w @voicechat/llm-runner test` | стрим `/v1/run` — реальный `listen()` + `fetch` |
| agent | `npm run -w @voicechat/agent typecheck` | `npm run -w @voicechat/agent test` | bundle test при протоколе/deps |
| UI | `npm run -w @voicechat/ui typecheck` | `npm run -w @voicechat/ui test` | web build для CSS/bootstrap; `npm run build:storybook` при правке сториз/фикстур |
| web | `npm run -w @voicechat/web typecheck` | package test при наличии | `npm run -w @voicechat/web build` |
| desktop | `npm run typecheck:desktop` | `npm run test:desktop` | electron-vite build; native rebuild |
| agent tray | `npm run typecheck:agent-tray` | `npm run test:agent-tray` | electron-vite build/dist |

`npm run verify` выполняет полный набор. Для локального шага предпочтителен узкий гейт затронутых пакетов, затем полный verify перед релизом/крупным merge.

`affected-check` считает `apps/web-recorder` отдельным workspace: изменения `packages/shared` включают его как потребителя, а изменения `packages/ui` добавляют его явно. Поэтому affected-ран выполняет его `typecheck` и `test`. Дорогой `frontend:build-gates` запускается при затронутых UI/Web/Desktop пакетах, но эта команда собирает основной Web, bundle gate, Storybook и Desktop renderer и не включает production build Web Recorder. После клиентских изменений, затрагивающих standalone recorder, его production-сборку нужно проверять отдельно: `npm run -w @voicechat/web-recorder build`.

### Fast-stage затронутых тестов

`scripts/affected-check.mjs` запускает быстрый этап напрямую как `npx vitest related`, чтобы не передавать несовместимый `--related` подкоманде `vitest run`. При параллельных пакетных jobs ограничение worker должно задавать одновременно `--minWorkers` и `--maxWorkers` одним значением. Если передать только `--maxWorkers=1`, Vitest 2 может вычислить минимум выше максимума и завершиться ещё до запуска suites, поэтому структурированного JSON с ошибками тестов не будет; аргументы централизованы в `relatedArgs` и покрыты `scripts/affected-check.test.mjs`.

Вывод дочерних Vitest-процессов остаётся буферизованным, чтобы быстрый успешный гейт был компактным. Если пакетная команда работает дольше 30 секунд, `affected-check` печатает heartbeat с активным пакетом, этапом и длительностью. При fail-fast остановке либо `SIGINT`/`SIGTERM` перед завершением печатается сохранённый хвост вывода. MergeRunManager получает эти строки через потоковый `CommandExecutor`; ReleaseManager также использует `execStream` и по мере поступления обновляет лог шага `regression`, поэтому одинаковая диагностика видна в обеих лентах.

## Стратегия тестов

Shared — чистые unit и contract tests без моков. Здесь проверяются union/runtime lists, parsers, policy, state machine, prompt и преобразования.

Server HTTP тестируется `app.inject()` с `:memory:` SQLite. WebSocket поднимает ephemeral listener и реальный ws-клиент, но engines/CLI заменяются fake. Spawn, fetch, filesystem и resource probes инъектируются. Тест никогда не использует настоящий HOME или найденные repo-модели; `VITEST` отключает autodiscovery. Глобальный `testTimeout` server-набора — 10 минут: полный merge-гейт запускает пакеты параллельно, и интеграционные WS-тесты не должны ложно падать из-за кратковременной нагрузки машины. Многошаговые оркестраторы (CI-, merge- и release-раны) тестируются тем же приёмом: реальный `CommandExecutor` заменяется `vi.fn`, который узнаёт скрипт по подстроке и отдаёт заготовленный stdout, а `now` инъектируется счётчиком, поэтому порядок команд и длительности детерминированы без git, сети и CLI (образец — `merge/runManager.test.ts`, разбор в [features/merge-runner.md](features/merge-runner.md)).

Исполнитель LLM (`apps/llm-runner`) тестируется как сервер — `app.inject()` и фейковый `spawn`, — но поток `/v1/run` проверяется только через реальный `listen()` и построчное чтение `fetch`: `inject()` отдаёт тело целиком и не показал бы, что строки не буферизуются. Тем же `inject()` покрываются профильные файловые API `/v1/auth/status`, `/v1/files/read`, `/v1/fs/cc/*` и `/v1/fs/cx/*`: тесты заводят временный `dataDir`, создают профили `cli-users/<base64url(user)>` и проверяют, что формы ответов совпадают с прежними серверными роутами. Bearer в тестах обязательно ASCII: значение заголовка — ByteString, и `fetch` с кириллическим токеном падает до запроса.

UI store тестируется без React; DOM components — jsdom + Testing Library + fake bridges. Проверяются пользовательские действия и наблюдаемый результат, не внутренние state setters. Таймеры voice/TTS управляются fake clock.

Agent тестирует config/platform/exec/fs/pty/telemetry/shutdown/single-instance отдельно от socket. Connection test проверяет routing/reconnect с fake ws. Платформенные ветки должны покрывать Linux/macOS/Windows/Termux через инъекцию или controlled platform override. Рабочий приём — платформа необязательным параметром функции со значением `process.platform` по умолчанию (`fileOps.ts:toNativePath(path, platform)`): тогда win32-ветка проверяется на POSIX-CI обычным вызовом с `'win32'` и семейством `path.win32`. То, что эмулировать нельзя (реальное чтение файла по MSYS-пути), закрывается `it.runIf(process.platform === 'win32')` и на Linux просто пропускается.

Electron main/preload код тестируется без запуска реального окна, где возможно. Native SQLite перед тестом пересобирается под Node ABI, перед Electron build — обратно под Electron ABI.

## Диагностика по слоям

1. `/api/health` — процесс и HTTP доступны.
2. `/api/session/me` — bearer token и пользователь.
3. `/api/system/capabilities` — сервер видит CPU/RAM и разрешает STT/TTS.
4. `/api/auth/status` — исполнитель видит авторизованный CLI profile нужного пользователя, а не только контейнер сервера; если Claude и Codex разведены по разным executor URL, проверять надо оба.
5. `/api/agents` — machine зарегистрирована, online, версия и telemetry.
6. Browser devtools network — REST status и `/ws` reconnect.
7. Server stdout — Fastify/CLI ошибки; UI console panel — нормализованные LLM events.
8. Agent/tray log — connection, shell, PTY и fs ошибки на удалённой машине.

При «генерация пропала после refresh» проверять `claude.active` и TurnManager, а не только UI. При дублированных событиях — cleanup subscriptions после reconnect. При недоступном TTS/STT — capabilities и cgroup limit до проверки binary.

Эти же слои автоматизирует **самодиагностика чата** прямо из UI: команда `самодиагностика чата` / `/chat-diagnostics` в композере любого разговора прогоняет 11 проверок (transport → backend → model → persistence → store) и публикует пошаговый результат служебными сообщениями в саму беседу, останавливаясь на первом провале с указанием слоя. Быстрый способ проверить весь путь «клиент → сервер → модель → БД» глазами пользователя, без devtools. Реализация и список шагов — [ui.md](ui.md), раздел про самодиагностику.

## Известные дефекты dev-режима браузера (2026-08-24)

Два независимых дефекта ломают вход в dev-режиме (`npm run dev:web`, Vite + React development build) и не проявляются в production-сборке; оба воспроизводятся на чистом main и не связаны с Web Reader:

- **React StrictMode + одноразовый dispose runtime.** `useCreateAppRuntime` создаёт runtime в `useMemo`, а эффект на StrictMode-цикле mount → cleanup → mount вызывает `runtime.dispose()` и затем `start()` на уже необратимо disposed runtime: все `setState` доменных сторов молча блокируются, `check()`/`login()` не устанавливают `currentUser`, и приложение навсегда остаётся на экране «Вход», хотя сетевые запросы (login 200, bootstrap) проходят.
- **Redux DevTools-обёртка зацикливает эффекты.** `createReduxDevToolsDiagnostics` оборачивает `store.actions` в Proxy, чей `get` создаёт новую функцию на каждый доступ; зависимость `useEffect(..., [path, setSidebarOpen])` в `App.tsx` меняется на каждом рендере, а `setState` без bail-out уведомляет подписчиков даже без изменения значения — при установленном расширении Redux DevTools рендер падает в «Maximum update depth exceeded» и экран пуст. Без расширения обёртка неактивна и дефект не виден.

**Исправлено 2026-08-25:** dispose runtime в `useCreateAppRuntime` откладывается на тик и отменяется повторным StrictMode-mount (регресс — StrictMode-тест в `App.dom.test.tsx`), а Proxy devtools кэширует обёртки actions (стабильные ссылки; тест в `store/devtools.test.ts`). Dev-вход работает без обходов.

## Docker

Dockerfile многостадийный: устанавливает workspace dependencies, собирает web, формирует runtime с server source, shared и необходимыми системными binary/libs. Приложение слушает configurable `HOST/PORT`, persistent data монтируется в `VC_DATA_DIR`.

Web build в образе использует same-origin. CLI credentials и пользовательские profiles должны жить в persistent volume; пересборка образа не должна стирать SQLite, модели и auth.

`docker-compose.yml` — основной сервис. `docker-compose.parallel.yml` предназначен для параллельного/альтернативного экземпляра с разнесёнными портами/томами. Перед запуском второго экземпляра проверять уникальность host port и data volume.

## Caddy и TLS

Caddy завершает HTTPS и проксирует HTTP/WebSocket на Fastify. Для microphone APIs браузеру нужен secure context (HTTPS или localhost). Proxy обязан сохранять Upgrade для `/ws` и `/agent`, request host/proto и достаточные timeouts для долгих потоков.

Публичный reverse proxy не должен открывать LAN-only Anthropic gateway без дополнительной аутентификации/ACL. Machine install scripts строят URL из публичной базы, поэтому `VC_PUBLIC_URL`/forwarded host должны соответствовать адресу, доступному самой машине.

## Данные и backup

Резервировать весь `VC_DATA_DIR`: SQLite с WAL/SHM согласованным snapshot, session secret, user CLI profiles, uploads и скачанные модели/голоса по выбранной раскладке. Простой copy только `.db` во время активной записи может быть неполным; использовать SQLite backup/остановку или копировать согласованный набор.

Machine tokens восстановить из hash нельзя. Потеря БД требует перерегистрации машин. Потеря session secret инвалидирует пользовательские bearer tokens, но не пароли и machine token hashes.

Перед обновлением: backup data volume, зафиксировать текущий image/commit, выполнить typecheck/tests/build, затем rolling restart. Схема обновляется идемпотентно при старте; обратимость конкретной миграции нужно оценивать по `database.ts`.

## Замер расхода CI-ранов

`node scripts/ci-usage-report.mjs [--db путь] [--since 2026-08-02] [--task ЧАСТЬ]
[--run ЧАСТЬ] [--json] [--context]` — таблица «во что обошёлся ран» по данным БД: стоимость
(настоящая от CLI, иначе оценка «≈», а без прайса — «занижено»), токены в единой
семантике, время рана и работы модели, попытки fix-loop, вызовы инструментов с
разбивкой и отдельно — сколько раз файл читали командой внутри `bash` и сколько
правок шло heredoc'ом. Это инструмент замера, а не сервис: гоняется руками по
прод-БД (в контейнере `--db /data/voicechat.db`), поэтому скрипт, а не ручка API.
Прайс и классификация инструментов в нём — намеренная копия
`packages/shared/src/pricing.ts` и `ci.ts` (скрипт не тянет сборку воркспейсов);
при расхождении источник истины — код, а не скрипт. Вызовы инструментов берутся
из `ci_run_tool_calls`, а у ранов до этой метрики восстанавливаются из ленты по
строкам `[tool_use] имя: …` — такие числа помечены «~». Отказы (`denied`) идут
отдельной припиской «отказов N», а не в «всего»: сам отклонённый вызов уже
посчитан своим видом. Под раном печатаются его стадии — «актуализация базы
знаний на sonnet: $0.18 (3%), запросов 12, модель 3м»: после «модели по стадии»
(см. `features/ci-runner.md`) стадии считают разные движки, и по одной сумме за
ран не видно, кто сколько съел. Методика и вердикт последнего замера — в
`features/ci-runner.md`.

**Контекст на запрос — главная строка про деньги.** У каждого рана печатается
«контекст/запрос ср. Xk, макс Yk» и число запросов к API (`num_turns`): цена хода
равна размеру контекста, умноженному на число запросов, и по сумме токенов ни один
множитель не виден. `--context` добавляет состав контекста в токенах: оценку
директивы задачи и инъекции БЗ, а также верхнюю оценку всего базового промпта
(системный промпт CLI, схемы инструментов и директива) по самому скромному ходу.
Отдельной строки системного промпта CLI в БД нет. Скрипт ещё раскладывает измеренный
живым CLI средний контекст на базовый минимум (это потолок постоянной части: в нём
уже мог быть первый ответ) и средний накопленный хвост диалога. Ответы инструментов
по-прежнему показаны в символах с разбивкой по видам и тремя тяжёлыми ответами:
сервер получает их ровно текстом, без токенизации модели. Они берутся из
`ci_run_tool_calls.chars` и `ci_run_tool_responses`, а у ранов до этих метрик
восстанавливаются из ленты (`[tool_result] … · полный текст`) и помечаются «~» —
оценка сверху, зато сравнимая с новыми ранами.

**Сверка прайса.** На ходах, где известны И настоящая цена от CLI, И оценка по
таблице, скрипт печатает их расхождение: у рана — «прайс +0.2% к факту (по 3)»,
у движка в итоговой строке — суммы оценки и факта с процентом. Пока проценты
около нуля, оценке можно верить и сравнивать движки; уехали — таблица цен
устарела, править `packages/shared/src/pricing.ts` (и копию в скрипте). Колонки
нет там, где сверять не с чем: codex настоящей цены не сообщает ни на одном
ходе, весь его расход в отчёте — оценка. Именно поэтому перекос и жил незаметно
полтора месяца: прайс завышал opus втрое, но у claude в отчёт шла настоящая
цена, а сравнение движков молча сравнивало факт с оценкой по кривой таблице.

## База знаний

Перед задачей: `npm run kb:context -- "запрос"`. После кода: `npm run kb:impact`, правка тематической статьи, `node scripts/kb.mjs touch <topic>`, `npm run kb:log -- slug`, `npm run kb:index`, `npm run kb:check`. README генерируется и руками не редактируется.

## Проверки Operations frontend

Пакет имеет собственные команды `typecheck` и `test`. `routes.test.ts` покрывает round-trip публичных hash routes и базовые POSIX/Windows path helpers; `operationsStore.test.ts` проверяет stale machine response, повторный `dispose` и независимость закрытия Explorer от Console. `architecture.test.ts` сканирует TypeScript-исходники и запрещает host stores, прямые transports, platform apps и явные имена token-полей. JSDOM setup находится в `src/test/setup.ts`.

`packages/ui/.storybook/main.ts` включает stories пакета. `Operations.stories.tsx` содержит состояния online/offline, utility, restricted policy, Explorer, LLM History, Knowledge Base, CI и diagnostics; это независимые поверхности без production transport. Проверки запускаются `npm run -w @voicechat/operations-app typecheck` и `npm run -w @voicechat/operations-app test`; общий проектный гейт остаётся `npm run affected-check`.

## Проверки Administration frontend

`@voicechat/admin-app` имеет собственные `typecheck` и `test`, JSDOM setup, route, store stale-response/dispose, DOM и architecture tests. Architecture suite запрещает host stores, apps/web/apps/desktop, прямые fetch/WebSocket/Electron API, глубокие host imports и browser storage. Storybook host включает `packages/admin-app/src/**/*.stories.tsx`. Штатный итоговый гейт — `npm run affected-check`; после переноса он прошёл fast и full stages.

## Проверки App Shell

`@voicechat/app-shell` запускает `npm run -w @voicechat/app-shell typecheck` и `npm run -w @voicechat/app-shell test`; Vitest использует JSDOM и `src/test/setup.ts` с jest-dom. `registry.test.ts` проверяет role gate до lazy load и диагностику конфликтующих route examples. `runtime.test.ts` подтверждает независимость нескольких runtime/store экземпляров, раздельные load/createStore/bootstrap и продолжение cleanup после ошибки одного ресурса, включая повторные logout/dispose.

`architecture.test.ts` рекурсивно сканирует TypeScript исходники App Shell и запрещает импорты Chat/Projects/Operations/Admin, host `@voicechat/ui`, platform apps и прямые обращения к перечисленным `window.*` bridges. Storybook host включает stories App Shell, Chat, Projects, Operations и Admin.

## Единый frontend quality gate

Каноническая команда `npm run verify:frontend` последовательно запускает статический gate, typecheck и Vitest всех frontend-пакетов, Web build, bundle check, Storybook build и build Desktop renderer. Она использует только локальные fake clients/JSDOM fixtures и не требует backend, CLI, production credentials, SQLite, микрофона, машин или сети. Desktop намеренно не входит в корневые npm workspaces, поэтому `frontend:build-gates` перед его сборкой выполняет `npm ci --prefix apps/desktop`; свежий CI-checkout не должен зависеть от ранее созданного `apps/desktop/node_modules`.

`scripts/frontend-quality.mjs` проверяет workspace dependency graph и циклы, запрет deep imports и product/host/platform/transport leaks, существование root/styles package exports, обязательную Storybook-матрицу пяти модулей, CSS imports/keyframes/unscoped selectors и dynamic imports всех product modules с role-gated Admin. Негативные fixtures и redaction отчёта покрыты `scripts/frontend-quality.test.mjs`. Безопасный машинный отчёт сохраняется в `artifacts/frontend-quality/report.json`; token, Bearer credentials и credential-bearing URLs редактируются.

Bundle gate сравнивает minified JS chunks Web build с измеренным baseline `frontend-quality/bundle-baseline.json`; запас равен 12%, превышение сообщает chunk, limit, actual и delta, React обязан находиться в одном chunk. Baseline меняется только явной правкой файла. `affected-check` запускает дорогие frontend build gates только при frontend-влиянии; server/runner/agent-only diff их не включает.

## E2E Make в реальном Chromium (2026-08-27)

`npm run e2e:make` — `e2e/make.e2e.test.ts` под vitest (`e2e/vitest.config.ts`) с `playwright` из корневых
node_modules (браузер — из кэша `~/Library/Caches/ms-playwright`, ставится `npx playwright install chromium`).
Тест сам поднимает `apps/server` на случайном порту с временным `VC_DATA_DIR`, логинится по
`/api/session/login`, выставляет `onboarded: true` через `PUT /api/settings` (иначе оверлей онбординга перекрывает
панель), создаёт Make-разговор и применяет шаблон `react-ts`. Сценарии: превью React (TSX через esbuild,
React из esm.sh — нужен интернет), «Компоненты» + controls, Monaco + автосохранение, публикация без входа.
Ловушка: `page.goto` на URL, отличающийся только хэшем, не перезагружает документ — токен из localStorage
подхватится только после `page.reload()`. В `npm test`/CI не входит: требует собранный `apps/web/dist`,
браузер и сеть; `describe.skipIf(!existsSync(dist))`.

**Мониторинг диска (roadmap-4 п.40).** `MakeWorkspaces.diskStats()` через `statfs` корня данных даёт `AdminMakeStats.disk { totalBytes, freeBytes, alert }`, порог тревоги — `MAKE_DISK_ALERT_BYTES` (10 ГБ, столько же с запасом требует проверка места перед релизом `RELEASE_MIN_FREE_KB`). В админке (`UsersAdmin`, блок Make) строка «Диск с данными…» краснеет и получает `role=alert`; в `/api/admin/make/metrics` — гауджи `make_disk_free_bytes`, `make_disk_total_bytes`, `make_disk_alert`. fail2ban и SSH-харденинг прод-хоста (btmp показывал брутфорс) не делались: это системная правка сервера вне репозитория — выполнять только по явному подтверждению.

## Мобильный прогон обходит и доску, и карточку задачи

`scripts/mobile-shots.mts` до этого снимал только список проектов, диалог
создания, настройки и каталог типов — то есть **падающий порог целей нажатия не
сторожил два главных экрана раздела**. Теперь прогон открывает доску проекта
(`9-board`), разворачивает свёрнутую ленту фильтров (`9b-board-filters` —
состояние достижимо только действием) и карточку задачи (`10-task-modal`).
Карточка снимается, только если на доске есть хотя бы одна задача: на пустом
стенде шаг молча пропускается, поэтому перед прогоном задачу надо создать.
