---
title: chat451-machines
date: 2026-09-12
machine: germany-4-8-60
author: unknown
---

# chat451-machines

## Changes

Machine utilities now provide per-agent history and cached path completion, bounded text preview, multiple selection, independent utility segments, xterm controls, fleet preferences and filtered TXT export. Regression tests carry CHAT-451 test-case markers.

## Verified findings

Full agent reads remain capped at 32 MiB. The new fs.read-prefix operation physically reads at most 204800 bytes and requires agent 0.17.0; unsupported agents never fall back to full reading. The preview decoder suppresses incomplete terminal UTF-8 only for truncated responses.

The previous brief parser could discard substantive trailing text after a known prefix. Parsing the whole remainder prevents that loss. Runtime validation also explicitly rejects unknown testType values.

The required gate also exposed a Browser Runner test race between independent socket-failure and HTTP 503 events. The test now waits for both entries while preserving its assertions.

## Documentation

- docs/kb/machines.md
- docs/kb/features/task-preparation.md
