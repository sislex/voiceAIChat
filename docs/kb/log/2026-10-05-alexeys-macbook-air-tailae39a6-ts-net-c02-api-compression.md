---
title: c02-api-compression
date: 2026-10-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# c02-api-compression

## Changes

- Registered API response compression before Core routes with Brotli/gzip negotiation,
  a strict 1024-byte threshold, streaming/range/upgrade/media exclusions, and focused
  inject tests covering round-trips and Content-Length preservation.

## Findings

- Compression must guard the plugin's per-route response hooks while preserving
  application hooks, and must not read streams to determine their size.

## Documentation

- docs/kb/server-internals.md, HTTP response compression.

## Outstanding verification

- The assigned node_modules lacks @fastify/compress. Its dependency declaration is
  added, but the supervisor must resolve the lockfile and provision the package;
  installation was prohibited and the npm registry could not resolve in the sandbox.
- `npm run test:files -- apps/server/src/httpCompression.test.ts`,
  `npm run -w @voicechat/server typecheck`, and
  `npm run gate:quick -- --base 8e5dc44797952ff3cdcd9aecf7809d30de6673ed`
  each exited 255 before running their checks.
- Direct Vitest execution failed loading @fastify/compress. Direct TypeScript
  execution reported the missing package and its Fastify route type augmentation.
- The affected planner's dry run succeeded but selected gate:all because its git
  subprocess was denied (EPERM). Full/release gates remain supervisor work.
- KB touch/log/index ran through their direct Node entrypoints. The touch command
  could not read git through a subprocess; checked was set to the directly verified
  HEAD. Index output falsely cleared unrelated stale statuses for the same reason,
  so that generated file was restored; regenerate it outside the sandbox.
