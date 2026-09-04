---
title: LLM: claude/codex CLI, ходы, stream-json, gateway
updated: 2026-09-04
checked: 1ffda784
areas:
  - apps/server/src/claude
  - apps/server/src/codex
  - apps/llm-runner/src
  - apps/server/src/turns.ts
  - apps/server/src/auth/statusState.ts
  - apps/server/src/session.ts
  - apps/server/src/prompt
  - apps/server/src/anthropic
  - apps/server/src/cc
  - apps/server/src/mcp/remoteBashMcp.ts
  - apps/llm-runner/src/cli/cliProfiles.ts
  - packages/shared/src/streamJson.ts
  - packages/shared/src/codexStream.ts
  - packages/shared/src/prompt.ts
  - packages/shared/src/tools.ts
  - packages/shared/src/questions.ts
  - packages/shared/src/images.ts
  - packages/shared/src/kb.ts
  - packages/shared/src/kbGaps.ts
  - packages/shared/src/auth.ts
  - packages/shared/src/protocol.ts
  - packages/ui/src/remote/index.ts
  - packages/ui/src/store/domains/settingsStore.ts
---

# LLM: claude/codex CLI, ходы, stream-json, gateway

## Модель вызывается как CLI, а не по API

`ClaudeCli` (`apps/llm-runner/src/cli/claudeCli.ts`) делает
`spawn('claude', ['-p', prompt, '--output-format', 'stream-json', '--verbose',
'--include-partial-messages', '--model', …])`, при необходимости
`--permission-mode` и `--resume <sessionId>`. `spawn` инжектируется — все тесты
работают на фейковом процессе, реальный CLI в тестах не запускается. Аналогично
`CodexCli` для `codex`; выбор движка — настройка `llmProvider`, а разговор может
переопределить движок и модель через `conversations.llm_provider`/`llm_model`
(`null` — наследовать настройки). Исполнитель выбирается отдельно через `llmEngineId`
(разговор сильнее общих настроек); сервер проверяет роль/enabled/kind и при
подмене на доступный default пишет явное предупреждение в ответ. При выборе codex без клиента codex ход
откатывается на claude, и модель разговора тогда игнорируется).

Перед запуском `turns.ts` применяет персональный deny-list
`user_llm_access` к обоим provider: запрещённый provider заменяется первым
доступным, а запрещённая модель — первой доступной моделью выбранного provider.
При отсутствии доступной пары ход не запускается; каждую подмену или отсутствие
доступа сервер сообщает в чат. Правила выбора живут в
`packages/shared/src/llmAccess.ts`, а не в роли пользователя.

**Меню моделей повторяет меню самих CLI** (`CLAUDE_MODELS` / `CODEX_MODELS` в
`packages/shared/src/types.ts` — один список на настройки, разговор и CI). У
Claude это `default` («Default (recommended)» — модель выбирает сам CLI),
`opus[1m]` («Opus (1M context)»), `fable`, `sonnet`, `haiku`: id уходит в
`claude --model` как есть, включая суффикс окна `[1m]`. У Codex —
`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`,
`gpt-5.4-mini`, `gpt-5.3-codex-spark` (в `codex -m`; первый —
`DEFAULT_CODEX_MODEL`). Старые значения
из БД/настроек не ломают ход: `normalizeClaudeModel` тянет их к пункту меню по
префиксу алиаса (`opus`, `opus-4.5` → `opus[1m]`; неизвестное → `default`), а
`turns.ts` нормализует Claude до проверки персонального доступа. Пустая модель
codex (прежний пункт «По умолчанию (из codex)») по-прежнему допустима —
исполнитель тогда не добавляет `-m`, а UI показывает её отдельным пунктом, как
любую модель не из пресетов.

Дефолты новых пользователей — `DEFAULT_SETTINGS.model = 'default'` и
`codexModel = DEFAULT_CODEX_MODEL`, то есть первый пункт каждого меню. Доступ
к `opus[1m]`, `fable` и любой модели Codex больше не выводится из роли: его
задаёт только персональный deny-list. У CI своя константа
`DEFAULT_CI_CLAUDE_MODEL = 'opus'` (`packages/shared/src/ci.ts`), и она
намеренно осталась прежней: ран отдаёт `ci_runs.llm_model` в `--model` без
нормализации (`modelFor` в `ci/modelHooks.ts`), а голый алиас `opus` CLI
по-прежнему понимает. В меню его нет, поэтому селекты дорисовывают такую
модель отдельным пунктом — см. [features/ci-runner.md](features/ci-runner.md).

Отсюда два следствия: (1) аутентификация — это `claude login` / `codex login` на
хосте или в контейнере runner-а, ключей в конфиге нет; (2) ошибки CLI переводятся в
человеческие сообщения (`ENOENT` → «установите Claude Code», stderr про
авторизацию → «выполните `claude login`»), не выбрасывай их наружу как есть.

В Docker-проде CLI разведены по двум внутренним сервисам compose: `runner-work`
(рабочие `claude` + `codex`, без публикации порта наружу) и `runner-personal`
(отдельный личный `claude`). Серверный образ `claude`/`codex` больше не содержит:
он разговаривает с runner-ами по HTTP и хранит только URL/токен.

**Сами CLI-классы живут не на сервере.** `claudeCli.ts`, `codexCli.ts`,
`childKill.ts`, `mcp.ts` и `cliProfiles.ts` переехали в воркспейс исполнителя
(`apps/llm-runner`), а контракт `LlmRequest`/`LlmClient` — в
`packages/shared/src/llm.ts` (`apps/server/src/claude/types.ts` остался
реэкспортом). Сервер пока зовёт классы напрямую через
`@voicechat/llm-runner/cli`, но сам `spawn` уже не содержит — см.
[features/llm-runners.md](features/llm-runners.md).

**Одноразовые вызовы без разговора.** Не всё идёт через `TurnManager`: KB-reranker
(`kb/reranker.ts`) и помощник промптов (`prompt/suggester.ts`) дергают тот же
`LlmClient.send` напрямую с `sessionId: null`, `permissionMode: 'plan'`,
`executionDisabled: true` и ждут единственный `onDone`. Помощник промптов
(`PromptSuggester`, модель `haiku`) по черновику возвращает переформулировки —
роут `POST /api/prompt/suggest`, конструируется из инъектированного `claude` в
`server.ts`, поэтому тесты мокают его через `opts.claude`.

Статус входа обоих CLI сервер отдаёт на `/api/auth/status`, но сам уже не
читает локальный `HOME`: при настроенном исполнителе `routes/rest.ts` получает
снимок через `RunnerFsClient.authStatus()` (`GET /v1/auth/status?userId=...`).
Если Claude и Codex живут на разных исполнителях, клиент сшивает ответ из двух
половин. Для Claude авторитетен результат `claude auth status --json`, запущенный
с `HOME` профиля пользователя (`apps/llm-runner/src/auth/loginStatus.ts`): наличие
`.credentials.json` не означает действующую авторизацию. `loggedIn: true` выдаётся
только при нулевом exit code и JSON-поле `loggedIn: true`; отрицательный результат
и подтверждённые признаки повторного входа дают фиксированное безопасное сообщение
без передачи stdout/stderr и `loggedIn: false` (`packages/shared/src/auth.ts`).
Codex сохраняет проверку `~/.codex/auth.json`/`OPENAI_API_KEY`.

