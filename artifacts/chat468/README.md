# CHAT-468 verification

## Reproduction

Baseline UI revision: `4cb0d1bf` (the task's starting commit). The browser fixture starts an isolated server with temporary data, one administrator, one chat and one general project. A read-only local TTS runner fixture supplies the voice-list HTTP response, so an unavailable external runner cannot add an unrelated error toast or distort before/after results. It never runs a CLI model or writes production data. Both versions use Chromium, a 1440×900 viewport, 40 ms latency, 1,000,000 bytes/s download and 500,000 bytes/s upload. Measurements count `/api/` requests and CDP `encodedDataLength`; content time ends at the route's primary content selector, data time at the last completed API response. Each cold pass uses a new browser context. Each warm pass leaves the route and returns in the same session.

Install the root workspace dependencies and the separately managed desktop dependencies
(`npm ci --prefix apps/desktop`) before the selected fast gate.
Create a detached worktree at the baseline revision and make its dependencies available.
Its `node_modules/@voicechat/*` workspace links must resolve inside the baseline worktree,
not the modified checkout; external dependencies can be shared. Run these commands sequentially from the task repository:

```sh
CHAT468_BASELINE_ROOT=/tmp/chat468-before npm run -w @voicechat/ui test -- src/test/routeResources.browser.test.ts -t 'records comparable'
npm run -w @voicechat/ui test -- src/test/routeResources.browser.test.ts
npm run gate:fast
```

The fixture writes raw measurements and screenshots to `.generated_images/chat468`. These are development-server measurements, including Vite module startup; they are not production latency estimates. No numerical speedup threshold is asserted. Cold chat checks prohibit machines, Account and closed Settings catalogs. Warm checks prohibit new requests for cached route resources.

## Recorded results

Each cell is before → after. Times are milliseconds and transferred sizes are bytes.

### Cold

| Route | Requests | Bytes | Content ms | Data ms |
|---|---:|---:|---:|---:|
| chat | 33 → 27 | 21013 → 19625 | 18203 → 19821 | 18671 → 20177 |
| Account | 36 → 29 | 22466 → 20430 | 17933 → 18749 | 17565 → 18436 |
| Machines | 34 → 27 | 21170 → 19625 | 18104 → 19014 | 17641 → 18491 |
| Settings | 33 → 29 | 27389 → 20127 | 17066 → 17926 | 17297 → 18140 |
| board | 29 → 21 | 23121 → 19342 | 22247 → 22763 | 18467 → 18108 |

### Warm

| Route | Requests | Bytes | Content ms | Data ms |
|---|---:|---:|---:|---:|
| chat | 0 → 0 | 0 → 0 | 47 → 40 | 0 → 0 |
| Account | 4 → 0 | 1610 → 0 | 205 → 36 | 105 → 0 |
| Machines | 1 → 0 | 157 → 0 | 21 → 21 | 54 → 0 |
| Settings | 0 → 0 | 0 → 0 | 27 → 53 | 0 → 0 |
| board | 8 → 3 | 7388 → 1069 | 207 → 109 | 222 → 169 |

The run demonstrates fewer requests and bytes on all five cold routes. Cold content time did not improve in this development-server sample; no production speedup is claimed. Warm Account and Machines issue zero API requests, and the board reuses its cached snapshot while making three other reads. Raw data: `before.json`, `after.json`. Clean responsive and offline screenshots are preserved in `screenshots/`.

## Automated coverage

- TC1: real HTTP/browser before/after for all five routes; runtime cold-chat allowlist; Account and board-filter warm returns.
- TC2: every resource family's TTL with controlled clocks, normalized keys, shared requests, project/session isolation.
- TC3: subscriber departure, invalidation/logout late responses, offline retained data, independent Settings failures/retry, board mutation/view races and refresh preservation.
- TC4: five sizes (1440×900, 1280×720, 768×1024, 390×844, 320×700), light/dark, keyboard focus, touch navigation, document overflow and screenshots; Account offline/retry browser check. Account, Settings and board retain existing components.
- TC5: RendererApi argument/response compatibility, diagnostics without payload or identifiers, affected regression suites and fast gate.
- TC6–TC8: existing complete-response parser, prompt and schema v2 normalization already enforce the requested rules. This commit links their regressions to these case IDs rather than replacing verified behavior.
- TC9: existing preparation KB section checked against the actual parser and prefixed-answer regressions.
- TC10: post-publication HTTP health and all five routes, enabled with `CHAT468_PRODUCTION_URL`, `CHAT468_PRODUCTION_TOKEN` and `CHAT468_PRODUCTION_PROJECT_ID`. These must identify an authorized test context.

## Final verification

`npm run gate:fast` completed with exit code 0 on 2026-09-15. The selected checks passed: server typecheck/tests/build (2,260 tests), profile tests (50), UI typecheck/tests (3,206), Storybook build, web typecheck/tests/build, admin typecheck/tests, desktop typecheck/tests/build, shared frontend builds, and both selected E2E files (4 tests). The full command output is preserved in `gate-fast.log`. Existing server environment skips remain; the route browser suite reports its two explicit device/production skips described below. `git diff --check` also passed.

## Component QA and environment limits

The existing Storybook configuration includes the UI and extracted packages. Reviewed `Settings/SettingsModal` and `Kanban/KanbanBoard` stories; Settings adds independent catalog loading/error/refresh examples. Route/cache behavior is exercised in the actual application browser fixture and DOM tests.

A real on-screen keyboard is not equivalent to shrinking a desktop viewport. The dedicated test requires `CHAT468_TOUCH_BROWSER_WS` (a test mobile Chromium CDP endpoint) and `CHAT468_TOUCH_APP_URL` (the fixture forwarded to that device). It checks the actual visual viewport reduction and composer bounds. Without these it is explicitly skipped. Desktop touch emulation does not establish real keyboard or nonzero hardware safe-area behavior.

Production checks run after the workflow publishes the committed revision through the authorized deployment tool. They are explicitly skipped in the isolated development fixture; a local health response is not reported as production verification.
