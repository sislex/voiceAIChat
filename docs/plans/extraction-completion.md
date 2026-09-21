# Complete the started repository extractions

Updated: 2026-09-22.
Status: in progress; Identity API repair and Users startup production acceptance complete.

The owner explicitly requested completion of every started extraction, including
removal of extracted applications' tests from Core. Delivery remains autonomous:
isolated worktrees, reviewable PRs, merges, releases and production checks.

## Acceptance

- Each extracted application owns its implementation, internal unit/component/E2E
  tests, fixtures, development entrypoints, builds and release gates in its own
  repository. Moving tests must preserve assertions and runnable coverage.
- Core has no transitional workspace wrappers or embedded implementation for
  completed extractions. Clients and contracts are explicit versioned dependencies.
- Core checks its own orchestration, resource permissions, host integration and
  compatibility with external artifacts. Its normal gate never invokes another
  repository's internal suite or discovers that repository's component stories.
- Service endpoints and provider-issued permissions remain configurable. Independent
  local startup must not require a sibling checkout of Core or another application.
- Release inputs identify immutable owner versions/commits. A component change
  can be built, tested and released by its owner; Core consumes its artifact.
- Each production cutover has passed gates, compatibility checks, rollout evidence,
  API/UI acceptance and a verified rollback path before being marked complete.

## Sequence

- [x] Finish Core 0.1.320 / Identity 1.2.1 rollout and Core 0.1.321 startup
  optimization; verify the reported APIs and full page navigation in production.
  Evidence: Core PRs #222/#223, Identity PR #4; `docs/kb/deploy.md`.
- [ ] Inventory every adapter, remaining implementation import, test, fixture,
  story, build entry and deployment input for Make, both Readers, Voice, Image
  Studio, Identity, Billing, SDK and the independently deployed LLM Runner.
- [ ] Publish missing public client/contract/UI artifact exports in owner repos.
  Retain one canonical source for shared contracts during each ownership cutover.
- [ ] Move remaining application-owned browser tests/fixtures/stories to their
  owner repositories and run them there before removing the Core copies.
- [ ] Replace Core compatibility imports and remove the `sislexaExternal`
  workspaces listed in `docs/kb/architecture.md`.
- [ ] Remove Core's embedded LLM Runner implementation and CLI imports after its
  required management/execution operations have independent service contracts.
- [ ] Replace source-workspace build/release coupling with owner-built artifacts;
  update Core's application catalog, gate selection, Docker/dev scripts and docs.
- [ ] Audit the supplied UI repository and existing UI-library extraction work;
  finish any started transfer of UI Kit/Foundation and their tests there.
- [ ] Verify clean independent installs and configurable local launches; run owner
  gates and Core integration gates, release and deploy each coherent increment.
- [ ] Perform a final tracked-file/import/test-discovery audit, then mark each
  component complete with its PR, release and production evidence.

## Scope boundaries

Future product extractions (Chat, Projects, Machines, Files, Automation, Knowledge)
are separate roadmap work unless their transfer has actually started. The supplied
Analytics repository is not evidence that an Analytics product has already been
implemented. Do not claim completion by creating empty services, deleting tests
without migration, or replacing real integration assertions with mocks.

The existing dirty diagnostics checkout and the user's local development processes
must remain untouched. The current API repair takes precedence over this cleanup.

## Test ownership increment (2026-09-22)

- Web Reader PR #3 owns 18 unchanged browser suites (688 cases), with owner-local
  imports and no Core checkout. Core copies and their gate-catalog entries removed.
- Make, both Readers, Image Studio and Identity own local story discovery and axe
  checks. Core's story discovery and required-state matrix no longer include them.
- Five Web Reader scenarios still check Core orchestration and remain in Core.
- Adapter removal, stopping delegated internal workspace suites and independent
  artifact consumption remain open; this increment must not be called complete
  repository extraction. Both canonical Core gates exited 0, including the 119 remaining Core browser cases.

## Consumer cutover decisions

Published libraries retain their existing public package names where this avoids
needless source compatibility breaks. Core consumes immutable archives directly;
a local workspace containing only re-exports is not a completed cutover. The
application catalog must distinguish an external owner from a local workspace so
Core's gate does not execute that owner's internals or pretend to build its source.
Consumer checks validate public exports, version/provenance, host ports and runtime
integration. Owner gates are prerequisites to publishing the pinned artifacts.

UI Kit/Foundation are being established in `sislex/sielexa-ui` (PR #1). Their
internal tests and pure component stories move with them; examples comparing a
shared primitive to real Core product content remain Core integration checks.
Library releases are accepted through their consuming application rollout, not
by deploying a dummy library service. SDK's compatibility workspace can be
removed by the same direct-dependency mechanism.

LLM Runner completion requires replacing Core's implicit local CLI spawning and
profile/MCP inspection with configured runner operations. Existing remote run,
profile transcript and auth-status ports should be reused; missing operations
need owner contracts and tests before Core loses its fallback. Preserve Core
upload/resource authorization and runner profile-volume isolation throughout.
