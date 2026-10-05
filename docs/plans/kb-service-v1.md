# kb-service-v1 — база знаний модулей в их репозиториях, общий поиск по модулям

Ран `kb-service-v1` — первая часть выноса базы знаний в отдельный модуль (решение владельца
2026-10-05). Запускается после `reliability-v2`.

## Решение владельца (2026-10-05)

1. Знания о модуле хранятся в его репозитории (`docs/kb` в общем формате: frontmatter, `areas`,
   сгенерированный индекс, журнал) и меняются тем же PR, что и код.
2. База знаний — отдельный модуль (бэкенд и интерфейс). Она индексирует `docs/kb` всех репозиториев
   модулей; в её интерфейсе знания смотрятся по выбранному модулю или по всем сразу.
3. В Core остаётся только общее: архитектура, контракты, карта модулей и владения, релизы и выкат.

## Что сейчас

- Движок базы знаний живёт в ядре: `apps/server/src/kb/*` (индекс и поиск с переранжированием,
  разделы и базы проектов в БД, контекст хода `autoContext`, MCP `/mcp/kb`, исследование кода
  проекта, телеметрия использования). Файловый источник — только `docs/kb` ядра.
- Интерфейс — экран `KnowledgeBase` в Core UI (`packages/ui/src/modules/operations`) и панель
  использования в чате.
- `docs/kb` есть в ядре (22 темы), Core UI (14) и Kanban (7); нет у Make, агента, Web Reader,
  Playwright Reader, Identity, Billing, LLM Runner и Desktop. Инструменты `scripts/kb.mjs` и
  `scripts/kb-search.mjs` привязаны к раскладке ядра.

## Этапы

- Этап 0 — контракты и переносимые инструменты.
- Этап 1 — несколько источников и модули в движке, выбор модуля в интерфейсе, `docs/kb` в
  репозиториях модулей.
- Этап 2 — Kanban подключает базу знаний репозитория проекта, ядро оставляет у себя только общее,
  движок выделен в пакет без зависимостей от внутренностей сервера.

Вынос в отдельный репозиторий, процесс (`VC_KB_MODE=remote`) и приложение интерфейса — следующий
план `kb-service-v2`: интегратор заводит репозиторий и регистрирует его в Delivery Control.

## Задачи интегратора (Claude, вне манифеста)

- После приёмки B01: собрать и закрепить архив `@voicechat/shared` в Core, sislexa-core-ui и
  sislexa-kanban, затем настроить C02 и U01.
- После приёмки B02: выпустить `@sislexa/kb-tools` и выдать архив задачам C03–C06 (vendor), затем
  настроить их.
- Финал: выпуски Core UI, Kanban, закрепление в ядре, релиз и выкат; в рабочем ядре — список источников
  модулей; проверка: экран базы знаний показывает модули, поиск находит тему Make из sislex/make,
  проект Kanban «Make» получает базу знаний репозитория и проходит подготовку задачи.

