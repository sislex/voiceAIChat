# make-stand-stories-v2 — живучесть стендов при перезапуске агента и HMR историй на стенде

Ран `make-stand-stories-v2`. Ветка задач — `dev`. Продолжение [make-stand-stories-v1](make-stand-stories-v1.md).

## Что нашла проверка на проде (2026-10-11, Core 0.1.443, Make 1.5.0)

- **Перезапуск агента ломает стенды.** Агент на M2 (`~/.voicechat-agent/voicechat-agent.cjs`) самообновился и
  перезапустился. Его дети — шлюз стенда (`npm run dev:gateway`, :23000) и dev-сервер живой копии
  (`npm run dev:component`, :23001) — остались работать сиротами (`ppid 1`). `recover()` в
  `apps/agent/src/devProcess.ts` читает `registry.json`, но «A persisted PID is not proof of ownership after
  reboot. Never kill it.»: старый PID не трогается, порт занят → процесс перезапускается на другом порту или
  падает. Kanban увидел шлюз `unhealthy`, стенд `recovering`, `live: []`; шлюз Kanban не перезапускает
  (`standReconciler.ts` только опрашивает `devProcess.status`), а `allocate()` берёт порты из БД, так что
  новый стенд получает занятый 23000. Лечилось вручную: убить сирот, удалить стенд, создать заново.
- **HMR Storybook на стенде не работает.** Storybook Core UI запускается ядром командой
  `npm run storybook --port 6006 --no-open --ci` в рабочей копии беседы; `/@vite/client` отдаёт
  `hmrPort = 24678`, `serverHost = "localhost:undefined/"`; рукопожатие WebSocket на `:6006` висит, на
  `:24678` проходит. Через прокси стенда (один порт → один порт) HMR-сокет недостижим: кадр показывает правку
  только после перезагрузки. `@storybook/builder-vite` 8.6 задаёт `hmr: { port: options.port, server:
  devServer }`, то есть ожидается общий порт — что-то это ломает. Подозрение: корневой скрипт
  `"storybook": "npm run -w @voicechat/ui storybook --"` и вызов без `--` — npm съедает `--port/--no-open/--ci`
  как свои опции (порт 6006 совпал со значением по умолчанию случайно, `--no-open` потерян).
- **Статус при создании стенда из Make.** `create` возвращает `phase: creating`, следующий `status` → Kanban
  404 (стенд появляется в списке только после завершения операции `create`) → Make показывает
  `failed: stand_not_found`, хотя создание идёт и через ~30 с стенд готов.
- **Косметика Make.** Подпись доступа к кадру «frame through machine bridge» при работе через прокси стенда
  (примечание при этом верное: «Storybook через прокси стенда с поддержкой HMR»). После старта Storybook
  список историй перегруппировался по путям живого индекса относительно корня Storybook (`../admin-app (2)`,
  `src/common (3)`, `src/modules (56)`) вместо пакетов репозитория (`packages/admin-app`, `packages/ui`).

## Решения

- **Агент владеет своими процессами и после перезапуска.** Каждый запуск получает маркер в окружении
  ребёнка (`SISLEXA_DEV_PROCESS_TOKEN`, случайный, хранится в `registry.json`). При восстановлении, если
  сохранённый PID жив и его окружение несёт тот же маркер (macOS `ps -E -p`, Linux `/proc/<pid>/environ`),
  процесс и его группа завершаются (SIGTERM, ≤10 с, затем SIGKILL) и перезапускаются **на том же порту**;
  чужой процесс (маркер не совпал) по-прежнему не трогается — тогда порт меняется, как сейчас. Дети
  запускаются в своей группе процессов, чтобы завершать их целиком.
- **HMR Storybook — на HTTP-порту Storybook.** Один порт → прокси стенда и мост машины работают без
  дополнительных аренд. Команда запуска из ядра передаёт аргументы скрипту через `--`.
- **Фаза `creating` держится до конца операции.** Пока у стенда есть незавершённая операция `create`,
  `makeStand status` возвращает `creating`, а не `stand_not_found`.
- **Группы историй — по пакетам репозитория** независимо от того, откуда пришёл путь (список до старта
  или живой индекс Storybook).

## Общий контракт

- Контракты `make-contracts`, маршруты ядра и Kanban не меняются. Маркер процесса — внутренняя деталь агента.
- Проверка Storybook: `GET /@vite/client` у запущенного Storybook не должен содержать отдельного HMR-порта
  (порт клиента равен HTTP-порту или не задан), рукопожатие `ws://127.0.0.1:<port>/?token=…` с протоколом
  `vite-hmr` проходит.

## Задачи интегратора (Claude, вне манифеста)

- Положить копию плана в `docs/plans/` репозиториев Agent, Core UI и Make до старта.
- После приёмки: выпуски Agent и Core UI → Desktop (встраивает оба) → закрепления в Core вместе с Make →
  релиз ядра и деплой; агент на M2 обновится сам — проверить, что стенд `dev-2d79cc2c-5d0` пережил
  перезапуск (шлюз и живой режим на прежних портах, Kanban `ready`), затем «Stories» → правка файла
  истории в «Code» видна в кадре без перезагрузки.

