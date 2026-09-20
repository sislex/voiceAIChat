---
title: sislexa-production-0310
date: 2026-09-20
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Sislexa foundation production release

PR #204 merged the tested foundation as `48ab7ed2a36952d48f5ca2c68249af4cbde6cf6d`.
The owner explicitly selected the installed `voicechat-deploy` fallback.
Production branch `release/0.1.310` points to that commit; deployment completed
at 2026-09-19 22:44:27 UTC. This was an operator deployment, not a Release Center run.

Both local `gate:fast` and pre-publication `gate` exited 0. Public HTTPS, using
Caddy's root certificate, reported version `0.1.310` / commit `48ab7ed2a369`.
Chromium rendered the login form without page errors. Core, Make, Playwright
Reader, Chromium, and LLM health passed, as did null-result core/tool contract
probes and rejection of missing user/service credentials. External LLM relays
kept their original start times; legacy local work/personal runners stayed off.

A normal Codex request in read-only mode returned the expected smoke-test text
and exit code 0 (run `df3897c1-3d61-434f-996c-5dddb6186336`). An earlier probe used
unsupported `textOnly` mode and timed out; it was canceled before retrying with
the normal request shape. Claude still requires login, as recorded before this
release. Browser-authenticated user workflows were not exercised by this probe.

The first Docker build failed with Debian signature errors while the disk was
98% full. Removing unused build cache older than 24 hours restored 8.8 GiB of
free space; the standard retry passed signature checks and completed. No images,
volumes, application data, or retained runner profiles were removed. After the
release the host had 6.1 GiB free. The private Postgres/configuration backup is
`/var/backups/voicechat/sislexa-foundation-20260919T222535Z`; its dump passed
`pg_restore --list`. Source rollback is `release/0.1.309` / `5169e54033b2`.

Next: extract Make, Playwright Reader, and Web Reader into the requested repos,
validate independent installs/builds and core compatibility, then release again.
