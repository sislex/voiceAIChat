# Complete the started repository extractions

Updated: 2026-09-22.
Status: complete; owner cutover 0.1.323 and follow-up 0.1.324 accepted in production.

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
- [x] Inventory every adapter, remaining implementation import, test, fixture,
  story, build entry and deployment input for Make, both Readers, Voice, Image
  Studio, Identity, Billing, SDK and the independently deployed LLM Runner.
- [x] Publish missing public client/contract/UI artifact exports in owner repos.
  Retain one canonical source for shared contracts during each ownership cutover.
- [x] Move remaining application-owned browser tests/fixtures/stories to their
  owner repositories and run them there before removing the Core copies.
- [x] Replace Core compatibility imports and remove the `sislexaExternal`
  workspaces listed in `docs/kb/architecture.md`.
- [x] Remove Core's embedded LLM Runner implementation and CLI imports after its
  required management/execution operations have independent service contracts.
- [x] Replace source-workspace build/release coupling with owner-built artifacts;
  update Core's application catalog, gate selection, Docker/dev scripts and docs.
- [x] Audit the supplied UI repository and existing UI-library extraction work;
  finish any started transfer of UI Kit/Foundation and their tests there.
- [x] Verify clean independent installs and configurable local launches; run owner
  gates and Core integration gates, release and deploy each coherent increment.
- [x] Perform a final tracked-file/import/test-discovery audit, then mark each
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

