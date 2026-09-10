---
title: English comments and documentation for Make
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# English comments and documentation for Make

## Changes

Translated 486 source-comment blocks in the Make backend, UI, and contract
packages. Translated their three AGENTS files and six dedicated Make plans.
Root and package contributor instructions now require English comments,
documentation, and communication; the commit convention now uses English too.
Historical shared journal entries remain historical records.

Generated HTML/CSS comments, Prometheus HELP text, and exported README.md and
DEPLOY.md now use English. Updated matching fixtures and expectations. Export
tests check generated Markdown across static/Vite and Netlify/Vercel modes,
including the explanation of unsupported API mocks on static hosting.

## Verification

The parser audit found no Russian source comments in the three Make packages.
A separate scan found none in their Markdown or dedicated plans. A Babel AST
comparison confirmed equivalent executable syntax in 66 changed files after
allowing the explicit generated-text translations; two further test files add
export assertions. API identifiers and existing UI labels are preserved.
`npm run gate:fast` completed with exit code 0: 8,146 tests across
31 package runs, all selected typechecks/builds, and 13 browser E2E tests
(7 Make scenarios and 6 frontend-artifact scenarios). Make itself passed 90
backend, 125 UI, and 9 contract tests. Compiler, lint, and test directives were
compared separately: all 12 remained intact. `git diff --check` passed.

Two earlier gate attempts stopped on missing Electron dependencies in the fresh
worktree. Root npm ci excludes desktop, agent-tray, and login-application. Their
separate installs and targeted checks succeeded, then the complete gate passed.
Root setup instructions and conventions now record all three packages.

The first pre-PR `npm run gate` attempt hit an intermittent failure in the
unchanged browser-runner `sessionDiagnostics.test.ts`: the failedOnly assertion
observed one network failure instead of two. The test waits for the transport
failure before asserting that the separate HTTP 503 request is also available.
An immediate isolated rerun passed all 15 tests without code changes.
The complete pre-PR gate rerun then passed with exit code 0, including all 329
browser-runner tests: 8,146 package tests across 31 runs, all selected typechecks
and builds, and 13 Chromium E2E scenarios.

## Location and scope

Work is in the `feat/make-english-documentation` worktree based on c28239cd.
The original checkout's uncommitted independent-application workflow KB notes
were preserved. The user's subsequent PR request authorizes committing and
publishing this branch for review.
