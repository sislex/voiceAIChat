---
title: recovery-health-target-binding
date: 2026-10-20
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# recovery-health-target-binding

Reviewed the operational commits entering Core main. A synthetic regression
proved that unchanged inventory from stack B could clear stack A's uncertain
deployment when the separate health response carried the same previous commit.

The recovery helper now requires a local Docker Unix socket and binds the
operation's literal-loopback HTTP health endpoint to the selected Core
container's published port and IP family. Proxy use, redirects and ambiguous
targets fail closed before health observation or receipt creation. Existing
operation locks, failed-exit evidence and fenced-delivery refusal remain intact.
Documented the accepted proof and unsupported target layouts in
`docs/kb/deploy.md`.

Validation: the new cross-stack regression failed before the implementation;
all 11 recovery tests pass afterward, including CLI journal preservation,
remote-daemon refusal and IPv4/IPv6 bindings. Tests use disposable synthetic
records and mocked Docker/HTTP calls; no live recovery or deployment was run.
The quick-gate dry run requires `gate:all`; the release integrator will run this
required gate together with the final owner pins before committing this patch.
