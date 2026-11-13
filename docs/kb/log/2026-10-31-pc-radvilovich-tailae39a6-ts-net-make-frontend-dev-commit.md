---
title: make-frontend-dev-commit
date: 2026-10-31
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# make-frontend-dev-commit

## Changes

The shared local stand explicitly sets VC_APPLICATION_DEV=1 for the Make
frontend server. The process fixture verifies that the flag reaches the server.

## Verified facts

The frontend server and build watcher are separate processes. Setting an env
flag inside Make's watcher cannot configure the sibling frontend server.
Core must pass the flag in the make-ui service environment.

## Knowledge topic

- docs/kb/deploy.md: isolated local stand without Docker

## Remaining work

No production deployment was performed.
