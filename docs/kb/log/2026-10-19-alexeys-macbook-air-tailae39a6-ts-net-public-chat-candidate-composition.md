---
title: public-chat-candidate-composition
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Public chat candidate composition

Pin clean immutable candidate archives from the Identity registration fix,
Billing daily admission policy and verified text-only LLM Runner branches.
These are review candidates, not new official owner version tags.

The Core accounting integration test verifies a real HTTP Billing admission
below the daily threshold, settlement above it, account balance and denial
of the next runner dispatch. All 12 accounting integration tests passed.

A clean npm installation exposed stale runner dependency metadata. The owner
manifest now matches contracts 0.1.2; refreshing that lock entry from the new
archive was also necessary because pin replacement retained old dependencies.
Clean Core installation then passed.

Use `chat,identity` for public chat and its account/quota page. Voice and other
product applications remain disabled. Documented in `docs/kb/deploy.md` and
`docs/plans/public-chat-v1.md`. Stand and release evidence are still pending.

The candidate also includes the Core UI daily balance archive and refreshes
compatible security fixes in runtime dependencies. Core pins sharp 0.35.5
consistently; the Identity owner removes unused Nodemailer dependencies.
The complete composition gate validates the final dependency graph.

Refreshing Identity's lock metadata also exposed its newer Shared peer range.
Core's local source includes the published 0.1.41 contract commit, so the
workspace manifest now reports that version. Explicit overrides select this
contract for the two legacy Chat UI/Chat App exact 0.1.10 peers. Identity retains
its actual minimum requirement. Clean installation and the full composition
gate must validate the resulting dependency graph.

The first complete composition gate caught missing reasoning-control mappings
in the newer standalone Runner. Its owner restores the existing Core contract,
including text-only execution, with unit/HTTP tests and actual offline Codex wire
probes on Mac and Docker. The S3 provider inventory is refreshed with the new
immutable owner pins; no historical provenance or source checks are bypassed.

The Core throttled browser gate also exposed an unread quota error response in
Core UI. The owner consumes error bodies before rejecting. A copied built UI
artifact passes the original route/resource tests; final published-pin acceptance
is still required. Diagnostic timeouts now list pending paths, and a local-only
artifact override supports consumer reproductions without owner source imports.

Forward the daily admission settings through the standard Billing Compose layer.
An actual Compose config test verifies the approved threshold/time zone, an unset
legacy policy, zero and explicit empty input without substituting defaults.

The cancellation audit found that an unaddressed legacy WebSocket cancel could
reach the process-global cancel-all method. The session now enumerates only its
user's active turns and checks the selected tenant. A real WebSocket regression
test keeps another user's turn and the same user's other-tenant turn active.

The public file-output endpoint also ignores saved workdirs, common upload roots
and runner filesystem proxies in text-only mode. Own Core output files remain
readable. HTTP tests verify foreign-file, shared-upload and symlink denial, and
prove that a caller-controlled workdir cannot authorize private installation files.

Validation: the required quick gate expanded to the complete Core gate and
passed, including all 53 enabled browser integration checks against the installed
UI archive from 7c853031318cf52622665a2666d526427b8e09f5. The final file-boundary
changes also passed server typecheck and 12 focused file/proxy tests. Stand
cutover and real Core/Billing acceptance remain pending at this source checkpoint.
