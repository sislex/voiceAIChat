---
title: stand-preview-inspector-session
date: 2026-10-30
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# stand-preview-inspector-session

## Changes

- Forward the authenticated lease request cookie through previewInspectorScript to Core's Reader proxy.
- Return an empty 502 for non-2xx executor script responses.
- Cover cookie/origin forwarding, failed upstream statuses, and server wiring with a successful Reader HTTP fixture.

## Verified findings

- Core requires a session for the internal /api/preview/inspector.js request; forwarding only parentOrigin results in 401.

## Updated topic

- docs/kb/server-internals.md#dev-stand-access-proxy

## Scope

- The server wiring test stubs the Reader script response while retaining Core authentication and HTTP proxying. Reader package behavior is owned separately.
