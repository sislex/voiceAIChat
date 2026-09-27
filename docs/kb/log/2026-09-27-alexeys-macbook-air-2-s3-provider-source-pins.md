---
title: s3-provider-source-pins
date: 2026-09-27
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# S3 provider source pins

## Changes

- Pinned accepted A01–A03 Identity, Billing, and LLM Runner source archives in Core with exact source commits and archive digests.
- Added an executable provenance check and assigned Identity's new application registry tables in the Core ownership manifest.

## Findings

- Importing Identity's client index into the Node server now pulls in browser-only modules; the server must import the specific RPC and server entry points.
- The S2 browser and desktop release snapshot is deliberately separate from S3 provider pins.

## Knowledge topic

- docs/kb/deploy.md

## Remaining work

- A04 must implement delegated principal handling against these accepted provider interfaces before S3 can be accepted.
