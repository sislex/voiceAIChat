# Sislexa component configuration and production checkpoint

Date: 2026-09-20.

Production 0.1.311 (`f425db0991e404f92881182b5d6d3cb33e2feb76`) was deployed
through the installed `voicechat-deploy` at 01:20:07 UTC, after the canonical gate
passed and PR 205 merged. Tool API/UI releases remain independently pinned at
1.0.0. Backup: `/var/backups/voicechat/sislexa-tools-ready-20260920T010101Z`;
the PostgreSQL dump produced 1100 restore-list entries. The production checkout
remained clean on its release branch. Existing external runner overrides and
relays were preserved.

Verified Core release/SHA, all three tool release/full-SHA metadata, internal RPC
null-result probes and missing-credential rejection, unauthenticated Make/Reader
rejection, UI manifest/entry/style integrity, retained 0.1.310 UI assets, recorder,
Browser Runner and external LLM relay health. Public HTTPS passed with the Caddy
root CA; the actual login page loaded through an SSH tunnel without page errors.
A bounded, execution-disabled Codex request returned the exact marker and exit 0
(run `06da40c5-5b74-4473-b1e8-930bb51a0140`). Authenticated human workflows were
not claimed from this smoke check. During image builds, unused Docker builder
cache was pruned to recover disk space; no application volumes/backups were
removed. Final free disk was 6.4 GB and the inspected service containers were up.

The implementation adds shared release/installation schemas, a Node-only
component runtime, provider token registries/CLI, version/grant verification,
Core and tool RPC integration, and per-service private configuration/mounts.
Identity delegation, a durable usage ledger and active-time analytics remain
explicit later stages. Targeted schema/runtime/Core authorization and independent
tool gates passed. The final canonical `npm run gate` exited 0, including all
typechecks, unit/integration tests, builds, route budgets and 31 browser suites
with 807 passing tests. Core 0.1.312 and three tool 1.1.0 releases were published.
Production 0.1.312 reached readiness at 03:03:51 UTC with a temporary Make
bootstrap sentinel; that public sentinel was explicitly rejected by RPC (401).
It supplies no authorization and will be removed by the 1.1.1 tool rollout.

The first 0.1.312 cutover exposed a Make entry-point guard that still demanded
VC_INTERNAL_TOKEN before constructing the managed server. Readiness correctly
kept the deployment red. Make 1.1.1 fixes that guard; its regression test launches
the real process with an empty legacy token, checks readiness and rejects legacy
RPC credentials. Legacy startup still rejects a missing token. The independent
Make gate passed (101 API, 19 contract and 148 UI tests, typechecks and build).
The host pins this immutable patch for release 0.1.313.

The actual Make 1.1.1 Docker image was also started in an isolated container
against the live Core dependency with empty VC_INTERNAL_TOKEN, disposable data
and provider registry. It reached readiness and reported 1.1.1; the temporary
container was removed. Fresh final-rollout backup:
`/var/backups/voicechat/sislexa-managed-final-20260920T030816Z` (381829411-byte
PostgreSQL dump, 1100 restore-list entries, configuration and prior image IDs).

The final host `npm run gate` for the Make 1.1.1 pin exited 0: typechecks, unit
and integration suites, builds, route budgets and 31 browser suites (807 tests).
The 0.1.313 rollout remains pending at this commit.
