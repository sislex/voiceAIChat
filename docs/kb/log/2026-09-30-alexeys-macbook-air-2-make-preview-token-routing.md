---
title: make-preview-token-routing
date: 2026-09-30
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# make-preview-token-routing

## Changes

- Raised Core's bounded Fastify route parameter limit to 1024 characters.
- Added a regression for preview-sized and oversized paths.

## Findings

- The UUID-based signed Make preview token exceeds Fastify's default 100-character parameter limit.
- Both Core and standalone Make must accept the token before browser engines can inspect a project preview.

## Knowledge base

- docs/kb/features/make-browser.md

## Remaining

- Release both services and repeat the production browser check.
