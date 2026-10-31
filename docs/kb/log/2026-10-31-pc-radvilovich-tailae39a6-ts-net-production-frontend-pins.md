---
title: production-frontend-pins
date: 2026-10-31
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# production-frontend-pins

## Changes

Production now prefers pinned frontend archives unless VC_APPLICATION_FRONTENDS_OVERRIDE=1. Development retains local owner overrides. Startup logs identify the source and manifest version/commit. Server integration tests cover both environments, explicit opt-in, inactive owners and startup metadata; route tests cover unpinned sources and missing pinned artifacts.

## Verified findings

The previous gateway always preferred configured sources for local owners, allowing old containers to replace pinned artifacts. UI manifest versions need not equal npm owner versions.

## Knowledge topic

- docs/kb/ui.md — independent product panel artifacts
