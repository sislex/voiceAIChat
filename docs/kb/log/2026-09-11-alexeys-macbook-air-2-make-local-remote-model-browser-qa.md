---
title: Local Make browser QA with remote models
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Local Make browser QA with remote models

## Setup

The user selected `main`; the clean checkout was fast-forwarded to `06b025e0`.
Another session subsequently advanced `main` to `a7b7d1bb` during QA; this
session did not commit or push. The intervening code change concerns chat
response preparation, not Make files.
Built all product frontends and the web shell. Started core with embedded Make
at `http://127.0.0.1:8802`, using a new isolated SQLite database and workshop root
under `/private/tmp/voicechat-make-local-qa/data`. The existing Reader checkout on
8799 was left running. The local admin login uses the credentials supplied by
the user; credentials are not recorded here.

Both model providers were configured against the server's `runner-work` over
SSH. The forward runner health check passed, but the first reverse callback via
the Docker host gateway timed out from the runner. Replaced it with an SSH
reverse Unix-socket forward and a loopback relay inside the runner network
namespace. The callback health check then returned 200 from inside the runner.
No production service configuration or firewall rules were changed.

The in-app browser tool failed before executing JavaScript with a missing
`sandboxPolicy` metadata field, including on retry after the user's restart.
Used a separate Playwright Chromium instance after the sandbox's Chromium
startup restriction was approved. This was not an in-app browser verification.

## Observed results

- Browser login and first-run dismissal succeeded; opening `/#/make` created a
  local Make workshop.
- Russian-to-English interface switching succeeded. The mobile project panel
  at 390 by 844 had equal client and scroll widths and stayed within the viewport.
- Codex on the remote runner read and edited local `index.html` through Make MCP.
  The preview updated to the requested counter page. Clicking `Add one` changed
  the displayed counter from 0 to 1. The model reported `make_check` passing.
- Claude failed authentication with `OAuth session expired and could not be
  refreshed`. The request remained visible as a failed queue item. Its retry was
  submitted after selecting Codex again, but the failed queue item remained.
  Removed that test queue item and sent a fresh request with Codex selected.
  Claude's OAuth state was not changed.
- Local Make self-diagnostics passed all four checks: REST, preview cookie,
  file write/read round trip, and the `make.changed` event.
- The fresh Codex follow-up added `Reset`. Browser clicks verified 0 to 2 to 0;
  both buttons and the generated page survived a full host reload.
- Published the test project on the local listener and opened its link in a
  separate anonymous browser context. The page rendered without login, and its
  counter incremented. No page JavaScript errors were collected in the manual
  browser session.

## Validation

`npm run gate:app -- make` passed with exit code 0 after rerunning outside the
sandbox. It included Make typechecking/tests, server bridge contracts, frontend
and web builds, and all 9 Make browser scenarios: desktop/mobile layout, React
preview, component stories, Monaco editing, publication, Angular rendering,
locale/draft preservation, and localized publication-password feedback.

`npm run gate:app -- make-ui` also passed with exit code 0 after the approved
Chromium rerun. This covered Make UI typechecking and tests, panel build, host
integration checks, and all three frontend artifact browser scenarios, including
desktop worker loading and rejecting a corrupted artifact.
Across both application gates, 268 tests passed, including 12 browser tests.
The documentation-only `npm run gate:fast` completed with exit code 0 and
selected no application checks; `git diff --check` was clean.

## Knowledge base

Added the two-way runner/callback requirements and the tested namespace relay
approach to the runner configuration section in `docs/kb/llm.md`.

## Artifacts and remaining limitation

Local launch helper, private runtime configuration, logs and screenshots are in
`/private/tmp/voicechat-make-local-qa`. Gate logs are
`/private/tmp/make-local-qa-backend-gate.log` and
`/private/tmp/make-local-qa-ui-gate.log`. The server-hosted Claude provider requires
reauthentication before a successful live edit can be verified.
