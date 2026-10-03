---
title: c04-compose-env
date: 2026-10-03
machine: alexeys-macbook-air-2
author: unknown
---

# c04-compose-env

## Changes

- Added the side-effect-free `compose_env.py get/chain` CLI and moved apply's base-chain resolution into it.
- Resolve overrides from process, checkout `.env`, then the default directory; keep `current.yml` last exactly once.
- Added parser and fake-Docker regressions; all 18 environment script tests pass.

## Findings

- Invalid dotenv input exits 3 in the helper and maps to apply's configuration exit 2 before any Docker calls.
- Process settings take precedence; literal dotenv parsing never evaluates shell expressions.

## Documentation

- docs/kb/deploy.md, environments section.

## Remaining validation

- The supervisor must run the required changed gate. In this sandbox npm exits 255; the directly invoked planner reports `spawnSync git EPERM` and falls back to the full gate, which is reserved for the supervisor.
- No TypeScript package changed; Python mypy is unavailable. Shell syntax and Python compilation checks are run locally.
- No deployment, commissioning, commit or push was performed.