| B01 | Core | — | Knowledge base module contracts per docs/plans/kb-service-v1.md «Решение владельца»: in packages/shared add KbModule { id: string (slug), title: string, repository: string \| null, ref: string, path: string, indexedSha: string \| null, indexedAt: number \| null, status: 'ready' \| 'indexing' \| 'failed' \| 'disabled' } and REST.kbModules (GET /api/kb/modules); add optional module to KbDocumentSummary, KbDocument and KbSearchResult and an optional module filter to the topics, search and context requests (absent = all modules visible to the viewer); document ids of file topics become '<module>:<path>' while old ids without a prefix keep resolving to module 'core'; define the remote knowledge service RPC contract (method names and argument/result types for status, modules, topics, document, search, context, write, delete, usage) as a typed registry in packages/shared so kb-service-v2 can move the engine out of Core without a contract change; keep every existing request valid; bump @voicechat/shared; tests for id compatibility and request validation; update docs/kb/protocol.md |
| B02 | Core | — | Make the KB tooling repository-independent and publishable: scripts/kb.mjs (check, index, log, touch) and scripts/kb-search.mjs (prepare, search, context, impact) must work in any repository from a kb.config.json at the repository root (kbDir, package globs that require AGENTS.md — empty allowed, index title, log directory, generated index path) with Core's current behavior as the default when the file is absent; move them into packages/kb-tools (@sislexa/kb-tools, bin sislexa-kb with the same subcommands, no runtime dependencies) and keep the root npm scripts (kb:check, kb:index, kb:log, kb:context, …) delegating to it; add docs/kb/kb-workflow.md «Подключение в репозитории модуля» with the exact steps (vendor archive, package.json scripts, kb.config.json, AGENTS.md lines); an owner release target that packs the tool; tests that run every subcommand in a temporary repository with a minimal config and in Core without one |
| C01 | Core | B01 | Multiple knowledge sources and modules in the Core KB engine (apps/server/src/kb) per docs/plans/kb-service-v1.md: a source list (config file under VC_DATA_DIR plus env override) of modules { id, title, repository, ref, path } with Core's own docs/kb as module 'core'; for a remote module keep a shallow cached checkout of only the docs path at ref (git fetch --depth 1 with sparse checkout, credentials from the existing project/integration token store, never logged), refresh when the remote sha changes (periodic check, default 10 min, plus an admin POST /api/kb/modules/:id/refresh), index atomically (the previous index stays served on failure, status failed with a sanitized reason); file documents carry module and the '<module>:<path>' id; topics, search, context and the MCP tools accept the module filter, and autoContext prefers the module of the project or repository of the current turn; GET /api/kb/modules lists modules with status; access rules in access.ts unchanged (file modules are visible like the current «Использование» section); tests with local bare repositories for indexing, refresh on a new sha, failed fetch keeping the old index, module filter, id compatibility; update docs/kb/features/project-knowledge-base.md and server-internals.md |
| C02 | core-ui | B01 | Module selector in the knowledge base UI (requires the @voicechat/shared archive with KbModule pinned by the integrator): in packages/ui/src/modules/operations/components/KnowledgeBase.tsx add «Модуль» with «Все модули» and the modules from GET /api/kb/modules (title, status, indexed sha and time, a «Обновить» action for admins), filter topics and search by the selected module, show the module chip on each topic and search result, keep the selection in the URL hash so links open the same module, resolve links between modules ('<module>:<path>' and relative links inside a module); old document ids keep opening; the chat KB usage panel and MessageMeta show the module of each used topic; tests for the selector, filtering, URL state, cross-module links and a failed module status; stories; update docs/kb/ui.md |
| C03 | Make | B02 | Knowledge base of the Make repository (requires the @sislexa/kb-tools archive vendored by the integrator): add kb.config.json, package.json scripts kb:check, kb:index, kb:log, kb:context and docs/kb written from the code — architecture (processes, Make server and UI, how Core embeds it), data and storage (projects, files, snapshots, presence, notes, comments), API and events, preview and build pipeline, deploy and configuration (env, replicas, module-lb), testing; each topic with frontmatter areas pointing to the real paths; generated README index; AGENTS.md: read docs/kb, update the topic in the same PR, run kb:check; npm run gate passes |
| C04 | Agent | B02 | Knowledge base of the agent repository (requires the @sislexa/kb-tools archive vendored by the integrator): kb.config.json, package.json kb scripts and docs/kb written from the code — architecture of apps/agent and the tray/login applications, connection and heartbeat, tunnel and docker0 address, git access check, MCP bridges and remote exec, update and install on macOS/Linux, configuration and tokens (without secrets), testing; frontmatter areas to real paths; generated index; AGENTS.md instructions; npm run gate passes |
| C05 | Playwright Reader | B02 | Knowledge base of the Playwright Reader repository (requires the @sislexa/kb-tools archive vendored by the integrator): kb.config.json, package.json kb scripts and docs/kb written from the code — architecture (browser host, panel, frame streaming), model tools and MCP, dialogs, downloads and files, tabs and popups, input forwarding, system tests and their stability rules (independent tests, waits for concrete state), release; frontmatter areas; generated index; AGENTS.md instructions; npm run gate passes |
| C06 | Web Reader | B02 | Knowledge base of the Web Reader repository (requires the @sislexa/kb-tools archive vendored by the integrator): kb.config.json, package.json kb scripts and docs/kb written from the code — architecture, proxy and engines, page actions and model tools, recordings, diagnostics, system tests, release; frontmatter areas; generated index; AGENTS.md instructions; npm run gate passes |
| U01 | Kanban | C01 | Connect the repository knowledge base to Kanban projects (requires the @voicechat/shared archive with KbModule pinned by the integrator): when a software project has a gitUrl whose repository contains docs/kb, register it as a knowledge module through Core (create or reuse the module for that repository) and link it to the project; preparation and readiness use it as the project's knowledge source (knowledgeBase 'connected'); show the connected module in the project settings with its status and a «Отключить» action; existing projects are connected by a one-time reconciliation; projects without docs/kb keep knowledgeBase 'absent' from reliability-v2; tests for a repository with docs/kb, without it, reconciliation and disconnect; update docs/kb |
| U02 | Core | C01, C03, C04, C05, C06 | Keep only cross-module knowledge in Core's docs/kb per docs/plans/kb-service-v1.md item 3, after C03–C06: for each topic or section that describes the internals of a module owned by another repository (Make, agent, readers, Kanban, Core UI), replace it with a short summary and a link '<module>:<path>' to the owner's topic, keeping in Core the architecture, contracts, ownership map, release and deploy, pins and operations; add docs/kb/modules.md listing every module with repository, KB location and owner responsibilities; kb:check passes with no broken links; update AGENTS.md «Knowledge base» accordingly |
| U03 | Core | C01 | Isolate the KB engine for extraction: move apps/server/src/kb engine, scoped store adapter interfaces, sources, autoContext and MCP tool definitions into packages/knowledge (@voicechat/knowledge) with no imports from apps/server internals — storage, access, model calls and git access come in through explicit ports implemented in apps/server; apps/server keeps routes and wiring and behaves identically; an in-process implementation of the remote KB RPC registry from B01 backed by the package, with a test that runs the RPC contract against it; tests keep passing; update docs/kb/server-internals.md with the port list |
