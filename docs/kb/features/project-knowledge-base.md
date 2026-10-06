---
id: project-knowledge-base
title: База знаний проекта
kind: feature
updated: 2026-10-06
checked: ea76c7df
areas:
  - docs/kb
  - scripts/kb-search.mjs
  - apps/server/src/kb
  - packages/shared/src/kb.ts
  - packages/ui/src/components/KnowledgeBase.tsx
symbols:
  - FileKnowledgeBaseService
  - ScopedKnowledgeBase
  - buildKbAutoContext
  - prepareKbQuery
  - areaTouchesPath
  - KbResearchManager
  - LlmKbReranker
  - KnowledgeBase
protocols:
  - GET /api/kb/status
  - GET /api/kb/topics
  - GET /api/kb/search
  - GET /api/kb/context
  - GET /api/kb/documents/:id
  - POST /api/kb/documents
  - DELETE /api/kb/documents/:id
  - POST /api/projects/:id/kb/research
tags:
  - documentation
  - search
  - bm25
  - agents
aliases:
  - KB
  - знания проекта
  - поиск по проекту
packages:
  - shared
  - server
  - ui
related:
  - kb-workflow
  - kb-usage
  - llm
  - protocol
---

# База знаний проекта

## Repository modules

`ModuleKnowledgeBaseService` indexes Core's `VC_KB_ROOT` (default `docs/kb`)
as the reserved module `core`. Additional sources are an array in
`$VC_DATA_DIR/kb-modules.json`. `VC_KB_MODULES`, when set, replaces that array
with JSON from the environment; an empty array leaves only Core. Restart Core
after changing the source list. Example:

```json
[{"id":"make","title":"Make","repository":"https://github.com/sislex/make.git","ref":"main","path":"docs/kb"}]
```

Module IDs are lowercase slugs and must be unique. Repositories use HTTPS
without embedded credentials (absolute local repository paths support testing
and local mirrors); docs paths must stay inside the checkout. Credentials come
from the existing Git credential helper store (`git credential fill`) or the
existing `VC_GITHUB_TOKEN` integration setting for `github.com`. The service
passes credentials to Git in process environment configuration, never URL,
command arguments, on-disk Git configuration, API responses or log messages.
It does not create or modify credentials. Inbound project integration tokens
are stored as hashes and are not Git hosting credentials.

Each remote source has a shallow, sparse checkout under
`$VC_DATA_DIR/kb-cache/<id>`. Startup triggers a refresh; subsequent checks run
every ten minutes (`VC_KB_REFRESH_MS` overrides the interval). Git fetches the
configured ref with depth one and requests blob filtering; sparse checkout
materializes only the docs subtree. A changed SHA is fully parsed before its
in-memory index replaces the previous generation. Unchanged SHAs retain the
index timestamp. Concurrent refresh requests for one module share the same
operation. A failed fetch or parse keeps the last successful in-memory index,
SHA and timestamp, with `status: failed` and a constant sanitized `error`.
Remote indexes are rebuilt at process startup; cached Git objects are reused.

`GET /api/kb/modules` returns the module list, status, indexed SHA and Unix
millisecond timestamp. `POST /api/kb/modules/:id/refresh` is admin-only and
returns the resulting module state (404 for an unknown module). A failed
refresh is represented by the returned state rather than raw Git diagnostics.

File IDs are `<module>:<relative-path.md>`; `sourcePath` is relative to the
source repository. Old unprefixed Core IDs, including frontmatter IDs and
extensionless paths, continue to resolve. Database document IDs stay unchanged.
Topics, search and context REST queries accept `module`; MCP `topics`, `search`
and `document` accept the same optional filter. No filter searches all visible
modules; an unknown module produces an empty result. File modules have the same
public `usage` visibility as Core's existing files; `access.ts` is unchanged.
The module filter narrows results and excludes unassociated database articles.

Auto-context first tries the module matching the authorized current project's
Git repository (or the repository explicitly supplied in the internal KB view).
If it cannot produce useful context, it falls back to the normal visible search.
SSH-style and HTTPS project URLs match the same configured repository.

Implementation and operator commissioning are separate: deploying the code
does not register production sources or provision tokens. Operators supply the
source list and existing Git access, then verify module status after startup.

Kanban registers repository knowledge bases through the Core RPC methods
`kb.ensureModule({ repository, ref?, path?, title? })` (defaults `main`, `docs/kb`;
returns the existing module when the same repository, ref and path is already
registered), `kb.removeModule(id)` and `kb.modules()`. Registration validates
the source like the file configuration, persists the list atomically to
`<VC_DATA_DIR>/kb-modules.json` and starts indexing in the background. When
`VC_KB_MODULES` is set, the list is managed by the environment and registration
fails with `kb_modules_managed_by_env`; module `core` cannot be removed.