Сервер хранит единое per-user состояние: `/api/auth/status` читает его же, а при
каждом подключении `/ws` отправляется полный кадр
`{ t: 'auth.status', v: 1, status }`. Содержательно равные результаты
дедуплицируются; подтверждённая auth-ошибка реального хода немедленно меняет
соответствующий provider и рассылается клиентам. Reconnect получает новый полный
снимок, история не воспроизводится. UI инициализирует и обновляет статус этими
кадрами; периодического polling `/api/auth/status` нет, HTTP-маршрут сохранён для
диагностики и обратной совместимости.

**У каждого пользователя свой HOME для CLI** (`apps/llm-runner/src/cli/cliProfiles.ts`):
`<dataDir>/cli-users/<base64url(логин)>/` с `.claude` и `.codex` внутри. Из общего
HOME контейнера копируются только файлы авторизации и конфигурации — история,
`projects/` и `sessions/` не копируются, чтобы пользователи не видели чужие
сессии. При каждом обращении повреждённый или окончательно просроченный OAuth
Claude восстанавливается из действующего общего профиля, но рабочие
пользовательские токены никогда не перезаписываются. При локальном запуске
`buildServer` всё ещё передаёт движкам `profileHome(userId)`, но проводник CC/Codex
и статус логина при настроенном исполнителе теперь читаются только через его HTTP API.

## Исполнитель по HTTP (`RemoteLlmClient`)

Движок не обязан жить рядом с сервером. Если задан адрес контейнера-исполнителя,
`buildServer` вместо `ClaudeCli`/`CodexCli` собирает `RemoteLlmClient`
(`apps/server/src/llm/remoteClient.ts`): он открывает `POST /v1/run` (тело —
`LlmRunBody` из `packages/shared`: поля `LlmRequest` ПЛОСКО плюс `kind` и `runId`)
и читает NDJSON-конверты `{t:'out'|'err', s}` / `{t:'exit', code}`. Строки `out` — сырой
stdout CLI, поэтому разбор stream-json/JSONL, usage и `session_id` остаются на
сервере: `turns.ts`, CI-раннер и парсеры `packages/shared` не отличают удалённый
ход от локального.

`LlmRequest.attachments` решает проблему серверных абсолютных путей в prompt: сервер
по-прежнему собирает prompt с путями из своей ФС, но вместе с запросом передаёт
байты вложений и исходный `serverPath`. Исполнитель создаёт временный каталог рана,
кладёт туда файлы, переписывает prompt по карте `serverPath → runnerPath` и удаляет
каталог после завершения или отмены рана. Аналогично `cwd` стал «желаемым»: сервер
его больше не проверяет через `existsSync`, а исполнитель сам решает, можно ли
сделать `chdir`; несуществующий путь просто игнорируется.

Общее место разбора — `llm/sinks.ts`: приёмник строк (`createClaudeSink` /
`createCodexSink`) отделён от способа их получить, им пользуются и локальные
CLI-классы, и `RemoteLlmClient`. Там же живут `describeClaudeExit` /
`describeCodexExit`, накопление usage и единичный финал `onDone|onError`.
Заводишь новый транспорт — кормишь тот же приёмник, а не копируешь `switch` по
событиям.

`runId` рана генерирует СЕРВЕР до запроса: иначе отмену до первого байта ответа
некуда адресовать. `LlmHandle.cancel()` шлёт `DELETE /v1/run/:id` (исполнитель
убивает свой CLI) и рвёт поток.

Codex resume с непустым `sessionId` получает в `RunManager` эксклюзивную аренду по
паре `userId + sessionId` до подготовки вложений и `spawn`. Пока владелец жив,
второй `POST /v1/run` получает `409 { error: 'codex_thread_in_use' }` без запуска
CLI. Разные thread одного пользователя, одинаковый thread разных пользователей и
новые Codex-сессии без `sessionId` продолжают выполняться параллельно; Claude эта
аренда не затрагивает. Аренда принадлежит `runId`, освобождается идемпотентно только
владельцем после окончательного `close` (с любым кодом), синхронной ошибки `spawn`,
события `child.error` либо при abandon из-за обрыва клиента/orphan-timeout. Один
`SIGTERM` при `DELETE` аренду не снимает: новый resume разрешается после
подтверждённой смерти процесса. `RemoteLlmClient` распознаёт только точную пару
HTTP 409 + `error=codex_thread_in_use` и отдаёт через существующий `onError`
фиксированную безопасную подсказку дождаться завершения, остановить текущий ход
либо сбросить сессию; произвольные детали тела в неё не попадают.

### Форму тела `/v1/run` держит только `packages/shared`

`apps/server/src/llm/protocol.ts` — тонкий адаптер: `RunnerRunBody` = `LlmRunBody`,
`parseRunnerLine` = `parseLlmRunFrame`, пути из `LLM_RUNNER`. Своих определений там
быть не должно. Пока они были (клиент слал конверт `{id, kind, request}`, а
`badRequest` исполнителя валидировал `prompt`/`model`/`kind` на верхнем уровне),
ходы не запускались вообще: `400 {"error":"bad_request","message":"prompt обязателен"}`
на каждое сообщение обоим движкам. Ни typecheck, ни тесты этого не видели — фейковый
исполнитель в тесте повторял форму за клиентом.

Вторая осечка того же чека `badRequest`: он требовал непустую `model`. У codex она
пустая штатно (`settings.codexModel` по умолчанию `''`, `codexInvocation` тогда не
добавляет `-m`, модель берётся из `config.toml` CLI), и каждый ход codex через
удалённого исполнителя падал в `400 model обязательна`. Локальный `spawn` этой
проверки не имел, поэтому баг вылезал только при настроенном `VC_LLM_RUNNER_URL`.
Теперь `model` обязательна только для `claude` (его `claudeArgs` пушит `--model`
всегда). Тем же чеком отбивался gateway: `apps/server/src/anthropic/gateway.ts` шлёт
codex `model: ''` намеренно.

Отсюда правило: контракт «сервер ↔ исполнитель» проверяется против НАСТОЯЩЕГО
`buildRunner` (`apps/server/src/llm/runnerContract.test.ts` поднимает его с
подменённым `RunManager` — spawn CLI не нужен, а валидация тела, Bearer и адресация
`DELETE /v1/run/:id` настоящие). Фейковый HTTP-сервер годится только для проверок
поведения потока (мусор в NDJSON, обрывы, таймауты).

Ошибки транспорта переводятся в человеческий текст — аналог `describeSpawnError`,
а не сетевой стектрейс: `ECONNREFUSED` → «исполнитель недоступен… проверьте, что
контейнер запущен», 401/403 → «проверьте токен `VC_LLM_RUNNER_TOKEN`», обрыв
потока без `exit` → «соединение оборвалось до конца ответа — ход остановлен»
(ход обязан закрыться, иначе он висит до перезапуска сервера).

Env (реестра исполнителей пока нет, срез 2 плана `docs/plans/llm-runners.md`):
`VC_LLM_RUNNER_URL` — общий адрес, `VC_LLM_RUNNER_CLAUDE_URL` /
`VC_LLM_RUNNER_CODEX_URL` — переопределение по движку, `VC_LLM_RUNNER_TOKEN` —
Bearer, `VC_LLM_RUNNER_TIMEOUT_MS` — ожидание заголовков `/v1/run` (сам ход не
ограничен). Эти переменные читает `config.ts`, а решение «remote или локальный
spawn» принимается в `buildServer()`. Не задано — сервер работает как раньше,
через `spawn`.

