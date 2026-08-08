# План разработки аналога Figma Make: виджет Make на отдельной странице

Дата исследования: 2026-08-08. Цель — отдельная страница ChatAI для создания функциональных веб-прототипов из промптов, кода и вложений, с безопасным интерактивным preview, ревизиями и публикацией. Это функциональный аналог, а не копирование закрытой инфраструктуры Figma.

## Факты о Figma Make

Таблица содержит только возможности, подтверждённые официальной документацией Figma на дату исследования.

| Возможность | Подтверждённое поведение | Источник |
|---|---|---|
| Генерация и итерация | AI chat создаёт функциональные прототипы, web apps и interactive UI; по завершении показывает summary и интерактивное preview, во время работы может отображать to-do list. | [Create and edit](https://help.figma.com/hc/en-us/articles/31304485164695-Create-and-edit-a-Figma-Make-file) |
| Входной контекст | Принимаются текст, voice dictation, несколько Figma designs/frames/components, вставленные frames, изображения и Community content; платные планы дают style context из library. | [Explore Make](https://help.figma.com/hc/en-us/articles/31304412302231-Explore-Figma-Make) |
| Правка по элементу | Point and edit передаёт AI контекст выбранной части preview; дальнейшие промпты итеративно меняют приложение. | [Create and edit](https://help.figma.com/hc/en-us/articles/31304485164695-Create-and-edit-a-Figma-Make-file) |
| Code и files | Есть lightweight code editor, file explorer с созданными AI файлами, форматирование, вставка/написание собственного кода и скачивание всех файлов. Новый файл в explorer создаётся через AI instruction, не вручную. | [Edit code](https://help.figma.com/hc/en-us/articles/33649966245783-Edit-the-code-of-a-functional-prototype-or-web-app) |
| История и объяснение | Можно редактировать более ранние версии; AI объясняет код без внесения изменений. | [Create and edit](https://help.figma.com/hc/en-us/articles/31304485164695-Create-and-edit-a-Figma-Make-file), [Beyond basics](https://help.figma.com/hc/en-us/articles/35710574222487-Beyond-the-basics-Using-Figma-Make) |
| Preview/design handoff | Есть fullscreen preview; snapshot preview копируется как design layers в Figma Design, но обратной синхронизации и автоматической связи с design system нет. | [Explore Make](https://help.figma.com/hc/en-us/articles/31304412302231-Explore-Figma-Make) |
| Совместная работа | Editor видит history, пишет prompts, прикладывает контекст, правит код и публикует; viewer видит историю и preview; команда может совместно работать над диалогом и кодом. | [Explore Make](https://help.figma.com/hc/en-us/articles/31304412302231-Explore-Figma-Make) |
| Templates/remix | Template масштабирует исходный Make file с правилами и создаёт независимые вариации; заявлены remix Make/Community работ. | [Templates](https://help.figma.com/hc/en-us/articles/34716344138519-Create-and-update-a-template-in-Figma-Make) |
| Kits/design systems | Make kit включает npm packages, assets, styles/tokens/variables design library и guidelines, может публиковаться команде/организации. | [Make kits](https://help.figma.com/hc/en-us/articles/39241689698839-Get-started-with-Make-kits) |
| MCP context | Make — MCP client для verified и remote HTTPS custom connectors; поддерживает OAuth, client credentials, headers/no auth, гранулярный read/write tool allowlist и Ask/Always/Never. localhost/stdio custom MCP не поддержаны, есть предупреждение о prompt injection. | [Custom MCP](https://help.figma.com/hc/en-us/articles/38147204302743-Create-and-use-custom-MCP-connectors-in-Figma-Make), [Partner MCP](https://help.figma.com/hc/en-us/articles/35440096186007-Connect-external-tools-using-Figma-Make-connectors) |
| Backend/secrets | Интеграция Supabase даёт secret storage, compute, Postgres и key-value use cases; можно подключить существующий или создать новый проект. Figma отдельно отмечает отсутствие автоматического полного SQL schema. | [Add backend](https://help.figma.com/hc/en-us/articles/32640822050199-Add-a-backend-to-a-functional-prototype-or-web-app) |
| Share/publish | File можно расшарить с правами, preview — показать отдельно; publish даёт dedicated URL, update/unpublish, custom domain, title/language/font settings. По умолчанию public app не индексируется; на высоких планах доступна внутренняя аудитория. | [Publish](https://help.figma.com/hc/en-us/articles/31304586129559-Publish-update-or-unpublish-a-functional-prototype-or-web-app), [FAQ](https://help.figma.com/hc/en-us/articles/31722591905559-Figma-Make-FAQs) |
| Export/GitHub | Код скачивается ZIP; Make может создать GitHub repository и push-ить изменения. Внешние изменения не синхронизируются назад автоматически. | [Beyond basics](https://help.figma.com/hc/en-us/articles/35710574222487-Beyond-the-basics-Using-Figma-Make) |
| Ограничения | Посетитель публикации не видит Make-file/chat; пользователь отвечает за права на third-party fonts/packages/images. Camera/microphone не поддерживаются в Make preview, но published app может запросить их. | [FAQ](https://help.figma.com/hc/en-us/articles/31722591905559-Figma-Make-FAQs) |

## Проектные решения и связь с репозиторием

Это решения ChatAI, не факты о Figma.

- UI размещается в packages/ui: web и Electron используют один React продукт. Маршрутизация — существующий hash-router useHashRoute, поскольку desktop грузит file URL.
- Новый маршрут: #/make, #/make/:makeId, вкладки #/make/:makeId/code, versions, settings, publish; также #/make/templates. Deep link открывает ровно запрошенный Make-project, чужой/удалённый id не раскрывает данных.
- Fastify API живёт в apps/server, общие типы и валидаторы — в packages/shared; доступ строится на уже существующих uid(req), isProjectMember, isProjectOwner.
- Генерация переиспользует общий LlmClient и существующий server→apps/llm-runner NDJSON контракт. Нельзя вводить второй LLM transport или дублировать LlmRunBody.
- Существующий preview уже защищён: /api/preview проверяет public address против SSRF, iframe общается через postMessage, а /mcp/preview выдаёт временный turn-token и ограничивает модель действиями open/read/find/click/type только на активной странице чата. Make расширяет этот паттерн для активного makeId/revisionId, но не заменяет его.
- Существующие Projects/Members/Machines/Conversations используются как связи; Make files, immutable revisions и artifacts — отдельная подсистема, не messages и не CI workspace.

## UX

#/make — каталог: create, search/filter, owner/linked project/template, статус last run и publication. Создание: blank, template, remix (последние два включаются feature flag после реализации).

#/make/:id — responsive three-pane workspace:

1. Слева — AI chat, attached context, linked Project/Conversation, revisions и run status.
2. По центру — sandboxed preview с desktop/tablet/mobile presets, reload/fullscreen, build diagnostics и Point-and-edit inspector.
3. Справа — file tree, Monaco/CodeMirror editor, unsaved state, diff, restore и Explain selection.

На телефоне панели становятся вкладками. Поток: create → prompt/upload → run status/plan/file changes → staging build → ready revision → preview → point/text/code iteration → selected ready revision → publish. Системные run events структурированы и остаются audit trail, но не подменяют пользовательский чат.

## Модель хранения и API

Добавить миграции SQLite, DB методы и routes/make.ts.

| Таблица | Поля и инварианты |
|---|---|
| make_projects | id, project_id?, title, owner_id, runtime_kind, current_revision_id?, timestamps, archived_at?; personal draft либо связь с Project. |
| make_members | make_project_id, username, role owner/editor/viewer, added_at; единственный owner. viewer read-only, editor не публикует. |
| make_files | Normalized path, MIME, kind, blob/hash/bytes; запрет traversal и caps. |
| make_revisions, make_revision_files | Immutable snapshot/manifest: parent, author user/llm, source, status draft/building/ready/failed, summary/hash. Publish допускает только ready. |
| make_runs, make_run_events | Run state, model/provider, bounded/redacted event log, usage/error. Один mutating run на проект, cancel идемпотентен. |
| make_attachments | Upload hash, MIME/scan/provenance; attachment никогда не секрет. |
| make_templates | Ссылка на immutable revision, scope, guidelines. Use/remix всегда копирует проект, не меняет source. |
| make_publications | Pinned revision, unique slug, visibility private/unlisted/public/org, deployment timestamps/status/domain. |
| Post-MVP make_secrets, make_integrations | Vault reference, selected MCP tools/consent/audit; plaintext никогда не выдаётся UI, LLM, revision/export/log. |

Blobs: content-addressed object storage, local adapter в dev и S3-compatible adapter в production; SQLite хранит metadata/references. Upload включает MIME sniffing, size/count limit, SHA-256 dedupe, AV hook; archive extraction — временная закрытая папка с zip-slip/zip-bomb/symlink защитой. ZIP export строится только из revision manifest и исключает secrets/logs.

REST/bridge: list/create/read/update/archive, member CRUD, upload/download/export, file read/write с If-Match, revision/diff/restore, run/cancel/SSE, template/remix, preview token, publish/update/unpublish. Membership проверяется до каждого чтения/изменения; owner-only — доступ, templates org scope, secrets/domains/publish. Конфликт manual edit — 409 revision_conflict, не last-write-wins.

## LLM, builder и preview

1. MakeOrchestrator создаёт immutable input manifest: prompt, safe attachment descriptions, selected file excerpts, guidelines, base revision; ставит очередь и отдаёт correlation id.
2. Через существующий LLM runner используется Make system prompt: сначала краткий план, затем structured patches; запрет invent secrets, ограниченный MVP stack — Vite + React + TypeScript + CSS.
3. Патчи проходят path/size validation и dependency allowlist, затем isolated rootless builder: prebuilt/cache registry, npm ci with ignore-scripts, typecheck/build, no Docker socket, privileged mode, DB, runner profile или egress по умолчанию.
4. Builder stream-ит plan/file/build diagnostics. Только успешный artifact образует ready; failure не изменяет current_revision_id.
5. Manual editor save создаёт отдельную revision; перед AI-run пользователь выбирает apply draft или base ready revision.
6. Make preview: distinct-origin signed URL, CSP, iframe sandbox, no same-origin/popups/top navigation/download by default, artifact allowlist and CPU/memory/time limits. Existing /api/preview остаётся proxy внешних сайтов и не становится файловым сервером Make.
7. Inspector передаёт bounded selector/geometry/public style/DOM context. Browser actions связаны с активными make/revision/turn, не с глобальным браузером.

MVP не даёт generated app ChatAI session/cookies/tokens, shell, прямой SQL или secret store. Backend capability — последующий scoped server-functions продукт со schema, auth, rate-limit и audit, не arbitrary execution.

## Публикация

Owner выбирает ready revision → server повторно делает build/scan/policy checks → immutable deployment → CDN URL. Видимости: private preview, unlisted MVP, public/org позже. Update создаёт новый deploy и atomic switch; Unpublish снимает routing/cache и создаёт audit record. UI показывает URL, revision, status, last publish. Custom domain, analytics/SEO snippet и external backend — post-MVP: DNS ownership verification, allowlists и отдельная security review. Delete project сначала unpublish, затем retention-aware cleanup metadata/blobs.

## Security и ограничения

- AuthN/AuthZ на REST/SSE/WS, short-lived signed tokens, id/path/MIME/URL/model-output validation; redaction Authorization/cookies/secrets/sensitive inputs.
- Tenant isolation для attachments, prompts, revisions, artifacts и public deploy. Viewer read-only; editor write/run; owner access/publish.
- Builder isolation + egress registry proxy; block private/link-local/metadata IP and DNS rebinding не слабее текущего preview SSRF guard.
- CSP/COOP/CORP, different origin, sandbox, max artifact/build duration/CPU/RAM/bandwidth/concurrency.
- MCP only after explicit consent: default Ask, per-tool read/write scopes, OAuth in vault, audit; no localhost/stdio remote connectors.
- Per-user/project quotas: blob bytes, attachments/revisions, queued/running jobs, prompt/context/output tokens, build/artifact/bandwidth/publish limits.
- Upload scan/report/takedown; publication requires rights acknowledgement. Do not promise microphone/camera inside preview.

## Этапы и зависимости

| Этап | Результат | Готовность |
|---|---|---|
| 0. ADR/threat model | Runtime/storage/domain/limits/content policy, retention и SLO. Нужны product/security/infra owners. | Нет critical findings; written rollback and incident ownership. |
| 1. Contracts/persistence | Shared validators, migrations, DB, Make API skeleton, membership/audit fixtures. | Migration на empty/existing DB; foreign ids rejected; API/schema tests green. |
| 2. Page shell | Catalog, hash routes, create/open, responsive panels, permissions states, feature flag. | Web+Electron deep-link/reload, a11y/route smoke, UI typecheck green. |
| 3. Files/revisions | Blob storage, safe upload, tree/editor, snapshots/diff/restore/ZIP. | Traversal/archive tests; bit-identical restore; ZIP excludes secrets. |
| 4. LLM runs | Orchestrator, SSE events/cancel, patch protocol, lock and bounded prompt. | Fake Claude/Codex contract run; cancel frees lock; failed run cannot change ready revision. |
| 5. Builder/preview | Rootless build, artifact storage, signed sandbox, diagnostics, point-edit. | Fixture builds; malicious fixture cannot read host/metadata; preview cannot read parent cookies. |
| 6. Collaborate/templates | Roles/invites/conflict UI/templates/remix/guidelines. | Viewer denied write/run; copy independent; ETag conflict reproduced. |
| 7. Publication | Unlisted deployment, atomic update/unpublish, audit/status UI. | Owner-only; URL serves pinned revision; unpublish invalidates cache/route. |
| 8. Opt-in integrations | Vault, scoped backend functions, GitHub export, MCP; separately assess Figma import/Supabase. | No secret in API/log/export; write consent/audit; revoked OAuth blocks calls. |
| 9. Hardening/rollout | Metrics/quotas/backups, e2e/load/pentest, beta and runbook. | Dashboard for success/p95 queue/build/preview/cancel/SSRF rejects; error-budget rollout. |

## Тестовая стратегия

- Unit: validators, roles, paths/URLs, manifest hash, revision/publication state machine, redaction/quota/context compaction.
- Fastify integration: auth/membership/ETag/migrations/SSE/cancel/storage fake and real buildRunner contract, not a hand-written runner fake.
- UI: routes/deep links/not-found, edit conflicts, keyboard/ARIA and strict postMessage origin/make/revision/turn checks.
- Security: hostile archive, symlink, private-IP/DNS rebinding, XSS/CSP, signed-token expiry/reuse, dependency policy, resource escape/exhaustion.
- E2E: create → prompt → ready → inspect/iterate → restore → unlisted publish → update → unpublish, web and Electron.
- Reliability/load: queue/cancel, runner disconnect/build timeout, artifact GC/recovery, cost and p95 monitoring.

Каждый этап выполняет из корня обязательный npm run affected-check; далее затронутые package typecheck/test/build по KB. Перед rollout — npm run verify плюс builder/deploy environment tests.

## Риски и mitigation

| Риск | Митигирование |
|---|---|
| Небезопасный/невалидный AI code | Structured patches, deterministic build gate, dependency/network policy, immutable rollback. |
| RCE/tenant escape | Ephemeral rootless builder, no host secrets/socket, isolated preview origin and sandbox. |
| Preview/MCP/secret leakage | Scoped short-lived tokens, binding to active make+revision, vault/redaction/consent/audit. |
| Цена/очередь | Hard quotas, concurrency/cancel, context caps, cost metrics and staged feature flag. |
| AI/manual collision | ETag, writer lock, immutable revisions, visible diff; no silent overwrite. |
| Figma/third-party fidelity/licensing | Import is opt-in later; provenance and rights acknowledgement; no claim of round-trip compatibility. |
| Public abuse | Default unlisted, owner-only publish, rate limit/report, atomic unpublish. |

## MVP и Definition of Done

MVP: personal/linked Make project; text + image upload; Vite/React/TS generation through existing CLI runner; revisioned files; sandbox preview; point-context iteration; owner/editor/viewer; ZIP export; unlisted publish. Templates, public/custom domains, voice, Figma import, GitHub, kits, backend/secrets and MCP connectors are subsequent opt-in stages.

Первый release готов, когда editor в web и Electron по #/make/:id завершает prompt→ready revision→interactive preview и после refresh видит историю; права изолируют artifacts/runs/files; каждый change создаёт restorable immutable revision; unsafe path/SSRF/RCE/token leakage regression tests green; owner публикует pinned unlisted URL, update atomic and unpublish auditable; metrics/quotas/runbook доступны; npm run affected-check и затронутые package gates зелёные.
