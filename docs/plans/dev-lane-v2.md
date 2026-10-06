# dev-lane-v2 — стенд разработки без обходных путей

Ран `dev-lane-v2`. Ветка задач — `dev`.

Проверка сценария владельца на M1 (2026-10-06) прошла: правка поля ввода чата из ветки Core UI видна на
стенде через ~20 с без выпуска пакета, образа и релизного гейта; правка бэкенда Make подменяет только
Make (контейнеры базового стенда и шлюз не перезапускались). По пути найдены пробелы стыков, закрытые
временно в ветках `dev` (Core UI #64, Make #18–#21), и пробелы, которые нужно закрыть по-настоящему:

1. Kanban запускает подмену компонента только с `SISLEXA_STAND_URL` и `SISLEXA_DEV_BUILD_ID`. Не
   передаются путь готовности из реестра (`SISLEXA_READINESS_PATH`), внутренний токен и MCP-секрет стенда
   (`VC_INTERNAL_TOKEN`, `VC_MCP_SECRET`) и данные компонента: Make из ветки стартует с временным
   токеном и пустыми данными, а ядро стенда отклоняет его внутренние вызовы.
2. Создание стенда и подмена идут синхронно до 10 минут, а ядро ждёт Kanban 60–80 с и отвечает
   `kanban_unavailable`, хотя операция продолжается. Адрес шлюза стенда API не отдаёт.
3. Агент клонирует зеркало `git clone --mirror`, которое тянет `refs/pull/*`: первое клонирование ядра
   на M1 шло ~10 минут.

| C01 | Kanban | — | Dev stand overrides with the stand's real settings and asynchronous operations (docs/plans/dev-lane-v2.md): (1) devProcess.start for a component override passes `SISLEXA_READINESS_PATH` = the component's `readinessPath` from DEV_COMPONENT_REGISTRY, and the base environment's `VC_INTERNAL_TOKEN` and `VC_MCP_SECRET` from its stored settings (never logged or returned by the API); (2) Make overrides get `VC_MAKE_DATA_DIR` = a per-stand host directory under the agent dev root, filled once from the base stand's Make data volume (`docker cp` of /data/make from the stand's make container through the machine exec port) before the first Make override, reused for later overrides; (3) POST /dev-stands and POST/DELETE …/components/:component return 202 with an operation id immediately and run in the background; `GET …/:standId/operations` shows running/succeeded/failed with the error; one running operation per stand; (4) GET /dev-stands/:standId includes `gateway: { port, urls: [LAN, Tailscale] }`; tests for env passing (no secret in responses or operation logs), Make data copy once, 202 + operation completion and failure, gateway urls; update docs/kb/environments-service.md. Integration: Core proxies the routes unchanged; Core UI (C02) polls operations. |
| C02 | core-ui | — | Dev stands section works with asynchronous operations (docs/plans/dev-lane-v2.md): after creating a stand or starting/stopping a component override (202 + operation id from Kanban C01), poll `GET /api/projects/:id/dev-stands/:standId/operations` until the operation finishes and show progress, success or the error code (readiness_timeout, repository_unavailable, dependency_failed, process_start_failed); show the stand gateway urls (LAN and Tailscale) from the stand details with a copy button; DOM tests for the polling states and the urls; update docs/kb. Integration: Kanban C01 response shapes. |
| C03 | agent | — | Faster first checkout for dev processes (apps/agent/src/devProcess.ts): replace `git clone --mirror` with a bare clone that fetches only `refs/heads/*` and `refs/tags/*` (no `refs/pull/*`), and fetch the requested SHA directly when it is not reachable from them; keep existing mirrors working (prune pull refs on the next fetch); serialize concurrent starts that use the same mirror instead of running clone and fetch at once; tests with a fake remote that has pull refs and two concurrent starts; update README. |