The server image installs `git` for module fetches. Private repositories need
`VC_GITHUB_TOKEN` (read access to the module repositories) in the Core environment;
without it a module stays `failed` with `KB source fetch failed`. In production the value comes
from `/etc/voicechat/production.env`; `docker-compose.yml` passes it to the `voicechat` service
(before 0.1.413 only the `kanban` service received it, so private modules such as Make failed).

## Назначение

База знаний быстро отвечает, как реализованы фичи voiceAIChat, где находятся ключевые символы и какие протоколы используются. Markdown в `docs/kb` остаётся единственным источником истины и проходит обычный Git review. UI работает только на чтение.

Генерируемый `docs/kb/README.md` исключён из Git pathspec расчёта свежести тем. Иначе тема с широкой областью `docs/kb` считала commit самого индекса новым изменением, следующий `kb:index` снова переписывал индекс, а release-ворота БЗ образовывали бесконечную петлю.

## Три раздела и доступ

Знания разделены не по теме, а по видимости (`KbScope` в `packages/shared/src/kb.ts`):

- **«Использование»** (`usage`) — как пользоваться ChatAI. Живёт в файлах `docs/kb/*.md`,
  одинаково для всех пользователей, правится коммитом в репозиторий.
- **«Настройки пользователя»** (`user`) — персональные знания о настройках и
  предпочтениях. Строка в `kb_documents` с `owner_id`; видит только владелец.
- **«Разработка проекта»** (`project`) — знания по разработке конкретного проекта.
  Строка в `kb_documents` с `project_id`; видят только участники проекта.

Единственное место, где решается видимость, — `ScopedKnowledgeBase` (`apps/server/src/kb/scoped.ts`)
поверх файлового источника. Он получает «вид» пользователя `KbView` (`kb/access.ts`):
логин + список его проектов. Фильтры `scope`/`projectId` в запросе **сужают** выдачу и
никогда её не расширяют, поэтому обойти доступ подстановкой чужого `projectId` нельзя:
маршрут отвечает 403 (`db.getProject(uid, projectId)`), а сервис на всякий случай ещё раз
проверяет вид и отдаёт пусто. Чужая статья по прямому id неотличима от несуществующей (404).

Тот же вид получают ход модели (авто-инъекция контекста в `turns.ts`) и инструменты
`mcp__kb__*` (`kbMcp.ts`, `viewOf`): модель видит общий раздел, персональные знания
владельца чата и знания проекта этого чата — не больше.

Индекс один на оба источника: BM25 из разных индексов несравним, поэтому статьи из БД
разбираются тем же кодом, что и файлы (`kb/engine.ts`), а кэш пересобирается по версии
набора (`db.kbDocumentsVersion()` — количество + максимум `updated_at`).

## Скелет раздела при создании проекта

`createProject` в одной транзакции с колонками доски заводит обзорную статью-заготовку
`Разработка: <проект>` (`projectKbSkeleton`). Раздел не бывает пустым, и «Исследовать
проект» есть что обновлять, а не только создавать.

## Исследовать проект

`POST /api/projects/:id/kb/research` (кнопка в UI БЗ) запускает `KbResearchManager`
(`kb/research.ts`): один ход инъектируемого `LlmClient` с проброшенным remote-bash MCP на
машину проекта (`readOnlyRemote`), промпт — правила ведения базы из `kb-workflow.md` плюс
id уже существующих статей. Модель возвращает JSON со статьями, **запись делает сервер**
(`db.saveKbDocument`), поэтому раздел, владелец и проект статьи не зависят от того, что
придумала модель; неизвестный id превращается в новую статью, а не переписывает чужую.

Прогон длинный, HTTP его не ждёт: состояние живёт в памяти процесса (как реестр ходов),
UI опрашивает `GET` того же маршрута раз в три секунды и по завершении перечитывает список.

## Поток поиска

Серверный `FileKnowledgeBaseService` рекурсивно читает разрешённые Markdown-документы, разбивает их по заголовкам и строит индекс в памяти. Точные совпадения `symbols`, `aliases`, `areas` и `protocols` получают приоритет, затем применяется BM25-подобное ранжирование текста.

Бусты считает `exactBoost` (`kb/engine.ts`) на двух уровнях. Совпадение всей строки запроса — сильнейший сигнал (12/10/9/9). Фразовый запрос целиком не равен ни одному symbol/alias, поэтому отдельно учитываются токены запроса (тот же `tokenize`, что и у текста): точное равенство токена элементу `symbols`/`aliases`/`protocols` и «обратное вложение» пути — токен-путь из запроса, начинающийся с `area` (в запросе `packages/ui/src/components/kanban/TaskModal.tsx`, в `areas` — `…/kanban`). Токенные веса ниже (6/5/6/4), их сумма ограничена потолком 12, чтобы набор совпавших токенов не перебивал осмысленный BM25-текст. `matchTypes`/`explanation` результата отражают вид совпадения (`symbol`/`path`/… вместо `lexical`) — панель «Использование БЗ» показывает их как факт.

