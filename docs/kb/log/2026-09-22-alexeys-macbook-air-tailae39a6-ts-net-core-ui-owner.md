---
title: core-ui-owner
date: 2026-09-22
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# core-ui-owner

## Changes

Moved the Core UI/browser source, stories and internal tests to `sislex/sislexa-core-ui`. Core now verifies a pinned static artifact; its real-server/browser integration remains local. A deterministic contract exporter reads committed shared files and locked peer versions. Documentation: UI, clients, architecture and testing operations.

## Findings

The former UI package contained a browser suite that actually spawned Core and Vite. It belongs to Core API integration and now consumes the published static UI. Published Identity/Foundation still use the legacy `@shared/*` spelling; the UI owner resolves it to the installed contract archive. Fresh dependency resolution changed bundle sizes, so the initial owner lock preserves the Core toolchain and dependency versions instead of relaxing budgets.

## Validation and remaining work

The full owner gate passed in 225 seconds; Core canonical branch gate passed in 505 seconds. Owner CI and Desktop CI passed and their PRs were merged. Web/Desktop route budgets passed unchanged. Core release/deployment acceptance remains pending; see the extraction plan.
