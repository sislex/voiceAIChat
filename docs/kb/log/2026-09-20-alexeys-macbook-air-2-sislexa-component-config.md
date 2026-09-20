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
with 807 passing tests. Publication and production deployment are pending.