## Разбор потока

`packages/shared/src/streamJson.ts` — построчный парсер stream-json:
`session` (session_id + окружение хода), `delta` (текстовый дельта-токен),
`result` (итог + метаданные хода), `ignore`. Рядом —
`parseStreamJsonActivity`: **параллельный** разбор той же строки в
`ClaudeLogEntry` (Bash/Read/Edit, thinking, модель, режим, сырой JSON) для режима
консоли. Два парсера намеренно независимы: поток токенов не должен ломаться из-за
изменений в активности. Для codex — `codexStream.ts`.

Usage нормализуется в `TurnUsage` и рассылается как `claude.usage`. Claude CLI
отдаёт промежуточные usage-снапшоты, поэтому его счётчик растёт во время ответа.
`codex exec --json` отдаёт точные input/output/cached только в `turn.completed`:
`CodexCli` проводит этот итог через `onUsage` перед `onDone`, а `TurnManager`
подмешивает последний usage-снапшот в сохраняемый `TurnMeta`.

`session_id` сохраняется в `conversations.claude_session_id`: следующий ход идёт
с `--resume`, поэтому в промпт кладётся только новая реплика (`buildPrompt`), а
не вся история. Полная история собирается `buildConversationPrompt` — когда
сессии CLI нет (новый разговор, потерянная сессия).

## Ход модели (`turns.ts`)

`TurnManager` процесс-глобальный: ход привязан к разговору, живёт сквозь reconnect,
рассылает события всем подключённым клиентам этого пользователя и сам пишет
результат в БД. Клиент при подключении получает `claude.active` со списком
незакрытых ходов и накопленным частичным текстом — так восстанавливается стрим
после F5. Модель хода зажимается по роли пользователя (`clampModelForRole`).

## Make: инструменты `mcp__make__*`

У разговора `assistantKind: 'make'` ход получает `makeMcpUrl` (`turns.ts`: база `MAKE_MCP_PATH`
+ `conv` + `turn`; в режиме «План» — `&ro=1`). Раннеры подключают MCP-сервер `make`
(`claudeCli.ts`: allow-list `mcp__make__make_list_files|read_file|write_file|delete_file|rename_file|check`
+ системный хинт; `codexCli.ts`: `mcp_servers.make.url` + хинт в промпт). Текст хинта один —
`MAKE_ASSISTANT_HINT` в `@voicechat/shared/llm` (Codex без фразы «отвечай на языке пользователя»
отвечал по-английски; хинт также велит вызывать `make_check` после правок и использовать загруженные
пользователем файлы из `img/`; для React-проектов — импорты с расширением, компоненты в
`src/components/<Имя>.jsx` + `<Имя>.stories.jsx` в CSF, «работаем над одним компонентом» = править только его файлы). Хинт: проект — статический
сайт без сборки, `index.html` — точка входа, писать файлы целиком через `make_write_file`, превью
обновится само, полный код в ответ не вставлять. Из инструкций чата для Make сервер убирает
`taskLaunch` (правка проекта — и есть задача, спрашивать «завести задачу» бессмысленно) и `console`.
Сервер `apps/server/src/mcp/makeMcp.ts`: один снимок на ход (по `turn`) с подписью «До правок: «<первые 80
символов запроса>»» — текст приходит из `turns.ts` параметром `&note=` MCP-URL (без него — «До правок ассистента»),
после каждой мутации — `MakeHub.changed` → WS `make.changed` владельцу. **Авто-план для больших запросов** (п.20): `isBigMakeRequest(text)` из `@voicechat/shared/make` (редизайн/переделай/с
нуля/длиннее 600 символов; короткие «да/делай» — нет) переводит ход Make в `permissionMode: 'plan'` (make MCP с
`ro=1`) и добавляет в промпт раздел «Режим плана»: перечислить файлы и изменения, дождаться подтверждения.
Следующий запрос пользователя идёт обычным режимом. Явный `plan` пользователя не трогаем.
Инструмент `make_check`
(в allow-list раннеров) возвращает список проблем как ошибку инструмента — модели предлагается
вызывать его после правок вместо попыток открыть страницу браузером.

**Авто-проверка после записи (roadmap-2 п.1).** `make_write_file` после записи сам вызывает `workspaces.check` и дописывает в ответ инструмента блок «Замечания по файлу» — только по записанному пути (битые ссылки, ошибка компиляции jsx/tsx/ts с номером строки). Так модель видит ошибку до следующего шага и не зависит от того, вспомнит ли она про `make_check`; общий `make_check` по-прежнему нужен для проверки проекта целиком.

**Транзакции и патчи (roadmap-4 пп.1–2).** `make_apply_changes { files[], delete[] }` пишет несколько файлов разом (`MakeWorkspaces.applyChanges`): после записи запускается `check`, и если в любом из записанных файлов ошибка компиляции — все они возвращаются к прежнему содержимому (созданные удаляются, удалённые восстанавливаются), инструмент отвечает ошибкой «Изменения откачены». `make_edit_file { path, find, replace, all? }` (`editFile`) заменяет фрагмент: без `all` он должен встречаться ровно один раз (0 → `not_found`, >1 → `exists` с подсказкой расширить фрагмент). Хинт велит использовать патч для больших файлов и транзакцию для связанных правок; `make_write_file` остаётся для новых/маленьких файлов.

**Режим вопроса (roadmap-4 п.4).** Если Make-разговор идёт в `plan` не из-за авто-плана (`isBigMakeRequest`), а по выбору пользователя, `turns.ts` добавляет хинт «## Режим вопроса» (ответь по существу, файлы не меняй, план не расписывай) вместо «Режима плана»; make MCP уходит с `ro=1`. В UI кнопка ❓ «Только спросить» в шапке Make (`askOnly`/`onAskOnlyChange`): `App` перед отправкой переключает разговор в «План» (`changeConversationMode`), а когда голосовое состояние возвращается в `idle`, восстанавливает прежний режим и сбрасывает переключатель.

**Память проекта и режим ассистента (roadmap-4 пп.6–7).** `.make/notes.md` (заметки, ≤ 20 000 символов) и `.make/settings.json` (`mode: balanced|designer|developer`) хранятся в каталоге проекта (скрыты из `list`, переживают `reset`). `promptContext` добавляет хинт режима из `MAKE_MODE_HINTS` и первые 4000 символов заметок в блок «Контекст проекта Make». Инструмент `make_remember { note }` дописывает строку `- <дата>: <текст>`; REST `GET/PUT /api/make/:id/notes` (viewer/editor), мосты `make:notes`/`make:setNotes`. UI — `MakeNotesDialog` из меню «⋯ → Память проекта»: радио режима и textarea заметок.

**Откат правок хода (roadmap-2 п.2).** Снимок «До правок», который `makeMcp` делает перед первой мутацией хода, регистрируется в `MakeHub.rememberTurnSnapshot(turn, snapshotId)`; `turns.ts` передаёт в MCP-URL тот же `turnId`, что и внутри хода, и при сборке `merged`-meta спрашивает `deps.makeHub.turnSnapshot(turnId)` → `TurnMeta.makeSnapshotId`. `ChatColumn` у ответа с этим полем показывает «Откатить правки» (проп `onMakeRestore`, `App` даёт его только в маршруте `/make`): подтверждение через `useConfirm`, затем `make:restore` — текущее состояние перед откатом сохраняется снимком «Перед восстановлением снимка». Ход без записей файлов кнопки не получает.

