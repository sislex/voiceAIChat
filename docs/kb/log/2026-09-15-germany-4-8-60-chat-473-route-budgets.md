---
title: chat-473-route-budgets
date: 2026-09-15
machine: germany-4-8-60
author: unknown
---

# chat-473-route-budgets

## Changes

- Added complete route resource budgets and Web/Electron production-renderer measurements, shared lazy loading with local recovery, and strict preparation-envelope compatibility.

## Verified findings

- Vite's shared preload helper could pull Monaco into the startup dependency graph; explicitly placing it with the React runtime removes that edge.
- Electron renderer compression is calculated for comparison; file-origin traffic needs CDP observation. HTTP 304 is a completed cache revalidation, not a failed chunk.
- Chromium caches a real failed import. Local retries recover loader failures, while a cached module failure needs an explicit guarded refresh; the browser regression retains the persisted chat draft.
- DevelopmentReadiness already validates the complete schema; a separate allowlisted envelope step can preserve strict validation while accepting known neutral introductions.

## Updated topics

- docs/kb/testing-operations.md
- docs/kb/ui.md
- docs/kb/features/task-preparation.md

## Verification limits

- Reduced viewport and safe-area fixtures are emulations, not evidence of a real mobile on-screen keyboard.
