---
title: sisl-731-agent-download-cache
date: 2026-10-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: voicechat-ci
---

# sisl-731-agent-download-cache

## Changes

- Preserved the three no-store download routes and TC-1/TC-2 regression coverage.
- Added TC-3 for Error and non-Error bundle failures: status 500, exact JSON error and no successful-download headers.

## Verified knowledge

- Cache-Control is exactly no-store for successful Linux/macOS installer and agent bundle downloads; existing content headers and body bytes are preserved.
- The catch branch remains a JSON error response.

## Updated topic

- docs/kb/machines.md (TC-4: agent installation HTTP contract).

## Scope

- Development Brief and kanban changes were explicitly excluded by the user.
