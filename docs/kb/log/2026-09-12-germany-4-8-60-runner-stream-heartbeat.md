---
title: runner-stream-heartbeat
date: 2026-09-12
machine: germany-4-8-60
author: unknown
---

# Runner stream heartbeat

## Changes

The LLM runner emits blank NDJSON keepalives every 15 seconds. It stops them
when a run ends and pauses them during backpressure without extending the
orphan deadline. Existing clients ignore these lines.

## Verified findings

CHAT-446 preparation attempts 1 and 2 failed in knowledge_research with
Body Timeout Error while reading the remote Codex response. The second attempt
was 1c838752-2fb3-4a1d-9f36-bf7917e4d029. The transport used global fetch and
the runner previously emitted only CLI output and exit frames.

The llm-runner gate passed: typecheck, all 90 tests, and build. Regression tests
cover ten minutes of silent CLI execution, real HTTP keepalive delivery,
backpressure, completion, cancellation, client disconnect, and process error.

## Documentation

- docs/kb/llm.md, RemoteLlmClient section.

## Remaining work

Commit, push, and publish the fix through the managed release flow after user
approval. Retry CHAT-446 through the authenticated preparation endpoint and
observe the resulting readiness gates. The browser currently requires login;
the project has no configured test accounts.
