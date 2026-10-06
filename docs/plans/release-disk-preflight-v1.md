# release-disk-preflight-v1 — проверка места при старте релиза и разбор в отдельном чате

Ран `release-disk-preflight-v1`. Ветка задач — `dev`.

Владелец, 2026-10-06: при каждом старте релиза и деплоя в Release Center проверять свободное место; если
его не хватает — давать пользователю возможность запустить разбор в отдельном чате, что можно безопасно
удалить. Сейчас Kanban проверяет диск прода только внутри деплоя (`RELEASE_MIN_FREE_KB`, 10 ГиБ) и сам
чистит кэш сборки Docker; машину сборки (M1) не проверяет никто, а пользователь узнаёт о нехватке места
по упавшему шагу.

## Решения

1. Проверяются две машины: машина сборки релиза (агент, выбранный при создании ветки) и прод. Минимум —
   10 ГиБ на каждой (`RELEASE_MIN_FREE_BYTES`), значение одно для сервера и интерфейса.
2. Проверка выполняется до создания релизной ветки и до деплоя. При нехватке места сервер отказывает с
   кодом `release_disk_low` и цифрами; владелец может продолжить явным флагом `ignoreDiskCheck`.
3. Кнопка «Разобраться в чате» создаёт новый чат проекта с машиной-исполнителем = машиной с нехваткой
   места и первым сообщением-заданием: найти, что можно безопасно удалить (неиспользуемые образы Docker,
   кэш сборки, старые релизы и логи), ничего не удалять без подтверждения пользователя, личные файлы не
   трогать. Ассистент отвечает в обычном чате; удаление выполняет только после ответа пользователя.
4. Существующая автоочистка кэша сборки на проде во время деплоя остаётся.

## Интеграция частей

- Контракт (B01, `packages/shared`): `ReleaseDiskPreflight`, `ReleaseDiskCheck`, код `release_disk_low`,
  `RELEASE_MIN_FREE_BYTES`, путь `projectReleasePreflight(id)` в `protocol.ts`, поле `ignoreDiskCheck` в
  запросах создания ветки и деплоя, функция `releaseDiskCleanupPrompt(check)` с текстом задания для чата.
- Kanban (C01) реализует маршрут и проверки по контракту B01; Core UI (C02) вызывает маршрут и создаёт
  чат через существующий API разговоров ядра. Архив shared собирает интегратор после B01.

| B01 | Core | — | Release disk preflight contract in packages/shared per docs/plans/release-disk-preflight-v1.md «Интеграция частей»: `RELEASE_MIN_FREE_BYTES = 10 GiB`; `ReleaseDiskCheck = { role: 'build' \| 'production', machineId: string \| null, machineName: string, freeBytes: number \| null, minBytes: number, ok: boolean, measuredAt: number, error?: string }` (freeBytes null + ok false + error when the machine cannot be measured); `ReleaseDiskPreflight = { ok: boolean, checks: ReleaseDiskCheck[] }` with a strict parser; error code `release_disk_low` whose response body carries the preflight; optional `ignoreDiskCheck?: boolean` on the release branch creation and deploy request types; `projectReleasePreflight(id)` path in protocol.ts (`GET /api/projects/:id/releases/preflight?agentId=`); `releaseDiskCleanupPrompt(check: ReleaseDiskCheck): string` — a Russian task for a new chat: the machine name, free and minimum space, find what can be safely removed (unused Docker images, build cache, old releases and logs, stale workspaces), show sizes, delete nothing without the user's explicit confirmation in the chat, never touch personal files; tests for the parser, the prompt (mentions the machine, sizes and the confirmation rule) and the constant; update docs/kb/protocol.md. Do not bump the shared package version (the integrator builds the archive). |
| C01 | Kanban | B01 | Release disk preflight in the Kanban release manager: `GET /api/projects/:id/releases/preflight?agentId=` measures the build machine (the given agent; `df -Pk` of its project working directory through the existing machine exec port, falling back to agent telemetry) and the production target (existing `diskFreeCommand`) and returns `ReleaseDiskPreflight` from shared; `createBranch` and `deploy` run the same preflight first and reject with HTTP 409 `release_disk_low` carrying the preflight unless the request has `ignoreDiskCheck: true` from a project owner (record the override in the release step log); an unmeasurable machine counts as not ok; keep the existing in-deploy build cache cleanup; tests for ok, low build machine, low production, unmeasurable machine, the override and the step log note; update docs/kb. Integration: contract and threshold from B01 (`@voicechat/shared`), Core UI (C02) calls the route and passes `ignoreDiskCheck`. |
| C02 | core-ui | B01 | Release Center disk preflight UI: when the create-release form opens (after the build machine is chosen) and before deploy, call `projectReleasePreflight` and show each machine's free/minimum space; when not ok (or the server answers 409 `release_disk_low`), show a warning with two actions: «Разобраться в чате» — create a new conversation in the same project with that machine as the execution target and send `releaseDiskCleanupPrompt(check)` as the first message, then open the chat (the release form stays as it was); «Запустить всё равно» — repeat the request with `ignoreDiskCheck: true` after a confirmation; a machine that could not be measured shows its error and the same actions; DOM tests for ok, low machine, the chat action (conversation created with the machine and the prompt) and the override; update docs/kb. Integration: types, prompt and route from B01 (`@voicechat/shared`), server behaviour from Kanban C01; uses the existing conversation create/send API of Core. |
