# release-gate-speed-v1 — релизная регрессия без повторной проверки уже проверенного

Ран `release-gate-speed-v1`. Ветка задач — `dev`.

Регрессия релиза 0.1.415 шла ~22 минуты: `gate:all` ~630 с (typecheck 35 с, модульные тесты 337 с одним
потоком, browser-integration 151 с, frontend-browser 105 с), `gate:performance` 105 с, `gate:system` ~170 с
и ~400 с подготовки. Разница считается от коммита прода, поэтому любой релиз с правками ядра идёт полным
режимом, хотя тот же код уже прошёл `gate:all` при переводе `dev → main`. Решение владельца (2026-10-06):
сделать все четыре улучшения.

1. База регрессии — последний коммит, прошедший полный гейт: аннотированный тег
   `verified/full-gate/<40-hex sha>` на этом коммите, сообщение тега содержит строку
   `gate:all exit 0` и время. Тег ставит перевод `dev → main` после зелёного `gate:all`.
2. Системные наборы владельцев (`gate:system`) — только для изменённых архивов Web Reader,
   Playwright Reader и Core UI или изменённых файлов ядра, через которые эти приложения встраиваются.
3. `gate:performance` — только когда изменения касаются отрисовки чата, интерфейса или замеров.
4. Модульные тесты полного гейта — параллельно по рабочим пространствам.

| B01 | Core | — | Release gate narrowing per docs/plans/release-gate-speed-v1.md (scripts/release-gate.mjs and its tests): (1) trusted base — before planning, fetch `refs/tags/verified/full-gate/*` from origin (best effort, a failure keeps the production base) and pick the newest annotated tag whose name is `verified/full-gate/<sha>` with `<sha>` equal to the tagged commit, whose message contains `gate:all exit 0`, whose commit is an ancestor of HEAD and a descendant of (or equal to) the production base; use it as the diff base and print `[release-gate] base: verified full gate <sha12> (production <sha12>)`; otherwise keep the production base; (2) gate:system suites run per owner archive: Web Reader, Playwright Reader and Core UI suites only when that archive's pin changed relative to the base or when Core files of their integration changed (an explicit, tested list of path prefixes per owner, e.g. the server reader/browser/tool-integration routes and packages/shared contracts they use); in full mode keep the per-owner selection instead of always running every suite; (3) `gate:performance` only when the diff touches paths of an explicit tested list (chat rendering, Core UI pin, performance scripts and budgets), otherwise print `[release-gate] performance: skipped (<reason>)`; (4) a helper `scripts/mark-full-gate.mjs <sha>` that creates and pushes the annotated tag with `gate:all exit 0` and the timestamp, used by promotion; tests for each decision (verified base chosen, rejected tag shapes, unrelated or non-ancestor tags, system suite selection per owner, performance skip/run) and docs/kb/testing-operations.md (release regression section). |
| B02 | Core | — | Parallel unit tests in the full gate per docs/plans/release-gate-speed-v1.md: the `tests` stage of scripts/full-gate.mjs (`npm run test` = test:tooling then every workspace's tests sequentially, 337 s on release 0.1.415) runs test:tooling and each workspace's `test` script as separate processes with bounded concurrency (default 3, `VC_GATE_TEST_CONCURRENCY`), buffers each process's output and prints it in a fixed order with a header per workspace, reports every failing workspace and fails if any fails; keep `npm run test` for local use unchanged; record per-workspace seconds in the existing `[gate:timing]` output (`tests/<workspace>: <s>`); tests for ordering, failure aggregation and concurrency bound with fake processes; update docs/kb/testing-operations.md. |
