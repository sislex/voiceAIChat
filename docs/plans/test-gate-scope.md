# Test gate scope and timing audit

Baseline: Core `412b40ee303062c694f7fb30caa31c71b6861a30`. The same 20 representative diffs were replayed through the original and revised planners. These scenarios describe selection; they are not 20 separate full test runs.

## Selection

| Scenario | Previous selection | Current selection |
| --- | --- | --- |
| docs | No code checks | No code checks |
| api | core complete owned suites | core complete owned suites |
| auth | core complete owned suites | core complete owned suites |
| api-test | core complete owned suites | core complete owned suites |
| shared-contract | shared, core, automation-runner, web, component-runtime complete owned suites | shared, core, automation-runner, web, component-runtime complete owned suites |
| component-runtime | component-runtime, core complete owned suites | component-runtime, core complete owned suites |
| projects-e2e | Full Core gate | 1 complete browser suite(s) |
| settings-e2e | Full Core gate | 1 complete browser suite(s) |
| reader-e2e | web-reader complete owned suites | 1 complete browser suite(s) |
| make-e2e | make complete owned suites | 1 complete browser suite(s) |
| route-resources | Full Core gate | 1 complete browser suite(s) |
| route-budgets | Full Core gate | 1 complete browser suite(s) |
| browser-config | Full Core gate | 15 complete browser suite(s) |
| artifact-verifier | Full Core gate | Root tooling suite + artifact verification |
| tooling-test | Full Core gate | Root tooling suite |
| tooling-runner | Full Core gate | Root tooling suite |
| gate-planner | Full Core gate | Full Core gate |
| docker | Full Core gate | Full Core gate |
| root-config | Full Core gate | Full Core gate |
| unknown | Full Core gate | Full Core gate |

Full fallback selections fell from 12 to 4 in this matrix. Gate implementation, Docker, root configuration and unknown paths remain full checks. Server/API and public contract edits retain their existing complete application suites. No internal extracted-application tests were reintroduced.

## Execution and measurement

`npm run gate:audit` regenerates selection and exact commands. `npm run gate:audit -- --run <id>` executes a scenario through the real gate command planner. Timing files are under `artifacts/gate-timings/`; results include exit codes and do not cache success across source changes.

| Measured scenario | Previous selected gate | Current elapsed time |
| --- | --- | --- |
| Projects E2E edit | Full branch gate: 505 s | 8.08 s |
| Artifact verifier edit | Full branch gate: 505 s | 10.62 s |

The 505-second baseline was one successful full branch gate on this MacBook Air M2, not a separate measurement of each scenario. New scoped measurements include artifact verification and all selected commands. The complete development gate passed in 341 seconds (5 min 41 s), versus the earlier 505-second branch baseline. Functional/browser integration fell from 210.14 to 135.25 seconds while preserving 104 passing cases and two existing opt-in skips; the separate route-budget case passed too. The 12 isolated functional files passed in 63.32 seconds with two workers; resource timing and Settings/Electron remained serial. Full-gate differences also include machine/cache variation, so these are observed times, not guaranteed SLAs. The required branch gate also passed in 350 seconds (5 min 50 s); browser integration took 134.73 seconds and the same 96 functional cases passed in 64.03 seconds with two workers. Both full runs retained the same 104 passing integration cases, two opt-in skips and passing real Web/Desktop budgets.

## Coverage and isolation

`gate:all` now includes the complete retained browser integration, which previously ran only when appended by the affected-gate wrapper. Full fallback invokes it once. Known E2E edits run the complete named suite; budget changes retain real Web/Desktop measurements. Functional E2E use at most two workers after explicit review of ports, databases and browser contexts. Route/resource measurement and native Electron input remain serial; `VC_E2E_WORKERS=1` disables parallelism. New suites default to serial execution.

The canonical gate exposed a missing `ServerConfig.applicationFrontends` type declaration from the previous UI extraction. Restored that declaration without changing runtime behavior.

A real route-budget run observed mutable Google Fonts CSS changing at the same URL. External resource identities now include URL and actual body SHA-256, retaining every observed version and its byte cost. Missing bodies, HTTP failures, invalid resources and budget overruns still fail; no CDN content is mocked and no budget was raised.

## UI owner selection review

The current planner in `sislex/sislexa-core-ui` was also inspected without changing that repository. This is selection evidence, not new runtime timing.

| Changed UI file | Selected complete groups |
| --- | --- |
| `packages/ui/src/components/ChatInstructionsSettings.tsx` | shell, chat |
| `packages/ui/src/components/ProjectBoard.tsx` | shell, projects |
| `packages/ui/src/components/AgentCommands.tsx` | shell, operations |
| `packages/admin-app/src/UsersAdmin.tsx` | shell, chat, projects, operations, admin |
| `packages/ui/src/styles/app.css` | shell, chat, projects, operations, admin |
| `README.md` | None |

Admin still reaches every group through current public-package consumers; improving that requires module boundary work, not deleting tests from the gate.

Final validation: `gate:fast` and `gate` both passed with exit code 0. Standalone gate/route regressions passed, the serial-worker override was checked, and the complete before/after selection audit was regenerated. Generated screenshot changes were discarded. Production health remained 0.1.326; these tooling/type-only changes do not require a new application deployment.