**Контекст проекта в промпте (roadmap-2 п.9).** Перед ходом Make `turns.ts` вызывает `deps.makeContext(conversationId)` (в `server.ts` — `makeWorkspaces.promptContext`): блок «## Контекст проекта Make» с токенами `:root` из `tokens.css`/`styles.css` (до 40, формат `--имя: значение`) и открытыми комментариями к превью (до 20, с селекторами). Блок добавляется к `promptBase` после подсказок инструкций; при ошибке чтения — пустая строка, ход не срывается.

**Make без машины (roadmap-3 п.2).** Раньше `turns.ts` форсил `plan` для любого пользователя без машины, а нативный plan-режим CLI глушит MCP — Make не мог писать файлы. Теперь для Make-разговора с провайдером Claude ход идёт в `default` с `disallowedTools = MAKE_ONLY_DISALLOWED_TOOLS` (Bash, Edit/Write/MultiEdit/NotebookEdit, Read/Glob/Grep/LS, WebFetch/WebSearch, Task, …) — остаются только MCP-инструменты, make MCP без `ro=1`. Для Codex ход остаётся в плане (`--sandbox read-only`): раньше считалось, что read-only sandbox блокирует HTTP-MCP, но настоящая причина — Codex ≥0.15 требует одобрения любого MCP-вызова, а неинтерактивный `codex exec` отвечает «MCP tool call requires approval, but approval policy is never». С 2026-09-02 раннер регистрирует каждый HTTP-MCP с `-c mcp_servers.<name>.default_tools_approval_mode="approve"` (`mcpServerArgs` в `codexCli.ts`), и MCP работает и в read-only sandbox; проверено на 0.152 против пробного сервера (без ключа падают даже read-only инструменты, с `--dangerously-bypass-approvals-and-sandbox` проходят, с ключом — проходят при read-only). Политику изменений при этом держат сами MCP-серверы (`ro=1`, автопилот/подтверждения).

**Make-чат к машине не ходит вообще (2026-09-04).** Раньше исключение работало
только «без машины»: назначенная чату машина давала remote-bash-мост, а у роли
`admin` вместе с ним и встроенные `Bash`/`Write`/`Read` — то есть модель Make
могла править файлы на машине, включая общую копию проекта. Теперь `turns.ts`
(флаг `makeChat`) для Make игнорирует машину целиком: `resolveConversationMachine`
не вызывается, `remote` не собирается, отсутствие или offline машины не блокирует
ход, `MAKE_ONLY_DISALLOWED_TOOLS` запрещаются при любой роли и режиме, а Codex-ход
Make остаётся в `plan` тоже при любой роли. Причина — та же, что и у удаления
Make-push: общая копия проекта (`…/projects/<id>/worktree`) принадлежит git-потоку
(задачи, CI, релизы), и правка мимо коммита оставляет её dirty. Мастерская при
этом не теряет ничего: `make_*` пишут в `<dataDir>/make/<conversationId>` и машины
не требуют. Снимок контекста (`routes/rest.ts`) повторяет это правило: для
Make-чата `resolution` = null, поэтому «Машина выполнения», рабочая директория,
навыки и `mcp-remote-*` показываются недоступными, а `disallowedTools` содержат
встроенные инструменты. Единственное действие Make с репозиторием — разовое
обновление общей копии до `origin/<base>` при создании чата: `refreshProjectMain`
в `server.ts` (передаётся в `registerRest`) вызывается из `POST /api/conversations`
при `assistantKind: 'make'` с проектом, best-effort и без `await` — нет машины, она
offline или синхронизация упала, чат всё равно создаётся, а причина уходит в лог
(`make_chat_project_refresh_failed`). Оставшиеся с прежних времён привязки
Make-чатов к машине снимает миграция `database.ts` (`UPDATE conversations SET
exec_target = NULL, workdir = NULL WHERE assistant_kind = 'make'`, идемпотентно;
явное `exec_target = 'none'` сохраняется как осознанный выбор пользователя), а
`setConversationExecTarget` больше не даёт записать машину и каталог Make-чату —
остальные поля того же вызова (`permission_mode`, движок, модель, навыки)
сохраняются. Тесты: `turns.test.ts` («Make с назначенной машиной всё равно не
получает remote-мост» — машина наследуется как default-машина проекта, «Make на
Codex остаётся в плане даже у admin»), `rest.conversations.test.ts` («новый
Make-чат проекта разово обновляет общую копию до origin, обычный чат — нет») и
`db/database.test.ts` («снимает с Make-чатов привязку к машине и каталог, а «none»
и чужие чаты не трогает»).

## Канбан: инструменты `mcp__kanban__*`

У разговора `assistantKind: 'kanban'` ход получает `kanbanMcpUrl` (`turns.ts`:
база `KANBAN_MCP_PATH` + `conv` + `turn`; в режиме «План» — `&ro=1`). Раннеры
подключают MCP-сервер `kanban` (`claudeCli.ts` — allow-list из `KANBAN_TOOLS`
с префиксом `mcp__kanban__`, `codexCli.ts` — `mcp_servers.kanban.url`), текст
поведения один на оба движка: `KANBAN_ASSISTANT_HINT` в `@voicechat/shared/llm`.
Он велит начинать с `kanban_context` (что открыто у пользователя), менять доску
инструментами, а не советом «нажмите там-то», проверять дубликаты перед
созданием задачи, смотреть `machines_load` перед запуском работы и вести серии
задач планом (`orchestration_*`).

Пока `deps.kanbanMcpBaseUrl` пуст, `turns.ts` оставляет прежний режим
предложений (`{text, commands}` c `propose.*`) — иначе ассистент вообще не смог
бы ничего сделать. Полное описание инструментов, автономии, моста в интерфейс и
оркестрации — [features/kanban-assistant.md](features/kanban-assistant.md).

## Старт хода: `claude.start`

Как только выбраны движок, модель и машина (до подготовки контекста БЗ и вложений — они
занимают секунды), сервер шлёт `claude.start {conversationId, provider, model, execTarget}`
(`turns.ts`, сразу после `requestedTarget`); те же поля несёт `ActiveTurn` в
`claude.active`. Клиент (`chatStore.applyClaudeStart`, `liveTarget`/`activeTargets`) рисует
по ним шапку «Готовим ответ…»/стрима — движок, модель по наведению и машину — вместо
догадки по `aiLabel`/`execTarget` разговора, которая не знает наследования от проекта.
По той же причине `POST /api/conversations/:id/messages` для роли `ai` без `engine`/`execTarget`
(так пишут самодиагностики) подставляет эффективные движок и машину разговора.

## Договорённости в тексте ответа (fenced-блоки)

