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
