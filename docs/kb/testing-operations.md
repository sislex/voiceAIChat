---
title: Разработка, тестирование, диагностика и эксплуатация
updated: 2026-08-15
checked: 0a044e4
areas:
  - package.json
  - scripts
  - apps/server/vitest.config.ts
  - apps/llm-runner/vitest.config.ts
  - apps/agent/vitest.config.ts
  - packages/shared/vitest.config.ts
  - packages/ui/vitest.config.ts
  - Dockerfile
  - docker-compose.yml
  - docker-compose.parallel.yml
  - Caddyfile
---

# Разработка, тестирование, диагностика и эксплуатация

## Установка зависимостей

Корневой `npm install` обслуживает `packages/shared`, `packages/ui`, `apps/llm-runner`, `apps/server`, `apps/web`, `apps/agent`. `apps/desktop` и `apps/agent-tray` устанавливаются отдельно из-за Electron/native ABI и собственных lockfiles.

Не переносить Electron-пакеты в workspaces без отдельного решения миграции: корневой hoisting способен подменить native module сборкой под другой runtime.

## Development

`npm run dev:web` запускает Fastify :8787 и Vite совместно через `scripts/dev-web.sh`. Обычно этот процесс принадлежит пользователю; автоматизированный агент не должен оставлять второй server на том же порту. Для диагностического запуска использовать другой `PORT` и временный `VC_DATA_DIR`.

Server запускает исходники через tsx. Web dev proxy сохраняет same-origin семантику API и WebSocket. Агент для разработки запускается `npx tsx apps/agent/src/index.ts --server ws://host:8787/agent --token ...`.

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

Пакет имеет собственные `typecheck` и `test`. Unit-набор покрывает routes, POSIX/Windows path helpers и redaction; store-набор — stale-response и idempotent dispose; DOM setup находится в `src/test/setup.ts`; Storybook states — в `Operations.stories.tsx`. `architecture.test.ts` сканирует исходники и запрещает host stores, прямые transports, platform apps и имена секретных полей. Финальный локальный гейт для задачи — `npm run affected-check`; при изменении stories дополнительно собирается общий Storybook.