Модель может завершить ответ fenced-блоком, который клиент вырезает и рендерит
виджетом. Подсказки о блоках — **инструкции чата**: список `Settings.chatInstructions`
(`ChatInstruction { id, title, description, enabled, kind?, text? }` в `types.ts`).
Пять встроенных (`kind`: console/explorer/questions/image/taskLaunch) без `text` дают
стандартный текст своего вида (`standardInstructionText`), `text` — правка пользователя;
инструкция без `kind` — своя, просто текст без ответного блока. «Настройки → Инструкции»
(`ChatInstructionsSettings`) умеют включать/выключать, править текст, дублировать
(копия встроенной становится своей), добавлять, удалять и «Восстановить стандартные»
(`missingBuiltinInstructions`). Per-чат: в инспекторе контекста группа «Инструкции чата»
(`chat-instructions`, пункты `instruction-<id>`, `instructionContextId`), тумблер пишет
в `disabledContext`. Сервер (`turns.ts`) берёт `effectiveChatInstructions(settings,
disabledContext)` и подмешивает `appendChatInstructionHints`; стандартные консоль и
проводник без правок склеиваются в одну tool-подсказку. Старый формат настройки
(`Record<kind, boolean>`) и отсутствие поля приводит `normalizeChatInstructions`
(в `database.getSettings`). На «открой консоль» без инструкции модель отвечает текстом. Сервер дополнительно
вырезает блоки выключенных инструкций из готового ответа (`stripDisabledInstructionBlocks`
в `onDone` до `parseTaskLaunchRequest`): модель помнит формат по сессии и может выдать
блок сама — в БД и `claude.done` он не попадает. Парсеры блоков включённость не проверяют.

- ` ```tool ` + JSON `{kind: 'console'|'explorer', agentId?}` → встроенная утилита
  по машине (`packages/shared/src/tools.ts`, подсказка модели — `TOOL_HINT`).
  Блок может добавить и само приложение, распознав команду пользователя
  (`detectOpenUtility`).
- ` ```questions ` + JSON-массив `{q, options, multi?}` → форма уточняющих
  вопросов; выбранные ответы уходят обычным сообщением пользователя
  (`packages/shared/src/questions.ts`).
- ` ```image ` + JSON `{path, agentId?, caption?}` → созданная моделью картинка
  прямо в сообщении (`packages/shared/src/images.ts`, подсказка — `IMAGE_HINT`).
  `path` — **абсолютный путь**, но лежать файл может в двух местах, и это
  главная грабля. Встроенные генераторы картинок самих CLI пишут **на сервер**, в
  профиль пользователя (Codex — `<профиль>/.codex/generated_images/<сессия>/<call-id>.png`),
  даже когда команды хода уходили на машину: CLI-то запущен в контейнере. Модель,
  создавшая файл своими руками на машине, наоборот, даёт путь её хоста. Поэтому
  Поэтому после хода сервер **перекладывает такие картинки на машину разговора**
  (`apps/server/src/imageRelocate.ts`): читает файл из своей области, пишет его
  через `fs.write` в `<корень машины>/.generated_images` и переписывает блок на
  путь машины + `agentId`. Дальше браузер берёт картинку прямо с машины по HTTP
  (см. `machines.md`), а сервер из цепочки уходит. Осечка на любом шаге (машина
  офлайн, запись запрещена) оставляет картинку серверной — тогда работает прежний
  путь: `MessageImage` без явного `agentId` спрашивает сервер
  (`GET /api/files/read`, мост `window.files`), при 404 читает с машины через
  `fs.read`, и показывает base64 как data-URL.
  Прямые адреса машины клиент строит **только для путей внутри `.generated_images`**
  (`machineImageUrls`) — другие каталоги агент по HTTP всё равно не отдаёт, а каждый
  мёртвый адрес стоил браузеру таймаута соединения. Даже валидный адрес ждём не
  дольше 4 с (`DIRECT_URL_TIMEOUT_MS` в `MessageImage`): не ответил — следующий
  адрес, кончились адреса — байты через сервер.
  Здесь же fallback по формату: обычная markdown-картинка с локальным путём
  распознаётся так же — модели пишут так по привычке, а браузер такой `src` не откроет.

  **Частичных кадров нет.** Codex шлёт единственное событие `image_generation_end`
  — уже с готовым файлом; ни старта, ни промежуточных версий картинки в потоке не
  бывает, так что «прогрессивный рендер» как в ChatGPT воспроизвести нечем. Вместо
  него `MessageImage` в живом ходе (`live`) показывает плитку-заглушку с бликом и
  **перечитывает файл раз в 700 мс**, пока ход не завершится: путь в тексте иногда
  появляется раньше, чем файл дописан, и без опроса это была бы вечная ошибка.
  Ошибку показываем, только когда ход закончился, а файла всё нет.

Все три парсера — чистые функции без DOM и сети, тесты рядом. `parseQuestions` также принимает сообщение, которое целиком состоит из валидного JSON-массива `QuestionSpec`: это fallback для транспорта, который снял обёртку ` ```questions `. JSON внутри обычного текста без fence не распознаётся. Перед отправкой модель получает ещё и `CHANGE_AUTHORIZATION_HINT` (`packages/shared/src/prompt.ts`): до изменения проекта она обязана спросить, создать ли задачу в TODO, поставить её в InProgress или работать прямо в чате; в последнем случае после работы отдельно спрашивает разрешение на commit/push. Подсказки
навешиваются в `turns.ts` цепочкой `appendChangeAuthorizationHint(appendImageHint(appendToolHint(appendQuestionsHint(…))))`.

Служебные блоки **не озвучиваются**: `SERVICE_FENCES` в
`packages/shared/src/sentences.ts` (`tool`/`questions`/`image`) заставляет
`splitSpeakable` и `prepareTtsText` пропускать их молча, а не подставлять
заглушку «Далее пример кода». Заводишь новый служебный блок — добавь его туда,
иначе TTS начнёт его проговаривать.

## База знаний в ходе модели (авто-контекст + `mcp__kb__*`)