UI Kit/Foundation are released from `sislex/sielexa-ui` (PRs #1–#3, v1.0.1). Their
internal tests and pure component stories are owned there; examples comparing a
shared primitive to real Core product content remain Core integration checks.
Library releases are accepted through their consuming application rollout, not
by deploying a dummy library service. SDK's compatibility workspace can be
removed by the same direct-dependency mechanism.

LLM Runner completion requires replacing Core's implicit local CLI spawning and
profile/MCP inspection with configured runner operations. Existing remote run,
profile transcript and auth-status ports should be reused; missing operations
need owner contracts and tests before Core loses its fallback. Preserve Core
upload/resource authorization and runner profile-volume isolation throughout.

## Owner artifacts and consumer validation (2026-09-22)

UI Kit 0.1.2/Foundation 0.1.4 and SDK 1.1.0 replace their Core source/compatibility
workspaces in the active consumer increment. The 25 remaining external adapters
validate source/package provenance; they no longer run owner unit or typecheck
suites. Consumer compilation and bridge tests remain required. Build delegation
and adapter deletion are still pending and must not be marked complete.

Published owner distribution releases now include Make 1.1.5/contracts 1.2.0,
Playwright Reader 1.1.3, Web Reader 1.1.3, Image Studio 1.0.6, Identity 1.2.3,
Voice 1.0.2 and Billing 1.1.2. Make 1.1.5 also owns fourteen pure model modules
and their 51 regression cases; Core copies await the consumer cutover. These
release publications do not constitute production rollout. Browser-runner transfer
to the Playwright Reader repository and Image Studio shutdown/viewer fixes remain
in review/validation. Core production is still 0.1.321 at this point.

The direct-library consumer increment passed both canonical Core gates (exit 0),
including 119 browser cases. Its PR/release and rollout are the next acceptance
steps. Image Studio 1.0.7, Billing 1.1.3 and SDK 1.1.2 supersede the owner versions
listed above; publication remains distinct from consumer/prod cutover.

## Core 0.1.322 and next consumer cutover

PR #226 merged and Core 0.1.322 was deployed with installed `voicechat-deploy`.
UI-library/SDK workspace removal and test-gate separation are now in production.
See deploy.md for acceptance and the unresolved first-load timing observation.

The next isolated worktree removes all 25 compatibility workspaces, consumes
owner-built frontend/recorder artifacts and moves the already-published Make and
recorder helper imports to their contract packages. This work is not yet gated.
Owner image workflows have published Make, Image Studio, Voice, Identity, Billing
and Playwright Reader images; Web Reader publication is running. These images
have not yet replaced the production owner services.

## Remaining shared product modules found during the final audit

Direct workspace removal is not the end of source ownership. Core shared still
contains the Make scaffold/path model and its two suites, Reader/browser models
and validators, and Image Studio shared models. Move the product-owned parts to
the corresponding owner contract packages before claiming full extraction.
Transport adapters and Core permission/orchestration tests remain Core-owned.
The Identity login test-ID assertion also needs an owner-side home; Core must
not inspect published UI source to test its internals.

Make PR #7 and Image Studio PR #33 move the final eight/three product browser
scenarios into their full owner gates. Studio also fixes independent viewport
windowing and the viewer refresh race caught by those migrated scenarios.
Core retains its two Make host-layout and six Studio shell/layout cases.

## Canonical product models (active, 2026-09-22)

Make PR #8 and Playwright Reader PR #7 move their remaining models and contract
tests out of Core Shared. Image Studio PR #34 adds a separately versioned contract
package and moves its retouch/internal payload tests. SDK 1.1.2 already owns the
operation context, usage and billing contracts; Core now removes those duplicate
implementations and tests. Fifty additional model/test files are removed in the
active Core worktree, pending consumer gates and rollout.

The first consumer installation exposed stale root peer ranges in Make/PW 1.2.0.
Patch 1.2.1 corrects those ranges and adds an owner gate that checks published peers
against owner workspace versions. Do not deploy the superseded 1.2.0 distributions.
Web Reader PR #8 consumes canonical Browser leaf exports. This also removes an
eager Core Shared barrel edge that pulled Make template initialization into the
initial host bundle; existing route budget limits remain unchanged. UI PR #5
updates the public Make test fixture to use Make's canonical contract package.

The follow-up owner audit also moves STT/TTS contracts to Voice and consumes its
existing canonical PCM module. Identity owns entitlement/password validation
models and their four unit cases. Shared no longer keeps those implementations;
its remaining tests exercise Core transport and orchestration. The active model
cutover removes 60 files in total (51 product/SDK, five Voice, four Identity).
The complete Core workspace typecheck passes against the current owner release
candidates; canonical gates and production acceptance remain required.

LLM Runner inspection confirms that Core still calls `ensureCliProfile` even
with remote runners configured, and retains local MCP, auth-status and transcript
fallbacks. Removal must use owner RPCs and stop copying CLI credentials into
Core. Core-owned upload/workspace authorization must survive that transition;
runner profile paths and credentials remain private to the runner service.

## Final owner-test audit (active, 2026-09-22)

Identity PR #12 migrates 29 internal authentication/device cases and two standalone
session UI browser cases. The owner gate runs actual Identity routes, storage and
built UI without Core; the geometry/filter tests also tolerate an unavailable
external account-summary provider. Core retains 22 CORS/admin/resource/migration
REST cases and three WebSocket/resource session browser cases. Playwright Reader
PR #9 owns the four remaining address-scheme UI regressions.

Core's third canonical fast gate passed unit suites, builds and unchanged route
budgets, but failed six of 108 browser cases because Reader's frame helper still
re-exported a removed Core Shared symbol. Reader PR #9 fixes the canonical leaf
export and guards that boundary. Core must pass its gate against that published
artifact before rollout; the failed gate is not acceptance.


Identity PRs #12/#13, Reader PRs #9/#10 and UI PR #6 are merged with passing
owner gates. Core's fourth fast gate passed all 108 then-selected browser cases.
The subsequent scheduling audit restored four previously unselected host suites:
sessions, settings, projects and Git pane. Its first run passed 125/127 cases;
the two failures exposed a Linux-only Electron path and a live-provider QA case
mixed into the hermetic gate. Electron now uses its exported platform path, and
the unchanged real voice assertions have an explicit `qa:voice-live` command.
All five settings Chromium/Electron cases pass after this correction; complete
Core gates and rollout are still required.


The final 0.1.323 candidate includes the residual cleanup in the same release:
Image Studio PR #36 / 1.1.2 owns the retouch engine/editor and eight cases;
Identity PRs #14/#15 / 1.3.1 own twelve SQLite session-store cases and fifteen
account-page cases; Runner PRs #9/#10 / 0.3.1 own CLI/history regressions and
publish a public consumer contract archive. Core keeps its TTS performance bridge
case and removes three player-unit duplicates already present in Voice.

Identity's standalone account cases exposed a missing default read cache, which
prevented account tabs from loading without the Core host. Identity 1.3.1 fixes
this with an instance-scoped, bounded cache and verifies expiry, request coalescing,
account isolation and retries. Core retains six host-cache/readiness cases.

Core removes the local runner workspace and implicit CLI/profile creation. New
consumer checks cover authenticated MCP/history forwarding, resume persistence,
management timeouts and user-output authorization. Both final canonical gates
and production acceptance remain open.

All thirteen 0.1.323 owner images are staged by exact published SHA without changing
running services. A fresh private backup was restored into an isolated local
PostgreSQL database and verified before deleting only that temporary restore DB.
Deployment and browser acceptance remain pending.

## Final gate checkpoint

`npm run gate:fast` and `npm run gate` both exited 0, including typechecks,
Core-owned suites, Web/Storybook/Electron builds, unchanged route budgets and
126 browser cases. Identity PR #16 also owns the final two store lifecycle cases;
its owner gate, PR checks and main checks pass. The source/lock audit confirms
31 extracted directories are absent, and all 16 owner-manifest archives match
published SHA/integrity without internal tests or stories. Production acceptance
must still be recorded before closing the last two checklist items.


## Final acceptance (2026-09-22)

Core PR #227 / 0.1.323 completed source, adapter and internal-test removal and
rolled out all owner artifacts. Core PR #228 / 0.1.324 resolved the account usage
query that final acceptance exposed. Both releases used installed voicechat-deploy;
all nine components are ready. See `docs/kb/deploy.md` for exact SHAs, image IDs,
backups, failure/recovery evidence and production timings.

Final browser/API acceptance covers Users/signup, standalone Account at 390px,
Make file write/preview, Image Studio upload/read/delete, Web Reader's iframe,
Playwright Reader's real Chromium frame, provider-specific RPC grants/revocation,
frontend SRI and parallel account/report requests. Real Codex and STT/TTS completed.
The diagnostic account/sessions and its runner profiles were removed. Core retains
host integration checks; product-only suites run in their repositories.

Owner releases: Make 1.2.1, Playwright Reader 1.2.2, Web Reader 1.2.1, Image Studio
1.1.2, Voice 1.1.0, Identity 1.3.1, Billing 1.1.3, LLM Runner 0.3.1, SDK 1.1.2,
and UI release 1.0.3 (Kit 0.1.3/Foundation 0.1.6). Exact release provenance lives
in the lock/manifests rather than floating branch refs. Final test-only follow-ups
include Reader #10, UI #6 and Identity #16; Runner operations acceptance is PR #11.

Existing Claude authentication expiry remains an interactive-login requirement.
This is not an unfinished extraction. Future product services and Release Center
registry/baseline onboarding retain their separately documented scope; this plan
was accepted through the expressly authorized server-side deployment path.
