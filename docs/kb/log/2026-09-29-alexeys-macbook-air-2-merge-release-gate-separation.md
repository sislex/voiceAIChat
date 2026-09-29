---
title: Separate merge checks from release checks
date: 2026-09-29
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Separate merge checks from release checks

## Changes

- Removed the merge runner's fallback to the project's release-oriented test command.
- Rejected an explicitly configured `gate:release` merge command and added regression tests.

## Findings

- A merge started before the merge-only project setting was saved can still use the earlier release command. Future runs use the new configuration.

## Knowledge base

- docs/kb/features/merge-runner.md

## Follow-up

- Existing projects without a merge-only command should configure an owner-specific check instead of relying on the generic `affected-check` fallback.