Режим разговора `kbContextMode` управляет тремя ветками в одном месте
(`turns.ts`): `auto` — сервер подмешивает контекст БЗ в промпт при высокой
уверенности И выдаёт модели инструменты `mcp__kb__*`; `manual` — авто-инъекции
нет, инструменты есть, системный хинт усиленный («сначала БЗ, потом код»);
`off` — ничего. Системный хинт (`kbToolHint`, `packages/shared/src/kb.ts`)
несёт вторым абзацем `KB_GAP_RULE`: молчание базы или неполный ответ, закрытые
кодом либо разработкой, обязаны вернуться в базу записью — дополнением того же
раздела, по проверенному коду и без догадок. Хинт добавляется на КАЖДЫЙ ход с
`kbMcpUrl` (`claudeCli`/`codexCli`), поэтому правило одинаково действует в чате
и во всех фазах CI-рана; механика записи — в
[kb-workflow.md](kb-workflow.md#пробел-базы-знаний-обязан-стать-записью). Инструменты подключаются ВНЕ ветки `remote`: база read-only и
нужна модели даже в ходе без машины. Выключатель на весь срез — `VC_KB_TOOL=off`.

MCP-эндпоинт `/mcp/kb` stateless, ход адресуется токеном `?turn=`, который
`TurnManager` выдаёт при старте и снимает во всех выходах хода. Claude получает
`--mcp-config` и общий `--append-system-prompt` (у CLI он один — хинты remote и
БЗ склеиваются); `--allowedTools` в ходе без машины намеренно не передаётся,
чтобы не сломать автоодобрение Read/Grep (escape hatch `VC_KB_TOOL_ALLOWLIST=1`).
Codex получает `-c mcp_servers.kb.url=…` до ветвления plan/remote. Базовый URL для `remote-bash` и `kb` сервер строит одной функцией `buildPublicMcpUrl` (`apps/server/src/mcp/publicBase.ts`): если задан `VC_MCP_PUBLIC_BASE`, исполнитель получает адрес вида `http://voicechat:8787/...`; без env остаётся dev/test-фолбэк `http://127.0.0.1:<PORT>`. Это важно именно для контейнера-исполнителя: его собственный loopback — не loopback Fastify-сервера. Пока CLI жил в контейнере `voicechat`, loopback совпадал и env был необязателен; с переездом на `runner-work`/`runner-personal` его отсутствие стало тихой поломкой — MCP-серверы не стартуют, `mcp__remote__*` и `mcp__kb__*` пропадают из хода, а сообщения об ошибке нет ни в ленте, ни в логе. Поэтому дефолт прописан в compose (`VC_MCP_PUBLIC_BASE: ${VC_MCP_PUBLIC_BASE:-http://voicechat:8787}`), а сервер печатает предупреждение на старте, если исполнитель настроен, а база — нет (`mcpBaseMisconfigured`).

По той же схеме к ходу разговора подключается MCP-сервер `browser`
(`/mcp/preview`, `apps/server/src/mcp/previewMcp.ts`): инструменты
`mcp__browser__open|read|find|click|type` управляют панелью веб-превью
пользователя и читают DOM открытой страницы. URL с токеном хода уходит полем
`LlmRequest.previewMcpUrl`, хинт — `previewToolHint()`
(`packages/shared/src/previewActions.ts`); сервер лишь транслирует действие
клиентам по WS (`preview.action`/`preview.result`) и ждёт ответ, исполняет его
браузер с активным чатом хода. Детали — [ui.md](ui.md#веб-превью).

Сборка блока контекста (порог `autoInjectAllowed`, формат разделов, точные
символы каждого) живёт в `kb/autoContext.ts` — ОДНА на ход чата и на ход модели
в CI-ране. Ран берёт режим не у чата, а у проекта (`ci_kb_context_mode`) и
фиксирует его в `ci_runs.kb_context_mode` на старте; инструменты подключаются к
работе модели, fix-loop и резюме, токен снимает `withKbTools` в `ci/modelHooks.ts`
во всех выходах хода — включая отмену рана. Подробности — `features/ci-runner.md`.

Каждое обращение (и авто-инъекция, и вызов модели) пишется в телеметрию и
рассылается кадром `kb.usage` — см. `features/kb-usage.md`.

## Наблюдатели сессий Claude Code и Codex

Фактические jsonl лежат только в профиле исполнителя. Серверные `/api/cc/*` и
`/api/cx/*` больше не читают диск напрямую: `routes/rest.ts` проксирует в
`RunnerFsClient`, а тот вызывает файловые роуты исполнителя `/v1/fs/cc/*` и
`/v1/fs/cx/*`, сохраняя наружу прежние формы ответов. На стороне исполнителя
`ccSessions.ts` и `codexSessions.ts` читают только «голову» файла для списков,
полный разбор делают при открытии транскрипта, usage считают из того же jsonl, а
реальный путь проекта берут из `cwd`-события, а не из имени каталога.

Live-tail больше идёт не через локальный `fs.watch` сервера, а через SSE
`/v1/fs/cc/watch` и `/v1/fs/cx/watch`. `session.ts` выбирает либо локальные
watchers, либо `observerTail` от `buildServer`; при вынесенном исполнителе это
`RunnerFsClient.watchCc/watchCx`. Клиентский контракт `cc.tail` / `cx.tail` не
меняется, а reconnect сервера к исполнителю продолжается с `Last-Event-ID`, чтобы
не терять хвост между переподключениями: id SSE равен последнему смещению в файле,
и после обрыва исполнитель дочитывает jsonl именно с него.

Тот же файловый клиент обслуживает и `GET /api/files/read`: сервер сначала
пытается прочитать картинку через `/v1/files/read`, а локальный `serverFiles.ts`
оставляет только как fallback для режима без удалённого исполнителя. Это же чтение
использует `imageRelocate.ts`, поэтому PNG, которые сгенерировал Codex внутри
профиля исполнителя, теперь можно безопасно переложить на машину разговора, не
монтируя профиль в контейнер сервера.

## Anthropic-совместимый gateway (входящий)

`apps/server/src/anthropic/gateway.ts` поднимает `/v1/messages` и
`/v1/messages/count_tokens`, чтобы **внешний** Claude Code мог использовать этот
сервер как endpoint. Прокси прозрачный: тело не преобразуется (кроме
опционального маппинга имён моделей `VC_CLAUDE_MODEL_MAP`), поэтому сохраняются
tools, thinking, prompt caching, SSE и beta-заголовки. Backend — либо `upstream`
(проброс на реальный Anthropic-совместимый URL), либо `codex` (локальный CLI).
Без `VC_CLAUDE_UPSTREAM_URL` отвечает 503. Токена gateway не спрашивает, но с
59f9178 **пускает только из локальной сети**: адрес клиента проверяется
`isLocalNetworkAddress` (loopback, 10/8, 172.16/12, 192.168/16, link-local, fc00::/7),
иначе 403 `permission_error`. Когда запрос пришёл с локального адреса (типично
из-за прокси), реальный клиент берётся из `x-forwarded-for`. То есть наружу его
всё равно не выставляют — фильтр по сети не заменяет авторизацию.

## Проброс Bash на машину пользователя

Когда ход идёт с выбранной машиной, встроенный Bash у claude выключается, а
вместо него подключается MCP-сервер `remote` (`apps/server/src/mcp/remoteBashMcp.ts`,
путь `/mcp/remote-bash`) с инструментом `bash`, выполняющим команду на агенте.
Эндпоинт stateless (свежий сервер и транспорт на каждый POST) и защищён секретом
процесса в query-параметре `k`. Детали политики — `machines.md`.

**Машины проекта.** Ход, связанный с проектом, видит не только выбранную машину:
если в query есть `project=<id>`, мост резолвит машины проекта
(`db.listProjectMachines`, резолвер передаётся пятым аргументом
`registerRemoteBashMcp`) и, когда их больше нуля, регистрирует инструмент
`machines` (имя, онлайн-статус, папка проекта, пометка выбранной) и добавляет
всем инструментам необязательный параметр `machine` (имя или id) — операцию
можно явно адресовать другой машине проекта. Без `machine` всё идёт на выбранную
машину с `cwd` хода (прежнее поведение); с `machine` другой машины `cwd` — её
`project_machines.path`, а пустой путь — отказ до обращения к машине. Query
`project` дописывает сервер, а не модель: `turns.ts` — когда чат привязан к
проекту и в проекте есть другие машины, `ci/modelHooks.ts` (`remoteOf`) — для
ходов CI-рана; там же в `remote.projectMachines` уходят имена ДРУГИХ машин, и
`claudeCli`/`codexCli` называют их в системном хинте (у claude
`mcp__remote__machines` добавляется в allow-list). Ход вне проекта и проект с
одной машиной работают по-старому — ни инструмента, ни параметра. Гейты `ro=1`
(план) и гейт чтения файлов применяются до резолва машины и от неё не зависят;
границы закреплены в `mcp/remoteBashMcp.test.ts` («машины проекта»),
`turns.test.ts`, `ci/modelHooks.test.ts` и `cli/*.test.ts` исполнителя.

Тело запроса читает **сам транспорт MCP**, а не Fastify: маршрут зарегистрирован в
своей области видимости (`app.register`), где сняты унаследованные парсеры и
поставлен парсер-пустышка на `*`, а `transport.handleRequest` вызывается без
третьего аргумента. Так сделано не ради стиля: если тело вычитает Fastify,
`hono/node-server` внутри MCP-SDK вешает слушатель `end` уже после конца потока,
считает запрос недосланным и через 500 мс «дренирует» соединение — сокет рвётся
после каждого вызова, а на ненастоящем сокете `app.inject()` таймер падает с
`socket.destroySoon is not a function`, то есть необработанным исключением
процесса уже после того, как тесты позеленели. Снятие парсеров обязательно:
без `removeAllContentTypeParsers()` Fastify ругается на дубль общего JSON-парсера
из `server.ts`. Регрессия закреплена в `mcp/remoteBashMcp.test.ts` — тест ждёт
800 мс после ответа и требует, чтобы `uncaughtException` не пришёл.

Правило общее для всех MCP-эндпоинтов сервера: так же устроен MCP базы знаний
(`kb/kbMcp.ts`, `/mcp/kb`) — он раньше передавал транспорту разобранное Fastify
тело третьим аргументом, и отложенные таймеры «дренирования» валили весь прогон
серверных тестов уже после того, как все файлы позеленели (падало на случайном
файле — том, что выполнялся в момент срабатывания таймера, — поэтому диагноз
искали не там). Тот же тест на отложенные исключения теперь есть и в
`kb/kbMcp.test.ts`.

**Автоодобрение файловых инструментов обязательно.** В headless (`claude -p`)
`--allowedTools` работает как allow-list АВТООДОБРЕНИЯ: инструмент, которого в нём
нет, объявлен модели, но каждый вызов упирается в неодобренное разрешение и не
происходит. Пока в списке был один `mcp__remote__bash`, добавленные позже
`read`/`grep`/`edit` того же сервера были ровно в этом состоянии: модель их
пробовала, получала отказ и возвращалась к `cat` внутри `bash` и правкам через
heredoc — то есть к поведению, ради отмены которого их и делали (замер: в ране
02.08 шесть отклонённых вызовов файловых инструментов и 54 чтения файлов через
`bash`). Поэтому `claudeArgs` кладёт в allow-list ВСЕ инструменты сервера
`remote`, а хинт называет их модели.

**Одной директивы мало.** Правки после этого переехали на `edit` целиком, а
чтения — нет: модели удобно одной командой скомбинировать поиск с чтением. Гейт
`mcp/bashFileRead.ts` отклоняет команду, вся суть которой — прочитать файл
рабочей копии, и возвращает готовый вызов `read` с окном строк (детали и границы
— в `machines.md`). Промпты обоих движков про гейт предупреждают заранее, чтобы
отказ не был для модели сюрпризом. У codex allow-list нет (вызовы MCP идут с
`--dangerously-bypass-approvals-and-sandbox`), но его промпт файловые инструменты
тоже обязан называть: иначе модель знает только про `bash`.

**Абсолютные пути внутри `cwd` разрешены.** `remotePath` принимает и путь от
`cwd`, и абсолютный путь, если тот лежит внутри `cwd` (Windows-путь сравнивается
без учёта регистра и слэшей, `..` запрещён всегда). Раньше любой ведущий слэш
давал отказ «путь должен быть относительным», а модель читала его как
«инструменты привязаны к чужому workspace»: абсолютные пути она видит и в
промпте, и в выводе собственных `bash`-команд. В ране `d2ba80bc` (CHAT-108) codex
после такого отказа ушёл писать файлы через `python3 -c` в `bash`, не смог и
закончил ход, не создав ни одной правки, — ран при этом отчитался успехом (защиту
от этого см. в [features/ci-runner.md](features/ci-runner.md#пустой-ход-модели-не-может-закончиться-успехом)).
Путь вне `cwd` по-прежнему отвергается, но теперь отказ называет сам `cwd`, и
модель может исправиться без человека. Границы закреплены в
`mcp/remoteBashMcp.test.ts`: абсолютный путь внутри `cwd` доходит до реестра,
`/repos/other` и сосед с общим префиксом (`/repos/taskX` при `cwd=/repos/task`)
отклоняются до обращения к машине, `..` внутри абсолютного пути запрещён,
Windows-путь сходится без учёта регистра и направления слэшей.

В режиме `plan` с выбранной машиной CLI не получает нативный plan-режим: он блокирует MCP-инструменты. Вместо него сервер запускает CLI в `default`, подключает remote MCP с `ro=1` и передаёт `readOnlyRemote`; для Codex это также позволяет нужный remote bypass. Гейт `remoteBashMcp` при `ro=1` отклоняет изменяющие shell-команды и `edit`, поэтому модели остаются `read`, `grep` и команды исследования (`ls`, `git log/diff/status`). MCP базы знаний подключается отдельно и остаётся доступным: он read-only. Без выбранной машины ход остаётся нативным `plan` с локальным read-only sandbox. Исключение — ход канбан-ассистента (`kanbanMcpUrl`): для Claude он идёт в `default` с `MAKE_ONLY_DISALLOWED_TOOLS` (как Make без машины), для Codex — в `plan`, а `ro=1` доска получает только при явном `permissionMode: 'plan'` самого разговора (`kanbanExplicitPlan` в `turns.ts`). Иначе принудительный plan хода без машины делал доску read-only, и ассистент отвечал «Kanban API требует подтверждения доступа, но подтверждения запрещены» (инцидент 2026-09-02).

## AI-помощник формулировки

`PromptSuggester` выполняет короткий одноразовый CLI-вызов без session id и с `executionDisabled: true`. В отличие от разговорного хода, движок и модель берутся из `Settings.aiAssistProvider` и `Settings.aiAssistModel`; пустая модель означает дефолт движка (для Claude по умолчанию используется `haiku`). Активные `ModifierPrompt` добавляются в системную инструкцию в порядке массива. Ответ ожидается как JSON `variants`, очищается, дедуплицируется и ограничивается четырьмя элементами.


## Предпросмотр контекста обязан совпадать с ходом

Ход собирает системный текст сам (`turns.ts`), а инспектор — сборщиком
`prompt/contextBlocks.ts`, поэтому любое правило, живущее только в `turns.ts`,
делает предпросмотр враньём. Два таких правила вынесены в общий код:

- **фильтр инструкций по виду чата** — `instructionsForAssistantKind`
  (`@voicechat/shared`): в «Консоли с ассистентом» не уходит подсказка про
  терминал (он уже открыт справа), в Make — про терминал и заведение задачи.
  Раньше два `.filter` стояли в `turns.ts`, и инспектор обещал подсказки,
  которых в этом чате не будет;
- **блок «Контекст задачи»** — `taskContextBlock`: иерархия, этап, машина и
  папка, описание и критерии приёмки, макеты. В чате задачи это самый большой
  блок после истории, и в предпросмотр он не попадал вообще. Выключается
  отдельным тумблером `task-context` (ход его проверяет), а не вместе с
  проектом: постановка бывает длинной, а привязка к проекту нужна и без неё.

- **контекст проекта Make** (токены темы из `styles.css` и открытые комментарии
  к макету) — `makeWorkspaces.promptContext`. Читается с диска, поэтому снимок
  получает его готовой строкой: сам `contextSnapshot` синхронный, а роут —
  `async`. Выключается тумблером `make-context`, который проверяет и ход.

**Источники макета в чате задачи видны пунктом `mcp-make-design`.** Ход
подключает read-only Make-источники по `task_designs` связанной задачи
(`turns.ts`, `buildTaskMakeSources`) — модель читает файлы макета, не будучи
Make-ассистентом. Тумблера нет (замок `kind`: источник даёт привязка задачи),
записи нет ни в каком режиме. Появился этот пункт после чужого коммита
`fe892d1b`: новое условие в ходе снова пришло без пункта в снимке — правило
«добавляешь в ход блок или инструмент — заведи пункт в снимке тем же коммитом»
работает, только если его помнить.

**Режим «Только планирование» делает инструменты вида чата read-only, и снимок
это говорит.** Ход подключает консоль, Make и канбан с `&ro=1`
(`turns.ts`): чтение работает, запись отклоняется. Пункты `mcp-console-pty`,
`mcp-make-files`, `mcp-kanban-board` несут флаг `readOnlyInPlan`: в details
всегда стоит «В режиме планирования: только чтение», а при действующем плане
объяснение дополняется фразой «запись отклоняется». Браузер превью так не
ограничен — у него флага нет.

**Хинты исполнителя CLI перечислены в `omitted` с размерами.** Раннер
приклеивает к промпту свои системные хинты (машина/без машины, инструменты БЗ —
`kbToolHint`, браузер превью — `previewToolHint` ≈661 токен, Make —
`MAKE_ASSISTANT_HINT`, консоль, канбан — `KANBAN_ASSISTANT_HINT`). Их условия
снимок знает (машина, `kbMode`, `assistantKind`, привязка к проекту), а для
текстов из shared называет и размер — раньше «полный просмотр» молчал о
заметной части того, что читает модель. Тексты, живущие в раннере (remote,
консоль, executionDisabled), названы без размера.

**Движок-исполнитель виден до отправки.** `resolveLlmEngine` в снимке — тот же,
что в ходе: закреплённый в разговоре/проекте движок, недоступный роли или
выключенный, молча заменяется дефолтным. Пункт `llm` показывает исполнителя в
details («встроенный запуск CLI на сервере», когда реестра нет), а замена даёт
предупреждение — раньше это было видно только по логам исполнения.

**Снимок обязан повторять правила хода целиком, включая исключения.** Три
места, где он их не повторял (найдено аудитом круга 24):

- **режим доступа в Make-чате.** Ход не понижает режим до «плана» без машины
  (`makeOnlyExecution` в `turns.ts`): инструменты `make_*` машины не требуют, а
  нативный plan-режим CLI их глушит — вместо понижения запрещаются встроенные
  инструменты (`MAKE_ONLY_DISALLOWED_TOOLS`, с 2026-09-04 — при любой роли).
  Снимок понижал, и обычный пользователь читал «Только планирование», пока ход
  правил файлы проекта;
- **права на движок.** Ход берёт первый разрешённый провайдер, если выбранный
  пользователю закрыт (`isProviderAllowed`/`firstAllowedProvider`; права —
  deny-list, запись `modelId: '*'` закрывает движок целиком). Снимок показывал
  сохранённое значение, то есть обещал codex тому, у кого он запрещён;
- **алиас модели.** Ход приводит модель Claude к пункту меню
  (`claudeModelAlias`), поэтому старое сохранённое «opus» исполняется как
  «opus[1m]». Снимок печатал сырое значение и называл не ту модель.

**Тумблер базы знаний сильнее настройки разговора — и в ходе, и в снимке.**
`turns.ts` считает `kbMode = disabled.has('knowledge-mode') ? 'off' : …`, а
снимок долго брал режим только из разговора: выключенная тумблером БЗ
показывалась работающей, и пункты `mcp-kb-*` оставались «доступны», хотя ход их
не подключает. Выключение БЗ — это эффект `tool`, а не `prompt-block`:
статического блока у неё нет (автоконтекст зависит от текста сообщения), зато
инструменты не подключаются вовсе. Инвариант «тумблер отнял инструмент»
принимает оба способа: явный запрет через `--disallowedTools` и неподключение
сервера.

**Инструменты модели зависят от вида чата, и список должен это отражать.**
Кроме `mcp__remote__*` (машина) и `mcp__kb__*` (база знаний) ход подключает
`mcp__browser__*` в чатах с превью (кроме Make), `mcp__console__*` в «Консоли с
ассистентом», `mcp__make__*` в Make и `mcp__kanban__*` в ходах панели
ассистента. В снимке это пункты `mcp-browser-preview`, `mcp-console-pty`,
`mcp-make-files`, `mcp-kanban-board` с замком причины `kind`
(`CONTEXT_LOCK_TEXT.kind`): тумблера у них нет, набор решает вид чата. Условия
доступности в снимке повторяют условия в `turns.ts` — появится новое семейство,
его надо завести в обоих местах.

**Живая сессия движка не отменяет постоянную часть.** При `resume` в промпт не
пересобирается только история: проект, задача, персонализация, инструкции и
Make-контекст приклеиваются к сообщению **каждым ходом** (`turns.ts`, строки
после `basePrompt = sessionId ? …`). Модель их уже видела, а платит за них
пользователь, поэтому снимок говорит об этом прямо — в объяснении пункта
«История разговора», в строке `omitted` и предупреждением, когда постоянная
часть больше тысячи токенов. Сводка экрана добавляет цену повтора за прошедшие
ходы (`costUsd × turnSizes.length`); нет прайса — нет и суммы.

**Динамику хода снимок не выдумывает, но и не замалчивает.** Блоки, которые
собираются в момент отправки, перечислены в `promptPreview.omitted`: режим
вопроса и режим плана у Make (зависят от `permissionMode` и размера запроса) и
режим канбан-ассистента (снимок доски приходит из панели, а не из настроек).
Показать их «как будет» нельзя, а молчать нельзя тем более: человек видит их
следы в ответах.

Правило на будущее: добавляешь в ход блок или условие — клади его в
`contextBlocks.ts`/`shared` и зови из обоих мест. Иначе инспектор перестаёт
отвечать на вопрос, ради которого сделан.

## Генерация картинок для студии (2026-09-03)

`apps/server/src/llm/imageStudioGenerator.ts` — один ход codex без сессии.
Три обязательных условия, без любого из них модель отвечает текстом и ран
падает «AI не вернул файл изображения» (сниппет ответа уходит в лог сервера с
префиксом `[image-studio]`): (1) исполнение разрешено —
`permissionMode: 'acceptEdits'` (sandbox workspace-write), потому что CLI-модель
рисует PNG только скриптом (Pillow/ImageMagick); `executionDisabled` здесь
нельзя — с ним codex честно отказывается создавать файл; (2) `cwd` =
`profileHome(userId)` — модель просят сохранить результат в текущей директории
и назвать абсолютный путь, а `readGenerated` читает его через
`runnerFs.readFile`/`readUserFile` с корнем в профиле; (3) в промпте —
`IMAGE_HINT` из shared: формат fenced-блока ```image модель сама не знает и
без подсказки вставляет markdown-ссылку, которую `parseImages` не берёт.
Правка выбранной картинки — тот же ход с вложением исходника (attachments);
генерация может получить до 4 референсов (`references` в generate) — файлы
галереи уходят вложениями reference-N-<имя> с подсказкой «повтори стиль и
палитру, не копируя композицию».
Обычный ход чата студии (assistantKind `images`) получает блок «Студия
картинок» через `deps.studioContext` в turns.ts: список галереи (до 30 файлов
с промптами) и правило «покажи результат fenced-блоком image с абсолютным
путём — иначе он не попадёт в галерею»; сам захват делает
`captureStudioImages` после done (сквозной цикл проверен живьём: модель
нарисовала в чате → файл появился в галерее с бейджем «новое»).