Если точного сильного результата нет и включён `VC_KB_RERANK_PROVIDER`, до 15 lexical-кандидатов получает `LlmKbReranker`. Он запускает отдельную сессию Claude/Codex без инструментов и возвращает только разрешённые chunk ID. Ошибка CLI оставляет исходную BM25-выдачу.

## Контекст агента

`GET /api/kb/context` и `npm run kb:context -- "задача"` возвращают до пяти найденных разделов. Context-бандл, в отличие от `kb:search`, содержит их полный текст: поисковая выдача сохраняет короткий `excerpt`.

При авто-инъекции первые один-два раздела попадают в промпт целиком, а следующие — компактными строками `Заголовок / Раздел · documentId#anchor`, по которым модель может вызвать `kb:document`. Общий готовый блок, включая заголовок и разделители, не превышает `KB_AUTO_CONTEXT_BUDGET` (3500 символов); телеметрия считает длины реально выбранных блоков и оценку токенов как `ceil(chars / 4)`.

Раздел, который в бюджет не влез, инъекцию не отменяет. Первый блок в этом случае обрезается по границе слова и получает ссылку «целиком — kb:document», остальные превращаются в те же компактные строки. Обрезка разрешена ТОЛЬКО первому блоку: иначе инъекция дотягивала бы бюджет до потолка на каждой задаче. Раньше цикл на первом же слишком большом разделе прерывался с пустым результатом — high-confidence выдача из разделов по 4–7 тысяч символов превращалась в молчание (CHAT-68).

Дорожек поиска две (`kb/taskQuery.ts`). Основная — лексическая по прозе запроса. Если она пуста или не дотянула до порога, идёт кодовая: `paths` и `symbols` из текста одним запросом, и из выдачи остаются только разделы с точным совпадением метаданных или с `areas`, задевающими упомянутый путь (`areaTouchesPath`). Порог уверенности кодовой дорожке не нужен — совпадение по `areas`/`symbols` и есть тот самый точный сигнал. `TurnManager` автоматически добавляет bundle только для разговора с `kbContextMode=auto` и только при высокой уверенности. `manual` фонового контекста не добавляет, но выдаёт модели инструменты `mcp__kb__*` (`off` — ничего); каждое обращение попадает в телеметрию панели «Использование БЗ» — см. `features/kb-usage.md`.

Для CI-рана телеметрия хранит у каждого выданного раздела снимок `relatedFiles`
(это `areas` документа). После рана сервер сопоставляет их с файлами, которые
модель открывала инструментами, и сохраняет только агрегат попадания. Так правки
ранжирования можно оценивать по фактическому исследованию кода, не сохраняя
второй полный журнал путей; отсутствие БЗ или логов даёт пустую метрику.


## API и UI

Маршруты `/api/kb/*` защищены общим Bearer guard. Контракт находится в `packages/shared/src/kb.ts`, web-мост — в `packages/ui/src/remote/httpApi.ts`. Пункт «База знаний» в Sidebar открывает общий `ToolFrame`: фильтры, результаты с объяснением совпадения и Markdown-документ со связанными файлами.

## Подготовка перед сборкой

`npm run kb:prepare` атомарно создаёт `generated/kb/{manifest,documents,lexical-index}.json`. `npm run kb:verify-prepared` проверяет content hash. Сетевые вызовы и CLI при подготовке не используются; reranking выполняется только runtime.

Агентские команды: `kb:search`, `kb:context`, `kb:impact`. Последняя сопоставляет Git diff с `areas` и рекомендует статьи для сверки, но не блокирует работу.

## Как расширять

Новая пользовательская фича получает карточку `docs/kb/features/<id>.md` с `areas`, `symbols`, `protocols`, aliases и связанными статьями. Большие фрагменты кода в KB не копируются: документ объясняет поток данных и указывает источник.

Настоящий vector search можно позднее добавить за интерфейсом semantic search, не меняя Markdown, REST-ответы или UI. В MVP используется BM25 с выборочным LLM-reranking, потому что Claude/Codex CLI не предоставляют embeddings.

## Тесты

`apps/server/src/kb/service.test.ts` проверяет точный символ, русский lexical-поиск, budget и reranking. `kb/taskQuery.test.ts` — разбор описания на прозу и код (шум вроде `read`, `cat -n`, `${режим}` в символы не попадает). `kb/autoContext.test.ts` — бюджет, обрезка первого блока, кодовая дорожка и причина пустой выдачи. `kb/taskInjection.test.ts` — регрессия на дословных описаниях CHAT-54/68/70 по настоящей `docs/kb`: на кодовых описаниях инъекция обязана быть непустой. `kb/access.test.ts` — контроль доступа: не-участник не достаёт знания чужого проекта ни фильтром, ни по id, ни широким поиском; персональные видит только владелец; скелет появляется у нового проекта. `kb/research.test.ts` — разбор ответа модели и запись статей (CLI мокается). `KnowledgeBase.dom.test.tsx` проверяет три раздела, выбор проекта, запуск исследования и запись своей статьи.
