# integrator-speed-v1 — приёмка за 8–12 минут вместо ~30

Ран `integrator-speed-v1`. Ветка задач — `dev`.

Владелец, 2026-10-08: оформить пункты 1–3 ускорения интегратора.

## Что видно сейчас (2026-10-08)

От сдачи до слияния — 20–40 минут (медиана ~30). Публикация PR и приёмка — меньше минуты, полный гейт —
2–8 минут; остальное — очередь (интегратор берёт задачи по одной и в простое опрашивает координатор раз в
30 с) и клон: `src/worker/integrator.ts` делает `git clone --no-checkout <url>` с нуля — для ядра до 14 минут,
тогда как воркеры клонируют из тёплого зеркала (`checkoutWithMirror` в `src/worker/warm-workspace.ts`).

| B01 | delivery-control | — | Integrator clones from the warm mirror. `integrate()` (`src/worker/integrator.ts`) obtains the checkout through the same `checkoutWithMirror` path as task attempts (mirror under the integrator's cache root, mirror lock, `gc.autoDetach=false`, remote URL reset to the repository URL), falling back to a direct clone when the mirror is busy; fetch the target branch head after cloning so integration is on the current head. Record `clone` timing as today plus `mirror: hit|miss|busy`. Tests with a temporary bare origin: mirror reused across integrations, busy-lock fallback, head freshness. Update docs (integrator). Gate: `npm run gate:task -- --base <sha>`. |
| B02 | delivery-control | — | Parallel integrations per repository. The coordinator hands out integration jobs for different repositories (and different target branches) concurrently: `/v1/integrator/next` returns the oldest submitted candidate whose repository+target has no integration in flight; one integrator process may run up to `integratorSlots` (config, default 3) integrations at once, each with its own lease and workspace; same-repository candidates stay serialized (merge order and head races unchanged). Tests: two repositories in parallel, same repository serialized, lease expiry frees the repository, slot limit. Update docs. Gate: `npm run gate:task -- --base <sha>`. |
| B03 | delivery-control | — | Wake the integrator on submission. Add an integrator wake channel: the integrator waits on `GET /v1/events?…&wait=20` filtered to `attempt.submitted` / `attempt.integration_requested` (or a dedicated long-poll `GET /v1/integrator/wait`) instead of a fixed 30 s sleep, so a submitted candidate is claimed within seconds; keep the 30 s fallback and the gentle idle behaviour (no claim mutations while nothing is pending: check pending work with a read-only call before claiming). Tests: claim latency after submit with a fake coordinator, no mutating calls while idle, fallback on long-poll failure. Update docs. Gate: `npm run gate:task -- --base <sha>`. |