| B01 | Agent | — | Dev-process recovery that replaces the agent's own orphaned children instead of drifting ports, per docs/plans/make-stand-stories-v2.md «Решения» (copy of the plan is in this repository): in `apps/agent/src/devProcess.ts` (1) every `launch` passes a random per-launch marker to the child environment (`SISLEXA_DEV_PROCESS_TOKEN`) and persists it in `registry.json` next to the pid; spawn children in their own process group so the whole tree can be signalled; (2) `recover()`: when the saved pid is alive and its environment carries the saved marker (macOS: `ps -E -o command= -p <pid>` / `ps -E`, Linux: `/proc/<pid>/environ`; keep the lookup injectable for tests), terminate that process group gracefully (SIGTERM, wait up to 10 s, then SIGKILL), wait until the saved port is free and relaunch on the same port; when the pid is alive without the marker (foreign process) keep today's behaviour (pick another free port, never kill); (3) on graceful agent shutdown (SIGTERM, self-update restart) leave children running — recovery replaces them — but log the intent; (4) `devProcess.recovered` events report whether the process was replaced or relaunched; tests with injected `isAlive`/environment lookup/terminate covering: alive with marker → replaced on the same port, alive without marker → port drift as before, dead pid → relaunch, legacy entries without marker; docs/kb of the agent updated. Gate: `npm run gate`. |
| B02 | core-ui | — | Storybook HMR served on the Storybook HTTP port, per docs/plans/make-stand-stories-v2.md «Что нашла проверка» and «Общий контракт» (copy of the plan is in this repository): reproduce with `npm run storybook -- --port <free> --no-open --ci` from the repository root (`packages/ui/.storybook/main.ts`, root script `npm run -w @voicechat/ui storybook --`) and inspect `/@vite/client` (`hmrPort`, `serverHost`); find why the websocket is not on the HTTP port (`@storybook/builder-vite` passes `hmr: { port, server }`; check `viteFinal`, `SISLEXA_STORYBOOK_HMR` handling and whether the npm wrapper forwards `--port`), fix it so the HMR websocket handshake on `ws://127.0.0.1:<port>/?token=…` (protocol `vite-hmr`) succeeds and `/@vite/client` carries no separate HMR port; keep `SISLEXA_STORYBOOK_HMR=off` behaviour and the static client plugin; add a smoke test (node test or the existing storybook smoke) that starts Storybook on a free port, asserts the `/@vite/client` contract and the websocket handshake, and stops it; document in docs/kb (storybook topic). Gate: `npm run gate`. |
| B03 | Core | — | Storybook launch arguments and stand creation phase, per docs/plans/make-stand-stories-v2.md: (1) `apps/server/src/components/storybookSessions.ts` composes `<command> --port <port> --no-open --ci`; for npm scripts (`npm run …`, `npm exec …`, `npx …`) the flags must follow a `--` separator or npm consumes them — add the separator when the command is an npm script invocation and does not already contain ` -- `, keep other commands unchanged (`PROJECT_STORYBOOK_DEFAULT_COMMAND` in `packages/shared/src/projectComponents.ts` is `npm run storybook`), tests for default and custom commands; (2) `apps/server/src/makeBridge/projectAdapters.ts` `makeStand` `status`: when Kanban returns 404 for the stand but `GET /api/projects/:host/dev-stands/:stand/operations` has a running `create` operation, report `phase: 'creating'` (with `standId`/`hostProjectId`) instead of `stand_not_found`; only a finished failed `create` or no operation yields `failed`; tests with a fake Kanban; docs/kb/server-internals.md updated. Gate: `npm run gate:task -- --base <sha>`. |
| B04 | Make | — | Stories tab polish in stand mode, per docs/plans/make-stand-stories-v2.md (copy of the plan is in this repository): (1) `packages/make-app/src/components/MakeProjectComponents.tsx` access label: when `access.kind === 'proxy'` and the URL is not `/api/preview?…` show «кадр через прокси стенда» (i18n for all locales) instead of «frame through machine bridge»; (2) grouping by repository package must not change after Storybook starts: live-index entries come with paths relative to the Storybook root (`../admin-app/src/AdminApp.stories.tsx`, `src/modules/...`) — map each live entry to the repository-relative path known from the pre-start listing (match by story file suffix) or, when unknown, resolve `..` against the Storybook package directory derived from the listing (`packages/ui`); groups stay `packages/admin-app`, `packages/ui` with stable counts; (3) while the stand phase is `creating` the tab stays disabled and the stand header shows the creating state rather than an error (Core now keeps `creating` while the create operation runs); DOM tests for the label and for grouping before/after a live index with relative paths; docs/kb/project-mode.md. Gate: `npm run gate:task -- --base <sha>`. |
