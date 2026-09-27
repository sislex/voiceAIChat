---
title: u10-exact-artifacts
date: 2026-09-27
machine: alexeys-macbook-air-2
author: unknown
---

# u10-exact-artifacts

Pinned the 13 assigned S2 archives, updated npm manifests/lock and added exact
artifact, consumer resource, settings and transport acceptance checks. Desktop's
embedded renderer is verified against every Core UI renderer manifest entry.

Documented the release evidence format and remaining validation in
`docs/kb/testing-operations.md` and `docs/plans/u10-handoff.md`.

Three artifact tests and two local integration checks passed. Loopback transport
requires the supervisor because the sandbox denied port 23000. New xterm peers
are absent from the offline npm cache; complete installation, full release gates,
browser parity and subsequent operator commissioning remain unverified.
