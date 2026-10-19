# deployment-profiles-v3 — общие сервисы против настоящего ядра

Ран `deployment-profiles-v3`. Ветка задач — `dev`. Продолжение [deployment-profiles-v2](deployment-profiles-v2.md).

## Почему третий прогон

Сверка v2 (2026-10-19) показала: Make (B10) и Image Studio (B16) проходят тесты только против ядра-заглушки. Ядро не
принимало от общего сервиса вызовы, привязанные к сессии, не указывало себя при вызове сервиса и раздавало один общий
секрет MCP. Это закрыто задачей B17 в Core (#745, Shared 0.1.40 / component-runtime 1.3.0):

- **Сервис → ядро:** токен приложения (переменная `VC_APPLICATION_<ID>_TOKEN`) в заголовке authorization и `x-sislexa-delegation` на внутренних путях;
  таблица `SHARED_SERVICE_RPC_ROUTES` в Shared подставляет пользователя из делегирования, остальные методы — `403
  method_denied`.
- **Ядро → сервис:** сервисный токен приложения (переменная `VC_APPLICATION_<ID>_SERVICE_TOKEN`) в заголовке authorization, `x-sislexa-core-id`, для методов
  пользователя — серверное делегирование на 5 минут; сервис проверяет вызов через `authenticateCoreRequest(registry,
  req)` по `serviceCredentialRef` записи реестра.
- **MCP:** токен `sxm1.<payload>.<hmac>` (`coreId`, `application`, `userId`, `conversationId`, срок 6 ч) по
  `VC_APPLICATION_<ID>_MCP_SECRET`; сервис проверяет его через `verifyCoreMcpToken(registry, token)` по `mcpSecretRef`.

Make и Image Studio на `dev` уже закрепили Shared 0.1.40 и component-runtime 1.3.0. Песочница модели не даёт запускать
`npm` и `git`: гейт прогоняет интегратор. Автоприёмка выключена.

## Задачи

| B18 | Make | — | Finish shared Make against the real Core contract (self-contained, repository `sislex/make`, branch `dev`, Shared 0.1.40 / component-runtime 1.3.0 already pinned). (1) In shared mode serve `/internal/service` for calls authenticated by `authenticateCoreRequest(registry, req)` (credential matched against the entry's `serviceCredentialRef`, core from `x-sislexa-core-id`) and route them to that core's module instead of requiring a cookie session; user-scoped methods read the user from the `x-sislexa-delegation` the core sends. (2) Accept Core-issued MCP tokens on `/mcp/make` via `verifyCoreMcpToken(registry, token)` and run tools in the token's core, user and conversation; keep `/api/make/:id/mcp-credential` for the browser only. (3) Send Core RPC (`/internal/make/core`) and events (`/internal/make/events`) with the application credential in the authorization header plus the session's `x-sislexa-delegation`, never with a core's `VC_INTERNAL_TOKEN`; send only the arguments of the `SHARED_SERVICE_RPC_ROUTES` table and handle `403 method_denied` (for example `machineFs.*`) as a clear unsupported-in-shared-mode error. (4) Single-core default (no `SISLEXA_CORE_REGISTRY`): keep the legacy `<data>/make` and `<data>/make-library` layout in place, because Core's embedded fallback shares the volume; move data under `<coreId>/` only when a registry is configured, and document rollback in KB. Registry entries gain `serviceCredentialRef` and `mcpSecretRef` in the admin API (never returned). Tests against an in-process Core built from the pinned Shared/runtime contract (real ticket, delegation and MCP token formats): Core→Make service RPC per core, MCP tool call with a Core token and refusal with another core's token, delegated RPC with the application token, single-core files stay in place. KB per AGENTS.md. |
| B19 | image-studio | — | Image Studio against the real Core contract (self-contained, repository `sislex/image-studio`, branch `dev`, Shared 0.1.40 / component-runtime 1.3.0 already pinned): call `/internal/image-studio/core` and `/internal/image-studio/generate` with the application credential in the authorization header and the session's `x-sislexa-delegation`; rely on Core filling the user from the delegation (`SHARED_SERVICE_RPC_ROUTES`) and send exactly the method arguments of that table, without dropping `userId` positionally; create conversations through delegated `POST /api/conversations` (assistant kind `images`); accept Core-issued MCP tokens on `/mcp/image-studio` via `verifyCoreMcpToken(registry, token)` instead of a cookie session; registry entries gain `serviceCredentialRef` and `mcpSecretRef` in the admin API (never returned). Tests: generation, `conversation` and `renameConversation` through the real contract formats with a ticket and delegation; refusal after revocation; MCP token of another core refused. KB per AGENTS.md. |

## После прогона (интегратор)

- Kanban, Web Reader и Playwright Reader переходят на Shared 0.1.40 после своих задач v2; их доделки под контракт B17 —
  отдельным прогоном после сверки B11/B14/B15. Внешний Kanban требует в ядре внутренних маршрутов `/internal/kanban/*`
  для общего сервиса (сейчас 404), внешний Image Studio — вызовов `promptContext`/`captureImages` из ядра.
