# Agent and Desktop ownership

## Scope

Move the companion runtime, protocol, installers, tray and enrollment application
to `sislex/agent`, and the Electron chat client to `sislex/desktop`. Each owner
must install, test and build without a Core checkout. Core consumes immutable
owner artifacts and keeps authorization, machine registry and integration checks.
The chat UI remains Core-owned and is published as a versioned renderer artifact.

## Acceptance

- [x] Agent owns runtime/protocol/installer/client tests and independently builds.
- [x] Desktop consumes released Agent and chat renderer artifacts; no source aliases.
- [x] Core removes transferred paths and consumes published owner archives.
- [ ] Owner and Core gates pass, PRs merge and release artifacts are pinned.
- [ ] Deploy through installed voicechat-deploy and verify production and downloads.
- [ ] Optimize gates after deployment, preserving integration coverage; measure stages.

## Gate follow-up

The full fallback repeats applicationFrontend E2E after gate:all. Desktop npm ci
is unconditional, and route inventories recompute gzip/Brotli sizes. Remove repeated
work with content/runtime validation; do not omit integration cases or relax budgets.
