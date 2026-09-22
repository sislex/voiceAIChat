# Core UI repository extraction

## Ownership

`sislex/sislexa-core-ui` owns the Core browser client, shared Web/Desktop renderer, shell, chat, projects, operations and administration UI, component stories and internal frontend tests. `sislex/sielexa-ui` continues to own generic UI Kit/Foundation. Extracted products continue to own their panels and tests.

Core publishes a versioned API contract from `packages/shared`. UI consumes the archive and declared peer versions; no sibling checkout or source alias is allowed. Core consumes immutable, checksummed browser assets built by the UI owner. Desktop consumes the owner's renderer artifact. Updating either consumer requires an explicit dependency upgrade and compatibility checks.

## Execution

- [x] Create an isolated Core worktree and clone the new owner repository.
- [x] Inventory current boundaries and direct shared-source dependencies.
- [x] Publish reproducible Core contract archive and validate isolated installation.
- [x] Establish module ownership and complete-suite affected gates in the UI owner.
- [x] Build and validate versioned browser/Desktop artifacts in the owner.
- [x] Replace Core UI workspaces and source-build steps with artifact verification.
- [x] Move frontend-internal browser fixtures and tests to the owner; retain public Core/API integration checks.
- [x] Update development, Docker, Release Center and compatibility configuration.
- [ ] Run owner and Core gates, open and merge PRs, publish immutable releases.
- [ ] Deploy through `voicechat-deploy` and validate production routes and dependent panels.

## Validation policy

A module change runs its entire owned suite plus dependent integration suites. Changes to shared runtime, contracts, dependency locks or unclassified paths fail safe to the full owner gate. Generic library releases do not silently change consumers: each pins a version and tests its upgrade. Core never executes the UI owner's internal unit suites. API compatibility and end-to-end behavior remain Core responsibilities.

## Verification notes

The first complete owner gate passed in 229 seconds. Its 34 browser cases and Web bundle limits passed without raising budgets. Native Electron preload/telemetry integration also passed against the pinned Desktop artifact. The separate fixed-hardware Admin performance comparison correctly rejects this macOS host because its baseline requires Linux/AMD EPYC; no replacement baseline was generated. Final owner/Core release validation remains required below.

Final local UI gate: 225 seconds; 3,414 unit/DOM cases and 34 browser cases passed. Core canonical branch gate: 505 seconds, including server/shared suites, Web/Desktop route budgets and 104 API/browser integration cases (two opt-in cases skipped). UI PR #1 and Desktop PR #4 passed CI and were merged. UI 1.0.0 and Desktop 1.0.3 consume the same immutable renderer. Core release/deployment acceptance remains pending.
