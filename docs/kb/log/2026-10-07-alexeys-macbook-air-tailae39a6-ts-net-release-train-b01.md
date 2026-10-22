---
title: release-train-b01
date: 2026-10-07
machine: alexeys-macbook-air-tailae39a6-ts-net
author: delivery
---

# release-train-b01

Implemented read-only owner comparisons, exact pinned-release verification,
Core remote-ref comparison, prerequisite checks and ordered text/JSON output in
`scripts/release-train.mjs`. Shared owner repositories are queried once while
every application remains visible. Added fixture Git and fake GitHub tests and
registered them with the tooling suite.

Documented behavior and operator prerequisites in `docs/kb/deploy.md`.
Execution/resume, actual publication and deployment are subsequent tasks.

Sandbox validation: targeted TypeScript checking passed. Git fixture tests and
the task gate require supervisor execution because Node child-process spawning
returns EPERM. No credentials, sibling workspaces or production services were
accessed. KB index generation also cannot inspect Git freshness in this sandbox;
the supervisor should regenerate the index with Git access.
