---
title: browser-ui-bridge-compat
date: 2026-09-22
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# browser-ui-bridge-compat

## Completed

- Marked the two browser-only release methods as optional on the shared renderer
  bridge while retaining them as typed IPC channels.

## New facts

- UI Foundation's public fake implements the shared Desktop surface. Requiring a
  browser-only operation there would force unrelated library releases and break
  compatibility with older Desktop hosts.

## Documentation

- `docs/kb/shared.md`

## Remaining work

- Core UI handles the optional capability and the web bridge supplies it.
