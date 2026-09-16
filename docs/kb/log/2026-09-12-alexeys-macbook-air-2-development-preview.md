---
title: development-preview
date: 2026-09-12
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# development-preview

## Changes

Added opt-in development-preview settings, failure policy, lifecycle persistence, CI MCP operations, Docker isolation, scoped Claude generation, browser evidence adapter and run-feed controls. Added contract/unit tests and an opt-in real Docker integration test.

## Verified findings

The existing executionDisabled flag was not a tool-free security boundary. Scoped Claude generation now supplies an empty tool set and strict empty MCP configuration; Codex issuance fails closed. A private-only Docker network did not provide a usable published loopback port; the trusted gateway publishes that port on its egress network with explicit gateway priority.

## Knowledge base

Updated CI runner, feature preview, Playwright Reader, deployment, data/auth, protocol and LLM topics.

## Remaining limits

Browser MCP open/errors/screenshot returned fetch failed in the development session, including for app.internal. No successful browser screenshot or full production-CLI browser E2E was obtained. Codex scoped generation is deliberately unavailable. Dependency images require operator provisioning; arbitrary applications own their migration/seed startup code. The collector reconciles persisted handles rather than discovering all unknown Docker resources.
