# reliability-v1 — надёжность после U04

Ран `reliability-v1` закрывает находки U04 и суток эксплуатации 2026-10-04/05, которые чаще всего
останавливали работу: зависший агент после смены маршрута, ложное «нет прав» в проверке Git-доступа,
VPN-доступ окружения, не снятый при удалении, и нестабильные системные тесты Playwright Reader,
уронившие релизы ядра 0.1.400 и 0.1.401. Задачи независимы, все в этапе 0.

## Задачи интегратора (Claude, вне манифеста)

- U01: выпуск агента 0.22.2 (контракты 1.2.2: `AGENT_VERSION`) с B01, B02 и уже слитым sislex/agent#9
  (`docker0` без контейнеров); закрепление в ядре, Core UI и Desktop; обновление агентов на машинах;
  удаление временного контейнера `docker0-keepalive` на s1. Выпуск Kanban с B03 и закрепление в ядре.
  Выпуск Playwright Reader с B04 и закрепление в ядре. Релиз и выкат ядра; снятие оставшегося
  VPN-доступа окружения `u04-check` (теги `tag:chatai-env-d4734cda779007dd6c8a2efe` на MacBook, M1, s1).

## Итоги (2026-10-05, прод 0.1.404)

- Все четыре задачи приняты (B04 — две попытки: песочница не запускает системный набор, оператор
  прогнал его три раза подряд, 29/29). Выпуски: агент 0.22.2 и контракты 1.2.2 (после sislex/agent#13 —
  выпуск сначала требовал контракты 1.2.1 и вышел без `dist`), Kanban 0.2.6, Playwright Reader 1.2.4;
  закреплены в ядре (#377, #378). Регрессия релиза 0.1.404 прошла с первого раза (0.1.400 и 0.1.401
  падали на Playwright Reader).
- Все пять агентов обновлены до 0.22.2; на s1 убран `docker0-keepalive` (адрес моста через `ip`).
- VPN-доступ `u04-check` не снят: повтор `vpn-grant/remove` — `RPC_HTTP_500`, ядро не сообщает причину.
  Вероятно, Tailscale API не позволяет снять все теги с устройства (tagged → пользовательское только
  повторным входом). Задача доски дополнена; Core UI и Desktop остаются на контрактах агента 1.2.1.

 — | Detect a dead server connection in apps/agent/src/connection.ts: on 2026-10-04 M1 lost its route when Tailscale (exit node) was turned off; the agent process stayed alive, its log ended with «подключён», it received nothing from 23:01 and the server saw it offline until a manual launchctl kickstart, which failed a Core release regression. Add a WebSocket heartbeat: send ping every 15 s, treat no pong (or no inbound frame) for 30 s as a dead connection, terminate the socket and go through the existing reconnect backoff; log the reason once («нет ответа сервера N с, переподключение»); keep timers cleared on shutdown and on normal close; make intervals injectable for tests; tests with a fake server that stops answering pings (reconnects within the deadline), a healthy server (no reconnect), and shutdown (no timers left); update README |
| B02 | Agent | — | Fix the false «insufficient permissions» of the project Git access check in apps/agent/src/gitAccess.ts (~line 93): verify runs git push --dry-run <url> <refspec> in the agent's working directory, which is not a git repository, so git fails with «fatal: not a git repository» and classify() reports insufficient_permissions; on 2026-10-05 the Make project showed writeAccess denied three times although the same token pushed fine. Run the write check in a temporary empty repository (git init in a private temp dir, git fetch --depth 1 <url> <source branch of the refspec>, git push --dry-run <url> FETCH_HEAD:<destination ref>, remove the temp dir in every path); classify git usage errors (not a git repository, src refspec does not match, couldn't find remote ref) separately from authentication/permission errors with their own error code; never print the credential; tests with a fake git for write allowed, write denied (403), and each git usage error; update README |
| B03 | Kanban | — | Make removing a managed environment reliably remove its VPN grant: on 2026-10-05 removing u04-check succeeded (down, volumes, cleanup) but the environment tag tag:chatai-env-d4734cda779007dd6c8a2efe stayed on MacBook, M1 and s1. removeVpnGrant in apps/server/src/environments/manager.ts swallows every error (environmentGrantState → removeEnvironmentGrant via the Core machines RPC). Record the grant removal as its own step of the remove operation (passed / skipped with reason / failed with the sanitized error code) without failing the stand removal; on failure keep a retry path: POST /api/projects/:id/environments/:env/vpn-grant/remove (owner) that retries the removal for a removed environment; find and fix the actual cause in Kanban if it is there (owner identity, environment key, phase handling, RPC name/arguments) and describe it in docs/kb/environments-service.md; tests with fake machines for success, a thrown RPC error (step failed, removal still succeeds), no grant (skipped) and the retry route |
| B04 | Playwright Reader | — | Stabilize system-tests/playwrightReader.e2e.test.ts, which fails Core release regressions under load: 0.1.400 failed «модель прокручивает обе оси контейнера и получает фактическую позицию» (scrolled left 170/top 20 instead of 250/200), 0.1.401 failed «панель отвечает на alert и prompt…» after «Matcher did not succeed in 10000ms», after which a leftover beforeunload dialog («Открыт диалог beforeunload … Ответь через handle-dialog») broke the following tests (download report, binary save, Blob export from the Make iframe, evaluate on the Make preview). Make every test independent: after each test dismiss any open dialog through the panel/handle-dialog and return the browser to a clean page, so one failure cannot cascade; replace fixed 10 s expect.poll waits that depend on machine speed with waits for the concrete event or state (dialog opened event, scroll position reported by the page), or a timeout scaled for the system host; make the scroll test wait until the scroll position settles before asserting; run the suite three times in a row under load (another heavy test suite in parallel) and record the result in docs; npm run gate passes |
