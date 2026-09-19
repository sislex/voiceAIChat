---
title: sislexa-project-name
date: 2026-09-20
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# sislexa-project-name

## Changes

Recorded Sislexa as the owner-selected project name in an isolated worktree
created from `origin/main`, as requested by the owner.

## Confirmed facts

The owner confirmed purchasing a domain with the `sislexa` label. The TLD was
not specified. This records a naming decision, not a deployment change.

## Documentation

- `AGENTS.md`: project identity and a link to the detailed record.
- `docs/kb/architecture.md#project-identity`: name, domain purchase confirmation,
  and the relationship to existing repository identifiers.

## Open questions

The full purchased domain name remains unspecified.

## Architecture discussion follow-up

The owner specified separate application repositories and releases, standalone
startup with configured remote dependencies, component access grants, and one
user account/budget across Chat and Make. Captured these requirements and a proposed
identity/delegation/reservation design in `docs/plans/sislexa-modular-platform.md`.
The architecture topic links to the proposal without presenting it as implemented.
The current login-based identity and monthly limit check were verified in code;
their existing description in `docs/kb/data-auth.md` remains the implementation reference.

The owner additionally requested percentage breakdowns of token consumption and
time spent across modules. Extended the proposal with separate consumption/cost
metrics, operation-origin attribution, estimated active-time intervals, deduplication
across tabs/devices, report filters, access control, and missing-data behavior.
