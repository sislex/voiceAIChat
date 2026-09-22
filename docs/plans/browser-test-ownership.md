# Browser test ownership

Date: 2026-09-22

The Core gate must verify Core behavior and public consumer integration. Detailed
product regressions must be stored and executed by their owner repositories.

| Previous Core suite | Owner | New path |
| --- | --- | --- |
| playwrightReader | sislex/playwrightreader | system-tests/playwrightReader.e2e.test.ts |
| webReaderNative | sislex/webreader | system-tests/webReaderNative.e2e.test.ts |
| webReaderModel | sislex/webreader | system-tests/webReaderModel.e2e.test.ts |
| webReaderHttp | sislex/webreader | system-tests/webReaderHttp.e2e.test.ts |
| make | sislex/sislexa-core-ui | system-tests/make.e2e.test.ts |
| imageStudioLayout | sislex/sislexa-core-ui | system-tests/imageStudioLayout.e2e.test.ts |

The two layout suites exercise the Core UI shell's responsive splits, navigation,
scheme restoration and composer geometry. Their owner is Core UI, not the product
panel repositories. Make and Image Studio already own their detailed panel tests.
All migrated assertions are retained. Test-host imports now use explicit fixture
aliases; fixture paths are injected by the runner, not inferred from a sibling.

Core retains `webReaderProject` (external service authentication/deep-link
integration) and `webReaderOwnProject` (Core project-resource bridge, including
cookie isolation and binary/limited responses). Project, Git, search, sessions,
settings, route-resource and route-budget suites still check Core integration.
`toolIntegration` is the short four-panel authenticated routing smoke test.

Owner `test:system` fetches a full pinned Core SHA and installs its lockfile in an
ignored cache, then overlays a fresh build of the current owner. Owner release
and packaging commands include these tests. Core `gate:system` runs owner suites
at pinned owner SHAs against Core's exact installed dependency artifacts. It does
not run owner internal unit/DOM suites. Core `gate:release` combines `gate:all`, `gate:performance`
(real Web/Desktop route budgets), and this separate system matrix. Ordinary Core development gates do not fetch
owner source or run these detailed scenarios.

## Validation

Two complete local Core gates passed in **321.24s (5m21s)** and **258.12s (4m18s)**.
Latest stage timings: typecheck 4.71s, workspace/tooling tests 145.08s, panel
verification 1.21s, Core UI verification 1.15s, functional browser integration
105.84s. All 41 functional browser cases
passed; two existing optional resource cases remain skipped. Core server tests:
2302 passed, 42 existing opt-in skips. The preceding complete run with performance
included passed in 431.02s; its unchanged Web/Desktop budget stage took 167.97s.
These are local workstation observations under varying load, not CI SLAs or a
controlled percentage comparison with earlier sessions.

All owner full gates passed. All migrated scenarios passed: Playwright Reader 29,
Web Reader 30, Core UI 8. The UI gate initially had one search DOM failure during
concurrent cold runs; both its isolated rerun and the complete repeated gate
passed. The shell fixture's repeated Bearer seeding was corrected before its
successful eight-case run. Planner tests preserve explicit performance selection,
including mixed diffs that also require the full Core gate. Release-center tests
prove a performance/system failure blocks readiness and cleans the worktree.

Cold fixture checkout/install/build costs belong to system/release acceptance,
not the normal Core development gate. `artifacts/gate-timings/system.json` records
the exact Core and owner commits for the separate installed-artifact matrix.

The first installed-artifact matrix exposed an existing Web Reader queue-test race:
queue depth was mistaken for proof that evaluation had started. The owner now
uses an explicit HTTP execution latch, stops panel frame polling for this API
assertion, and confirms active evaluation completed successfully. All 30 Web
Reader cases passed against Core's installed packages after the fixture correction.
No product queue behavior or deadline was changed.
